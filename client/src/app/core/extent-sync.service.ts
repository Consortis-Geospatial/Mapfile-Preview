import { Injectable } from '@angular/core';
import { MapViewportService, Extent } from './map-viewport.service';
import { ProjectionService } from './projection.service';

/**
 * ExtentSyncService
 * ----------------
 * Used by Save / Save As.
 *
 * It takes the current Leaflet viewport extent (stored in MapViewportService as CRS:84 lon/lat)
 * and updates:
 *  - MAP EXTENT (in MAP projection)
 *  - each LAYER EXTENT (in each LAYER projection, falling back to MAP projection)
 *
 * IMPORTANT:
 * - We do best-effort parsing. We only touch EXTENT lines at depth 1 of each MAP/LAYER block.
 */
type SyncOptions = {
    /** If EXTENT is missing, insert it. Default: true */
    addMissing?: boolean;

    /** Update MAP EXTENT. Default: true */
    updateMap?: boolean;

    /** Update LAYER EXTENT. Default: true */
    updateLayers?: boolean;
};

// MapServer "block" starters (keywords that open a block closed by END).
//
// IMPORTANT:
// Some MapServer directives can appear on a single line and MUST NOT be treated as blocks.
// Example: within STYLE you can see lines like: `PATTERN 10 10` (this is NOT a block)
// If we mistakenly count those as blocks, our depth-counting never reaches 0 and we won't find
// the MAP/LAYER END, causing extent sync to silently skip.
//
// So we only treat a line as a block start when the keyword appears *alone* on the line
// (allowing only trailing comments).
const BLOCK_STARTERS_RE =
    /^\s*(MAP|LAYER|CLASS|STYLE|LABEL|WEB|LEGEND|SCALEBAR|QUERYMAP|REFERENCE|GRID|PROJECTION|METADATA|OUTPUTFORMAT|SYMBOL|FEATURE|CLUSTER|JOIN|VALIDATION|COMPOSITE|UNION|POINTS)\b/i;

@Injectable({ providedIn: 'root' })
export class ExtentSyncService {
    constructor(
        private readonly viewport: MapViewportService,
        private readonly proj: ProjectionService
    ) { }

    /**
     * Sync MAP/LAYER EXTENT to current map viewport (CRS:84 lon/lat) stored in MapViewportService.
     * If viewport isn't available yet, returns the input unchanged.
     */
    async syncToCurrentViewport(mapfileText: string, opts: SyncOptions = {}): Promise<string> {
        const snap = this.viewport.getSnapshot();

        console.groupCollapsed('[ExtentSync] 🔄 syncToCurrentViewport');
        console.log('snapshot:', snap);

        if (!snap?.extent4326) {
            console.warn('[ExtentSync] No viewport snapshot yet. Skipping extent sync.');
            console.groupEnd();
            return mapfileText;
        }

        try {
            const out = await this.sync(mapfileText, snap.extent4326, {
                addMissing: true,
                updateMap: true,
                updateLayers: true,
                ...opts
            });
            console.log('changed:', out !== mapfileText);
            return out;
        } finally {
            console.groupEnd();
        }
    }

