// server/src/lib/llmExplain.ollama.js
// Attach a short LLM paragraph (20-50 words) to each MapServer validation error.
// Provider: Ollama

const config = require('../config');

// Use native fetch if available (Node 18+), otherwise fall back to node-fetch.
const fetchFn = globalThis.fetch || require('node-fetch');

/**
 * Return a snippet consisting of:
 *   - the error line
 *   - 2 lines above
 *   - 2 lines below
 * with the ORIGINAL mapfile line numbers.
 */
function makeNumberedSnippet(mapText, errLine, radius = 2) {
  const src = String(mapText || '');
  if (!src.trim()) {
    return '1| (map text not available)';
  }

  const lines = src.split(/\r?\n/);
  const total = Math.max(1, lines.length);

  const ln = Math.max(1, Math.min(Number(errLine) || 1, total));
  const start = Math.max(1, ln - radius);
  const end = Math.min(total, ln + radius);

  // Align line numbers so the snippet is easy to read.
  const width = String(end).length;

  const out = [];
  for (let i = start; i <= end; i++) {
    const n = String(i).padStart(width, ' ');
    out.push(`${n}| ${lines[i - 1]}`);
  }
  return out.join('\n');
}

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function clampWords(text, max = 50) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return normalizeWhitespace(text);
  return normalizeWhitespace(words.slice(0, max).join(' ') + '…');
}

async function ollamaGenerate(prompt) {
  const llm = config.llm;
  if (!llm || typeof llm !== 'object') return null;

  // Allow disabling explicitly. If not set, default is enabled.
  if (llm.enabled === false) return null;

  const base = String(llm.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const url = `${base}/api/generate`;

  const controller = new AbortController();
  const timeoutMs = Number(llm.timeoutMs || 150000);
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: llm.model || 'gemma3:4b',
        prompt,
        stream: false,
        options: {
          temperature: Number(llm.temperature ?? 0.1),
          num_predict: Number(llm.maxTokens || 540)
        }
      })
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Ollama HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }

    const json = await r.json();
    return (json?.response || '').trim();
  } finally {
    clearTimeout(t);
  }
}

function buildPrompt({ index, line, message, snippet }) {
  const errorText = `MapServer validation errors:\n#${index} (line ${line}): ${message}`;
  console.log(`[LLM] Building prompt for error #${index} (line ${line})`);
  console.log(`[LLM] Snippet:\n${snippet}\n---`);
  return (
    `You are mapserver senior developer and i want say with simple worlds the error:\n` +
    `"${errorText}"\n\n` +
    `take and this part of mapfile (analyse only the line with error and the error)\n` +
    `"\n${snippet}\n"\n\n` +
    `Write ONE paragraph of 20-50 words. No bullet points. No code.`
  );
}

// Limit parallel calls to avoid hammering the provider when MapServer returns many errors.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Returns errors enriched with `llmParagraph` (20–50 words), when llm.enabled=true.
 * Each error item is expected to be: { line, message }
 */
async function explainErrorsWithLLM(errors, mapText) {
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) return list;

  const llm = config.llm;
  if (!llm || typeof llm !== 'object') return list;
  if (llm.enabled === false) return list;

  const cache = new Map();

  return mapLimit(list, 2, async (e, idx0) => {
    const line = Number(e?.line || 1);
    const message = String(e?.message || '').trim();
    const snippet = makeNumberedSnippet(mapText, line, 30);

    const key = `${line}::${message}::${snippet}`;
    if (cache.has(key)) {
      return { ...e, llmParagraph: cache.get(key), snippet };
    }

    const prompt = buildPrompt({ index: idx0 + 1, line, message, snippet });

    try {
      const resp = await ollamaGenerate(prompt);
      const llmText = resp ? clampWords(resp, 50) : null;
      cache.set(key, llmText);
      return { ...e, llmParagraph: llmText, snippet };
    } catch (err) {
      // Never fail /validate because the LLM is down.
      cache.set(key, null);
      return { ...e, llmParagraph: null, snippet, llmError: String(err?.message || err) };
    }
  });
}

module.exports = { explainErrorsWithLLM, makeNumberedSnippet };
