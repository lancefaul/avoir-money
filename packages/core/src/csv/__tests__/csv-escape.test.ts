import { describe, it, expect } from 'vitest';
import { escapeCsvCell, needsFormulaGuard, unescapeFormulaGuard } from '../csv-escape.js';

describe('escapeCsvCell — CSV syntax', () => {
  it('leaves a plain value untouched', () => {
    expect(escapeCsvCell('Groceries')).toBe('Groceries');
  });
  it('quotes and doubles quotes when a comma or quote is present', () => {
    expect(escapeCsvCell('a, b')).toBe('"a, b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes when a newline is present', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('escapeCsvCell — formula injection', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\ttab', '\rcr'])(
    'prefixes a leading formula trigger with an apostrophe: %j',
    (payload) => {
      expect(escapeCsvCell(payload)).toBe(`'${payload}`);
    },
  );

  it('guards the classic command-injection payload (and quotes it for its embedded ")', () => {
    // Leading '=' → guard with ', and the embedded " forces CSV quoting + doubling.
    expect(escapeCsvCell('=cmd|"/C calc"!A0')).toBe(`"'=cmd|""/C calc""!A0"`);
  });

  it('does not guard a trigger char that is not leading', () => {
    expect(escapeCsvCell('a=b')).toBe('a=b');
    expect(escapeCsvCell('12-34')).toBe('12-34');
  });

  it('applies both the guard and CSV quoting when a payload also needs quotes', () => {
    // leading '=' → guard to "'=x,y", then the comma forces quoting
    expect(escapeCsvCell('=x,y')).toBe(`"'=x,y"`);
  });
});

describe('unescapeFormulaGuard — round-trip', () => {
  it('strips the apostrophe only when it guards a formula trigger', () => {
    expect(unescapeFormulaGuard("'=1+1")).toBe('=1+1');
    expect(unescapeFormulaGuard("'@x")).toBe('@x');
  });
  it('leaves a genuine leading apostrophe alone', () => {
    expect(unescapeFormulaGuard("'tis the season")).toBe("'tis the season");
    expect(unescapeFormulaGuard("'")).toBe("'");
  });
  it('round-trips: unescape(guard(v)) === v for guarded values', () => {
    for (const v of ['=1+1', '+x', '-y', '@z', 'plain', 'a=b']) {
      const guarded = needsFormulaGuard(v) ? `'${v}` : v;
      expect(unescapeFormulaGuard(guarded)).toBe(v);
    }
  });
});