    async sync(mapfileText: string, viewportExtent4326: Extent, opts: SyncOptions): Promise<string> {
        if (!mapfileText?.trim()) return mapfileText;

        console.groupCollapsed('[ExtentSync] 🗺️ sync');
        console.log('viewportExtent4326:', viewportExtent4326);
        console.log('opts:', opts);

        try {
            const nl = mapfileText.includes('\r\n') ? '\r\n' : '\n';
            const lines = mapfileText.replace(/\r\n/g, '\n').split('\n');

            const mapStart = this.findFirstBlockStart(lines, 'MAP');
            if (mapStart < 0) {
                console.warn('[ExtentSync] MAP block not found.');
                return mapfileText;
            }

            let mapEnd = this.findBlockEnd(lines, mapStart);
            if (mapEnd <= mapStart) {
                // Depth-based parsing can fail if we mistakenly count a directive as a block start.
                // Most real-world mapfiles have the MAP closing END as the last END in the file,
                // so we can safely fall back to that rather than silently skipping extent sync.
                const fallback = this.findLastEndAfter(lines, mapStart);
                if (fallback > mapStart) {
                    console.warn(
                        `[ExtentSync] MAP block END not found via depth-parse. Using last END at line ${fallback} as fallback.`
                    );
                    mapEnd = fallback;
                } else {
                    console.error('[ExtentSync] MAP block END not found.');
                    throw new Error('MAP block END not found');
                }
            }

            const mapCrsFromMap = this.extractCrsFromBlock(lines, mapStart, mapEnd);
            const mapCrsFromLayers = mapCrsFromMap ? null : this.extractFirstLayerCrs(lines, mapStart, mapEnd);
            // Default to CRS:84 (lon/lat) to match Leaflet/UI coordinate order.
            const mapCrs = mapCrsFromMap || mapCrsFromLayers || 'CRS:84';

            if (!mapCrsFromMap && mapCrsFromLayers) {
                console.log('[ExtentSync] MAP CRS missing; using first layer CRS:', mapCrsFromLayers);
            }
            console.log('[ExtentSync] MAP CRS:', mapCrs);

            // 1) MAP EXTENT
            if (opts.updateMap !== false) {
                const mapExtent = await this.proj.projectExtent(viewportExtent4326, 'CRS:84', mapCrs);
                console.log('[ExtentSync] MAP EXTENT -> ' + mapCrs + ':', mapExtent);

                this.replaceOrInsertExtent(lines, mapStart, mapEnd, mapExtent, mapCrs, {
                    addMissing: opts.addMissing !== false,
                    insertStrategy: 'map'
                });

                // Also sync service METADATA extents (if they exist): wms_extent / wfs_extent
                this.replaceMetadataExtentKeysInBlock(lines, mapStart, mapEnd, mapExtent, mapCrs);
            }

            console.log('extent-sync.service.ts -- options for LAYER extent update:', opts.updateLayers);
            // 2) LAYER EXTENT for each LAYER block
            if (opts.updateLayers !== false) {
                for (let i = mapStart + 1; i < mapEnd; i++) {
                    if (this.isComment(lines[i])) continue;
                    if (!/^\s*LAYER\b/i.test(lines[i])) continue;

                    const layerStart = i;
                    const layerEnd = this.findBlockEnd(lines, layerStart);
                    if (layerEnd <= layerStart) continue;

                    const layerName = this.extractLayerName(lines, layerStart, layerEnd) || '(unnamed)';
                    const layerCrs =
                        this.extractCrsFromBlock(lines, layerStart, layerEnd) ||
                        mapCrs ||
                        'CRS:84';

                    const layerExtent = await this.proj.projectExtent(viewportExtent4326, 'CRS:84', layerCrs);

                    console.log(`[ExtentSync] LAYER: ${layerName}`, { layerCrs, layerExtent });

                    this.replaceOrInsertExtent(lines, layerStart, layerEnd, layerExtent, layerCrs, {
                        addMissing: opts.addMissing !== false,
                        insertStrategy: 'layer'
                    });

                    // Also sync layer METADATA extents (if they exist): wms_extent / wfs_extent
                    this.replaceMetadataExtentKeysInBlock(lines, layerStart, layerEnd, layerExtent, layerCrs);

                    i = layerEnd;
                }
            }

            const out = lines.join(nl);
            console.log('done; changed:', out !== mapfileText);
            return out;
        } finally {
            console.groupEnd();
        }
    }

    // -------------------------
    // Parsing helpers
    // -------------------------

    private isComment(line: string) {
        return /^\s*#/.test(line || '');
    }

    private isBlockStart(line: string) {
        if (this.isComment(line)) return false;

        const src = line || '';
        const m = src.match(BLOCK_STARTERS_RE);
        if (!m) return false;

        // Only count as a block start if there's nothing except whitespace (or a trailing comment)
        // after the keyword (e.g., allow: `PROJECTION # comment`, but reject: `PATTERN 10 10`).
        const rest = src.slice(m[0].length).trim();
        return rest.length === 0 || rest.startsWith('#');
    }

    private findFirstBlockStart(lines: string[], keyword: 'MAP' | 'LAYER'): number {
        const re = new RegExp(`^\\s*${keyword}\\b`, 'i');
        for (let i = 0; i < lines.length; i++) {
            if (!this.isComment(lines[i]) && re.test(lines[i])) return i;
        }
        return -1;
    }

