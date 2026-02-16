const express = require('express');
const fetch = require('node-fetch');
const { URLSearchParams } = require('url');
// IMPORTANT:
// ΜΗΝ κάνουμε destructuring το config εδώ, γιατί τότε “παγώνουν” οι τιμές.
// Τα routes /new και /save_as ενημερώνουν το config object in-memory (Object.assign)
// και θέλουμε το preview να βλέπει τις νέες τιμές χωρίς restart.
const config = require('../config');

const router = express.Router();

/**
 * Build the upstream MapServer URL by forcing the `map=` parameter to either:
 * - CURRENT_MAP_ALIAS (when USE_MAP_ALIAS=1), or
 * - the absolute path CURRENT_MAP
 *
 * Any user-provided `map` query param is ignored/overridden.
 */
function buildMapservUrl(query) {
  const mapParam = config.useMapAlias ? config.currentMapAlias : config.currentMapPath;

  const qs = new URLSearchParams(query || {});
  qs.set('map', mapParam); // force map param (don't allow override)

  return `${config.mapservUrl}?${qs.toString()}`;
}

/**
 * Transparent WMS proxy.
 * - Forces `map=<alias-or-path>`
 * - Passes through everything else (GetMap, GetLegendGraphic, GetCapabilities, etc.)
 */
router.get('/wms', async (req, res) => {
  const url = buildMapservUrl(req.query);

  try {
    console.log(`[preview] /wms → ${url}`);

    const r = await fetch(url);
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');

    if (!r.body) {
      const txt = await r.text().catch(() => '');
      return res.send(txt);
    }

    r.body.pipe(res);
  } catch (e) {
    console.error('[preview] /wms error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Transparent WFS proxy.
 * - Forces `map=<alias-or-path>`
 * - Passes through query params (SERVICE=WFS, REQUEST=GetFeature, etc.)
 */
router.get('/wfs', async (req, res) => {
  const url = buildMapservUrl(req.query);

  try {
    console.log(`[preview] /wfs → ${url}`);

    const r = await fetch(url);
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');

    if (!r.body) {
      const txt = await r.text().catch(() => '');
      return res.send(txt);
    }

    r.body.pipe(res);
  } catch (e) {
    console.error('[preview] /wfs error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CGI smoke-test (still forces map=...)
router.get('/cgi', async (req, res) => {
  const url = buildMapservUrl({ ...(req.query || {}), mode: req.query?.mode || 'map' });

  try {
    console.log(`[preview] /cgi → ${url}`);

    const r = await fetch(url);
    res.status(r.status);
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');

    if (!r.body) {
      const txt = await r.text().catch(() => '');
      return res.send(txt);
    }

    r.body.pipe(res);
  } catch (e) {
    console.error('[preview] /cgi error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
