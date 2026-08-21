/**
 * Differential fixture for `generateAmortization` — the function the original
 * debt fixture did NOT cover, which is how four divergences survived the first
 * port.
 *
 * ONLY the clock-free path is captured, deliberately. `generateAmortization`
 * calls `remainingTermPeriods`, which reads `new Date()` whenever the debt has
 * a `maturityDate` or a `startDate` + `termMonths`. Those inputs make the
 * output depend on the day it is run, so a committed fixture over them would
 * rot silently. Every debt below omits both, so `remainingTermPeriods` returns
 * null and the clock is never consulted.
 *
 * The clock-dependent branch is handled differently in Rust — the port takes
 * the reference date as an argument rather than reading the clock — and is
 * covered by unit tests instead. See `debt.rs`.
 *
 *   node rust/core/tests/fixtures/generate-amort.mjs > amort_vectors.json
 */

import { generateAmortization } from '../../../../packages/core/dist/index.js';

let s0 = 0x1b873593;
let s1 = 0xcc9e2d51;
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
const pick = (a) => a[Math.floor(rnd() * a.length)];

const FREQS = [
  null,
  'WEEKLY',
  'BIWEEKLY',
  'SEMI_MONTHLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
];

const vectors = [];

function record(name, balanceCents, aprHundredths, minCents, freq, extraCents, escrowCents) {
  const debt = {
    currentBalance: balanceCents / 100,
    apr: aprHundredths / 100,
    minimumPayment: minCents / 100,
    frequency: freq,
    // No maturityDate, no startDate, no termMonths -> clock is never read.
  };
  const r = generateAmortization(debt, extraCents / 100, escrowCents / 100);
  vectors.push({
    name,
    in: { balanceCents, aprHundredths, minCents, freq, extraCents, escrowCents },
    out: {
      isNegativelyAmortizing: r.isNegativelyAmortizing,
      payoffMonths: r.payoffMonths,
      totalInterestCents: Math.round(r.totalInterest * 100),
      totalPaymentsCents: Math.round(r.totalPayments * 100),
      totalEscrowCents: Math.round(r.totalEscrow * 100),
      entries: r.entries.map((e) => ({
        month: e.month,
        paymentCents: Math.round(e.paymentAmount * 100),
        principalCents: Math.round(e.principalAmount * 100),
        interestCents: Math.round(e.interestAmount * 100),
        escrowCents: Math.round(e.escrowAmount * 100),
        remainingCents: Math.round(e.remainingBalance * 100),
      })),
    },
  });
}

// Hand-picked: the boundaries that matter.
record('exact payoff, no remainder', 5_000_00, 12_00, 500_00, 'MONTHLY', 0, 0);
record('negatively amortizing', 10_000_00, 24_00, 100_00, 'MONTHLY', 0, 0);
record('payment exactly equals interest', 10_000_00, 12_00, 100_00, 'MONTHLY', 0, 0);
record('zero interest', 1_200_00, 0, 100_00, 'MONTHLY', 0, 0);
record('with escrow', 150_000_00, 6_50, 950_00, 'MONTHLY', 0, 250_00);
record('with extra payment', 5_000_00, 12_00, 500_00, 'MONTHLY', 100_00, 0);
record('single period payoff', 100_00, 12_00, 500_00, 'MONTHLY', 0, 0);
record('one cent balance', 1, 12_00, 500_00, 'MONTHLY', 0, 0);
record('weekly frequency', 5_000_00, 12_00, 120_00, 'WEEKLY', 0, 0);
record('annual frequency', 5_000_00, 12_00, 2_000_00, 'ANNUAL', 0, 0);
record('long mortgage hits the 600-month cap', 400_000_00, 7_00, 2_400_00, 'MONTHLY', 0, 0);

// Seeded random across the space.
for (let i = 0; i < 120; i++) {
  const bal = int(100, 300_000_00);
  const apr = int(0, 2_500);
  // Bias the payment high enough that most cases actually amortize.
  const min = Math.max(int(50_00, 5_000_00), Math.floor(bal / 60));
  record(
    `random ${i}`,
    bal,
    apr,
    min,
    pick(FREQS),
    i % 7 === 0 ? int(0, 50_000) : 0,
    i % 5 === 0 ? int(0, 40_000) : 0,
  );
}

const totalEntries = vectors.reduce((n, v) => n + v.out.entries.length, 0);
process.stdout.write(
  JSON.stringify(
    {
      generatedBy: 'packages/core/dist',
      clockFree: true,
      count: vectors.length,
      totalEntries,
      vectors,
    },
    null,
    1,
  ),
);
