const router = require('express').Router();
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const config = require('../config');
const { formatMapfile } = require('../lib/formatter');
const { validateMap } = require('../lib/validate');
const { explainErrorsWithLLM } = require('../lib/llmExplain');
const { ensureWebMetadata, ensureLayerMetadata } = require('../lib/metadata');

const { upsertMapAlias } = require('../lib/mapserverConf');
const { toSafeAlias, toSafeFileName, buildMapFromTemplate } = require('../lib/mapBuilder');

console.log('✅ [routes] mapfile.js loaded');
console.log(`📄 [routes] config.currentMapPath: ${config.currentMapPath}`);
console.log(`📁 [routes] config.workspaceDir: ${config.workspaceDir}`);


// Serialize operations that write to the genuine file (config.currentMapPath)
let __fileLock = Promise.resolve();
function withFileLock(fn) {
  const run = __fileLock.then(fn, fn);
  __fileLock = run.catch(() => { });
  return run;
}
// Helper: write to the genuine file (config.currentMapPath) with a backup.
// This removes the tmp_* mapfiles entirely.
async function backupAndWriteCurrent(content) {
  await fs.ensureDir(path.dirname(config.currentMapPath));
  const backupPath = `${config.currentMapPath}.bak`;

  const existed = await fs.pathExists(config.currentMapPath);
  if (existed) {
    await fs.copy(config.currentMapPath, backupPath, { overwrite: true });
    console.log(`🧷 [backupAndWriteCurrent] Backup created: ${backupPath}`);
  }

  await fs.writeFile(config.currentMapPath, content, 'utf8');
  console.log(`📝 [backupAndWriteCurrent] Wrote ${config.currentMapPath} (len=${content.length})`);

  return { backupPath, hadBackup: existed };
}

async function restoreBackup({ backupPath, hadBackup }) {
  if (!hadBackup) {
    // If no previous file, remove the new one
    await safeUnlink(config.currentMapPath);
    return;
  }
  await fs.copy(backupPath, config.currentMapPath, { overwrite: true });
  console.log(`↩️  [restoreBackup] Restored backup -> ${config.currentMapPath}`);
}

async function cleanupBackup({ backupPath, hadBackup }) {
  try {
    if (hadBackup) await fs.unlink(backupPath);
  } catch { /* ignore */ }
}

// Generic helper: backup + write ANY file (used by /saveSample)
async function backupAndWriteFile(targetPath, content) {
  await fs.ensureDir(path.dirname(targetPath));
  const backupPath = `${targetPath}.bak`;

  const existed = await fs.pathExists(targetPath);
  if (existed) {
    await fs.copy(targetPath, backupPath, { overwrite: true });
    console.log(`🧷 [backupAndWriteFile] Backup created: ${backupPath}`);
  }

  await fs.writeFile(targetPath, content, 'utf8');
  console.log(`📝 [backupAndWriteFile] Wrote ${targetPath} (len=${content.length})`);

  return { backupPath, hadBackup: existed, targetPath };
}

async function restoreBackupFile({ backupPath, hadBackup, targetPath }) {
  if (!hadBackup) {
    // If no previous file, remove the new one
    await safeUnlink(targetPath);
    return;
  }
  await fs.copy(backupPath, targetPath, { overwrite: true });
  console.log(`↩️  [restoreBackupFile] Restored backup -> ${targetPath}`);
}

async function cleanupBackupFile({ backupPath, hadBackup }) {
  try {
    if (hadBackup) await fs.unlink(backupPath);
  } catch { /* ignore */ }
}

async function safeUnlink(p) {
  try { await fs.unlink(p); } catch { /* ignore */ }
}

// --- routes ---