    /**
     * Fallback helper: return the index of the last standalone END after startLine.
     * In a typical MapServer mapfile, the MAP closing END is also the last END in the file.
     */
    private findLastEndAfter(lines: string[], startLine: number): number {
        for (let i = lines.length - 1; i > startLine; i--) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;
            if (/^\s*END\b/i.test(line)) return i;
        }
        return startLine;
    }

    private findBlockEnd(lines: string[], startLine: number): number {
        let depth = 1;
        for (let i = startLine + 1; i < lines.length; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                if (depth === 0) return i;
                continue;
            }

            if (this.isBlockStart(line)) {
                depth++;
            }
        }
        return startLine;
    }

    private extractFirstLayerCrs(lines: string[], mapStart: number, mapEnd: number): string | null {
        // Find first LAYER block directly under MAP and use its CRS as a fallback for MAP.
        for (let i = mapStart + 1; i < mapEnd; i++) {
            if (this.isComment(lines[i])) continue;
            if (!/^\s*LAYER\b/i.test(lines[i])) continue;

            const layerStart = i;
            const layerEnd = this.findBlockEnd(lines, layerStart);
            if (layerEnd <= layerStart) continue;

            return this.extractCrsFromBlock(lines, layerStart, layerEnd);
        }
        return null;
    }

    private extractLayerName(lines: string[], start: number, end: number): string | null {
        // Find NAME at depth==1 inside LAYER block (best-effort)
        let depth = 1;
        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                continue;
            }
            if (this.isBlockStart(line)) {
                depth++;
                continue;
            }

            if (depth === 1 && /^\s*NAME\b/i.test(line)) {
                // NAME "roads"  OR  NAME roads
                const m = line.match(/^\s*NAME\s+\"?([^\"\s]+)\"?/i);
                // NOTE: we intentionally match optional quotes only (no leading backslash required)
                return m?.[1] || null;
            }
        }
        return null;
    }

    private extractCrsFromBlock(lines: string[], start: number, end: number): string | null {
        // 1) PROJECTION block
        const proj = this.extractEpsgFromProjection(lines, start, end);
        if (proj) return proj;

        // 2) srid=XXXX (usually inside CONNECTION string)
        const srid = this.extractSrid(lines, start, end);
        if (srid) return `EPSG:${srid}`;

        // 3) METADATA "wms_srs"/"wfs_srs" "EPSG:XXXX ..."
        const meta =
            this.extractEpsgFromMetadata(lines, start, end, 'wfs_srs') ||
            this.extractEpsgFromMetadata(lines, start, end, 'wms_srs');
        if (meta) return meta;

        return null;
    }

    private extractEpsgFromProjection(lines: string[], start: number, end: number): string | null {
        for (let i = start + 1; i <= end; i++) {
            if (this.isComment(lines[i])) continue;
            if (!/^\s*PROJECTION\b/i.test(lines[i])) continue;

            const projStart = i;
            const projEnd = this.findBlockEnd(lines, projStart);
            const txt = lines.slice(projStart, projEnd + 1).join('\n');

            const epsg =
                txt.match(/EPSG\s*:\s*(\d+)/i)?.[1] ||
                txt.match(/init\s*=\s*epsg\s*:\s*(\d+)/i)?.[1];

            return epsg ? `EPSG:${epsg}` : null;
        }
        return null;
    }

    private extractSrid(lines: string[], start: number, end: number): number | null {
        const txt = lines.slice(start, end + 1).join('\n');
        const m = txt.match(/\bsrid\s*=\s*(\d+)/i);
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
    }

    private extractEpsgFromMetadata(lines: string[], start: number, end: number, key: string): string | null {
        const txt = lines.slice(start, end + 1).join('\n');
        const re = new RegExp(`\"${key}\"\\s*\"([^\"]+)\"`, 'i');
        const m = txt.match(re);
        if (!m) return null;

        const val = String(m[1] || '').toUpperCase();
        const epsg = val.match(/EPSG\s*:\s*(\d+)/i)?.[1];
        return epsg ? `EPSG:${epsg}` : null;
    }

    // -------------------------
    // EXTENT rewrite helpers
    // -------------------------

    private formatNum(v: number, crs: string): string {
        const code = String(crs || '').toUpperCase();
        const isDegrees = code === 'EPSG:4326' || code === 'EPSG:4258' || code === 'CRS:84';
        const digits = isDegrees ? 6 : 3;
        if (!Number.isFinite(v)) return '0';
        return Number(v).toFixed(digits);
    }

    private guessInnerIndent(lines: string[], start: number, end: number): string {
        // Find a depth-1 directive line to borrow indentation (typically two spaces).
        let depth = 1;
        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line) || !line.trim()) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                continue;
            }
            if (this.isBlockStart(line)) {
                depth++;
                continue;
            }

            if (depth === 1) {
                return (line.match(/^\s*/)?.[0] ?? '  ') || '  ';
            }
        }
        return '  ';
    }

    private replaceOrInsertExtent(
        lines: string[],
        start: number,
        end: number,
        newExtent: Extent,
        crs: string,
        cfg: { addMissing: boolean; insertStrategy: 'map' | 'layer' }
    ) {
        const indent = this.guessInnerIndent(lines, start, end);
        const extentLine =
            `${indent}EXTENT ` +
            `${this.formatNum(newExtent[0], crs)} ` +
            `${this.formatNum(newExtent[1], crs)} ` +
            `${this.formatNum(newExtent[2], crs)} ` +
            `${this.formatNum(newExtent[3], crs)}`;

        // Replace existing EXTENT at depth==1
        let depth = 1;
        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                continue;
            }
            if (this.isBlockStart(line)) {
                depth++;
                continue;
            }

            console.log('extent-sync.service.ts -- [ExtentSync] checking line for EXTENT:', { i, depth, line });
            if (depth === 1 && /^\s*EXTENT\b/i.test(line)) {
                console.log('[ExtentSync] REPLACE EXTENT line', { i, old: line, next: extentLine });
                lines[i] = extentLine;
                return;
            }
        }

        if (!cfg.addMissing) return;

        const insertAfter = this.findInsertAfterLine(lines, start, end, cfg.insertStrategy);
        const safeAfter = Math.min(Math.max(insertAfter, start), end - 1);
        lines.splice(safeAfter + 1, 0, extentLine);
    }

    // -------------------------
    // METADATA extent rewrite helpers (wms_extent / wfs_extent)
    // -------------------------

    /**
     * Update METADATA entries "wms_extent" and "wfs_extent" (if they exist) inside the given block.
     *
     * We DO NOT add missing entries — we only replace existing ones (per requirement: "αν υπάρχουν").
     *
     * Notes:
     * - Keys may appear in MAP/LAYER METADATA or nested WEB METADATA.
     * - Values are rewritten using the same CRS/precision rules as EXTENT.
     */
    private replaceMetadataExtentKeysInBlock(
        lines: string[],
        start: number,
        end: number,
        newExtent: Extent,
        crs: string,
        keys: Array<'wms_extent' | 'wfs_extent'> = ['wms_extent', 'wfs_extent']
    ) {
        const keySet = new Set(keys.map(k => k.toLowerCase()));
        const nextValue = this.formatExtentValue(newExtent, crs);

        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;
            if (!/^\s*METADATA\b/i.test(line)) continue;

            const metaStart = i;
            const metaEnd = this.findBlockEnd(lines, metaStart);
            if (metaEnd <= metaStart) continue;

            for (let j = metaStart + 1; j < metaEnd; j++) {
                const src = lines[j] || '';
                if (this.isComment(src) || !src.trim()) continue;

                const parsed = this.parseMetadataEntryLine(src);
                if (!parsed) continue;
                if (!keySet.has(parsed.key.toLowerCase())) continue;

                const rendered = this.renderMetadataEntryLine(parsed, nextValue);
                if (rendered !== src) {
                    console.log('[ExtentSync] REPLACE METADATA extent', {
                        line: j,
                        key: parsed.key,
                        old: src,
                        next: rendered
                    });
                    lines[j] = rendered;
                }
            }

            // Skip the whole METADATA block.
            i = metaEnd;
        }
    }

    private formatExtentValue(e: Extent, crs: string): string {
        return (
            `${this.formatNum(e[0], crs)} ` +
            `${this.formatNum(e[1], crs)} ` +
            `${this.formatNum(e[2], crs)} ` +
            `${this.formatNum(e[3], crs)}`
        );
    }

    private parseMetadataEntryLine(line: string): null | {
        indent: string;
        key: string;
        keyQuotedBy: '"' | "'" | null;
        valueQuotedBy: '"' | "'" | null;
        commentRaw: string;
    } {
        const indent = (line.match(/^\s*/)?.[0] ?? '') || '';
        const rest0 = line.slice(indent.length);

        const restTrim = rest0.trimStart();
        if (!restTrim || restTrim.startsWith('#')) return null;

        // ---- Parse key token ----
        let key = '';
        let keyQuotedBy: '"' | "'" | null = null;

        let rest = restTrim;
        const c0 = rest[0];
        if (c0 === '"' || c0 === "'") {
            keyQuotedBy = c0 as any;
            const idx = rest.indexOf(c0, 1);
            if (idx < 0) return null;
            key = rest.slice(1, idx);
            rest = rest.slice(idx + 1).trimStart();
        } else {
            const m = rest.match(/^([A-Za-z0-9_]+)\b/);
            if (!m) return null;
            key = m[1];
            rest = rest.slice(m[0].length).trimStart();
        }

        if (!rest) return null;

        // ---- Parse value token (we don't need to keep the old value) ----
        let valueQuotedBy: '"' | "'" | null = null;
        let commentRaw = '';

        const v0 = rest[0];
        if (v0 === '"' || v0 === "'") {
            valueQuotedBy = v0 as any;
            const idx = rest.indexOf(v0, 1);
            if (idx < 0) return null;
            const after = rest.slice(idx + 1);
            const m = after.match(/(\s*#.*)$/);
            commentRaw = m?.[1] || '';
        } else {
            // Preserve any leading whitespace before a trailing # comment.
            const m = rest.match(/(\s*#.*)$/);
            if (m) commentRaw = m[1];
        }

        return { indent, key, keyQuotedBy, valueQuotedBy, commentRaw };
    }

    private renderMetadataEntryLine(
        parsed: {
            indent: string;
            key: string;
            keyQuotedBy: '"' | "'" | null;
            valueQuotedBy: '"' | "'" | null;
            commentRaw: string;
        },
        value: string
    ): string {
        const keyToken = parsed.keyQuotedBy ? `${parsed.keyQuotedBy}${parsed.key}${parsed.keyQuotedBy}` : parsed.key;
        const valToken = parsed.valueQuotedBy ? `${parsed.valueQuotedBy}${value}${parsed.valueQuotedBy}` : value;
        const comment = parsed.commentRaw || '';

        // Keep a single space between key and value; preserve original trailing comment (including its leading spaces).
        return `${parsed.indent}${keyToken} ${valToken}${comment}`;
    }


    private findInsertAfterLine(lines: string[], start: number, end: number, strategy: 'map' | 'layer'): number {
        // Prefer after PROJECTION block (if exists at depth 1)
        let depth = 1;
        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                continue;
            }

            if (depth === 1 && /^\s*PROJECTION\b/i.test(line)) {
                const projEnd = this.findBlockEnd(lines, i);
                return projEnd;
            }

            if (this.isBlockStart(line)) {
                depth++;
                continue;
            }
        }

        if (strategy === 'map') {
            // Insert after SIZE if present
            depth = 1;
            for (let i = start + 1; i < end; i++) {
                const line = lines[i] || '';
                if (this.isComment(line)) continue;

                if (/^\s*END\b/i.test(line)) {
                    depth--;
                    continue;
                }
                if (this.isBlockStart(line)) {
                    depth++;
                    continue;
                }
                if (depth === 1 && /^\s*SIZE\b/i.test(line)) return i;
            }
            return start;
        }

        // layer: after NAME if present
        depth = 1;
        for (let i = start + 1; i < end; i++) {
            const line = lines[i] || '';
            if (this.isComment(line)) continue;

            if (/^\s*END\b/i.test(line)) {
                depth--;
                continue;
            }
            if (this.isBlockStart(line)) {
                depth++;
                continue;
            }
            if (depth === 1 && /^\s*NAME\b/i.test(line)) return i;
        }
        return start;
    }
}
