import { describe, it, expect } from 'vitest';
import { computeCashRemaining } from './cashSpending.js';

describe('computeCashRemaining (live cash-flow model)', () => {
  const base = {
    previousPeriodCheckingBalance: 2000,
    previousPeriodSavingsBalance: 500,
    incomeItems: [{ amount: 1500, actualAmount: null }],
    cashExpenses: [] as { amount: number; actualAmount: number | null; isPaid: boolean }[],
    previousPeriodCreditExpenses: 400,
    adHocCashSpending: 0,
  };

  it('totalIncome sums previous checking + savings + income', () => {
    expect(computeCashRemaining(base).totalIncome).toBe(4000); // 2000 + 500 + 1500
  });

  it('income uses the actual amount once paid', () => {
    const { totalIncome } = computeCashRemaining({
      ...base,
      incomeItems: [{ amount: 1500, actualAmount: 1487.32 }],
    });
    expect(totalIncome).toBe(3987.32); // 2500 + 1487.32
  });

  it('an unpaid expense is listed but not deducted until paid; it lands in Cash After Expenses', () => {
    const {
      cashRemaining,
      paidCashExpenses,
      unpaidCashExpenses,
      totalCashExpenses,
      cashAfterExpenses,
    } = computeCashRemaining({
      ...base,
      cashExpenses: [{ amount: 1200, actualAmount: null, isPaid: false }],
    });
    expect(paidCashExpenses).toBe(0);
    expect(unpaidCashExpenses).toBe(1200);
    expect(totalCashExpenses).toBe(1200); // paid + unpaid, regardless of paid status
    expect(cashRemaining).toBe(3600); // 4000 − 400 credit − 0 paid − 0 ad-hoc
    expect(cashAfterExpenses).toBe(2400); // 3600 − 1200 still upcoming
  });

  it('a paid expense deducts its actual amount', () => {
    const { cashRemaining, paidCashExpenses } = computeCashRemaining({
      ...base,
      cashExpenses: [{ amount: 1200, actualAmount: 1189.99, isPaid: true }],
    });
    expect(paidCashExpenses).toBe(1189.99);
    expect(cashRemaining).toBe(2410.01); // 4000 − 400 − 1189.99
  });

  it('a paid expense with no actual falls back to the expected amount', () => {
    expect(
      computeCashRemaining({
        ...base,
        cashExpenses: [{ amount: 1200, actualAmount: null, isPaid: true }],
      }).paidCashExpenses,
    ).toBe(1200);
  });

  it('ad-hoc cash spending deducts from cash remaining', () => {
    expect(computeCashRemaining({ ...base, adHocCashSpending: 131 }).cashRemaining).toBe(3469);
  });

  it('combines paid, unpaid, ad-hoc, and the credit bill', () => {
    const { cashRemaining, totalCashExpenses, cashAfterExpenses } = computeCashRemaining({
      ...base,
      cashExpenses: [
        { amount: 1200, actualAmount: 1200, isPaid: true }, // paid → deducts now
        { amount: 60, actualAmount: null, isPaid: false }, // upcoming → only in Cash After Expenses
      ],
      adHocCashSpending: 85,
    });
    expect(totalCashExpenses).toBe(1260); // 1200 + 60, regardless of paid status
    expect(cashRemaining).toBe(2315); // 4000 − 400 − 1200 − 85
    expect(cashAfterExpenses).toBe(2255); // 2315 − 60 still upcoming
  });

  it('rounds monetary results to cents (no float drift)', () => {
    const { cashRemaining } = computeCashRemaining({
      previousPeriodCheckingBalance: 0.1,
      previousPeriodSavingsBalance: 0.2,
      incomeItems: [],
      cashExpenses: [],
      previousPeriodCreditExpenses: 0,
      adHocCashSpending: 0,
    });
    expect(cashRemaining).toBe(0.3); // not 0.30000000000000004
  });
});
