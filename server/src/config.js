// server/src/config.js
//
// Loads defaults and then applies optional overrides from:
//   server/src/config.local.json
//
// ✅ LLM is OPT-IN (enabled=false by default):
// The validate endpoint will attach LLM paragraphs ONLY if llm.enabled=true.
// Provider is selected via llm.typeLLM ("Ollama" | "Gemini").
//
// Example config.local.json:
// {
//   "llm": {
//     "enabled": true,
//     "typeLLM": "Gemini",
//     "geminiApiKey": "YOUR_KEY",
//     "geminiModel": "gemini-1.5-flash"
//   }
// }
//
// Tip: for production prefer env var GEMINI_API_KEY instead of storing a key in JSON.

const fs = require('fs');
const path = require('path');

const ALLOWED_LLM_TYPES = new Set(['Ollama', 'Gemini']);

// --- Defaults (keep existing keys as-is to avoid breaking imports) ---
const defaults = {
  // 1) Path to the MapServer binary (used for validation)
  mapservPath: process.env.MAPSERV_PATH || "C:\\mapserver8\\bin\\mapserv.exe",

  // 2) Base URL where MapServer is served via IIS/Apache (used for preview requests)
  mapservUrl: process.env.MAPSERV_URL || "http://localhost:8080/mapserver-8",

  // Mapfile workspace
  workspaceDir: process.env.WORKSPACE_DIR || "C:\\data\\maps",

  // Default "current" mapfile
  currentMapPath: process.env.CURRENT_MAP || "C:\\data\\maps\\ms8_landify_example.map",

  currentMapAlias: process.env.CURRENT_MAP_ALIAS || "example",

  // If true, preview/validation uses map=<alias>
  useMapAlias: (process.env.USE_MAP_ALIAS ?? "1") !== "0",

  // Global MapServer config (contains ENV + MAPS aliases)
  mapserverConfPath:
    process.env.MAPSERVER_CONF ||
    process.env.MAPSERVER_CONFIG_FILE ||
    path.resolve(__dirname, 'mapserver.conf'),

  // Backend port
  port: process.env.PORT || 4300,

  // Editor defaults (used by Settings dialog / formatter)
  editor: {
    indent: 2
  },

  // LLM config (opt-in via enabled=true in config.local.json)
  llm: {
    enabled: false,

    // Provider selection: "Ollama" | "Gemini"
    typeLLM: 'Ollama',

    // Shared generation controls
    timeoutMs: 150000000,
    temperature: 0.1,
    maxTokens: 5400,

    // --- Ollama ---
    ollamaUrl: "http://localhost:11434",
    model: "gemma3:4b",

    // --- Gemini ---
    // You can also provide "gemini-api-key" in JSON; we normalize it below.
    geminiApiKey: "*****************",
    geminiModel: "gemini-2.5-flash",
    geminiBaseUrl: "https://generativelanguage.googleapis.com",

  },

  geminiMpTeacher: {
    enable: true,
    daylyReqLimit: 5,
    maxToken: 5400,
    pdfPath: "C:\\Consortis_Projects\\MapHelper.pdf",
    topK: 6,
    reindex: false,
    model: "gemini-2.5-flash"
  }
};

// Optional JSON overrides written by the Settings API / dialog
// IMPORTANT: must match routes/settings.js (server/src/config.local.json)
const overridePath = path.resolve(__dirname, 'config.local.json');

function deepMerge(base, extra) {
  if (!extra) return base;
  for (const k of Object.keys(extra)) {
    if (
      base[k] &&
      typeof base[k] === 'object' &&
      !Array.isArray(base[k]) &&
      typeof extra[k] === 'object' &&
      !Array.isArray(extra[k])
    ) {
      deepMerge(base[k], extra[k]);
    } else {
      base[k] = extra[k];
    }
  }
  return base;
}

function normalizeLLMConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return;

  // Allow legacy JSON key name: "gemini-api-key"
  if (cfg.llm && typeof cfg.llm === 'object') {
    const legacyKey = cfg.llm['gemini-api-key'];
    if (legacyKey && !cfg.llm.geminiApiKey) cfg.llm.geminiApiKey = legacyKey;
  }

  // Enforce allowed providers only (case-insensitive)
  const raw = String(cfg?.llm?.typeLLM || 'Ollama').trim().toLowerCase();
  if (raw === 'gemini') cfg.llm.typeLLM = 'Gemini';
  else cfg.llm.typeLLM = 'Ollama';
}

let merged = JSON.parse(JSON.stringify(defaults));
if (fs.existsSync(overridePath)) {
  try {
    const overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    merged = deepMerge(merged, overrides);
  } catch (e) {
    console.warn('[config] Failed to load config.local.json overrides:', e.message);
  }
}

normalizeLLMConfig(merged);

module.exports = merged;
