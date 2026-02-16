/**
 * src/routes/mpTeacher/mapserverTeacher.js
 *
 * REST API "teacher" endpoint that answers questions using Gemini 2.5 Flash,
 * grounded in a PDF chosen by path (pdfPath in the request).
 *
 * Dependencies:
 *   npm i @google/genai pdfjs-dist fs-extra
 *
 * Endpoint:
 *   POST /api/mpTeacher/mapserverTeacher/ask
 *   Body (JSON):
 *     {
 *       "prompt": "Πώς ορίζω ένα WMS layer;",
 *       "pdfPath": "C:\\path\\to\\MapServer.pdf",
 *       "model": "gemini-2.5-flash",          // optional
 *       "apiKey": "....",                    // optional (env vars preferred)
 *       "topK": 6,                           // optional
 *       "reindex": false                     // optional
 *     }
 *
 * Notes:
 * - Uses a lightweight BM25 retrieval over locally extracted PDF text.
 * - Sends ONLY retrieved excerpts to Gemini and asks it to answer using only them,
 *   returning page references.
 */

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const { GoogleGenAI } = require('@google/genai');
const config = require('../../config');

// pdfjs-dist v5 is ESM-first. This loader works for both older (CJS) and newer (ESM) builds.
let _pdfjsPromise;
async function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const tryRequire = (p) => {
      try { return require(p); } catch { return null; }
    };
    // CommonJS candidates (older builds)
    const reqCandidates = [
      'pdfjs-dist/legacy/build/pdf.cjs',
      'pdfjs-dist/legacy/build/pdf.js',
      'pdfjs-dist/build/pdf.cjs',
      'pdfjs-dist/build/pdf.js'
    ];
    for (const c of reqCandidates) {
      const mod = tryRequire(c);
      if (mod) return mod?.getDocument ? mod : (mod?.default || mod);
    }
    // ESM candidates (newer builds)
    const impCandidates = [
      'pdfjs-dist/legacy/build/pdf.mjs',
      'pdfjs-dist/build/pdf.mjs',
      'pdfjs-dist/legacy/build/pdf',
      'pdfjs-dist/build/pdf'
    ];
    for (const c of impCandidates) {
      try {
        const mod = await import(c);
        const lib = mod?.getDocument ? mod : (mod?.default && mod.default.getDocument ? mod.default : mod);
        if (lib?.getDocument) return lib;
      } catch { }
    }
    // Last resort
    try {
      const mod = await import('pdfjs-dist');
      const lib = mod?.getDocument ? mod : (mod?.default && mod.default.getDocument ? mod.default : mod);
      if (lib?.getDocument) return lib;
    } catch { }
    throw new Error('Cannot load pdfjs-dist. Check installed version and file paths.');
  })();
  return _pdfjsPromise;
}

const router = express.Router();

const DEFAULT_API_KEY = (config?.llm?.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '123456789');
const DEFAULT_MODEL = (config?.geminiMpTeacher?.model || config?.llm?.geminiModel || 'gemini-2.5-flash');
const DEFAULT_TOPK = Number(config?.geminiMpTeacher?.topK || 6);

// Small stopword list (English + a few Greek basics) to keep technical terms intact.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'as', 'is', 'are', 'be', 'by', 'from', 'that', 'this', 'it',
  'σε', 'και', 'ή', 'να', 'το', 'η', 'οι', 'τα', 'των', 'της', 'στο', 'στη', 'στην', 'στον', 'με', 'για', 'από', 'ως', 'είναι'
]);

// Unicode letters/digits tokenization (Node 18+).
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

function tokenize(text) {
  const m = text.match(TOKEN_RE) || [];
  return m
    .map(t => t.toLowerCase())
    .filter(t => t && !STOPWORDS.has(t));
}

function cleanText(t) {
  return (t || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Extract text per page using pdfjs-dist (keeps page numbers). */
async function extractPagesText(pdfAbsPath) {
  const buf = await fs.readFile(pdfAbsPath);
  // pdfjs-dist v5 rejects Node Buffers; it expects Uint8Array.
  // This creates a Uint8Array *view* (no copy) over the Buffer memory.
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data, disableWorker: true });
  const pdf = await loadingTask.promise;

  const pagesText = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const pageText = tc.items.map(it => (it && it.str) ? it.str : '').join(' ');
    pagesText.push(cleanText(pageText));
  }

  try { await pdf.cleanup(); } catch (_) { }
  try { await pdf.destroy(); } catch (_) { }

  return pagesText;
}

