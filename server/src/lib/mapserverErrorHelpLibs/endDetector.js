'use strict';

/**
 * Blocks in MapServer mapfiles that open a block and MUST be closed by END.
 * You can extend this list via options.extraOpeners (Set or Array).
 */
const DEFAULT_BLOCK_OPENERS = new Set([
    'MAP',
    'LAYER',
    'CLASS',
    'STYLE',
    'LABEL',
    'LEADER',
    'WEB',
    'METADATA',
    'PROJECTION',
    'OUTPUTFORMAT',
    'SYMBOL',
    'QUERYMAP',
    'REFERENCE',
    'SCALEBAR',
    'LEGEND',
    'VALIDATION',
    'JOIN',
    'CLUSTER',
    'COMPOSITE',
    'FEATURE',
    'GRID',
    'IDENTIFY',

    // Common nested blocks that also end with END in mapfiles:
    'PATTERN',
    'POINTS',
]);

/**
 * Shared tokenizer (used to keep comment/quote handling consistent).
 *
 * Rules:
 * - Ignores # and // line comments (outside strings)
 * - Ignores /* ... *\/ block comments (can span multiple lines)
 * - Reads quoted strings "..." or '...' with backslash escapes
 * - Emits:
 *   - word tokens: [A-Za-z_][A-Za-z0-9_]*
 *   - string tokens: text inside quotes (type="string")
 *
 * State is mutated intentionally to support multi-line block comments.
 * Multi-line quotes are OFF by default; can be enabled via options.allowMultilineQuotes.
 */
function tokenizeLine(line, state, options = {}) {
    const allowMultilineQuotes = options.allowMultilineQuotes === true;

    const tokens = [];
    const unclosedQuotes = [];
    let i = 0;

    while (i < line.length) {
        // Inside /* ... */ block comment
        if (state.inBlockComment) {
            const endIdx = line.indexOf('*/', i);
            if (endIdx === -1) return { tokens, state, unclosedQuotes }; // rest of line is comment
            state.inBlockComment = false;
            i = endIdx + 2;
            continue;
        }

        // Inside a multi-line quote (only if enabled)
        if (state.inQuote) {
            const quote = state.quoteChar;
            let escaped = false;
            for (; i < line.length; i++) {
                const c = line[i];
                if (escaped) { escaped = false; continue; }
                if (c === '\\') { escaped = true; continue; }
                if (c === quote) {
                    state.inQuote = false;
                    state.quoteChar = '';
                    i += 1;
                    break;
                }
            }
            if (state.inQuote) return { tokens, state, unclosedQuotes }; // consume whole line
            continue;
        }

        const ch = line[i];
        const next = i + 1 < line.length ? line[i + 1] : '';

        // Line comments
        if (ch === '#') break;
        if (ch === '/' && next === '/') break;

        // Start of block comment
        if (ch === '/' && next === '*') {
            state.inBlockComment = true;
            i += 2;
            continue;
        }

        // Skip whitespace
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }

        // Quoted string
        if (ch === '"' || ch === "'") {
            const quote = ch;
            const startCol = i + 1; // 1-based
            i += 1; // consume opening quote

            let val = '';
            let escaped = false;
            let closed = false;

            for (; i < line.length; i++) {
                const c = line[i];
                if (escaped) { val += c; escaped = false; continue; }
                if (c === '\\') { escaped = true; continue; }
                if (c === quote) { closed = true; i += 1; break; }
                val += c;
            }

            tokens.push({ type: 'string', value: val, col: startCol, quote, closed });

            if (!closed) {
                unclosedQuotes.push({ col: startCol, quote });
                if (allowMultilineQuotes) {
                    state.inQuote = true;
                    state.quoteChar = quote;
                } else {
                    // string runs to end-of-line; nothing else to tokenize here
                    return { tokens, state, unclosedQuotes };
                }
            }

            continue;
        }

        // Word token: [A-Za-z_][A-Za-z0-9_]*
        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            i += 1;
            while (i < line.length && /[A-Za-z0-9_]/.test(line[i])) i += 1;
            const text = line.slice(start, i);
            tokens.push({ type: 'word', text, col: start + 1 }); // 1-based column
            continue;
        }

        // Any other character
        i += 1;
    }

    return { tokens, state, unclosedQuotes };
}

function isAllCapsIdentifier(s) {
    return /^[A-Z_][A-Z0-9_]*$/.test(s);
}

/**
 * Main analyzer (returns structured result)
 */
