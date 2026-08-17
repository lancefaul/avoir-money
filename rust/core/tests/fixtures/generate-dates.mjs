/**
 * Differential fixture for pay-period generation.
 *
 * Runs the LIVE `packages/core/dist` implementation and records its output, so
 * the Rust port is checked against what the app actually does rather than
 * against my reading of it. This module matters more than most: a single
 * local-time constructor here once shifted 243 pay periods by a day and needed
 * a production migration.
 *
 * Seeded, plus a block of hand-picked edge cases that random generation is
 * unlikely to hit — leap days, pay-day-31 clamping, year boundaries, and
 * ranges that start mid-period.
 *
 *   node rust/core/tests/fixtures/generate-dates.mjs > date_vectors.json
 */

import { generatePayPeriods } from '../../../../packages/core/dist/index.js';

let s0 = 0x2545f491;
let s1 = 0x6c078965;
function rnd() {
  let x = s0;
  const y = s1;
  s0 = y;
  x ^= x << 23;
  x ^= x >>> 17;
  x ^= y ^ (y >>> 26);
  s1 = x >>> 0;
  return ((s0 + s1) >>> 0) / 4294967296;
}
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo));
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

const cases = [];

// ── Hand-picked edge cases ────────────────────────────────────────────────
// Pay day 31: clamps to 28/29/30 depending on the month, including a leap year.
cases.push({
  name: 'monthly pay-day-31 across a leap year',
  scheduleType: 'MONTHLY',
  firstPayDay: 31,
  rangeStart: utc(2024, 1, 1),
  rangeEnd: utc(2024, 12, 31),
});
cases.push({
  name: 'semi-monthly 15/31 across a leap year',
  scheduleType: 'SEMI_MONTHLY',
  firstPayDay: 15,
  secondPayDay: 31,
  rangeStart: utc(2024, 1, 1),
  rangeEnd: utc(2024, 12, 31),
});
// Feb 29 as a biweekly anchor.
cases.push({
  name: 'biweekly anchored on a leap day',
  scheduleType: 'BIWEEKLY',
  anchorDate: utc(2024, 2, 29),
  rangeStart: utc(2024, 1, 1),
  rangeEnd: utc(2025, 6, 30),
});
// Range spanning a year boundary — periodNum must reset.
cases.push({
  name: 'weekly across a year boundary',
  scheduleType: 'WEEKLY',
  anchorDate: utc(2026, 3, 20),
  rangeStart: utc(2025, 11, 1),
  rangeEnd: utc(2026, 2, 28),
});
// Anchor far in the future relative to the range (walk-back path).
cases.push({
  name: 'biweekly with an anchor after the range',
  scheduleType: 'BIWEEKLY',
  anchorDate: utc(2030, 7, 4),
  rangeStart: utc(2026, 1, 1),
  rangeEnd: utc(2026, 12, 31),
});
// Anchor far in the past (walk-forward path).
cases.push({
  name: 'biweekly with an anchor long before the range',
  scheduleType: 'BIWEEKLY',
  anchorDate: utc(2015, 1, 2),
  rangeStart: utc(2026, 1, 1),
  rangeEnd: utc(2026, 12, 31),
});
// Inverted range — must produce nothing.
cases.push({
  name: 'inverted range',
  scheduleType: 'MONTHLY',
  firstPayDay: 1,
  rangeStart: utc(2026, 12, 31),
  rangeEnd: utc(2026, 1, 1),
});
// Single-day range landing exactly on a pay date.
cases.push({
  name: 'single-day range on a pay date',
  scheduleType: 'MONTHLY',
  firstPayDay: 15,
  rangeStart: utc(2026, 6, 15),
  rangeEnd: utc(2026, 6, 15),
});
// Second pay day before the first — the config is odd but must not throw.
cases.push({
  name: 'semi-monthly with second pay day before first',
  scheduleType: 'SEMI_MONTHLY',
  firstPayDay: 20,
  secondPayDay: 5,
  rangeStart: utc(2026, 1, 1),
  rangeEnd: utc(2026, 12, 31),
});

// ── Seeded random cases ───────────────────────────────────────────────────
const TYPES = ['WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY'];
for (let i = 0; i < 120; i++) {
  const t = TYPES[i % TYPES.length];
  const y = int(2020, 2031);
  const startM = int(1, 13);
  const spanM = int(1, 30);
  const rangeStart = utc(y, startM, int(1, 28));
  const endTotal = y * 12 + (startM - 1) + spanM;
  const rangeEnd = utc(Math.floor(endTotal / 12), (endTotal % 12) + 1, int(1, 28));

  const c = { name: `random ${i} ${t}`, scheduleType: t, rangeStart, rangeEnd };
  if (t === 'WEEKLY' || t === 'BIWEEKLY') {
    c.anchorDate = utc(int(2015, 2032), int(1, 13), int(1, 29));
  } else {
    c.firstPayDay = int(1, 32);
    if (t === 'SEMI_MONTHLY') c.secondPayDay = int(1, 32);
  }
  cases.push(c);
}

const vectors = cases.map((c) => {
  let periods;
  let error = null;
  try {
    periods = generatePayPeriods({
      scheduleType: c.scheduleType,
      anchorDate: c.anchorDate,
      firstPayDay: c.firstPayDay,
      secondPayDay: c.secondPayDay,
      rangeStart: c.rangeStart,
      rangeEnd: c.rangeEnd,
    });
  } catch (e) {
    periods = [];
    error = e.message;
  }
  return {
    name: c.name,
    in: {
      scheduleType: c.scheduleType,
      anchorDate: c.anchorDate ? iso(c.anchorDate) : null,
      firstPayDay: c.firstPayDay ?? null,
      secondPayDay: c.secondPayDay ?? null,
      rangeStart: iso(c.rangeStart),
      rangeEnd: iso(c.rangeEnd),
    },
    error,
    out: periods.map((p) => ({
      startDate: iso(p.startDate),
      endDate: iso(p.endDate),
      payDate: iso(p.payDate),
      year: p.year,
      periodNum: p.periodNum,
    })),
  };
});

const totalPeriods = vectors.reduce((n, v) => n + v.out.length, 0);
process.stdout.write(
  JSON.stringify(
    { generatedBy: 'packages/core/dist', count: vectors.length, totalPeriods, vectors },
    null,
    1,
  ),
);
