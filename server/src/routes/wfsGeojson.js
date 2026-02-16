// server/src/routes/wfsGeojson.js
//
// GET /api/wfs/geojson?layers=layer1,layer2&bbox=minx,miny,maxx,maxy[,EPSG:xxxx]
//
// Mandatory params:
//   - layers
//   - bbox
//
// Returns: GeoJSON FeatureCollection (merged across layers)

const express = require('express');
// IMPORTANT: ΜΗΝ κάνουμε destructuring το config εδώ.
// Θέλουμε να βλέπουμε αλλαγές στο config object in-memory χωρίς restart.
const config = require('../config');

const { createWfsGeojsonProxy } = require('../lib/wfsGeojsonProxy');

const router = express.Router();

console.log('✅ [routes] wfsGeojson.js loaded');

router.get('/wfs/geojson', createWfsGeojsonProxy(config));

module.exports = router;
