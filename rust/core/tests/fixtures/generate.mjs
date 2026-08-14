/**
 * Generates the differential-test fixture: random inputs, run through the LIVE
 * TypeScript implementation, with its outputs recorded.
 *
 * The Rust port is then asserted against these recorded outputs. This is the
 * only check that can actually prove the port is equivalent — reimplementing
 * the tests in Rust proves the Rust matches my reading of the TypeScript, which
 * is precisely the thing that could be wrong.
 *
 * Deterministic by seed, so regenerating produces the same fixture and a diff
 * means a real behaviour change rather than new random inputs.
 *
 *   node rust/core/tests/fixtures/generate.mjs > debt_vectors.json
 *
 * Requires packages/core to be built (`dist/`). It reads that build rather than
 * the source so it exercises exactly what the app ships.
 */

import {
  splitPayment,
  computeAmortizedPayment,
  resolveBasePayment,
  periodsPerYear,
} from '../../../../packages/core/dist/index.js';

// xorshift128+, seeded — Math.random cannot be seeded and would make the
// fixture irreproducible.
let s0 = 0x9e3779b9;
let s1 = 0x243f6a88;
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
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo));

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

const toCents = (d) => (d === null || d === undefined ? null : Math.round(d * 100));

const vectors = [];

for (let i = 0; i < 400; i++) {
  // Inputs are generated in CENTS — the representation the Rust side uses —
  // and handed to the TypeScript as dollars, which is what it expects.
  const balanceCents = int(100, 100_000_00);
  const aprHundredths = int(0, 3_500); // 0.00% … 35.00%
  const paymentCents = int(1, 10_000_00);
  const freq = pick(FREQS);

  const split = splitPayment(balanceCents / 100, aprHundredths / 100, paymentCents / 100, freq);

  const termMonths = int(1, 480);
  const originalCents = int(1_000_00, 500_000_00);
  const amortized = computeAmortizedPayment(
    originalCents / 100,
    aprHundredths / 100,
    termMonths,
    freq,
  );

  const minimumCents = i % 5 === 0 ? 0 : int(1, 10_000_00); // exercise both branches
  const base = resolveBasePayment({
    minimumPayment: minimumCents / 100,
    originalBalance: originalCents / 100,
    apr: aprHundredths / 100,
    termMonths,
    frequency: freq,
  });

  vectors.push({
    in: {
      balanceCents,
      aprHundredths,
      paymentCents,
      freq,
      termMonths,
      originalCents,
      minimumCents,
    },
    out: {
      periodsPerYear: periodsPerYear(freq),
      splitPrincipalCents: toCents(split.principal),
      splitInterestCents: toCents(split.interest),
      amortizedCents: toCents(amortized),
      basePaymentCents: toCents(base),
    },
  });
}

process.stdout.write(
  JSON.stringify({ generatedBy: 'packages/core/dist', count: vectors.length, vectors }, null, 1),
);
