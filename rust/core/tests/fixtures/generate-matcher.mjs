/**
 * Differential fixture for the reconcile matcher.
 *
 * Scenario-driven: each case is one shape the matcher must classify correctly,
 * drawn from the situations its comments cite as having caused real false
 * positives. Random statements almost never produce a grouped entry, a sign
 * flip, or a trade near-miss.
 *
 * Synthetic merchants, as with the other reconcile fixtures.
 *
 *   node rust/core/tests/fixtures/generate-matcher.mjs > matcher_vectors.json
 */
import { reconcile } from '../../../../packages/core/dist/index.js';

const END = '2026-06-30';
const s = (id, date, description, amount, direction = 'charge') => ({
  id,
  date,
  description,
  amount,
  direction,
});
const a = (id, date, name, amount, direction = 'charge', isTrade) => ({
  id,
  date,
  name,
  amount,
  direction,
  ...(isTrade ? { isTrade: true } : {}),
});

const cases = [];
const add = (name, statement, app, options) => {
  const r = reconcile({ statement, app, endDate: END, options });
  cases.push({
    name,
    in: { statement, app, endDate: END, options: options ?? null },
    out: {
      remainder: r.remainder,
      summary: r.summary,
      findings: r.findings.map((f) => ({
        kind: f.kind,
        statementId: f.statement?.id ?? null,
        appId: f.app?.id ?? null,
        statementIds: (f.statements ?? []).map((x) => x.id),
        appIds: (f.apps ?? []).map((x) => x.id),
        delta: f.delta,
        note: f.note ?? null,
      })),
    },
  });
};

add(
  'exact match',
  [s('S1', '2026-06-10', 'COSTCO WHSE #0429', 84.32)],
  [a('A1', '2026-06-10', 'Costco', 84.32)],
);
add(
  'match a few days late',
  [s('S1', '2026-06-13', 'COSTCO', 84.32)],
  [a('A1', '2026-06-10', 'Costco', 84.32)],
);
add(
  'name disagrees but amount is exact',
  [s('S1', '2026-06-10', 'SQ *UNKNOWN VENDOR', 12.5)],
  [a('A1', '2026-06-10', 'Farmers Market', 12.5)],
);
add(
  'probable typo within tolerance',
  [s('S1', '2026-06-10', 'Netflix', 15.99)],
  [a('A1', '2026-06-10', 'Netflix', 15.5)],
);
add(
  'sign flip',
  [s('S1', '2026-06-10', 'Refund Store', 30, 'credit')],
  [a('A1', '2026-06-10', 'Refund Store', 30, 'charge')],
);
add(
  'dated far apart but exact',
  [s('S1', '2026-06-25', 'Annual Fee', 95)],
  [a('A1', '2026-06-01', 'Annual Fee', 95)],
);
add(
  'trade drift with no name agreement',
  [
    s(
      'S1',
      '2026-06-10',
      'Purchase of Acme Variable Rate Perpetual Stretch Preferred Stock',
      120.02,
    ),
  ],
  [a('A1', '2026-06-10', 'Buy TCKC', 120.0, 'charge', true)],
);
add(
  'trade drift beyond the nickel is reported',
  [s('S1', '2026-06-10', 'Purchase of Something Long', 120.02)],
  [a('A1', '2026-06-10', 'Buy XYZ', 119.3, 'charge', true)],
);
add(
  'one statement line, three app rows',
  [s('S1', '2026-06-10', 'CITY UTILITIES', 136.9)],
  [
    a('A1', '2026-06-10', 'Water', 50.0),
    a('A2', '2026-06-10', 'Sewage', 46.9),
    a('A3', '2026-06-10', 'Garbage', 40.0),
  ],
);
add(
  'one app row, two statement lines',
  [s('S1', '2026-06-10', 'Amazon', 30.0), s('S2', '2026-06-11', 'Amazon', 46.0)],
  [a('A1', '2026-06-10', 'Amazon refund', 76.0)],
);
add('missing from the app', [s('S1', '2026-06-10', 'Mystery Charge', 22.0)], []);
add('phantom in the app', [], [a('A1', '2026-05-02', 'Old Entry', 22.0)]);
add('pending near the period end', [], [a('A1', '2026-06-28', 'Just Entered', 22.0)]);
add(
  'duplicate whose twin matched',
  [s('S1', '2026-06-10', 'Gym', 39.99)],
  [a('A1', '2026-06-10', 'Gym', 39.99), a('A2', '2026-06-12', 'Gym', 39.99)],
);
add(
  'two identical charges on one day',
  [s('S1', '2026-06-10', 'Coffee', 3.48), s('S2', '2026-06-10', 'Coffee', 3.48)],
  [a('A1', '2026-06-10', 'Coffee', 3.48), a('A2', '2026-06-10', 'Coffee', 3.48)],
);
add(
  'credits and charges do not cross',
  [s('S1', '2026-06-10', 'Store', 40, 'credit')],
  [a('A1', '2026-06-10', 'Store', 40, 'charge'), a('A2', '2026-06-10', 'Store', 40, 'credit')],
);
add(
  'exact-but-late beats close-but-near within posting lag',
  [s('S1', '2026-06-10', 'Vendor', 25.44)],
  [a('A1', '2026-06-05', 'Vendor', 25.44), a('A2', '2026-06-10', 'Vendor', 25.0)],
);
// BEYOND ordinary posting lag the preference INVERTS: a same-day near-miss
// beats an exact amount from three weeks away, which is more likely a
// different purchase that happens to cost the same. The case above stays
// inside postingLagDays and so cannot distinguish the two weightings — a
// mutation test showed the suite could not tell DATE_FAR_BEYOND_LAG from 0.
add(
  'beyond posting lag, close-and-near beats exact-and-far',
  [s('S1', '2026-06-20', 'Vendor', 25.44)],
  [a('A1', '2026-06-05', 'Vendor', 25.44), a('A2', '2026-06-20', 'Vendor', 25.0)],
);

add('empty on both sides', [], []);
add(
  'sum gate disabled',
  [s('S1', '2026-06-10', 'ZZZ', 90.0)],
  [a('A1', '2026-06-10', 'Alpha', 40.0), a('A2', '2026-06-10', 'Beta', 50.0)],
  { sumNameThreshold: 0 },
);

const totalFindings = cases.reduce((n, c) => n + c.out.findings.length, 0);
process.stdout.write(
  JSON.stringify(
    { generatedBy: 'packages/core/dist', count: cases.length, totalFindings, cases },
    null,
    1,
  ),
);
