// syntaxisErrorDetector.js (v2)
'use strict';

/**
 * Heuristic MapServer mapfile syntax error detector.
 *
 * Improvements (v2):
 * - Unified tokenizer (same behavior as endDetector) for #, //, /*...*\/ and quotes
 * - Column (στήλη) reporting
 * - Hard vs Soft issues + cascade control (suppresses soft warnings after a hard parse-likely error)
 * - Typo suggestions for UNKNOWN_KEYWORD (Levenshtein)
 *
 * @param {string} mapfileText
 * @param {object} [options]
 * @param {boolean} [options.includeNotes=true] - include heuristic notes at end
 * @param {number}  [options.softSuppressionLines=25] - after a HARD issue, suppress soft warnings for N lines
 * @param {boolean} [options.enableSuggestions=true] - add typo suggestions for unknown keywords
 * @param {number}  [options.maxSuggestions=3] - max suggestion count
 * @param {boolean} [options.allowMultilineQuotes=false] - if true, tokenizer will treat quotes as multi-line
 * @returns {string} human-readable report (Greek)
 */

// --- Shared tokenizer (same semantics as endDetector.v2) ---
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
            i += 1; // opening quote

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
            tokens.push({ type: 'word', text, col: start + 1 }); // 1-based
            continue;
        }

        // Any other character
        i += 1;
    }

    return { tokens, state, unclosedQuotes };
}

function looksUpperKeyword(tokenValue) {
    return /^[A-Z_][A-Z0-9_]*$/.test(tokenValue);
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length;
    const bl = b.length;
    if (al === 0) return bl;
    if (bl === 0) return al;

    // Ensure b is the shorter one to reduce memory a bit
    if (bl > al) {
        const tmp = a; a = b; b = tmp;
    }

    const v0 = new Array(b.length + 1);
    const v1 = new Array(b.length + 1);

    for (let i = 0; i <= b.length; i++) v0[i] = i;

    for (let i = 0; i < a.length; i++) {
        v1[0] = i + 1;
        const ca = a.charCodeAt(i);

        for (let j = 0; j < b.length; j++) {
            const cost = ca === b.charCodeAt(j) ? 0 : 1;
            const del = v0[j + 1] + 1;
            const ins = v1[j] + 1;
            const sub = v0[j] + cost;
            v1[j + 1] = Math.min(del, ins, sub);
        }

        for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
    }

    return v0[b.length];
}

