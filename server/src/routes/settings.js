// server/src/routes/settings.js
const router = require('express').Router();
const fs = require('fs-extra');
const path = require('path');

// Θα αποθηκεύουμε overrides εδώ (στο root του server project):
// server/config.local.json
const CONFIG_LOCAL_PATH = path.join(__dirname, '..', 'config.local.json');

// Πάρε το τρέχον config (defaults + overrides αν το υποστηρίζει το config.js σου)
function getConfigFresh() {
  // Αν θες να “ξαναδιαβάζεται” χωρίς restart, καθάρισε cache:
  delete require.cache[require.resolve('../config')];
  return require('../config');
}

/**
 * GET /api/settings
 * Επιστρέφει το τρέχον config που χρησιμοποιεί ο server
 */
router.get('/', (_req, res) => {
  const cfg = getConfigFresh();
  res.json({ ok: true, settings: cfg });
});

/**
 * PUT /api/settings
 * Γράφει overrides σε config.local.json (ώστε να μη πειράζεις το config.js)
 *
 * Σημείωση:
 * - Κρατάμε allow-list για να μην γράφεται ό,τι να ’ναι στο δίσκο.
 */
router.put('/', async (req, res) => {
  try {
    const incoming = req.body || {};

    // Βάλε εδώ ό,τι keys θες να επιτρέπεις από UI
    const ALLOWED_KEYS = [
      'mapservPath',
      'mapservUrl',
      'workspaceDir',
      'currentMapPath',
      'currentMapAlias',
      'useMapAlias',
      'mapserverConfPath',
      'port',
      // optional (opt-in) LLM configuration
      'llm'
    ];

    const overrides = {};
    for (const k of ALLOWED_KEYS) {
      if (k in incoming) overrides[k] = incoming[k];
    }

    await fs.writeJson(CONFIG_LOCAL_PATH, overrides, { spaces: 2 });

    res.json({
      ok: true,
      savedTo: CONFIG_LOCAL_PATH,
      overrides
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
