// server/src/routes/layers.js
//
// Endpoint που διαβάζει το τρέχον config.currentMapPath και επιστρέφει τα layers
// (NAME + προαιρετικά TYPE, TITLE).
//
// Χρήση από UI:
//   GET /api/layers
//
// Σημείωση: Δεν κάνουμε destructuring το config, ώστε αν αλλάξει in-memory από /new ή /save_as
// να “φαίνεται” άμεσα χωρίς restart (ίδια λογική με routes/preview.js).

const express = require('express');
const fs = require('fs-extra');
const config = require('../config');
const { getWfsSupportMap } = require('../lib/wfs_support_checker');

const router = express.Router();

console.log('✅ [routes] layers.js loaded');

function stripComments(line) {
    // Αφαιρεί σχόλια με # εκτός quotes.
    let out = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') inQuote = !inQuote;
        if (!inQuote && ch === '#') break;
        out += ch;
    }
    return out;
}

function firstTokenUpper(line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\b/);
    return m ? m[1].toUpperCase() : null;
}

function parseDirectiveValue(line, keyUpper) {
    // Διαβάζει τιμή από γραμμή τύπου:
    //   NAME "roads"
    //   TYPE POLYGON
    //   TITLE "Roads layer"
    const re = new RegExp(`^\\s*${keyUpper}\\s+(.+?)\\s*$`, 'i');
    const m = line.match(re);
    if (!m) return null;

    let v = m[1].trim();
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    return v;
}

function parseMetadataKV(line) {
    // METADATA lines are often:
    //   "wms_title" "My Title"
    //   "ows_title" "My Title"
    // or sometimes:
    //   wms_title "My Title"
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map(x => x[1]);
    if (quoted.length >= 2) return { key: quoted[0], value: quoted[1] };

    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
        const key = parts[0].replace(/^"+|"+$/g, '');
        const rest = line.trim().slice(parts[0].length).trim();
        const value = rest.replace(/^"+|"+$/g, '');
        if (key && value) return { key, value };
    }
    return null;
}

function extractLayerTitle(layer) {
    // Προτεραιότητα:
    // 1) TITLE directive (αν υπάρχει)
    // 2) METADATA: wms_title / ows_title / title
    if (layer.title) return layer.title;

    const md = layer.metadata || {};
    const keyOrder = ['wms_title', 'ows_title', 'title', 'wfs_title', 'gml_featuretype_title'];
    for (const k of keyOrder) {
        if (md[k]) return md[k];
        if (md[k.toUpperCase()]) return md[k.toUpperCase()];
    }
    return null;
}

function parseLayersFromMapfile(content) {
    const layers = [];
    const stack = [];
    let currentLayer = null;

    const BLOCK_START = new Set([
        'MAP',
        'LAYER',
        'WEB',
        'METADATA',
        'PROJECTION',
        'CLASS',
        'STYLE',
        'LABEL',
        'FEATURE',
        'JOIN',
        'CLUSTER',
        'OUTPUTFORMAT',
        'LEGEND',
        'REFERENCE',
        'QUERYMAP',
        'SCALEBAR',
        'SYMBOL',
    ]);

    const lines = String(content).split(/\r?\n/);

    for (const rawLine of lines) {
        const noComments = stripComments(rawLine);
        const line = noComments.trim();
        if (!line) continue;

        const tok = firstTokenUpper(line);

        if (tok === 'END') {
            const popped = stack.pop();
            if (popped === 'LAYER' && currentLayer) {
                currentLayer.title = extractLayerTitle(currentLayer);
                layers.push({
                    name: currentLayer.name || null,
                    type: currentLayer.type || null,
                    title: currentLayer.title || null,
                });
                currentLayer = null;
            }
            continue;
        }

        if (tok && BLOCK_START.has(tok)) {
            stack.push(tok);
            if (tok === 'LAYER') {
                currentLayer = { name: null, type: null, title: null, metadata: {} };
            }
            continue;
        }

        if (!currentLayer) continue;

        // Top-level directives μέσα στο LAYER
        if (stack[stack.length - 1] === 'LAYER') {
            const name = parseDirectiveValue(line, 'NAME');
            if (name !== null) currentLayer.name = name;

            const type = parseDirectiveValue(line, 'TYPE');
            if (type !== null) currentLayer.type = type;

            const title = parseDirectiveValue(line, 'TITLE');
            if (title !== null) currentLayer.title = title;

            continue;
        }

        // METADATA block που ανήκει στο τρέχον LAYER
        if (stack[stack.length - 1] === 'METADATA' && stack.includes('LAYER')) {
            const kv = parseMetadataKV(line);
            if (kv && kv.key) {
                currentLayer.metadata[kv.key] = kv.value;
            }
        }
    }

    // Θέλουμε μόνο layers που έχουν NAME
    return layers.filter(l => l.name);
}

router.get('/layers', async (_req, res) => {
    try {
        const mapPath = config.currentMapPath;

        const exists = await fs.pathExists(mapPath);
        if (!exists) {
            const msg = `File not found: ${mapPath}`;
            console.warn('⚠️  [GET /layers]', msg);
            return res.status(404).json({ ok: false, error: msg });
        }

        const content = await fs.readFile(mapPath, 'utf8');
        const layers = parseLayersFromMapfile(content);

        // Mapfile-based WFS support check (offline)
        const wfsSupport = getWfsSupportMap(content);
        const layersWithWfs = layers.map(l => {
            const s = wfsSupport[l.name] || { supported: false, reasons: ['not detected'] };
            return {
                ...l,
                wfsSupported: !!s.supported,
                wfsReasons: Array.isArray(s.reasons) ? s.reasons : [],
            };
        });

        return res.json({
            ok: true,
            path: mapPath,
            count: layersWithWfs.length,
            layers: layersWithWfs,
        });
    } catch (err) {
        console.error('💥 [GET /layers] Error:', err);
        return res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
