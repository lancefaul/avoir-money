/**
 * CSV cell escaping — the single source of truth for both export paths (the
 * transaction formatter here in core, and the client-side category export in
 * the web app).
 *
 * Two concerns:
 *  1. CSV *syntax*: quote cells containing commas, quotes, or newlines.
 *  2. Formula *injection*: a spreadsheet treats a cell that begins with
 *     `= + - @` or a control char (TAB / CR) as a formula, so an exported value
 *     like `=cmd|…` can execute when the file is opened. We neutralize by
 *     prefixing such cells with a single quote (the OWASP-recommended defense).
 *
 * The neutralizing prefix is reversible: `unescapeFormulaGuard` strips it, so a
 * value that round-trips through export → import is unchanged.
 */

// eslint-disable-next-line no-control-regex -- TAB/CR are exactly the chars we guard
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/** True when a cell would be interpreted as a formula by a spreadsheet. */
export function needsFormulaGuard(value: string): boolean {
  return FORMULA_TRIGGER.test(value);
}

/**
 * Escape a value for a CSV cell: neutralize formula injection first, then apply
 * CSV syntax quoting. The formula guard is applied before quoting so the `'`
 * lands on the raw value, not inside the quotes' escaping.
 */
export function escapeCsvCell(value: string): string {
  const guarded = needsFormulaGuard(value) ? `'${value}` : value;
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n')) {
    return '"' + guarded.replace(/"/g, '""') + '"';
  }
  return guarded;
}

/**
 * Inverse of the formula guard: strip a single leading `'` when it precedes a
 * formula-trigger char, so importing our own export is lossless. Leaves any
 * other apostrophe (a genuine value like `'tis`) untouched.
 */
export function unescapeFormulaGuard(value: string): string {
  if (value.length >= 2 && value[0] === "'" && FORMULA_TRIGGER.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}
