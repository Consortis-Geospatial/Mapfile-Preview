const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs-extra');
const path = require('path');
const settingsRouter = require('./routes/settings');
const { port, workspaceDir } = require('./config');

(async () => {
  await fs.ensureDir(workspaceDir);
  //await fs.ensureDir(logsDir);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/settings', settingsRouter);

  app.use('/api', require('./routes/mapfile'));
  app.use('/api', require('./routes/mapfilePaths'));
  app.use('/api', require('./routes/preview'));

  app.use('/api', require('./routes/layers'));

  app.use('/api', require('./routes/wfsGeojson'));

  app.use('/api', require('./routes/mpTeacher/mapserverTeacher'));

  // Optionally serve the built Angular UI from the same origin as the API.
  // Enabled by setting UI_DIST (used by the Docker image). In local dev this
  // env var is unset, so this block is skipped and `ng serve` keeps serving the UI.
  const uiDist = process.env.UI_DIST;
  if (uiDist && fs.existsSync(uiDist)) {
    app.use(express.static(uiDist));
    // SPA fallback: send index.html for any non-API GET (client-side routing).
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(uiDist, 'index.html'));
    });
  }

  app.listen(port, () => console.log(`Server on http://localhost:${port}`));
})();
