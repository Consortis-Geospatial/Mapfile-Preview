// server/src/lib/mapBuilder.js
const fs = require('fs-extra');

function toSafeAlias(s) {
    return String(s || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function toSafeFileName(s) {
    const base = String(s || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!base.toLowerCase().endsWith('.map')) return `${base}.map`;
    return base;
}

function normalizePath(p) {
    return String(p || '').replace(/\\/g, '/');
}

function parseExtent(extent, fallback) {
    // δέχεται [minx,miny,maxx,maxy] ή "minx miny maxx maxy"
    if (Array.isArray(extent) && extent.length === 4) return extent.map(Number);
    if (typeof extent === 'string') {
        const parts = extent.trim().split(/\s+/).map(Number);
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) return parts;
    }
    return fallback;
}

function applyTemplate(tpl, vars) {
    return tpl.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/gi, (_m, key) => {
        const k = String(key).toUpperCase();
        return vars[k] != null ? String(vars[k]) : '';
    });
}

async function buildMapFromTemplate({
    templatePath,
    alias,
    name,
    config,
    payload
}) {
    const tpl = await fs.readFile(templatePath, 'utf8');

    const defaultExtent = parseExtent(
        config.defaultExtent,
        [0, 0, 1000, 1000]
    );

    const extent = parseExtent(payload.extent, defaultExtent);
    const epsg = Number(payload.epsg || config.defaultEpsg || 2100);
    const units = String(payload.units || config.defaultUnits || 'METERS');

    const size = Array.isArray(payload.size) && payload.size.length === 2
        ? payload.size.map(Number)
        : (Array.isArray(config.defaultSize) ? config.defaultSize : [800, 600]);

    const fontsetPath = normalizePath(payload.fontsetPath || config.fontsetPath || '');
    const symbolsetPath = normalizePath(payload.symbolsetPath || config.symbolsetPath || '');
    const shapePath = normalizePath(payload.shapePath || config.shapePath || '');

    // online resource: καλύτερα με alias
    const owsOnline =
        payload.owsOnlineResource ||
        `${config.mapservUrl}?map=${encodeURIComponent(alias)}`;

    const vars = {
        MAP_NAME: alias,
        OWS_TITLE: payload.title || name || alias,
        OWS_ABSTRACT: payload.abstract || '',
        OWS_ONLINERESOURCE: owsOnline,
        EPSG: epsg,
        UNITS: units,
        SIZE_X: size[0],
        SIZE_Y: size[1],
        EXTENT_MINX: extent[0],
        EXTENT_MINY: extent[1],
        EXTENT_MAXX: extent[2],
        EXTENT_MAXY: extent[3],

        // optional lines (κρατάμε indentation 2 spaces)
        FONTSET_LINE: fontsetPath ? `  FONTSET "${fontsetPath}"\n` : '',
        SYMBOLSET_LINE: symbolsetPath ? `  SYMBOLSET "${symbolsetPath}"\n` : '',
        SHAPEPATH_LINE: shapePath ? `  SHAPEPATH "${shapePath}"\n` : ''
    };

    // 1) κάνε replace placeholders
    let out = applyTemplate(tpl, vars);

    // 2) μικρό tidy: αν μείνουν “κενές γραμμές” από optional lines
    out = out.replace(/\n{3,}/g, '\n\n');

    return out;
}

module.exports = { toSafeAlias, toSafeFileName, buildMapFromTemplate };