function syntaxisErrorDetector(mapfileText, options = {}) {
    const includeNotes = options.includeNotes !== false;
    const softSuppressionLines = Number.isFinite(options.softSuppressionLines)
        ? Math.max(0, Math.floor(options.softSuppressionLines))
        : 25;
    const enableSuggestions = options.enableSuggestions !== false;
    const maxSuggestions = Number.isFinite(options.maxSuggestions)
        ? Math.max(0, Math.floor(options.maxSuggestions))
        : 3;
    const allowMultilineQuotes = options.allowMultilineQuotes === true;

    if (typeof mapfileText !== 'string') {
        return 'Σφάλμα: το mapfile πρέπει να δοθεί ως string.';
    }

    // --- Block model (simplified but useful) ---
    const BLOCKS = new Set([
        'MAP',
        'LAYER',
        'CLASS',
        'STYLE',
        'WEB',
        'METADATA',
        'PROJECTION',
        'LABEL',
        'OUTPUTFORMAT',
        'SYMBOL',
        'LEGEND',
        'SCALEBAR',
        'QUERYMAP',
        'REFERENCE',
        'CLUSTER',
        'GRID',
        'COMPOSITE'
    ]);

    // Which parent blocks are valid for a given block opener
    const ALLOWED_PARENTS = {
        MAP: ['ROOT'],
        LAYER: ['MAP'],
        CLASS: ['LAYER'],
        STYLE: ['CLASS', 'LABEL'], // some mapfiles place STYLE inside LABEL too
        LABEL: ['CLASS'],
        WEB: ['MAP'],
        METADATA: ['MAP', 'LAYER', 'CLASS', 'WEB', 'OUTPUTFORMAT'],
        PROJECTION: ['MAP', 'LAYER'],
        OUTPUTFORMAT: ['MAP'],
        SYMBOL: ['MAP'],
        LEGEND: ['MAP'],
        SCALEBAR: ['MAP'],
        QUERYMAP: ['MAP'],
        REFERENCE: ['MAP'],
        CLUSTER: ['LAYER'],
        GRID: ['LAYER'],
        COMPOSITE: ['LAYER']
    };

    // Keywords (first token per line) that are common, per context.
    // Not exhaustive by design — used to catch obvious "wrong context" and typos.
    const ALLOWED_FIRST_TOKENS = {
        ROOT: new Set(['MAP']),
        MAP: new Set([
            'NAME', 'STATUS', 'EXTENT', 'UNITS', 'SIZE', 'IMAGETYPE', 'IMAGECOLOR',
            'SHAPEPATH', 'FONTSET', 'SYMBOLSET', 'CONFIG', 'DEBUG',
            'OUTPUTFORMAT', 'SYMBOL', 'WEB', 'LAYER',
            'LEGEND', 'SCALEBAR', 'QUERYMAP', 'REFERENCE',
            'PROJECTION', 'METADATA',
            'MAXSIZE', 'RESOLUTION', 'DEFRESOLUTION', 'ANGLE', 'TRANSPARENT',
            'END', 'INCLUDE'
        ]),
        LAYER: new Set([
            'NAME', 'TYPE', 'STATUS', 'DATA', 'CONNECTION', 'CONNECTIONTYPE',
            'FILTER', 'FILTERITEM', 'FILTERTYPE',
            'CLASSITEM', 'LABELITEM', 'GROUP',
            'MINSCALEDENOM', 'MAXSCALEDENOM',
            'MINDISTANCE', 'MAXDISTANCE',
            'OPACITY', 'TRANSPARENCY',
            'PROCESSING', 'VALIDATION', 'TEMPLATE', 'HEADER', 'FOOTER',
            'TOLERANCE', 'TOLERANCEUNITS',
            'PROJECTION', 'METADATA',
            'CLASS', 'CLUSTER', 'GRID', 'COMPOSITE',
            'END', 'INCLUDE'
        ]),
        CLASS: new Set([
            'NAME', 'TITLE', 'GROUP', 'EXPRESSION', 'TEXT',
            'MINSCALEDENOM', 'MAXSCALEDENOM',
            'STYLE', 'LABEL',
            'TEMPLATE', 'KEYIMAGE',
            'METADATA',
            'OPACITY',
            'END', 'INCLUDE'
        ]),
        STYLE: new Set([
            'COLOR', 'OUTLINECOLOR', 'WIDTH', 'MINWIDTH', 'MAXWIDTH',
            'SIZE', 'MINSIZE', 'MAXSIZE',
            'SYMBOL', 'PATTERN', 'GAP', 'ANGLE',
            'OPACITY',
            'END'
        ]),
        LABEL: new Set([
            'TEXT', 'TYPE', 'FONT', 'SIZE', 'MINSIZE', 'MAXSIZE',
            'COLOR', 'OUTLINECOLOR', 'SHADOWCOLOR', 'SHADOWSIZE',
            'POSITION', 'OFFSET', 'ANGLE', 'WRAP', 'BUFFER',
            'MINSCALEDENOM', 'MAXSCALEDENOM',
            'STYLE',
            'END'
        ]),
        WEB: new Set([
            'IMAGEPATH', 'IMAGEURL', 'TEMPLATE', 'HEADER', 'FOOTER', 'ERROR',
            'METADATA', 'END'
        ]),
        OUTPUTFORMAT: new Set([
            'NAME', 'DRIVER', 'MIMETYPE', 'IMAGEMODE', 'EXTENSION',
            'FORMATOPTION', 'TRANSPARENT', 'END', 'METADATA'
        ]),
        // In METADATA / PROJECTION we don't enforce first-token keywords (content is free-form)
        METADATA: null,
        PROJECTION: null,
        SYMBOL: new Set(['NAME', 'TYPE', 'IMAGE', 'POINTS', 'FILLED', 'END']),
        LEGEND: new Set(['STATUS', 'KEYSIZE', 'LABEL', 'TEMPLATE', 'END']),
        SCALEBAR: new Set(['STATUS', 'SIZE', 'INTERVALS', 'UNITS', 'COLOR', 'END']),
        QUERYMAP: new Set(['STATUS', 'SIZE', 'COLOR', 'STYLE', 'END']),
        REFERENCE: new Set(['STATUS', 'IMAGE', 'EXTENT', 'SIZE', 'COLOR', 'END']),
        CLUSTER: new Set(['MAXDISTANCE', 'REGION', 'BUFFER', 'END']),
        GRID: new Set(['MINARCS', 'MAXARCS', 'MININTERVAL', 'MAXINTERVAL', 'END']),
        COMPOSITE: new Set(['OPACITY', 'COMPOP', 'END'])
    };

    // Global known keywords to detect obvious typos at start of line
    const GLOBAL_KNOWN = new Set([
        ...Object.keys(ALLOWED_FIRST_TOKENS).filter(k => k !== 'ROOT'),
        ...Array.from(ALLOWED_FIRST_TOKENS.ROOT || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.MAP || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.LAYER || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.CLASS || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.STYLE || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.LABEL || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.WEB || []),
        ...Array.from(ALLOWED_FIRST_TOKENS.OUTPUTFORMAT || []),
        'END'
    ]);

    function currentContext(stack) {
        return stack[stack.length - 1]?.type || 'ROOT';
    }

    function isAllowedParent(child, parent) {
        const allowed = ALLOWED_PARENTS[child];
        if (!allowed) return true;
        return allowed.includes(parent);
    }

    function contextsWhereKeywordIsAllowed(kw) {
        const out = [];
        for (const [ctx, set] of Object.entries(ALLOWED_FIRST_TOKENS)) {
            if (!set) continue;
            if (set.has(kw)) out.push(ctx);
        }
        // ROOT isn't very useful in suggestions
        return out.filter(c => c !== 'ROOT');
    }

    function suggestKeywords(kw) {
        if (!enableSuggestions || maxSuggestions <= 0) return [];
        const w = kw.toUpperCase();
        const maxDist = w.length <= 6 ? 2 : 3;

        const scored = [];
        for (const cand of GLOBAL_KNOWN) {
            if (cand === w) continue;
            // quick filter to reduce work
            if (Math.abs(cand.length - w.length) > maxDist) continue;

            const d = levenshtein(w, cand);
            if (d <= maxDist) scored.push({ cand, d });
        }

        scored.sort((a, b) => a.d - b.d || a.cand.localeCompare(b.cand));
        return scored.slice(0, maxSuggestions).map(x => x.cand);
    }

    // --- Run scan ---
    const issues = [];
    const stack = [{ type: 'ROOT', line: 0, col: 0 }];

    const lines = mapfileText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let suppressSoftUntilLine = 0;
    let suppressedSoftCount = 0;

    function addIssue(issue) {
        // cascade control
        const isSoft = issue.severity === 'SOFT';
        if (isSoft && issue.lineNo <= suppressSoftUntilLine) {
            suppressedSoftCount += 1;
            return;
        }

        issues.push(issue);

        if (issue.severity === 'HARD') {
            suppressSoftUntilLine = Math.max(suppressSoftUntilLine, issue.lineNo + softSuppressionLines);
        }
    }

    const state = { inBlockComment: false, inQuote: false, quoteChar: '' };

    for (let idx = 0; idx < lines.length; idx++) {
        const lineNo = idx + 1;
        const rawLine = lines[idx];

        const out = tokenizeLine(rawLine, state, { allowMultilineQuotes });

        // Empty line (or only comments)
        if (!out.tokens.length) continue;

        // Strong signal: unclosed quote in the same line (MapServer typically doesn't allow multi-line strings)
        if (out.unclosedQuotes && out.unclosedQuotes.length) {
            for (const uq of out.unclosedQuotes) {
                addIssue({
                    lineNo,
                    col: uq.col,
                    kind: 'MISSING_QUOTE',
                    severity: 'HARD',
                    message: `Βρέθηκε ανοιχτό ${uq.quote} χωρίς κλείσιμο στην ίδια γραμμή.`,
                    excerpt: rawLine.trim()
                });
            }
            // Continue analysis of the tokens that were already extracted (if any)
        }

        // First meaningful token
        const firstTok = out.tokens[0];
        const ctx = currentContext(stack);

        // END handling (only when END is first token of the line)
        if (firstTok.type === 'word') {
            const kw = firstTok.text.toUpperCase();

            if (kw === 'END') {
                if (stack.length <= 1) {
                    addIssue({
                        lineNo,
                        col: firstTok.col,
                        kind: 'END_MISMATCH',
                        severity: 'HARD',
                        message: 'Βρέθηκε END χωρίς ανοιχτό block να κλείσει.',
                        excerpt: rawLine.trim()
                    });
                } else {
                    stack.pop();
                }
                continue;
            }

            // Block openers
            if (BLOCKS.has(kw)) {
                const parent = ctx;

                if (!isAllowedParent(kw, parent)) {
                    addIssue({
                        lineNo,
                        col: firstTok.col,
                        kind: 'NESTING',
                        severity: 'HARD',
                        message:
                            `Λάθος nesting: βρέθηκε ${kw} ενώ το τρέχον block είναι ${parent}. ` +
                            `Το ${kw} αναμένεται μέσα σε: ${(ALLOWED_PARENTS[kw] || []).join(', ') || '—'}.`,
                        excerpt: rawLine.trim()
                    });
                }

                // Soft context/order check
                const allowedSet = ALLOWED_FIRST_TOKENS[parent];
                if (allowedSet && !allowedSet.has(kw)) {
                    addIssue({
                        lineNo,
                        col: firstTok.col,
                        kind: 'CONTEXT',
                        severity: 'SOFT',
                        message: `Ύποπτο context: το keyword ${kw} δεν αναμένεται μέσα στο ${parent}.`,
                        excerpt: rawLine.trim()
                    });
                }

                stack.push({ type: kw, line: lineNo, col: firstTok.col });
                continue;
            }

            // Inside METADATA / PROJECTION: keep validation minimal
            if (ctx === 'METADATA') {
                // Soft check: "key" "value" is very common
                if (out.tokens.length >= 2) {
                    const kTok = out.tokens[0];
                    const vTok = out.tokens[1];
                    const kOk = kTok.type === 'string' || (kTok.type === 'word' && !looksUpperKeyword(kTok.text.toUpperCase()));
                    const vOk = vTok.type === 'string' || vTok.type === 'word';
                    if (!kOk || !vOk) {
                        addIssue({
                            lineNo,
                            col: kTok.col,
                            kind: 'METADATA_FORMAT',
                            severity: 'SOFT',
                            message: 'Πιθανό format METADATA: συνήθως είναι "key" "value".',
                            excerpt: rawLine.trim()
                        });
                    }
                }
                continue;
            }

            if (ctx === 'PROJECTION') {
                // Commonly init=epsg:XXXX or +proj=... — skip keyword validation.
                continue;
            }

            // Context/order check for non-block keywords:
            const allowedHere = ALLOWED_FIRST_TOKENS[ctx];
            if (allowedHere && looksUpperKeyword(kw) && !allowedHere.has(kw)) {
                const isKnown = GLOBAL_KNOWN.has(kw);
                const allowedIn = isKnown ? contextsWhereKeywordIsAllowed(kw) : [];
                const extra = isKnown
                    ? (allowedIn.length ? ` (συνήθως επιτρέπεται σε: ${allowedIn.slice(0, 4).join(', ')})` : ' (ίσως ασυμβατό με την έκδοση ή σε λάθος block)')
                    : ' (πιθανό typo ή άγνωστο keyword)';
                addIssue({
                    lineNo,
                    col: firstTok.col,
                    kind: 'CONTEXT',
                    severity: 'SOFT',
                    message: `Λάθος context/σειρά: το keyword ${kw} δεν αναμένεται μέσα στο ${ctx}.${extra}`,
                    excerpt: rawLine.trim()
                });
            }

            // Unknown/typo check (only for uppercase-looking words at start)
            if (looksUpperKeyword(kw) && !GLOBAL_KNOWN.has(kw)) {
                const sugg = suggestKeywords(kw);
                addIssue({
                    lineNo,
                    col: firstTok.col,
                    kind: 'UNKNOWN_KEYWORD',
                    severity: 'SOFT',
                    message:
                        `Άγνωστη/ύποπτη λέξη-κλειδί στην αρχή γραμμής: ${kw} (πιθανό typo)` +
                        (sugg.length ? `. Μήπως εννοείς: ${sugg.join(', ')};` : '.'),
                    excerpt: rawLine.trim()
                });
            }

            continue;
        }

        // If first token is string (common in METADATA): nothing to validate here beyond quote checks.
        if (ctx !== 'METADATA' && ctx !== 'PROJECTION') {
            // Soft, but often meaningless; keep silent to reduce noise.
            continue;
        }
    }

    // EOF: blocks left open
    if (stack.length > 1) {
        const openBlocks = stack
            .slice(1)
            .map(b => `${b.type} (άνοιξε στη γραμμή ${b.line}, στήλη ${b.col})`)
            .join(' → ');
        addIssue({
            lineNo: lines.length,
            col: 0,
            kind: 'MISSING_END',
            severity: 'HARD',
            message: `Φαίνεται ότι λείπουν END. Ανοιχτά blocks στο τέλος: ${openBlocks}`,
            excerpt: ''
        });
    }

    // --- Build report ---
    if (!issues.length) {
        return [
            'Δεν εντοπίστηκαν προφανή συντακτικά προβλήματα με βάση heuristics.',
            includeNotes
                ? 'Σημείωση: Ο έλεγχος είναι heuristic (όχι πλήρης MapServer parser). Αν έχεις συγκεκριμένο error από MapServer, στείλε το για πιο στοχευμένη αντιστοίχιση.'
                : ''
        ].filter(Boolean).join('\n');
    }

    // Split hard vs soft
    const hard = issues.filter(i => i.severity === 'HARD');
    const soft = issues.filter(i => i.severity === 'SOFT');

    const order = [
        'NESTING',
        'END_MISMATCH',
        'MISSING_END',
        'MISSING_QUOTE',
        'UNKNOWN_KEYWORD',
        'CONTEXT',
        'METADATA_FORMAT'
    ];

    const kindTitle = {
        NESTING: 'Λάθος nesting blocks',
        END_MISMATCH: 'END χωρίς αντίστοιχο block',
        MISSING_END: 'Λείπει END (ανοιχτά blocks)',
        MISSING_QUOTE: 'Λείπει εισαγωγικό (" ή \')',
        UNKNOWN_KEYWORD: 'Άγνωστη/λάθος λέξη-κλειδί',
        CONTEXT: 'Λάθος σειρά/λάθος context',
        METADATA_FORMAT: 'Ύποπτο format σε METADATA'
    };

    function groupByKind(arr) {
        const grouped = new Map();
        for (const k of order) grouped.set(k, []);
        for (const it of arr) {
            if (!grouped.has(it.kind)) grouped.set(it.kind, []);
            grouped.get(it.kind).push(it);
        }
        return grouped;
    }

    const out = [];
    out.push(`Εντοπίστηκαν ${issues.length} πιθανό(ά) πρόβλημα(τα):`);

    if (hard.length) {
        out.push('');
        out.push(`== HARD errors (πιθανό parse fail) (${hard.length}) ==`);
        const grouped = groupByKind(hard);
        for (const [kind, arr] of grouped.entries()) {
            if (!arr.length) continue;
            out.push('');
            out.push(`— ${kindTitle[kind] || kind} (${arr.length})`);
            for (const it of arr) {
                const colPart = it.col ? `, στήλη ${it.col}` : '';
                out.push(`  • Γραμμή ${it.lineNo}${colPart}: ${it.message}`);
                if (it.excerpt) out.push(`    Απόσπασμα: ${it.excerpt}`);
            }
        }
    }

    if (soft.length) {
        out.push('');
        out.push(`== SOFT warnings (πιθανό typo/λάθος context/έκδοση) (${soft.length}) ==`);
        const grouped = groupByKind(soft);
        for (const [kind, arr] of grouped.entries()) {
            if (!arr.length) continue;
            out.push('');
            out.push(`— ${kindTitle[kind] || kind} (${arr.length})`);
            for (const it of arr) {
                const colPart = it.col ? `, στήλη ${it.col}` : '';
                out.push(`  • Γραμμή ${it.lineNo}${colPart}: ${it.message}`);
                if (it.excerpt) out.push(`    Απόσπασμα: ${it.excerpt}`);
            }
        }
    }

    if (suppressedSoftCount > 0) {
        out.push('');
        out.push(`(Info) Καταστάλθηκαν ${suppressedSoftCount} soft warning(s) λόγω cascade control (μετά από HARD error).`);
    }

    if (includeNotes) {
        out.push('');
        out.push('Σημείωση: Ο detector είναι heuristic. Για 100% ακρίβεια, ιδανικά τρέχεις και τον επίσημο MapServer parser και χαρτογραφείς το error message.');
    }

    return out.join('\n');
}

module.exports = { syntaxisErrorDetector };
