// server/src/lib/wfsGeojsonProxy.js
//
// Endpoint helper: proxy MapServer WFS GetFeature and always return GeoJSON.
//
// ✅ Mandatory query params (from caller):
//   - layers : comma-separated layer names (WFS typeName/typeNames)
//   - bbox   : "minx,miny,maxx,maxy"  (optionally with ",EPSG:xxxx" as 5th part)
//
// Optional query params (pass-through-ish / convenience):
//   - srs / srsName : e.g. "EPSG:4326" (defaults to bbox CRS if provided, else EPSG:4326)
//   - version       : WFS version (default 2.0.0)
//   - limit / count : max features per layer (WFS 2.0 uses COUNT)
//   - startIndex    : paging (WFS 2.0)
//   - outputFormat  : default "geojson"
//
// Notes:
// - We DO NOT allow the client to override `map=`; we force it from config
//   (alias when config.useMapAlias, otherwise full path).
// - We try a single multi-layer WFS call first. If upstream response is not valid JSON,
//   we fall back to one request per layer and merge the FeatureCollections.

const fetch = require('node-fetch');
const { URLSearchParams } = require('url');

/** Build the upstream MapServer URL, forcing the `map` parameter. */
function buildMapservUrl(config, query) {
  const mapParam = config.useMapAlias ? config.currentMapAlias : config.currentMapPath;

  const qs = new URLSearchParams(query || {});
  qs.set('map', mapParam); // force map param (don't allow override)

  return `${config.mapservUrl}?${qs.toString()}`;
}

function parseLayersParam(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) raw = raw.join(',');
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseBBox(raw) {
  if (!raw) return null;

  // Accept "minx,miny,maxx,maxy" or "minx,miny,maxx,maxy,EPSG:xxxx"
  const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 4) return null;

  const nums = parts.slice(0, 4).map(v => Number(v));
  if (nums.some(n => Number.isNaN(n) || !Number.isFinite(n))) return null;

  const crs = parts[4] ? String(parts[4]).trim() : null;
  return { nums, crs, rawParts: parts };
}

function asFeatureCollection(obj) {
  if (!obj) return null;
  if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) return obj;
  // Some servers might return a single Feature
  if (obj.type === 'Feature') return { type: 'FeatureCollection', features: [obj] };
  return null;
}

function mergeFeatureCollections(collections, layerNames) {
  const out = { type: 'FeatureCollection', features: [] };
  for (let i = 0; i < collections.length; i++) {
    const fc = collections[i];
    const layer = layerNames?.[i];

    if (!fc || !Array.isArray(fc.features)) continue;

    for (const f of fc.features) {
      if (layer) {
        f.properties = f.properties || {};
        // Preserve layer provenance without clobbering user fields
        if (f.properties._layer == null) f.properties._layer = layer;
      }
      out.features.push(f);
    }
  }
  return out;
}

async function fetchJsonOrText(url, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch(url, { signal: ac.signal });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    const bodyText = await r.text();

    const ok = r.ok;

    // Best-effort parse when content-type looks like json OR body starts like json
    const looksJson = ct.includes('json') || /^\s*[{[]/.test(bodyText || '');
    if (looksJson) {
      try {
        return { ok, status: r.status, json: JSON.parse(bodyText), text: bodyText, contentType: ct };
      } catch (_e) {
        // fall through
      }
    }

    return { ok, status: r.status, json: null, text: bodyText, contentType: ct };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Factory returning an Express handler.
 * IMPORTANT: pass the config OBJECT (not destructured values) so in-memory updates propagate.
 */
function createWfsGeojsonProxy(config) {
  return async function wfsGeojsonProxy(req, res) {
    try {
      const layers = parseLayersParam(req.query.layers);
      const bbox = parseBBox(req.query.bbox);

      if (!layers.length) {
        return res.status(400).json({ ok: false, error: 'Missing required param: layers' });
      }
      if (!bbox) {
        return res.status(400).json({ ok: false, error: 'Missing or invalid required param: bbox' });
      }

      // Optional
      const version = String(req.query.version || '2.0.0');
      const outputFormat = String(req.query.outputFormat || 'geojson');
      const srsName = String(req.query.srsName || req.query.srs || bbox.crs || 'EPSG:4326');

      const limit = req.query.count ?? req.query.limit ?? req.query.maxFeatures ?? null;
      const startIndex = req.query.startIndex ?? null;

      // Build base WFS query.
      // We set both `typeName` (WFS 1.x) and `typeNames` (WFS 2.0) for compatibility.
      const baseQuery = {
        service: 'WFS',
        request: 'GetFeature',
        version,
        outputFormat,
        srsName,
        bbox: bbox.rawParts.join(','),
      };

      if (limit != null && String(limit).trim() !== '') {
        // WFS 2.0 uses COUNT. Some servers also accept MAXFEATURES.
        baseQuery.count = String(limit);
        baseQuery.maxfeatures = String(limit);
      }
      if (startIndex != null && String(startIndex).trim() !== '') {
        baseQuery.startIndex = String(startIndex);
      }

      // 1) Try single request for all layers (if server supports multiple typenames)
      const multi = { ...baseQuery };
      multi.typeName = layers.join(',');  // WFS 1.0/1.1
      multi.typeNames = layers.join(','); // WFS 2.0

      const multiUrl = buildMapservUrl(config, multi);
      console.log(`[wfs-geojson] multi → ${multiUrl}`);

      const r1 = await fetchJsonOrText(multiUrl);
      const fc1 = r1.json ? asFeatureCollection(r1.json) : null;

      if (r1.ok && fc1) {
        res.set('Content-Type', 'application/geo+json; charset=utf-8');
        return res.status(200).send(JSON.stringify(fc1));
      }

      // If upstream errored, we still allow fallback (sometimes multi-type is not supported)
      // 2) Fallback: one request per layer, merge
      const collections = [];
      for (const layer of layers) {
        const q = { ...baseQuery, typeName: layer, typeNames: layer };
        const url = buildMapservUrl(config, q);
        console.log(`[wfs-geojson] layer=${layer} → ${url}`);

        const rr = await fetchJsonOrText(url);
        const fc = rr.json ? asFeatureCollection(rr.json) : null;

        if (!rr.ok) {
          // Fail fast with upstream details
          return res.status(502).json({
            ok: false,
            error: 'Upstream MapServer WFS error',
            layer,
            upstreamStatus: rr.status,
            upstreamContentType: rr.contentType,
            upstreamBody: (rr.text || '').slice(0, 2000), // avoid huge payloads
          });
        }
        if (!fc) {
          return res.status(502).json({
            ok: false,
            error: 'Upstream did not return GeoJSON (FeatureCollection)',
            layer,
            upstreamStatus: rr.status,
            upstreamContentType: rr.contentType,
            upstreamBody: (rr.text || '').slice(0, 2000),
            hint: 'Try setting outputFormat=geojson (or the correct MapServer GeoJSON outputFormat).',
          });
        }

        collections.push(fc);
      }

      const merged = mergeFeatureCollections(collections, layers);
      res.set('Content-Type', 'application/geo+json; charset=utf-8');
      return res.status(200).send(JSON.stringify(merged));
    } catch (e) {
      console.error('[wfs-geojson] error:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
}

module.exports = { createWfsGeojsonProxy };
