// server/src/lib/llmExplain.js
// Provider dispatcher.
// Selects the implementation based on config.llm.typeLLM ("Ollama" | "Gemini").

const config = require('../config');

function pickProvider() {
  const t = String(config?.llm?.typeLLM || 'Ollama').trim();
  if (t === 'Gemini') return require('./llmExplain.gemini');
  return require('./llmExplain.ollama');
}

module.exports = pickProvider();
