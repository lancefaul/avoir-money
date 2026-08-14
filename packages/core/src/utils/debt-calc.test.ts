import { describe, it, expect } from 'vitest';
import { FrequencySchema } from '../schemas/enums.js';
import {
  periodsPerYear,
  computeAmortizedPayment,
  generateAmortization,
  resolveBasePayment,
} from './debt-calc.js';

describe('FrequencySchema – BIANNUAL', () => {
  it('parses BIANNUAL as a valid frequency', () => {
    expect(FrequencySchema.parse('BIANNUAL')).toBe('BIANNUAL');
  });
});

describe('periodsPerYear – BIANNUAL', () => {
  it('returns 2 for BIANNUAL frequency', () => {
    expect(periodsPerYear('BIANNUAL')).toBe(2);
  });
});

describe('computeAmortizedPayment', () => {
  it('computes the fixed P&I for a real 30-year mortgage', () => {
    // $200,000 @ 4% over 360 monthly payments → $954.83 P&I.
    expect(computeAmortizedPayment(200000, 4.0, 360, 'MONTHLY')).toBe(954.83);
  });

  it('computes the fixed P&I for a standard $100k / 6% / 30-year loan', () => {
    expect(computeAmortizedPayment(100000, 6, 360, 'MONTHLY')).toBe(599.55);
  });

  it('uses straight-line repayment for a zero-interest loan', () => {
    // $12,000 over 12 months, no interest → $1,000/mo
    expect(computeAmortizedPayment(12000, 0, 12, 'MONTHLY')).toBe(1000);
  });

  it('honors payment frequency (biweekly halves the monthly-equivalent term)', () => {
    // Same loan billed biweekly: 26 periods/yr, n = 360 * 26/12 = 780 periods
    const monthly = computeAmortizedPayment(100000, 6, 360, 'MONTHLY')!;
    const biweekly = computeAmortizedPayment(100000, 6, 360, 'BIWEEKLY')!;
    // A biweekly payment is smaller than a monthly one (more, smaller payments)
    expect(biweekly).toBeGreaterThan(0);
    expect(biweekly).toBeLessThan(monthly);
  });

  it('returns null when the loan terms cannot amortize', () => {
    expect(computeAmortizedPayment(0, 5, 360, 'MONTHLY')).toBeNull();
    expect(computeAmortizedPayment(100000, 5, 0, 'MONTHLY')).toBeNull();
    expect(computeAmortizedPayment(-100, 5, 360, 'MONTHLY')).toBeNull();
  });

  it('rounds the payment to cents', () => {
    const payment = computeAmortizedPayment(200000, 4.0, 360, 'MONTHLY')!;
    expect(Math.round(payment * 100)).toBe(payment * 100);
  });
});

/**
 * Which payment the app amortizes and displays.
 *
 * The stored payment is what the lender actually charges; the PMT formula is a
 * reconstruction of it. Preferring the reconstruction showed payments the user
 * had never made — a derived figure against the one actually charged — because the stored loan
 * terms are approximations (an `originalBalance` that may or may not include
 * fees, a term recorded as months-remaining). So the fact wins and the
 * reconstruction is the fallback.
 *
 * **This amends ADR-023**, which made derivation authoritative. That was correct
 * at the time: the mortgage's stored `minimumPayment` then held the full PITI,
 * which the schedule treated as P&I and added escrow to again. The ADR's own
 * second half is what makes the reversal safe — the mortgage form now stores the
 * *derived P&I* into `minimumPayment`, so the field no longer contains escrow
 * and reading it back cannot resurrect the double count.
 */
describe('resolveBasePayment – the stored payment wins', () => {
  // The app derives 661.29 while the lender charges 653.52. `termMonths: 71`
  // — months REMAINING rather than the full schedule — is what makes them
  // differ, which is the whole point: the recorded payment is a fact and the
  // derived one is a reconstruction from approximate terms.
  const autoLoan = {
    currentBalance: 30000,
    apr: 5.5,
    frequency: 'MONTHLY' as const,
    termMonths: 71,
    originalBalance: 40000,
    minimumPayment: 653.52,
  };

  it('uses the recorded payment even when the terms derive a different one', () => {
    // The two must genuinely disagree, or this test proves nothing.
    const derived = computeAmortizedPayment(40000, 5.5, 71, 'MONTHLY');
    expect(derived).not.toBeCloseTo(653.52, 2);

    expect(resolveBasePayment(autoLoan)).toBe(653.52);
  });

  it('amortizes the recorded payment, so the schedule matches the displayed figure', () => {
    const first = generateAmortization(autoLoan).entries[0]!;
    expect(first.principalAmount + first.interestAmount).toBeCloseTo(653.52, 2);
  });

  it('falls back to the loan terms when no payment is recorded', () => {
    const noStored = { ...autoLoan, minimumPayment: 0 };
    expect(resolveBasePayment(noStored)).toBeCloseTo(661.29, 2);
  });

  it('falls back to the stored payment for revolving debt with no term', () => {
    const card = { currentBalance: 5000, apr: 19.99, minimumPayment: 150 };
    expect(resolveBasePayment(card)).toBe(150);
    const first = generateAmortization(card).entries[0]!;
    expect(first.principalAmount + first.interestAmount).toBeCloseTo(150, 2);
  });
});

describe('generateAmortization – mortgage P&I and escrow', () => {
  // The mortgage's stored payment is the derived P&I, written by the debt form
  // (ADR-023). It is deliberately NOT the PITI the lender bills, because escrow
  // is a pass-through added separately.
  const mortgage = {
    currentBalance: 175000,
    apr: 4.0,
    frequency: 'MONTHLY' as const,
    termMonths: 360,
    originalBalance: 200000,
    minimumPayment: 954.83,
  };

  it('stored P&I and derived P&I agree for the mortgage — the reversal changes nothing here', () => {
    // Why the ADR-023 behaviour and this one produce the same mortgage figure.
    expect(computeAmortizedPayment(200000, 4.0, 360, 'MONTHLY')).toBeCloseTo(954.83, 2);
    expect(resolveBasePayment(mortgage)).toBe(954.83);
  });

  it('splits P&I into principal and interest with no escrow of its own', () => {
    const first = generateAmortization(mortgage).entries[0]!;
    expect(first.principalAmount + first.interestAmount).toBeCloseTo(954.83, 2);
    expect(first.interestAmount).toBeCloseTo((175000 * 4.0) / 100 / 12, 2);
  });

  it('adds escrow on top of P&I rather than inside it', () => {
    const first = generateAmortization(mortgage, 0, 250).entries[0]!;
    expect(first.escrowAmount).toBe(250);
    expect(first.paymentAmount).toBeCloseTo(1204.83, 2); // 954.83 P&I + 250 escrow
  });

  it('would double-count escrow if it were ever stored inside minimumPayment', () => {
    // Not a wish — a statement of where the guarantee now lives. Since the
    // stored payment is trusted, nothing downstream can detect escrow hidden
    // inside it, so the mortgage form storing pure P&I is the thing keeping
    // this correct. Pinned so the risk is visible if that form ever changes.
    const contaminated = { ...mortgage, minimumPayment: 1204.83 };
    const first = generateAmortization(contaminated, 0, 250).entries[0]!;
    expect(first.paymentAmount).toBeCloseTo(1454.83, 2); // 1204.83 + 250 again
  });
});