function chunkPages(pagesText, maxChars = 4500, overlapChars = 600) {
  /**
   * Create chunks by concatenating consecutive pages until maxChars reached.
   * Keeps page ranges for citations.
   */
  const chunks = [];
  let buf = '';
  let bufStart = 1;

  function flush(endPage) {
    const txt = cleanText(buf);
    if (txt) chunks.push({ text: txt, pageStart: bufStart, pageEnd: endPage });
    buf = '';
  }

  for (let idx = 1; idx <= pagesText.length; idx++) {
    const pageTxt = pagesText[idx - 1] || '';
    const candidate = buf ? cleanText(buf + '\n\n' + pageTxt) : cleanText(pageTxt);

    if (candidate.length <= maxChars) {
      if (!buf) bufStart = idx;
      buf = candidate;
      continue;
    }

    // If a single page is too large, split within the page.
    if (!buf && pageTxt.length > maxChars) {
      let start = 0;
      while (start < pageTxt.length) {
        const end = Math.min(pageTxt.length, start + maxChars);
        const piece = cleanText(pageTxt.slice(start, end));
        if (piece) chunks.push({ text: piece, pageStart: idx, pageEnd: idx });
        start = Math.max(0, end - overlapChars);
      }
      buf = '';
      continue;
    }

    // Flush buffer up to previous page.
    flush(idx - 1);

    // Start new buffer with current page.
    bufStart = idx;
    buf = cleanText(pageTxt);
  }

  flush(pagesText.length);
  return chunks;
}

function buildIndexFromChunks(pdfHash, chunks) {
  const docFreq = Object.create(null);
  const docLen = [];

  for (const ch of chunks) {
    const toks = tokenize(ch.text);
    docLen.push(toks.length);
    const seen = new Set(toks);
    for (const t of seen) docFreq[t] = (docFreq[t] || 0) + 1;
  }

  const avgdl = docLen.length ? (docLen.reduce((a, b) => a + b, 0) / docLen.length) : 0;

  return { pdfHash, chunks, docFreq, docLen, avgdl, k1: 1.5, b: 0.75 };
}

function bm25Search(idx, query, topK = DEFAULT_TOPK) {
  const qTerms = tokenize(query);
  if (!qTerms.length || !idx.chunks.length) return [];

  const N = idx.chunks.length;
  const scores = new Array(N).fill(0);

  const idf = Object.create(null);
  const uniq = Array.from(new Set(qTerms));
  for (const t of uniq) {
    const df = idx.docFreq[t] || 0;
    idf[t] = df
      ? Math.log(1 + (N - df + 0.5) / (df + 0.5))
      : Math.log(1 + (N + 0.5) / 0.5);
  }

  for (let i = 0; i < N; i++) {
    const dl = idx.docLen[i] || 0;
    if (!dl) continue;

    const toks = tokenize(idx.chunks[i].text);
    const tf = Object.create(null);
    for (const t of toks) {
      if (idf[t] !== undefined) tf[t] = (tf[t] || 0) + 1;
    }

    const denomConst = idx.k1 * (1 - idx.b + idx.b * (idx.avgdl ? (dl / idx.avgdl) : 1));
    let s = 0;
    for (const t of Object.keys(tf)) {
      const f = tf[t];
      s += idf[t] * (f * (idx.k1 + 1)) / (f + denomConst);
    }
    scores[i] = s;
  }

  return scores
    .map((score, i) => ({ i, score }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK));
}

