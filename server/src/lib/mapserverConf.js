// server/src/lib/mapserverConf.js
// Utilities for reading/writing MapServer's global config file (mapserver.conf / mapservr.conf)
// so we can use `map=<ALIAS>` in WMS/CGI calls.
//
// This file focuses on the `MAPS ... END` block, where each entry maps an alias to a .map file:
//
//   MAPS
//     MY_ALIAS "C:/data/maps/my.map"
//   END
//
// Requirement from UI:
// When the user calls POST /api/open with an alias, if that alias does not exist in the config
// file, we should create it automatically.

const fs = require('fs-extra');
const path = require('path');
const os = require('os');

function detectEol(s) {
    if (typeof s !== 'string' || s.length === 0) return os.EOL || '\n';
    return s.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeForConf(p) {
    // MapServer σε Windows συνήθως δέχεται και / αντί για \
    return String(p || '').replace(/\\/g, '/');
}

function ensureMapsBlock(raw, eol) {
    const reMaps = /(^\s*MAPS\s*\r?\n)([\s\S]*?)(^\s*END\s*$)/m;
    if (reMaps.test(raw)) return { raw, created: false };

    // Append a minimal MAPS block at the end (preserve existing content as-is)
    const needsSep = raw && !raw.endsWith(eol);
    const next =
        raw +
        (needsSep ? eol : '') +
        `MAPS${eol}` +
        `END${eol}`;

    return { raw: next, created: true };
}

/**
 * Upsert alias στο MAPS block του mapserver.conf
 * - αν υπάρχει alias: update path (μόνο αν overwrite=true ή αν path είναι ίδιο)
 * - αν δεν υπάρχει: add νέα γραμμή πριν το END
 *
 * Enhancements:
 * - If the config file does not exist, optionally create a minimal one (MAPS..END)
 * - If the MAPS block is missing, optionally create it at the end of the file
 */
async function upsertMapAlias({
    confPath,
    alias,
    mapPath,
    overwrite = false,
    createConfIfMissing = true,
    createMapsBlockIfMissing = true
}) {
    if (!alias) throw new Error('alias is required');
    if (!mapPath) throw new Error('mapPath is required');
    if (!confPath) throw new Error('confPath is required');

    const confMapPath = normalizeForConf(mapPath);

    const existedBefore = await fs.pathExists(confPath);

    // Read (or create) the raw config text
    let raw = '';
    if (existedBefore) {
        raw = await fs.readFile(confPath, 'utf8');
    } else {
        if (!createConfIfMissing) {
            throw new Error(`MapServer config not found: ${confPath}`);
        }
        // Minimal valid config (we only need MAPS for alias usage)
        const eol = os.EOL || '\n';
        raw = `MAPS${eol}END${eol}`;
    }

    const eol = detectEol(raw);

    // Ensure MAPS block exists
    let mapsBlockCreated = false;
    if (createMapsBlockIfMissing) {
        const ensured = ensureMapsBlock(raw, eol);
        raw = ensured.raw;
        mapsBlockCreated = ensured.created;
    }

    const reMaps = /(^\s*MAPS\s*\r?\n)([\s\S]*?)(^\s*END\s*$)/m;
    const m = raw.match(reMaps);
    if (!m) {
        // If we get here, either createMapsBlockIfMissing=false, or file is malformed.
        throw new Error('MAPS block not found in MapServer config');
    }

    const head = raw.slice(0, m.index);
    const mapsHeader = m[1];
    const body = m[2];
    const mapsEndLine = m[3];
    const tail = raw.slice(m.index + m[0].length);

    const lines = body.split(/\r?\n/);

    // Accept only entries of the form: <indent><ALIAS> "<path>"
    const entryRe = /^(\s*)([A-Za-z0-9_]+)\s+"([^"]+)"\s*$/;

    let foundIndex = -1;
    let indent = '    ';

    for (let i = 0; i < lines.length; i++) {
        const mm = lines[i].match(entryRe);
        if (mm) {
            indent = mm[1] || indent;
            const key = mm[2];
            if (key.toUpperCase() === String(alias).toUpperCase()) {
                foundIndex = i;
                break;
            }
        }
    }

    let action = 'noop';

    if (foundIndex >= 0) {
        const mm = lines[foundIndex].match(entryRe);
        const existingPath = mm ? mm[3] : '';
        if (normalizeForConf(existingPath) === confMapPath) {
            action = 'noop';
        } else if (!overwrite) {
            throw new Error(`Alias "${alias}" already exists in MAPS (set overwrite=true to update it)`);
        } else {
            lines[foundIndex] = `${indent}${alias} "${confMapPath}"`;
            action = 'updated';
        }
    } else {
        // Add before trailing empty lines (so we keep a clean END)
        let insertAt = lines.length;
        while (insertAt > 0 && lines[insertAt - 1].trim() === '') insertAt--;
        lines.splice(insertAt, 0, `${indent}${alias} "${confMapPath}"`);
        action = 'added';
    }

    if (action === 'noop' && !mapsBlockCreated && existedBefore) {
        return { ok: true, action, confPath, alias, mapPath: confMapPath };
    }

    const newBody = lines.join(eol);
    const next =
        head +
        mapsHeader +
        newBody +
        (newBody.endsWith(eol) ? '' : eol) +
        mapsEndLine +
        eol +
        tail.replace(/^\s*\r?\n/, ''); // μικρό cleanup

    // Ensure parent directory exists if we are creating the file
    await fs.ensureDir(path.dirname(confPath));

    // backup only if file existed
    if (existedBefore) {
        await fs.copy(confPath, `${confPath}.bak`, { overwrite: true });
    }

    await fs.writeFile(confPath, next, 'utf8');

    return {
        ok: true,
        action,
        confPath,
        alias,
        mapPath: confMapPath,
        ...(existedBefore ? {} : { confCreated: true }),
        ...(mapsBlockCreated ? { mapsBlockCreated: true } : {})
    };
}

module.exports = { upsertMapAlias };
