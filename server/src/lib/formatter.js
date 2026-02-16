// Stack-based Mapfile auto-formatter
// - Default indent: 4 (configurable via caller)
// - Opens only when a block keyword is standalone (allowing inline comments)
// - Pre-dedents on END and realigns using optional trailing block name (e.g., END # QUERYMAP)
// - Preserves blank lines and full-line comments
// - Self-heals: level = stack.length

function formatMapfile(src, indentSize = 4) {
  const IND = ' '.repeat(Number(indentSize) > 0 ? Number(indentSize) : 4);
  const text = String(src || '').replace(/\t/g, '  ');
  const lines = text.split(/\r?\n/);

  // Known block openers
  const OPENERS = [
    'MAP', 'LAYER', 'CLASS', 'STYLE', 'LABEL', 'PROJECTION', 'METADATA',
    'OUTPUTFORMAT', 'WEB', 'FEATURE', 'LEGEND', 'SCALEBAR', 'QUERYMAP',
    'CLUSTER', 'GRID', 'LEADER', 'SYMBOL', 'VALIDATION', 'JOIN', 'JOINS',
    'GEOTRANSFORM', 'COMPOSITE', 'PATTERN'
  ];

  // Standalone opener: the keyword must be the first token and no other tokens follow,
  // except an optional inline comment starting with '#'.
  // Examples that MATCH: "LAYER", "STYLE   # comment"
  // Examples that DO NOT MATCH: "STYLE HILITE", "OUTPUTFORMAT \"png24\""
  const openerLine = new RegExp(
    `^(${OPENERS.join('|')})\\s*(?:#.*)?$`, 'i'
  );

  // END line with optional trailing block name, with or without '#'
  // Matches:
  //   END
  //   END # CLASS
  //   END CLASS
  const endLine = /^END(?:\s*(?:#\s*)?([A-Z0-9_]+))?\s*$/i;

  const stack = []; // holds block names, e.g., ['MAP', 'QUERYMAP']
  const out = [];

  for (const raw of lines) {
    const trimmed = raw.trim();

    // Preserve empty lines exactly
    if (trimmed === '') {
      out.push('');
      continue;
    }

    // Preserve full-line comments at current level
    if (trimmed.startsWith('#')) {
      out.push(IND.repeat(stack.length) + trimmed);
      continue;
    }

    // END handling: pre-dedent + realign using optional block name
    const mEnd = trimmed.match(endLine);
    if (mEnd) {
      const name = mEnd[1]?.toUpperCase();
      if (name) {
        // Realign to the *named* block level (keep it on the stack),
        // so the single pop() below will close exactly that block.
        let idx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].toUpperCase() === name) { idx = i; break; }
        }
        if (idx >= 0) {
          stack.length = idx + 1;  // keep through the named block
        }
      }
      // Pop once for this END (closes the current or named block)
      if (stack.length > 0) stack.pop();

      // Emit END with the corrected level
      out.push(IND.repeat(stack.length) + trimmed);
      continue;
    }

    // Normal (non-END) line: print at current level
    out.push(IND.repeat(stack.length) + trimmed);

    // If this is a standalone opener, push to stack (indent subsequent lines)
    const mOpen = trimmed.match(openerLine);
    if (mOpen) {
      // Special case: avoid treating "STYLE HILITE" as opener (already excluded by regex),
      // but keep this guard to be safe if future keywords appear with args.
      const rest = trimmed.slice(mOpen[1].length).trim();
      if (rest === '' || rest.startsWith('#')) {
        stack.push(mOpen[1].toUpperCase());
      }
    }
  }

  return out.join('\n');
}

module.exports = { formatMapfile };
