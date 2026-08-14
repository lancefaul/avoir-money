import type { Frequency } from '../types/index.js';

export type DebtInput = {
  currentBalance: number;
  apr: number;
  minimumPayment: number;
  frequency?: Frequency | null;
  termMonths?: number | null;
  maturityDate?: Date | null;
  startDate?: Date | null;
  /**
   * Original loan principal. When present (with a valid term), the fixed
   * principal+interest payment is derived from the amortization formula rather
   * than taken from minimumPayment. Optional so revolving debts (credit cards)
   * with no fixed term fall back to minimumPayment.
   */
  originalBalance?: number | null;
};

export type AmortizationEntry = {
  month: number; // period number (kept as "month" for backward compat)
  paymentAmount: number;
  principalAmount: number;
  interestAmount: number;
  escrowAmount: number;
  remainingBalance: number;
};

export type AmortizationResult = {
  entries: AmortizationEntry[];
  totalInterest: number;
  totalPayments: number;
  totalEscrow: number;
  payoffMonths: number; // total payment periods (kept as "payoffMonths" for backward compat)
  isNegativelyAmortizing: boolean;
};

/** Number of payment periods per year for each frequency */
export function periodsPerYear(freq: Frequency | null | undefined): number {
  switch (freq) {
    case 'WEEKLY':
      return 52;
    case 'BIWEEKLY':
      return 26;
    case 'SEMI_MONTHLY':
      return 24;
    case 'QUARTERLY':
      return 4;
    case 'BIANNUAL':
      return 2;
    case 'ANNUAL':
      return 1;
    case 'MONTHLY':
    default:
      return 12;
  }
}

/** Convert payment periods to months for date math */
function periodsToMonths(periods: number, freq: Frequency | null | undefined): number {
  return Math.ceil((periods * 12) / periodsPerYear(freq));
}

/** Get current date as UTC midnight */
function utcToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Add N months to a UTC date, clamping to end-of-month to avoid overflow
 *  (e.g. Jan 31 + 1 month = Feb 28, not Mar 3) */
function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  // Create the target month, day 1, to find its last day
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
}

