// server/src/lib/wfs_support_checker.js
//
// Mapfile-based ("offline") WFS support checker (STRICT mode).
//
// Goal
// ----
// Mark a layer as WFS-supported ONLY when it is explicitly enabled for
// GetFeature requests via metadata, and also provides basic WFS metadata.
//
// Strict rules
// ------------
// A layer is considered WFS supported if ALL conditions are true:
// 1) WFS is explicitly enabled via one of these metadata keys:
//      - "wfs_enable_request"  OR
//      - "ows_enable_request"
//    ...either on the LAYER's METADATA block OR inherited from WEB/METADATA.
//    The value must allow GetFeature (or be "*" / "all").
//
// 2) The layer provides basic identification metadata (layer-scoped):
//      - title: "wfs_title" OR "ows_title"
//      - srs  : "wfs_srs"   OR "ows_srs"
//
// 3) The layer is NOT TYPE RASTER (WFS is vector-only).
//
// Output
// ------
// getWfsSupportMap(mapfileText) =>
//   { [layerName]: { supported: boolean, reasons: string[] } }

function stripComments(line) {
  // Remove MapServer comments starting with #, but keep # inside quotes.
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
  // Reads value from:
  //   NAME "roads"
  //   TYPE POLYGON
  const re = new RegExp(`^\\s*${keyUpper}\\s+(.+?)\\s*$`, 'i');
  const m = line.match(re);
  if (!m) return null;
  let v = m[1].trim();
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
  return v;
}

function parseMetadataKV(line) {
  // METADATA lines are usually:
  //   "wfs_title" "My Title"
  //   "ows_enable_request" "*"
  // or sometimes unquoted keys.
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

function normalizeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    out[String(k).toLowerCase()] = v;
  }
  return out;
}

function valueIncludesGetFeature(v) {
  const s = String(v || '').toLowerCase();
  // Common patterns in MapServer configs:
  //   "GetCapabilities GetFeature"
  //   "*"
  //   "all"
  return s.includes('getfeature') || s.includes('*') || s.includes('all');
}

function valueLooksDisabled(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '' || s === 'none' || s === '0' || s === 'false' || s === 'off';
}

function hasAny(metaLower, keys) {
  return keys.some(k => metaLower[k] != null && String(metaLower[k]).trim() !== '');
}

function computeWfsSupportForLayer(layer, layerMetaLower, webMetaLower) {
  const reasons = [];

  // 3) Vector-only
  const typeUpper = String(layer.type || '').toUpperCase();
  if (typeUpper === 'RASTER') {
    return { supported: false, reasons: ['TYPE=RASTER (WFS is vector-only)'] };
  }

  // 1) Explicit enable request (layer-scoped first, then WEB fallback)
  let enableKey = null;
  let enableVal = null;
  let enableScope = null;

  if (layerMetaLower.wfs_enable_request != null) {
    enableKey = 'wfs_enable_request';
    enableVal = layerMetaLower.wfs_enable_request;
    enableScope = 'layer';
  } else if (layerMetaLower.ows_enable_request != null) {
    enableKey = 'ows_enable_request';
    enableVal = layerMetaLower.ows_enable_request;
    enableScope = 'layer';
  } else if (webMetaLower.wfs_enable_request != null) {
    enableKey = 'wfs_enable_request';
    enableVal = webMetaLower.wfs_enable_request;
    enableScope = 'web';
  } else if (webMetaLower.ows_enable_request != null) {
    enableKey = 'ows_enable_request';
    enableVal = webMetaLower.ows_enable_request;
    enableScope = 'web';
  }

  if (!enableKey) {
    return {
      supported: false,
      reasons: ['missing enable metadata (wfs_enable_request / ows_enable_request)'],
    };
  }

  reasons.push(`${enableKey}=${String(enableVal)} (scope=${enableScope})`);

  if (valueLooksDisabled(enableVal) || !valueIncludesGetFeature(enableVal)) {
    return { supported: false, reasons: [...reasons, 'enable metadata does not allow GetFeature'] };
  }

  // 2) Basic WFS metadata (layer-scoped)
  const hasTitle = hasAny(layerMetaLower, ['wfs_title', 'ows_title']);
  const hasSrs = hasAny(layerMetaLower, ['wfs_srs', 'ows_srs']);

  if (!hasTitle || !hasSrs) {
    const miss = [];
    if (!hasTitle) miss.push('missing wfs_title/ows_title');
    if (!hasSrs) miss.push('missing wfs_srs/ows_srs');
    return { supported: false, reasons: [...reasons, ...miss] };
  }

  reasons.push('has basic WFS metadata (title + srs)');
  return { supported: true, reasons };
}

function getWfsSupportMap(mapfileText) {
  const supportMap = {};

  // WEB/METADATA (map-level) can define enable rules globally
  let webMetadata = {};

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

  const lines = String(mapfileText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const noComments = stripComments(rawLine);
    const line = noComments.trim();
    if (!line) continue;

    const tok = firstTokenUpper(line);

    if (tok === 'END') {
      const popped = stack.pop();
      if (popped === 'LAYER' && currentLayer) {
        const name = currentLayer.name;
        if (name) {
          const layerMetaLower = normalizeMeta(currentLayer.metadata);
          const webMetaLower = normalizeMeta(webMetadata);
          supportMap[name] = computeWfsSupportForLayer(currentLayer, layerMetaLower, webMetaLower);
        }
        currentLayer = null;
      }
      continue;
    }

    if (tok && BLOCK_START.has(tok)) {
      stack.push(tok);
      if (tok === 'LAYER') {
        currentLayer = { name: null, type: null, metadata: {} };
      }
      continue;
    }

    // WEB/METADATA (map-level, not inside LAYER)
    const inMetadata = stack[stack.length - 1] === 'METADATA';
    const inWeb = stack.includes('WEB');
    const inLayer = stack.includes('LAYER');

    if (inMetadata && inWeb && !inLayer) {
      const kv = parseMetadataKV(line);
      if (kv && kv.key) webMetadata[kv.key] = kv.value;
      continue;
    }

    if (!currentLayer) continue;

    // Top-level directives in LAYER
    if (stack[stack.length - 1] === 'LAYER') {
      const name = parseDirectiveValue(line, 'NAME');
      if (name !== null) currentLayer.name = name;

      const type = parseDirectiveValue(line, 'TYPE');
      if (type !== null) currentLayer.type = type;

      continue;
    }

    // METADATA block inside current layer
    if (inMetadata && inLayer) {
      const kv = parseMetadataKV(line);
      if (kv && kv.key) currentLayer.metadata[kv.key] = kv.value;
    }
  }

  return supportMap;
}

module.exports = {
  getWfsSupportMap,
};