function analyze(mapfileText, options = {}) {
    const text =
        Buffer.isBuffer(mapfileText) ? mapfileText.toString('utf8') : String(mapfileText ?? '');

    const lines = text.replace(/\r\n?/g, '\n').split('\n');

    const extraOpeners = options.extraOpeners
        ? new Set(Array.isArray(options.extraOpeners) ? options.extraOpeners : [...options.extraOpeners])
        : new Set();

    const openers = new Set([...DEFAULT_BLOCK_OPENERS, ...[...extraOpeners].map(s => String(s).toUpperCase())]);

    // Heuristic: treat single-token ALLCAPS lines as block openers (helps catch new/rare blocks)
    const enableHeuristicOpeners = options.enableHeuristicOpeners !== false; // default true

    // Quote/comment behavior
    const allowMultilineQuotes = options.allowMultilineQuotes === true;

    /**
     * Safety:
     * Inline END (e.g. "PATTERN ... END") is common.
     * But to avoid popping the stack on accidental "END" tokens mid-line (unknown constructs),
     * we ONLY honor inline END tokens when:
     *   - the line starts with a known/heuristic opener, OR
     *   - options.allowInlineEndWithoutOpener === true, OR
     *   - END is the first word token on the line (classic END line)
     */
    const allowInlineEndWithoutOpener = options.allowInlineEndWithoutOpener === true;

    const stack = [];
    const extraEnds = [];

    const state = { inBlockComment: false, inQuote: false, quoteChar: '' };

    for (let idx = 0; idx < lines.length; idx++) {
        const lineNo = idx + 1;
        const line = lines[idx];

        const out = tokenizeLine(line, state, { allowMultilineQuotes });
        // state is mutated intentionally, so keep it
        const wordTokens = out.tokens.filter(t => t.type === 'word');

        if (!wordTokens.length) continue;

        const first = wordTokens[0].text.toUpperCase();

        const isKnownOpener = openers.has(first);
        const isHeuristicOpener =
            enableHeuristicOpeners &&
            wordTokens.length === 1 &&
            isAllCapsIdentifier(first) &&
            first.length >= 3 && // avoid ON/OFF etc
            first !== 'END';

        const openedThisLine = isKnownOpener || isHeuristicOpener;

        if (openedThisLine) {
            stack.push({
                type: first,
                line: lineNo,
                col: wordTokens[0].col,
            });
        }

        // Handle END tokens:
        for (let tIdx = 0; tIdx < wordTokens.length; tIdx++) {
            const tok = wordTokens[tIdx];
            const kw = tok.text.toUpperCase();
            if (kw !== 'END') continue;

            const shouldHonor =
                tIdx === 0 || allowInlineEndWithoutOpener || openedThisLine;

            if (!shouldHonor) continue;

            if (stack.length === 0) {
                extraEnds.push({
                    line: lineNo,
                    col: tok.col,
                    excerpt: line.trim().slice(0, 200),
                });
            } else {
                stack.pop();
            }
        }
    }

    const missingEnds = stack.slice(); // remaining open blocks at EOF

    const ok = extraEnds.length === 0 && missingEnds.length === 0;

    const messageParts = [];
    messageParts.push('endDetector: Έλεγχος blocks/END');

    if (ok) {
        messageParts.push('✅ Δεν εντοπίστηκε πρόβλημα: δεν υπάρχει παραπανίσιο END και δεν λείπει END.');
        return { ok, extraEnds, missingEnds, message: messageParts.join('\n') };
    }

    messageParts.push(
        `❌ Εντοπίστηκαν: ${extraEnds.length} παραπανίσια END και ${missingEnds.length} block(s) χωρίς END.`
    );

    if (extraEnds.length) {
        messageParts.push('\nΠαραπανίσια END:');
        for (const e of extraEnds) {
            messageParts.push(
                `- Παραπανίσιο END στη γραμμή ${e.line}, στήλη ${e.col}.` +
                (e.excerpt ? `  (γραμμή: "${e.excerpt}")` : '')
            );
        }
    }

    if (missingEnds.length) {
        messageParts.push('\nΛείπουν END (ανοιχτά blocks στο τέλος του αρχείου):');
        // report from inner-most to outer-most for clarity
        for (let i = missingEnds.length - 1; i >= 0; i--) {
            const b = missingEnds[i];
            messageParts.push(`- Λείπει END για το block ${b.type} (άνοιξε στη γραμμή ${b.line}, στήλη ${b.col}).`);
        }

        // optional: show nesting order
        const nesting = missingEnds.map(b => `${b.type}@${b.line}:${b.col}`).join(' > ');
        messageParts.push(`\nNesting (από έξω προς τα μέσα): ${nesting}`);
    }

    return { ok, extraEnds, missingEnds, message: messageParts.join('\n') };
}

/**
 * The service function the API can call: returns ONLY text (as requested).
 */
function endDetector(mapfileText, options) {
    return analyze(mapfileText, options).message;
}

// CommonJS exports (Node.js)
module.exports = endDetector;
module.exports.endDetector = endDetector;
module.exports.analyze = analyze;
module.exports.DEFAULT_BLOCK_OPENERS = DEFAULT_BLOCK_OPENERS;