// 1) Load current mapfile from disk
router.get('/load', async (_req, res) => {
  try {
    const exists = await fs.pathExists(config.currentMapPath);
    if (!exists) {
      const msg = `File not found: ${config.currentMapPath}`;
      console.warn('⚠️  [GET /load]', msg);
      return res.status(404).json({ ok: false, error: msg });
    }
    const content = await fs.readFile(config.currentMapPath, 'utf8');
    console.log(`📤 [GET /load] Sent content (len=${content.length})`);
    res.json({ ok: true, path: config.currentMapPath, content });
  } catch (err) {
    console.error('💥 [GET /load] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// OPEN: Load a specific mapfile from workspace by (path + allias) and make it current
// Body: { path: "relative/or/absolute/inside/workspace.map", allias: "MY_ALIAS", overwrite?: boolean }
router.post('/open', async (req, res) => {
  const payload = req.body || {};
  const pathArgRaw = payload.path || payload.mapPath || payload.filePath || '';
  const aliasRaw = payload.allias || payload.alias || payload.mapAlias || '';
  const overwrite = payload.overwrite !== undefined ? !!payload.overwrite : true;

  if (!pathArgRaw) return res.status(400).json({ ok: false, error: 'path is required' });
  if (!aliasRaw) return res.status(400).json({ ok: false, error: 'allias/alias is required' });

  try {
    // sanitize alias
    const alias = toSafeAlias(aliasRaw);

    // sanitize/resolve path (must be inside workspaceDir)
    const workspaceRoot = path.resolve(config.workspaceDir);
    let targetPath = String(pathArgRaw).trim();

    // Normalize slashes for Windows / Linux input
    targetPath = targetPath.replace(/\\/g, path.sep);

    if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(workspaceRoot, targetPath);
    } else {
      targetPath = path.resolve(targetPath);
    }

    // If no extension provided, assume ".map"
    if (!path.extname(targetPath)) {
      targetPath = targetPath + '.map';
    }

    // Safety: ensure path is within workspaceRoot
    const rel = path.relative(workspaceRoot, targetPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ ok: false, error: 'path must be inside workspaceDir' });
    }

    const exists = await fs.pathExists(targetPath);
    if (!exists) {
      return res.status(404).json({ ok: false, error: `File not found: ${targetPath}` });
    }

    // Read content
    const content = await fs.readFile(targetPath, 'utf8');

    // Ensure alias points to this mapfile in mapserver.conf
    const confResult = await upsertMapAlias({
      confPath: config.mapserverConfPath,
      alias,
      mapPath: targetPath,
      overwrite
    });

    // Make this the “current” map (persist + runtime)
    const overridesToApply = {
      currentMapAlias: alias,
      currentMapPath: targetPath,
      useMapAlias: true
    };

    const overridePath = path.resolve(__dirname, '..', 'config.local.json');
    try {
      let existing = {};
      if (await fs.pathExists(overridePath)) {
        try { existing = await fs.readJson(overridePath); } catch { existing = {}; }
      }
      await fs.writeJson(overridePath, { ...existing, ...overridesToApply }, { spaces: 2 });
      console.log(`💾 [POST /open] Wrote overrides -> ${overridePath}`);
    } catch (e) {
      console.warn('⚠️  [POST /open] Failed to write config.local.json:', e.message);
      // Not fatal: runtime still updates
    }

    Object.assign(config, overridesToApply);

    console.log(`📂 [POST /open] Opened ${targetPath} as alias=${alias} (len=${content.length})`);
    return res.json({
      ok: true,
      success: true,
      alias,
      path: targetPath,
      conf: confResult,
      content
    });
  } catch (err) {
    console.error('💥 [POST /open] Error:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});


// 2) Save mapfile text to disk (write directly to config.currentMapPath, with backup)
router.post('/save', async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content is required' });

  return withFileLock(async () => {
    let backupInfo = null;
    try {
      backupInfo = await backupAndWriteCurrent(content);

      // Optional: validate immediately after save, but do NOT break save if validation fails.
      const mapParam = config.useMapAlias ? config.currentMapAlias : config.currentMapPath;
      try {
        const result = await validateMap(mapParam);
        console.log('✅ [POST /save] Validation result:', result);
      } catch (e) {
        console.warn('⚠️  [POST /save] Validation failed (save still ok):', e.message || e);
      }

      await cleanupBackup(backupInfo);
      return res.json({ ok: true, success: true, path: config.currentMapPath });
    } catch (err) {
      console.error('💥 [POST /save] Error:', err);
      if (backupInfo) await restoreBackup(backupInfo);
      if (backupInfo) await cleanupBackup(backupInfo);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
});

// 2a) SaveSample — overwrites the COSTUME template mapfile (sampleNewCostumeQuickMap.map)
// Body: { content: "..." }
// - Validates the resulting template (GetCapabilities) and rolls back on invalid.
// - Does NOT create mapfile copies, does NOT touch aliases.
router.post(['/saveSample', '/saveSample/'], async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content is required' });

  const templatePath = path.resolve(__dirname, '..', 'sample-map', 'sampleNewCostumeQuickMap.map');

  return withFileLock(async () => {
    let backupInfo = null;
    try {
      const exists = await fs.pathExists(templatePath);
      if (!exists) {
        return res.status(404).json({ ok: false, error: `Template not found: ${templatePath}` });
      }

      backupInfo = await backupAndWriteFile(templatePath, content);


      // NOTE: SaveSample does NOT validate. We just persist the template file.
      await cleanupBackupFile(backupInfo);
      return res.json({
        ok: true,
        success: true,
        path: templatePath,
        message: 'Το δείγμα αποθηκεύτηκε επιτυχώς.'
      });
} catch (err) {
      console.error('💥 [POST /saveSample] Error:', err);
      if (backupInfo) await restoreBackupFile(backupInfo);
      if (backupInfo) await cleanupBackupFile(backupInfo);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
});

// 2b) Save As — writes content to a NEW mapfile and (optionally) switches current map
// Διαφορά από /save:
//  - ΔΕΝ γράφει υποχρεωτικά στο config.currentMapPath
//  - Δέχεται ορίσματα: path (folder), fileName, allias/alias
//  - Ενημερώνει mapserver.conf (MAPS alias) και κάνει το νέο mapfile “current”
router.post('/save_as', async (req, res) => {
  const payload = req.body || {};

  const content = payload.content;
  const dirArg = payload.path || ''; // relative folder under workspaceDir (or empty => workspaceDir)
  const aliasRaw = payload.allias || payload.alias || payload.mapAlias || '';
  const fileNameRaw = payload.fileName || payload.filename || payload.name || '';
  const overwrite = !!payload.overwrite;

  if (typeof content !== 'string') return res.status(400).json({ ok: false, error: 'content is required' });
  if (!fileNameRaw) return res.status(400).json({ ok: false, error: 'fileName is required' });
  if (!aliasRaw) return res.status(400).json({ ok: false, error: 'allias/alias is required' });

  // sanitize
  const alias = toSafeAlias(aliasRaw);
  const fileName = toSafeFileName(fileNameRaw);

  // Build target directory: allow either absolute path (ONLY if under workspaceDir) or relative.
  const ws = path.resolve(config.workspaceDir);
  const targetDir = path.isAbsolute(dirArg)
    ? path.resolve(dirArg)
    : path.resolve(config.workspaceDir, dirArg);
  const targetPath = path.resolve(targetDir, fileName);

  // Security: prevent path traversal outside workspaceDir
  if (!targetPath.startsWith(ws + path.sep) && targetPath !== ws) {
    return res.status(400).json({ ok: false, error: 'target path must be under workspaceDir' });
  }

  return withFileLock(async () => {
    // Simple per-target backup (only used if overwrite=true and file exists)
    const backupPath = `${targetPath}.bak`;
    let hadBackup = false;

    try {
      const exists = await fs.pathExists(targetPath);
      if (exists && !overwrite) {
        return res.status(409).json({ ok: false, error: `Mapfile already exists: ${targetPath} (set overwrite=true)` });
      }

      await fs.ensureDir(path.dirname(targetPath));

      // Backup existing target file (if any)
      if (exists) {
        await fs.copy(targetPath, backupPath, { overwrite: true });
        hadBackup = true;
        console.log(`🧷 [POST /save_as] Backup created: ${backupPath}`);
      }

      await fs.writeFile(targetPath, content, 'utf8');
      console.log(`📝 [POST /save_as] Wrote ${targetPath} (len=${content.length})`);

      // Ensure alias exists/points to this mapfile
      const confResult = await upsertMapAlias({
        confPath: config.mapserverConfPath,
        alias,
        mapPath: targetPath,
        overwrite
      });

      // Make this the “current” map (persist + runtime)
      const overridesToApply = {
        currentMapAlias: alias,
        currentMapPath: targetPath,
        useMapAlias: true
      };

      const overridePaths = [
        path.resolve(__dirname, '..', 'config.local.json')
      ];

      const settingsWrite = { ok: true, written: [], errors: [] };
      for (const p of overridePaths) {
        try {
          let existing = {};
          if (await fs.pathExists(p)) {
            try { existing = await fs.readJson(p); } catch { existing = {}; }
          }
          await fs.writeJson(p, { ...existing, ...overridesToApply }, { spaces: 2 });
          settingsWrite.written.push(p);
        } catch (e) {
          settingsWrite.ok = false;
          settingsWrite.errors.push({ path: p, error: e.message || String(e) });
        }
      }

      // Update live config object (important for routes that reference config at runtime)
      Object.assign(config, overridesToApply);

      // Optional: validate after save_as (do NOT fail the save if validation fails)
      try {
        const result = await validateMap(config.currentMapAlias);
        console.log('✅ [POST /save_as] Validation result:', result);
      } catch (e) {
        console.warn('⚠️  [POST /save_as] Validation failed (save still ok):', e.message || e);
      }

      // Cleanup backup if everything went fine
      if (hadBackup) await safeUnlink(backupPath);

      return res.json({
        ok: true,
        success: true,
        alias,
        fileName,
        mapPath: targetPath,
        mapserverConfPath: config.mapserverConfPath,
        conf: confResult,
        settingsWrite,
        current: {
          currentMapAlias: config.currentMapAlias,
          currentMapPath: config.currentMapPath,
          useMapAlias: config.useMapAlias
        },
        hint: `${config.mapservUrl}?map=${alias}&SERVICE=WMS&REQUEST=GetCapabilities`
      });
    } catch (err) {
      console.error('💥 [POST /save_as] Error:', err);

      // Rollback target file if needed
      if (hadBackup) {
        try { await fs.copy(backupPath, targetPath, { overwrite: true }); } catch { /* ignore */ }
      } else {
        try { await fs.remove(targetPath); } catch { /* ignore */ }
      }

      if (hadBackup) await safeUnlink(backupPath);

      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
});

// 3) Validate content or validate current map
router.post('/validate', async (req, res) => {
  const { content, useAlias } = req.body || {};

  // OPT-IN: enrich validation errors with LLM paragraph ONLY if `llm` exists in config.
  async function maybeEnrichErrors(result, mapText) {
    const llm = config.llm;
    if (!llm || typeof llm !== 'object') return result; // keep previous response
    if (llm.enabled === false) return result; // explicit off
    if (!result || !Array.isArray(result.errors) || result.errors.length === 0) return result;
    const enriched = await explainErrorsWithLLM(result.errors, mapText);
    return { ...result, errors: enriched };
  }

  const llmOptIn = !!config.llm && typeof config.llm === 'object' && config.llm.enabled !== false;

  // If caller explicitly wants alias validation:
  if (useAlias) {
    console.log('👉 [POST /validate] Validating alias:', config.currentMapAlias);
    try {
      let result = await validateMap(config.currentMapAlias);
      if (llmOptIn && (result.errors || []).length) {
        // map text for snippet: read current file (alias points to the current map)
        const mapText = await fs.readFile(config.currentMapPath, 'utf8').catch(() => '');
        result = await maybeEnrichErrors(result, mapText);
      }
      console.log('📕 [POST /validate] Result (alias):', result);
      return res.json({ ok: true, success: result.success, errors: result.errors || [], warnings: result.warnings || [] });
    } catch (err) {
      console.error('💥 [POST /validate] Error (alias):', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  }

  // No content => validate the current genuine file as-is
  if (typeof content !== 'string') {
    const mapParam = config.useMapAlias ? config.currentMapAlias : config.currentMapPath;
    console.log('👉 [POST /validate] Validating current file:', mapParam);
    try {
      let result = await validateMap(mapParam);
      if (llmOptIn && (result.errors || []).length) {
        const mapText = await fs.readFile(config.currentMapPath, 'utf8').catch(() => '');
        result = await maybeEnrichErrors(result, mapText);
      }
      console.log('📕 [POST /validate] Result (current):', result);
      return res.json({ ok: true, success: result.success, errors: result.errors || [], warnings: result.warnings || [] });
    } catch (err) {
      console.error('💥 [POST /validate] Error (current):', err);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  }

  console.log('👉 [POST /validate] Received content length:', content.length);

  // Content provided => temporarily write to the genuine file, validate, then restore.
  return withFileLock(async () => {
    let backupInfo = null;
    try {
      backupInfo = await backupAndWriteCurrent(content);
      const mapParam = config.useMapAlias ? config.currentMapAlias : config.currentMapPath;
      let result = await validateMap(mapParam);
      if (llmOptIn && (result.errors || []).length) {
        result = await maybeEnrichErrors(result, content);
      }
      console.log('📕 [POST /validate] Result (content-on-genuine):', result);

      await restoreBackup(backupInfo);
      await cleanupBackup(backupInfo);

      return res.json({ ok: true, success: result.success, errors: result.errors || [], warnings: result.warnings || [] });
    } catch (err) {
      console.error('💥 [POST /validate] Error (content-on-genuine):', err);
      if (backupInfo) await restoreBackup(backupInfo);
      if (backupInfo) await cleanupBackup(backupInfo);
      return res.status(500).json({ ok: false, error: String(err) });
    }
  });
});

// ✅ POST /api/new — create a new mapfile from template + add alias to mapserver.conf
router.post('/new', async (req, res) => {
  const payload = req.body || {};

  const name = payload.name || payload.title || '';
  const alias = toSafeAlias(payload.alias || name || 'NEW_MAP');
  const fileName = toSafeFileName(payload.fileName || `${alias}.map`);
  const overwrite = !!payload.overwrite;

  const templatePath = path.resolve(__dirname, '..', 'sample-map', 'sampleNewMap.map');
  const targetPath = path.resolve(config.workspaceDir, fileName);

  // ασφάλεια: μην αφήσεις path traversal εκτός config.workspaceDir
  const ws = path.resolve(config.workspaceDir);
  if (!targetPath.startsWith(ws + path.sep) && targetPath !== ws) {
    return res.status(400).json({ ok: false, error: 'target path must be under workspaceDir' });
  }

  try {
    const exists = await fs.pathExists(targetPath);
    if (exists && !overwrite) {
      return res.status(409).json({ ok: false, error: `Mapfile already exists: ${targetPath} (set overwrite=true)` });
    }

    const content = await buildMapFromTemplate({
      templatePath,
      alias,
      name,
      config,
      payload
    });

    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content, 'utf8');

    const confResult = await upsertMapAlias({
      confPath: config.mapserverConfPath,
      alias,
      mapPath: targetPath,
      overwrite
    });

    // ✅ Make the newly created map "current" (persist + runtime)
    // Step 2: update current settings when a NEW map is created.
    // NOTE: We write overrides in BOTH places to be compatible with:
    //  - src/config.local.json            (what src/config.js currently reads)
    const overridePaths = [
      path.resolve(__dirname, '..', 'config.local.json'),
    ];

    const overridesToApply = {
      currentMapAlias: alias,
      currentMapPath: targetPath,
      useMapAlias: true
    };

    const settingsWrite = { ok: true, written: [], errors: [] };

    for (const p of overridePaths) {
      try {
        let existing = {};
        if (await fs.pathExists(p)) {
          try { existing = await fs.readJson(p); } catch { existing = {}; }
        }
        await fs.writeJson(p, { ...existing, ...overridesToApply }, { spaces: 2 });
        settingsWrite.written.push(p);
      } catch (e) {
        settingsWrite.ok = false;
        settingsWrite.errors.push({ path: p, error: e.message || String(e) });
      }
    }

    // Step 3: avoid "frozen" values — update the live config object in-memory
    // so subsequent requests within this Node process see the new current map.
    Object.assign(config, overridesToApply);

    return res.json({
      ok: true,
      alias,
      fileName,
      mapPath: targetPath,
      mapserverConfPath: config.mapserverConfPath,
      conf: confResult,
      settingsWrite,
      current: {
        currentMapAlias: config.currentMapAlias,
        currentMapPath: config.currentMapPath,
        useMapAlias: config.useMapAlias
      },
      hint: `${config.mapservUrl}?map=${alias}&SERVICE=WMS&REQUEST=GetCapabilities`
    });
  } catch (err) {
    // rollback αν έγραψες αρχείο αλλά απέτυχε το conf
    try { await fs.remove(targetPath); } catch (_) { }
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// ✅ POST /api/newQuickCostume — create a new COSTUME mapfile from COSTUME template + add alias to mapserver.conf
// Body (same as /new): { name, alias, fileName, overwrite }
router.post(['/newQuickCostume', '/newQuickCostume/'], async (req, res) => {
  const payload = req.body || {};

  const name = payload.name || payload.title || '';
  const alias = toSafeAlias(payload.alias || payload.allias || name || 'NEW_COSTUME');
  let fileName = toSafeFileName(payload.fileName || payload.filename || `${alias}.map`);
  const overwrite = !!payload.overwrite;

  // If no extension provided, assume ".map"
  if (!path.extname(fileName)) {
    fileName = toSafeFileName(`${fileName}.map`);
  }

  // Template sits next to sampleNewMap.map (same folder)
  const templatePath = path.resolve(__dirname, '..', 'sample-map', 'sampleNewCostumeQuickMap.map');
  const targetPath = path.resolve(config.workspaceDir, fileName);

  // ασφάλεια: μην αφήσεις path traversal εκτός config.workspaceDir
  const ws = path.resolve(config.workspaceDir);
  if (!targetPath.startsWith(ws + path.sep) && targetPath !== ws) {
    return res.status(400).json({ ok: false, error: 'target path must be under workspaceDir' });
  }

  try {
    const tplExists = await fs.pathExists(templatePath);
    if (!tplExists) {
      return res.status(404).json({ ok: false, error: `Template not found: ${templatePath}` });
    }

    const exists = await fs.pathExists(targetPath);
    if (exists && !overwrite) {
      return res.status(409).json({ ok: false, error: `Mapfile already exists: ${targetPath} (set overwrite=true)` });
    }

    // Build from template (same flow as /new, but with COSTUME template)
    const content = await buildMapFromTemplate({
      templatePath,
      alias,
      name,
      config,
      payload
    });

    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content, 'utf8');

    const confResult = await upsertMapAlias({
      confPath: config.mapserverConfPath,
      alias,
      mapPath: targetPath,
      overwrite
    });

    // ✅ Make the newly created map "current" (persist + runtime)
    const overridePaths = [
      path.resolve(__dirname, '..', 'config.local.json'),
    ];

    const overridesToApply = {
      currentMapAlias: alias,
      currentMapPath: targetPath,
      useMapAlias: true
    };

    const settingsWrite = { ok: true, written: [], errors: [] };

    for (const p of overridePaths) {
      try {
        let existing = {};
        if (await fs.pathExists(p)) {
          try { existing = await fs.readJson(p); } catch { existing = {}; }
        }
        await fs.writeJson(p, { ...existing, ...overridesToApply }, { spaces: 2 });
        settingsWrite.written.push(p);
      } catch (e) {
        settingsWrite.ok = false;
        settingsWrite.errors.push({ path: p, error: e.message || String(e) });
      }
    }

    Object.assign(config, overridesToApply);

    return res.json({
      ok: true,
      alias,
      fileName,
      mapPath: targetPath,
      mapserverConfPath: config.mapserverConfPath,
      conf: confResult,
      settingsWrite,
      current: {
        currentMapAlias: config.currentMapAlias,
        currentMapPath: config.currentMapPath,
        useMapAlias: config.useMapAlias
      },
      hint: `${config.mapservUrl}?map=${alias}&SERVICE=WMS&REQUEST=GetCapabilities`
    });
  } catch (err) {
    // rollback αν έγραψες αρχείο αλλά απέτυχε το conf
    try { await fs.remove(targetPath); } catch (_) { }
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});



// ✅ POST /api/format — format the mapfile text
router.post('/format', async (req, res) => {
  const { content, indent = 4 } = req.body;
  try {
    res.json({ ok: true, content: formatMapfile(content, indent) });
  } catch (err) {
    res.json({ ok: false, errors: [{ message: err.message }] });
  }
});

// ✅ POST /api/autometadata — add missing WEB and LAYER metadata
router.post('/autometadata', async (req, res) => {
  const { content, baseUrl } = req.body;
  try {
    const withWeb = ensureWebMetadata(content, baseUrl || 'http://localhost:4300/api/wms');
    const final = ensureLayerMetadata(withWeb);
    res.json({ ok: true, content: final });
  } catch (err) {
    res.json({ ok: false, errors: [{ message: err.message }] });
  }
});

module.exports = router;