/** Count whole months between two UTC dates */
function diffMonthsUTC(a: Date, b: Date): number {
  return (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
}

/**
 * Compute how many payment periods remain on a fixed-term debt.
 * If maturityDate is set, remaining = periods between now and maturity.
 * Else if startDate + termMonths is available, remaining = converted periods.
 * Returns null if neither is available (open-ended debt).
 */
function remainingTermPeriods(debt: DebtInput): number | null {
  const now = utcToday();
  const ppYear = periodsPerYear(debt.frequency);
  if (debt.maturityDate) {
    const maturity = new Date(debt.maturityDate);
    const months = diffMonthsUTC(maturity, now);
    // Convert remaining months to periods
    const periods = Math.ceil((months * ppYear) / 12);
    return Math.max(1, periods);
  }
  if (debt.startDate && debt.termMonths && debt.termMonths > 0) {
    const start = new Date(debt.startDate);
    const elapsedMonths = diffMonthsUTC(now, start);
    const remainingMonths = Math.max(0, debt.termMonths - elapsedMonths);
    const periods = Math.ceil((remainingMonths * ppYear) / 12);
    return Math.max(1, periods);
  }
  return null;
}

/**
 * Calculate the principal/interest split for a single payment.
 * Interest is computed per payment period: balance * apr / 100 / periodsPerYear.
 * principal = paymentAmount - interest (clamped to 0 if negative)
 */
export function splitPayment(
  currentBalance: number,
  apr: number,
  paymentAmount: number,
  frequency?: Frequency | null,
): { principal: number; interest: number } {
  const ppYear = periodsPerYear(frequency);
  const interest = Math.round(((currentBalance * apr) / 100 / ppYear) * 100) / 100;
  let principal = Math.round((paymentAmount - interest) * 100) / 100;
  if (principal < 0) {
    principal = 0;
  }
  return { principal, interest };
}

/**
 * Compute the fixed periodic principal+interest (P&I) payment for an amortizing
 * loan using the standard amortization (PMT) formula:
 *
 *   M = P · [ r(1+r)^n ] / [ (1+r)^n − 1 ]
 *
 * where P = original principal, r = periodic interest rate, n = total periods.
 *
 * The payment is derived from the loan's ORIGINAL terms (original principal,
 * rate, full term) so it reflects the fixed P&I set at origination — escrow and
 * other pass-through amounts are added separately by the caller.
 *
 * Returns null when the terms are insufficient to amortize (non-positive
 * principal or term), signalling the caller to fall back to a stored payment.
 * A zero (or negative) rate yields straight-line principal repayment. The
 * result is rounded to cents.
 */
export function computeAmortizedPayment(
  originalBalance: number,
  apr: number,
  termMonths: number,
  frequency?: Frequency | null,
): number | null {
  if (!(originalBalance > 0) || !(termMonths > 0)) return null;
  const ppYear = periodsPerYear(frequency);
  const n = Math.round((termMonths * ppYear) / 12);
  if (n <= 0) return null;
  const r = apr / 100 / ppYear;
  if (r <= 0) {
    // Zero/negative interest: straight-line principal repayment.
    return Math.round((originalBalance / n) * 100) / 100;
  }
  const factor = Math.pow(1 + r, n);
  const payment = (originalBalance * (r * factor)) / (factor - 1);
  return Math.round(payment * 100) / 100;
}

/**
 * The fixed principal+interest payment to amortize against and to display.
 *
 * **The stored payment wins.** `minimumPayment` is what the lender actually
 * charges — a known fact — while `computeAmortizedPayment` is a reconstruction
 * that only reproduces that fact when the stored terms are exactly the lender's.
 * They frequently are not: an original principal that did or did not include
 * fees, an APR that is the note rate rather than the effective one, a term
 * entered as months-remaining rather than the full schedule. Preferring the
 * reconstruction over the fact meant the app displayed a payment the user had
 * never made — a derived figure against a real the real payment, a derived figure against the real payment.
 *
 * The reconstruction is kept as the fallback, for a debt whose payment is not
 * recorded, and remains exactly right where it is genuinely needed: a mortgage's
 * P&I, which cannot be read off the bill because the bill is PITI.
 *
 * **Why this is safe now and was not before (amends ADR-023).** That ADR made
 * derivation authoritative because the mortgage's stored `minimumPayment` then
 * held the full PITI, which the schedule treated as P&I and added escrow to
 * again — a double count. Its fix had two halves, and the second is what makes
 * this reversal safe: the mortgage form now *stores the derived P&I* into
 * `minimumPayment`. The field no longer contains escrow, so reading it back
 * cannot resurrect the double count. Verified against real data: the mortgage's
 * stored payment is precisely what the formula derives.
 *
 * One definition, called by both the schedule and the serializer. Two
 * implementations of the same rule is how the displayed payment and the
 * schedule's payment came to disagree in the first place.
 */
export function resolveBasePayment(debt: {
  minimumPayment: number;
  originalBalance?: number | null;
  apr: number;
  termMonths?: number | null;
  frequency?: Frequency | null;
}): number {
  if (debt.minimumPayment > 0) return debt.minimumPayment;
  return (
    computeAmortizedPayment(
      debt.originalBalance ?? 0,
      debt.apr,
      debt.termMonths ?? 0,
      debt.frequency,
    ) ?? debt.minimumPayment
  );
}

/**
 * Generate a full amortization schedule.
 * Iterates per payment period (weekly, biweekly, monthly, etc.).
 * Interest per period = balance * apr / 100 / periodsPerYear.
 * If negatively amortizing (period interest >= payment + extraPayment),
 * returns an empty schedule with isNegativelyAmortizing: true.
 * If termMonths is provided, the schedule is capped at the equivalent
 * number of periods with a balloon payment in the final period.
 * Capped at 600 months equivalent as a safety limit.
 */
export function generateAmortization(
  debt: DebtInput,
  extraPayment: number = 0,
  escrowAmount: number = 0,
): AmortizationResult {
  const ppYear = periodsPerYear(debt.frequency);
  // The payment actually charged, falling back to the loan terms only when none
  // is recorded. Shared with `serializeDebt` so the schedule always amortizes
  // the same figure the debts page displays — see `resolveBasePayment`.
  const basePayment = resolveBasePayment(debt);
  const periodPayment = basePayment + extraPayment;
  const periodInterest = (debt.currentBalance * debt.apr) / 100 / ppYear;
  const roundedEscrow = Math.round(escrowAmount * 100) / 100;

  // Check for negative amortization
  if (periodInterest >= periodPayment) {
    return {
      entries: [],
      totalInterest: 0,
      totalPayments: 0,
      totalEscrow: 0,
      payoffMonths: 0,
      isNegativelyAmortizing: true,
    };
  }

  const entries: AmortizationEntry[] = [];
  let balance = debt.currentBalance;
  let totalInterest = 0;
  let totalPayments = 0;
  let totalEscrow = 0;
  let period = 0;
  const MAX_PERIODS = Math.ceil((600 * ppYear) / 12); // 50 years in periods
  const remaining = remainingTermPeriods(debt);
  const termCap = remaining ?? MAX_PERIODS;
  const effectiveMax = Math.min(termCap, MAX_PERIODS);

  while (balance > 0.005 && period < effectiveMax) {
    period++;
    const interest = (balance * debt.apr) / 100 / ppYear;
    let payment = periodPayment;
    let principal = payment - interest;

    // Final period (either natural payoff or term cap): adjust payment to cover remaining balance
    const isLastPeriod = period === effectiveMax && balance > principal;
    if (principal >= balance || isLastPeriod) {
      principal = balance;
      payment = principal + interest;
    }

    balance = Math.max(0, balance - principal);
    totalInterest += interest;
    // Escrow is purely additive — added AFTER P+I calculation
    const entryPayment = payment + roundedEscrow;
    totalPayments += entryPayment;
    totalEscrow += roundedEscrow;

    entries.push({
      month: period,
      paymentAmount: Math.round(entryPayment * 100) / 100,
      principalAmount: Math.round(principal * 100) / 100,
      interestAmount: Math.round(interest * 100) / 100,
      escrowAmount: roundedEscrow,
      remainingBalance: Math.round(Math.max(0, balance) * 100) / 100,
    });

    // Break on effectively zero balance (accounts for floating point)
    if (balance < 0.005) break;
  }

  return {
    entries,
    totalInterest: Math.round(totalInterest * 100) / 100,
    totalPayments: Math.round(totalPayments * 100) / 100,
    totalEscrow: Math.round(totalEscrow * 100) / 100,
    payoffMonths: entries.length,
    isNegativelyAmortizing: false,
  };
}

/**
 * Estimate the payoff date from a given start date.
 * Converts payment periods to months for date arithmetic.
 * For fixed-term debts with a maturityDate, returns the maturity date
 * unless extra payments would pay it off sooner.
 * Returns null if the debt is negatively amortizing.
 */
export function estimatePayoffDate(
  debt: DebtInput,
  fromDate: Date,
  extraPayment: number = 0,
): Date | null {
  const result = generateAmortization(debt, extraPayment);
  if (result.isNegativelyAmortizing) return null;
  if (result.payoffMonths === 0) return fromDate;

  const months = periodsToMonths(result.payoffMonths, debt.frequency);
  const payoff = addMonthsUTC(fromDate, months);

  // For fixed-term debts with a maturity date and no extra payments,
  // the payoff date is the maturity date
  if (debt.maturityDate && extraPayment === 0) {
    return new Date(debt.maturityDate);
  }

  // With extra payments, return the earlier of calculated payoff or maturity
  if (debt.maturityDate) {
    const maturity = new Date(debt.maturityDate);
    return payoff < maturity ? payoff : maturity;
  }

  return payoff;
}

/**
 * Calculate months remaining until payoff.
 * Returns 0 if negatively amortizing (caller should check separately).
 */
export function monthsRemaining(debt: DebtInput, extraPayment: number = 0): number {
  const result = generateAmortization(debt, extraPayment);
  return result.payoffMonths;
}