function buildTeacherPrompt(question, chunks) {
  const excerpts = chunks.map((ch, j) => {
    let t = ch.text || '';
    if (t.length > 1800) t = t.slice(0, 1800).trimEnd() + ' …';
    return `[Απόσπασμα ${j + 1} | σελ. ${ch.pageStart}–${ch.pageEnd}]\n${t}`;
  }).join('\n\n');

  const instructions =
    'Είσαι τεχνικός βοηθός για MapServer.\n' +
    'Απάντησε χρησιμοποιώντας ΑΠΟΚΛΕΙΣΤΙΚΑ τα παρακάτω αποσπάσματα από το PDF.\n' +
    'Αν δεν υπάρχει αρκετή πληροφορία στα αποσπάσματα, πες καθαρά ότι δεν βρέθηκε στο PDF και πρότεινε τι να ψάξει ο χρήστης.\n' +
    'Μην εφευρίσκεις παραμέτρους/συντακτικό.\n' +
    "Στο τέλος, πρόσθεσε γραμμή: 'Πηγές: σελ. X–Y, ...' με τις σελίδες που χρησιμοποίησες.\n";

  return `${instructions}\nΕρώτηση: ${question}\n\nΑποσπάσματα:\n${excerpts || '(Δεν βρέθηκαν σχετικά αποσπάσματα.)'}\n`;
}

async function geminiAnswer({ apiKey, model, prompt }) {
  // Prefer env vars; fall back to request; then hard-coded default.
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    apiKey ||
    DEFAULT_API_KEY;

  const ai = new GoogleGenAI({ apiKey: key });

  // Per official docs, response.text is available on the SDK response.
  const response = await ai.models.generateContent({
    model: model || DEFAULT_MODEL,
    contents: prompt,
    config: {
      temperature: 0.0,
      maxOutputTokens: 4096,
    },
  });

  return (response && response.text) ? String(response.text).trim() : String(response).trim();
}

// In-memory index cache keyed by (pdfHash + chunking params)
const INDEX_CACHE = new Map();

async function getOrBuildIndex(pdfAbsPath, { reindex = false, maxChars = 4500, overlapChars = 600 } = {}) {
  const data = await fs.readFile(pdfAbsPath);
  const pdfHash = sha256Buffer(data);
  const cacheKey = `${pdfHash}|${maxChars}|${overlapChars}`;

  if (!reindex && INDEX_CACHE.has(cacheKey)) return INDEX_CACHE.get(cacheKey);

  const pagesText = await extractPagesText(pdfAbsPath);
  const chunks = chunkPages(pagesText, maxChars, overlapChars);
  const idx = buildIndexFromChunks(pdfHash, chunks);

  INDEX_CACHE.set(cacheKey, idx);
  return idx;
}

// Health
router.get('/mpTeacher/mapserverTeacher/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /api/mpTeacher/mapserverTeacher/ask
 */
router.post('/mpTeacher/mapserverTeacher/ask', async (req, res) => {
  try {
    const {
      prompt,
      pdfPath: pdfPathFromReq,
      model,
      apiKey,
      topK = DEFAULT_TOPK,
      reindex = false,
    } = req.body || {};


    const teacherCfg = config?.geminiMpTeacher || {};
    const pdfPath = (pdfPathFromReq && typeof pdfPathFromReq === 'string')
      ? pdfPathFromReq
      : (teacherCfg.pdfPath || '');

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing "prompt" (string).' });
    }
    if (!pdfPath || typeof pdfPath !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing "pdfPath" (string). Provide it in the request or set config.geminiMpTeacher.pdfPath.' });
    }

    const pdfAbsPath = path.resolve(pdfPath);
    const exists = await fs.pathExists(pdfAbsPath);
    if (!exists) {
      return res.status(400).json({ ok: false, error: `PDF not found: ${pdfAbsPath}` });
    }

    const idx = await getOrBuildIndex(pdfAbsPath, { reindex });
    const ranked = bm25Search(idx, prompt, Number(topK) || DEFAULT_TOPK);
    const usedChunks = ranked.map(r => idx.chunks[r.i]);

    const teacherPrompt = buildTeacherPrompt(prompt, usedChunks);
    const answer = await geminiAnswer({ apiKey, model, prompt: teacherPrompt });

    const sources = usedChunks.map((ch, k) => ({
      rank: k + 1,
      pageStart: ch.pageStart,
      pageEnd: ch.pageEnd,
    }));

    return res.json({ ok: true, answer, sources, model: model || DEFAULT_MODEL, pdfPath: pdfAbsPath });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'Teacher API failed.',
      details: err && err.message ? err.message : String(err),
    });
  }
});

module.exports = router;
