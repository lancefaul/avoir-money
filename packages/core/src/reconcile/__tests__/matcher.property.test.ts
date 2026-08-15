/**
 * Property-based tests for the reconciliation matcher.
 *
 * Example tests pin known shapes; these pin the structural guarantees that must
 * hold for *any* input — the ones a wrong result would violate silently rather
 * than visibly. Chief among them: every row must be accounted for exactly once.
 * A matcher that drops a row produces a plausible-looking report with a missing
 * discrepancy, which is worse than an obvious crash.
 *
 * Money arbitraries pass `noNaN`/`noDefaultInfinity`, and dates are generated as
 * integer day offsets rather than via `fc.date()`, per QUALITY.md — `fc.date()`
 * emits `Invalid Date` by default and produced a seed-dependent flake here once
 * already.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reconcile } from '../matcher.js';
import { nameSimilarity, normalizeName, dayDiff } from '../name-similarity.js';
import type { AppTx, Direction, Finding, StatementLine } from '../types.js';

const END = '2026-06-30';
const BASE = Date.UTC(2026, 5, 1); // 2026-06-01

/** Integer cents → dollars, so every generated amount is exactly representable. */
const amountArb = fc.integer({ min: 1, max: 500_000 }).map((c) => c / 100);
const dayArb = fc.integer({ min: 0, max: 45 });
const dateArb = dayArb.map((d) => new Date(BASE + d * 86_400_000).toISOString().slice(0, 10));
const directionArb = fc.constantFrom<Direction>('charge', 'credit');
const nameArb = fc.constantFrom(
  'Acme Bakery',
  'Corner Coffee',
  'Zenith Hardware',
  'City Utilities',
  'SQ *ZZQX HOLDINGS',
);

const statementArb: fc.Arbitrary<StatementLine> = fc.record({
  date: dateArb,
  description: nameArb,
  amount: amountArb,
  direction: directionArb,
});

const appArb: fc.Arbitrary<AppTx> = fc
  .record({
    date: dateArb,
    name: nameArb,
    amount: amountArb,
    direction: directionArb,
    n: fc.integer({ min: 0, max: 1_000_000 }),
  })
  .map(({ n, ...rest }) => ({ id: `t${n}`, ...rest }));

/** Every statement line referenced by a finding, across all shapes. */
function statementRefs(findings: Finding[]): StatementLine[] {
  return findings.flatMap((f) => [...(f.statement ? [f.statement] : []), ...(f.statements ?? [])]);
}

/** Every app transaction referenced by a finding, across all shapes. */
function appRefs(findings: Finding[]): AppTx[] {
  return findings.flatMap((f) => [...(f.app ? [f.app] : []), ...(f.apps ?? [])]);
}

