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

  app.listen(port, () => console.log(`Server on http://localhost:${port}`));
})();
