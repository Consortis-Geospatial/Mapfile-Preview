// server/src/lib/validate.js  (patched: distinguish warnings vs errors)
// Key change: Do NOT fail validation just because MapServer writes to stderr.
// We decide success/failure primarily from the CGI stdout response (GetCapabilities).
// stderr is classified into errors vs warnings; warnings do not fail validation.

const spawnMapserv = require('./spawnMapserv');

function stripHtml(html) {
  // crude but effective for MapServer's simple error page
  return (html || '').replace(/<[^>]+>/g, ' ');
}

function parseLineErrors(text) {
  const errors = [];
  const lines = (text || '').split(/\r?\n/).filter(Boolean);

  // collect any line that references "(line N)" or "line N"
  for (const raw of lines) {
    // 1) common: "Parsing error near (TOKEN):(line 14)"
    // 2) fallback: "... line 14 ..."
    const m = raw.match(/\(line\s+(\d+)\)|\bline\s+(\d+)\b/i);
    if (m) {
      const ln = Number(m[1] || m[2] || 1);
      errors.push({ line: ln, message: raw.trim() });
    }
  }

  // If nothing matched but we still think it's an error, return a generic marker on line 1
  if (errors.length === 0 && (text || '').trim()) {
    errors.push({ line: 1, message: (text || '').trim().slice(0, 500) });
  }

  return errors;
}

function parseCgi(stdout) {
  // Split headers/body at double CRLF (or double LF fallback)
  let sep = '\r\n\r\n';
  let idx = stdout.indexOf(sep);
  if (idx === -1) {
    sep = '\n\n';
    idx = stdout.indexOf(sep);
  }

  if (idx === -1) {
    return { headersText: '', bodyText: stdout };
  }

  const headersText = stdout.slice(0, idx);
  const bodyText = stdout.slice(idx + sep.length);
  return { headersText, bodyText };
}

function getContentType(headersText) {
  const m = (headersText || '').match(/^Content-Type:\s*([^\r\n;]+)/im);
  return m ? m[1].trim().toLowerCase() : '';
}

function hasCapabilitiesXml(bodyText) {
  return /<\s*(WMS_Capabilities|WMT_MS_Capabilities)\b/i.test(bodyText || '');
}

function hasServiceException(bodyText) {
  return /<\s*(ServiceExceptionReport|ServiceException)\b/i.test(bodyText || '');
}

function looksLikeErrorHtml(contentType, bodyText) {
  if (contentType && contentType.includes('html')) return true;
  if (/MapServer Message|msLoadMap|msParseMap|Parsing error near/i.test(bodyText || '')) return true;
  return false;
}

// Heuristic classifier: put stderr lines into {errors,warnings}.
// Unknown lines default to warnings so we don't fail valid mapfiles due to PROJ/GDAL notices.
function splitStderr(stderr) {
  const lines = (stderr || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const errors = [];
  const warnings = [];

  for (const l of lines) {
    const isHardError =
      /\b(ERROR|FATAL)\b/i.test(l) ||
      /Segmentation fault|core dumped/i.test(l) ||
      (
        /msLoadMap\(|msLoadMapFromString\(|msParseMap\(|msValidate\(|msLayerOpen\(/i.test(l) &&
        /(Unable|Failed|Cannot|can't|No such|Parse|error)/i.test(l)
      );

    const isWarning =
      /\bWARN(ING)?\b/i.test(l) ||
      /deprecated/i.test(l) ||
      /^PROJ:/i.test(l) ||
      /^GDAL:/i.test(l);

    if (isHardError) errors.push(l);
    else if (isWarning) warnings.push(l);
    else warnings.push(l);
  }

  return { errors, warnings };
}

async function validateMap(mapPath) {
  console.log(`👉 [validateMap] Validating file: ${mapPath}`);

  const mapParam = String(mapPath);
const query =
    `map=${encodeURIComponent(mapParam)}` +
    `&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;

  return new Promise((resolve, reject) => {
    const child = spawnMapserv(query, { method: 'GET' });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('error', err => {
      console.error('💥 [validateMap] Spawn error:', err);
      reject(err);
    });

    child.on('close', (code) => {
      console.log(`🔚 [validateMap] mapserv exited with code ${code}`);

      const { headersText, bodyText } = parseCgi(stdout || '');
      const contentType = getContentType(headersText);

      const { errors: stderrErrors, warnings: stderrWarnings } = splitStderr(stderr);

      // 1) Decide validity primarily from stdout (CGI response)
      const stdoutIsCapabilities = hasCapabilitiesXml(bodyText);
      const stdoutIsServiceException = hasServiceException(bodyText);
      const stdoutIsHtmlError = looksLikeErrorHtml(contentType, bodyText);

      // Useful debug (but don't spam body)
      console.log(`[validateMap] detected Content-Type: ${contentType || '(unknown)'}`);
      if (headersText) console.log(`[validateMap] stdout headers:\n${headersText}`);
      if (stderrWarnings.length) console.warn(`⚠️ [validateMap] warnings on stderr: ${stderrWarnings.length}`);
      if (stderrErrors.length) console.warn(`❗ [validateMap] errors on stderr: ${stderrErrors.length}`);

      // 2) Explicit error response from MapServer (ServiceException or HTML error page)
      if (stdoutIsServiceException || stdoutIsHtmlError) {
        const plain = stripHtml(bodyText);
        const errList = parseLineErrors(plain);

        // If we couldn't parse line-based errors from stdout, fallback to stderr errors.
        if (errList.length === 0 && stderrErrors.length) {
          return resolve({
            success: false,
            errors: parseLineErrors(stripHtml(stderrErrors.join('\n'))),
            warnings: stderrWarnings
          });
        }

        return resolve({ success: false, errors: errList, warnings: stderrWarnings });
      }

      // 3) Success response (Capabilities). Even if stderr has warnings, we treat as valid.
      if (stdoutIsCapabilities) {
        console.log('✅ [validateMap] Capabilities XML detected. Treating as VALID.');
        return resolve({ success: true, errors: [], warnings: stderrWarnings });
      }

      // 4) No clear stdout verdict. If we have classified stderr errors, fail.
      if (stderrErrors.length) {
        return resolve({
          success: false,
          errors: parseLineErrors(stripHtml(stderrErrors.join('\n'))),
          warnings: stderrWarnings
        });
      }

      // 5) If mapserv exit code is non-zero and we still have no signal, treat as failure with generic error.
      if (code && code !== 0) {
        const msg = (stderr || '').trim() || (bodyText || '').trim() || `mapserv exited with code ${code}`;
        return resolve({ success: false, errors: [{ line: 1, message: msg.slice(0, 500) }], warnings: stderrWarnings });
      }

      // 6) Fallback: treat as success, keep warnings
      console.log('ℹ️ [validateMap] No error markers found. Treating as success.');
      return resolve({ success: true, errors: [], warnings: stderrWarnings });
    });
  });
}

module.exports = { validateMap };