describe('conservation', () => {
  it('accounts for every statement line exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 12 }),
        fc.array(appArb, { maxLength: 12 }),
        (statement, app) => {
          const { findings } = reconcile({ statement, app, endDate: END });
          const refs = statementRefs(findings);
          expect(refs.length).toBe(statement.length);
          // Identity, not equality — a duplicated reference would pass a value check.
          for (const line of statement) {
            expect(refs.filter((r) => r === line).length).toBe(1);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('accounts for every app transaction exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 12 }),
        fc.array(appArb, { maxLength: 12 }),
        (statement, app) => {
          const { findings } = reconcile({ statement, app, endDate: END });
          const refs = appRefs(findings);
          expect(refs.length).toBe(app.length);
          for (const t of app) {
            expect(refs.filter((r) => r === t).length).toBe(1);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it('never consumes a transaction in two findings', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 12 }),
        fc.array(appArb, { maxLength: 12 }),
        (statement, app) => {
          const { findings } = reconcile({ statement, app, endDate: END });
          const ids = appRefs(findings).map((t) => t.id);
          // Generated ids can collide; compare against the input's own multiset.
          const inputIds = app.map((t) => t.id).sort();
          expect(ids.sort()).toEqual(inputIds);
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 10 }),
        fc.array(appArb, { maxLength: 10 }),
        (statement, app) => {
          const a = reconcile({ statement, app, endDate: END });
          const b = reconcile({ statement, app, endDate: END });
          expect(a.summary).toEqual(b.summary);
          expect(a.remainder).toBe(b.remainder);
          expect(a.findings.map((f) => f.kind)).toEqual(b.findings.map((f) => f.kind));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('does not depend on input ordering for the summary', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { minLength: 1, maxLength: 8 }),
        fc.array(appArb, { minLength: 1, maxLength: 8 }),
        (statement, app) => {
          const forward = reconcile({ statement, app, endDate: END });
          const reversed = reconcile({
            statement: [...statement].reverse(),
            app: [...app].reverse(),
            endDate: END,
          });
          // Counts must agree even though pairing order may differ.
          const total = (s: Record<string, number | undefined>) =>
            Object.values(s).reduce<number>((a, b) => a + (b ?? 0), 0);
          expect(total(reversed.summary)).toBe(total(forward.summary));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('monetary safety', () => {
  it('always returns a remainder rounded to cents', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 12 }),
        fc.array(appArb, { maxLength: 12 }),
        (statement, app) => {
          const { remainder } = reconcile({ statement, app, endDate: END });
          expect(Number.isFinite(remainder)).toBe(true);
          expect(Math.round(remainder * 100) / 100).toBe(remainder);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('always returns per-finding deltas rounded to cents', () => {
    fc.assert(
      fc.property(
        fc.array(statementArb, { maxLength: 12 }),
        fc.array(appArb, { maxLength: 12 }),
        (statement, app) => {
          const { findings } = reconcile({ statement, app, endDate: END });
          for (const f of findings) {
            expect(Number.isFinite(f.delta)).toBe(true);
            expect(Math.round(f.delta * 100) / 100).toBe(f.delta);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('reports zero remainder when both sides are empty', () => {
    const { findings, remainder } = reconcile({ statement: [], app: [], endDate: END });
    expect(findings).toEqual([]);
    expect(remainder).toBe(0);
  });
});

describe('one-sided inputs', () => {
  it('classifies every statement line as missing when the app is empty', () => {
    fc.assert(
      fc.property(fc.array(statementArb, { minLength: 1, maxLength: 10 }), (statement) => {
        const { findings } = reconcile({ statement, app: [], endDate: END });
        expect(findings.every((f) => f.kind === 'missing_in_app')).toBe(true);
        expect(findings.length).toBe(statement.length);
      }),
      { numRuns: 80 },
    );
  });

  it('classifies every app row as pending, phantom, or duplicate when the statement is empty', () => {
    fc.assert(
      fc.property(fc.array(appArb, { minLength: 1, maxLength: 10 }), (app) => {
        const { findings } = reconcile({ statement: [], app, endDate: END });
        const allowed = new Set([
          'missing_in_bank_pending',
          'missing_in_bank_phantom',
          'duplicate_in_app',
        ]);
        expect(findings.every((f) => allowed.has(f.kind))).toBe(true);
        expect(findings.length).toBe(app.length);
      }),
      { numRuns: 80 },
    );
  });
});

describe('name similarity', () => {
  it('is symmetric', () => {
    fc.assert(
      fc.property(nameArb, nameArb, (a, b) => {
        expect(nameSimilarity(a, b)).toBeCloseTo(nameSimilarity(b, a), 10);
      }),
      { numRuns: 100 },
    );
  });

  it('is bounded to [0, 1] and reflexive', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (s) => {
        const self = nameSimilarity(s, s);
        expect(self).toBeGreaterThanOrEqual(0);
        expect(self).toBeLessThanOrEqual(1);
        if (normalizeName(s)) expect(self).toBe(1);
      }),
      { numRuns: 150 },
    );
  });

  it('measures day distance symmetrically and non-negatively', () => {
    fc.assert(
      fc.property(dateArb, dateArb, (a, b) => {
        expect(dayDiff(a, b)).toBe(dayDiff(b, a));
        expect(dayDiff(a, b)).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 150 },
    );
  });
});
