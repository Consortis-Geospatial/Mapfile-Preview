// server/src/routes/mapfilePaths.js
//
// Returns the base folders permitted by MS_MAP_PATTERN (MapServer global config).
// This is useful for a UI dropdown / table of "allowed mapfile paths".
//
// Reads:
//   - server/src/config.js (config.mapserverConfPath)
//   - The referenced mapserver.conf file and extracts ENV / MS_MAP_PATTERN
//
// Endpoint:
//   GET /api/mapfile/paths
//
// Response example:
// {
//   "ok": true,
//   "mapserverConfPath": "C:\\data\\maps\\mapserver.conf",
//   "msMapPattern": "^(?:(?:C:)?[\\/]data[\\/]maps[\\/]|...)...",
//   "paths": ["C:\\data\\maps\\", "D:\\mapdata\\mapfiles\\"]
// }

const express = require('express');
const fs = require('fs');

const config = require('../config');

const router = express.Router();

/**
 * Extract the MS_MAP_PATTERN value from a mapserver.conf file (ENV block).
 */
function readMsMapPattern(confText) {
  // Matches: MS_MAP_PATTERN "...."
  const m = confText.match(/^\s*MS_MAP_PATTERN\s+"([^"]+)"\s*$/m);
  return m ? m[1] : null;
}

/**
 * Split a string by '|' at depth 0 (ignoring nested (...) groups).
 */
function splitTopLevelAlternatives(s) {
  const alts = [];
  let cur = '';
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = i > 0 ? s[i - 1] : '';

    if (ch === '(' && prev !== '\\') depth++;
    if (ch === ')' && prev !== '\\') depth = Math.max(0, depth - 1);

    if (ch === '|' && depth === 0) {
      alts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }

  if (cur) alts.push(cur);
  return alts.map(a => a.trim()).filter(Boolean);
}

/**
 * Try to extract the *base directories* allowed by an MS_MAP_PATTERN regex.
 *
 * Works best with the recommended MapServer pattern structure:
 *   ^(?:(?:C:)?[\\/]data[\\/]maps[\\/]|(?:D:)?[\\/]mapdata[\\/]mapfiles[\\/])...
 */
function extractAllowedRootsFromMsMapPattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return [];

  // Find the first non-capturing group after '^' (the "root folders" group)
  const caret = pattern.indexOf('^');
  const start = pattern.indexOf('(?:', caret >= 0 ? caret + 1 : 0);
  if (start === -1) return [];

  // Find matching ')' for that group
  let depth = 0;
  let end = -1;
  for (let i = start; i < pattern.length; i++) {
    const ch = pattern[i];
    const prev = i > 0 ? pattern[i - 1] : '';
    if (ch === '(' && prev !== '\\') depth++;
    if (ch === ')' && prev !== '\\') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  // Content inside the first (?: ... ) group (excluding "(?:" and ")")
  const group = pattern.slice(start + 3, end);

  // Top-level alternatives are the allowed root directory regexes
  const alts = splitTopLevelAlternatives(group);

  // Convert each alt-regex into a readable folder path.
  const roots = [];
  for (let alt of alts) {
    // Example alt: (?:C:)?[\\/]data[\\/]maps[\\/]
    // 1) Replace optional drive: (?:C:)? => C:
    alt = alt.replace(/\(\?:([A-Za-z]):\)\?/g, '$1:');

    // 2) Replace [\\/] path separator class => '/'
    alt = alt.replace(/\[\\\\\/\]/g, '/');

    // 3) Remove basic escapes
    alt = alt.replace(/\\\./g, '.'); // '\.' => '.'
    alt = alt.replace(/\\-/g, '-');  // '\-' => '-'

    // Ensure trailing '/'
    if (!alt.endsWith('/')) alt += '/';

    // Windows?
    let root = alt;
    if (/^[A-Za-z]:\//.test(root)) {
      root = root.replace(/\//g, '\\');
      if (!root.endsWith('\\')) root += '\\';
    } else {
      root = root.replace(/\/{2,}/g, '/');
    }

    roots.push(root);
  }

  // Deduplicate + sort
  return Array.from(new Set(roots)).sort((a, b) => a.localeCompare(b));
}

router.get('/mapfile/paths', (req, res) => {
  try {
    const confPath = config.mapserverConfPath;

    if (!confPath) {
      return res.status(500).json({
        ok: false,
        error: 'config.mapserverConfPath is empty. Set MAPSERVER_CONF or MAPSERVER_CONFIG_FILE.'
      });
    }

    if (!fs.existsSync(confPath)) {
      return res.status(404).json({
        ok: false,
        error: `mapserver.conf not found at: ${confPath}`,
        mapserverConfPath: confPath
      });
    }

    const confText = fs.readFileSync(confPath, 'utf8');
    const msMapPattern = readMsMapPattern(confText);

    if (!msMapPattern) {
      return res.json({
        ok: true,
        mapserverConfPath: confPath,
        msMapPattern: null,
        paths: [],
        note: 'MS_MAP_PATTERN not found in mapserver.conf (ENV block).'
      });
    }

    const roots = extractAllowedRootsFromMsMapPattern(msMapPattern);

    return res.json({
      ok: true,
      mapserverConfPath: confPath,
      msMapPattern,
      paths: roots
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

module.exports = router;
