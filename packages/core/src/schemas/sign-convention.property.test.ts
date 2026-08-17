import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SignConventionConfigSchema } from '../schemas/sign-convention.js';

/**
 * Feature: import-sign-conventions, Property 1: Schema validation accepts all valid configs and rejects invalid ones
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 *
 * For any object with all five transaction type keys where each key's enum fields
 * contain valid values, SignConventionConfigSchema should accept it.
 * For any object missing a key or containing an invalid enum value, the schema should reject it.
 */
describe('Property 1: Schema validation accepts all valid configs and rejects invalid ones', () => {
  // Generator for valid SignConventionConfig objects
  const validConfigArb = fc.record({
    expense: fc.record({
      positiveMeaning: fc.constantFrom('money_out' as const, 'money_in' as const),
      negativeMeaning: fc.constantFrom('refund' as const, 'ignore' as const, 'spending' as const),
    }),
    income: fc.record({
      positiveMeaning: fc.constantFrom('money_in' as const, 'money_out' as const),
      negativeMeaning: fc.constantFrom('flip_sign' as const, 'ignore' as const),
    }),
    transfer: fc.record({
      positiveMeaning: fc.constantFrom('withdrawal' as const, 'deposit' as const),
    }),
    trade: fc.record({
      positiveMeaning: fc.constantFrom('buy' as const, 'sell' as const),
    }),
    refund: fc.record({
      positiveMeaning: fc.constant('money_in' as const),
    }),
  });

  it('accepts all valid SignConventionConfig objects', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const result = SignConventionConfigSchema.safeParse(config);
        expect(result.success).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with missing top-level keys', () => {
    const keys = ['expense', 'income', 'transfer', 'trade', 'refund'] as const;
    fc.assert(
      fc.property(validConfigArb, fc.constantFrom(...keys), (config, keyToRemove) => {
        const partial = { ...config };
        delete (partial as Record<string, unknown>)[keyToRemove];
        const result = SignConventionConfigSchema.safeParse(partial);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for expense.positiveMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'money_out' && s !== 'money_in');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          expense: { ...config.expense, positiveMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for expense.negativeMeaning', () => {
    const invalidValue = fc
      .string()
      .filter((s) => s !== 'refund' && s !== 'ignore' && s !== 'spending');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          expense: { ...config.expense, negativeMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for income.positiveMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'money_in' && s !== 'money_out');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          income: { ...config.income, positiveMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for income.negativeMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'flip_sign' && s !== 'ignore');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          income: { ...config.income, negativeMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for transfer.positiveMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'withdrawal' && s !== 'deposit');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          transfer: { positiveMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for trade.positiveMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'buy' && s !== 'sell');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          trade: { positiveMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects configs with invalid enum values for refund.positiveMeaning', () => {
    const invalidValue = fc.string().filter((s) => s !== 'money_in');
    fc.assert(
      fc.property(validConfigArb, invalidValue, (config, bad) => {
        const broken = {
          ...config,
          refund: { positiveMeaning: bad },
        };
        const result = SignConventionConfigSchema.safeParse(broken);
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects an empty object', () => {
    const result = SignConventionConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

/**
 * Feature: import-sign-conventions, Property 2: Config serialization round-trip
 * Validates: Requirements 1.7, 4.8
 *
 * For any valid SignConventionConfig, JSON.stringify then JSON.parse then
 * SignConventionConfigSchema.parse produces an object deeply equal to the original.
 */
describe('Property 2: Config serialization round-trip', () => {
  const validConfigArb = fc.record({
    expense: fc.record({
      positiveMeaning: fc.constantFrom('money_out' as const, 'money_in' as const),
      negativeMeaning: fc.constantFrom('refund' as const, 'ignore' as const, 'spending' as const),
    }),
    income: fc.record({
      positiveMeaning: fc.constantFrom('money_in' as const, 'money_out' as const),
      negativeMeaning: fc.constantFrom('flip_sign' as const, 'ignore' as const),
    }),
    transfer: fc.record({
      positiveMeaning: fc.constantFrom('withdrawal' as const, 'deposit' as const),
    }),
    trade: fc.record({
      positiveMeaning: fc.constantFrom('buy' as const, 'sell' as const),
    }),
    refund: fc.record({
      positiveMeaning: fc.constant('money_in' as const),
    }),
  });

  it('round-trips through JSON serialization and schema parsing', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const json = JSON.stringify(config);
        const parsed = JSON.parse(json);
        const validated = SignConventionConfigSchema.parse(parsed);
        expect(validated).toEqual(config);
      }),
      { numRuns: 20 },
    );
  });
});

import { normalizeAmount } from '../schemas/sign-convention.js';

// Shared generators for Properties 3 and 4
const validConfigArb3 = fc.record({
  expense: fc.record({
    positiveMeaning: fc.constantFrom('money_out' as const, 'money_in' as const),
    negativeMeaning: fc.constantFrom('refund' as const, 'ignore' as const, 'spending' as const),
  }),
  income: fc.record({
    positiveMeaning: fc.constantFrom('money_in' as const, 'money_out' as const),
    negativeMeaning: fc.constantFrom('flip_sign' as const, 'ignore' as const),
  }),
  transfer: fc.record({
    positiveMeaning: fc.constantFrom('withdrawal' as const, 'deposit' as const),
  }),
  trade: fc.record({
    positiveMeaning: fc.constantFrom('buy' as const, 'sell' as const),
  }),
  refund: fc.record({
    positiveMeaning: fc.constant('money_in' as const),
  }),
});

const positiveAmountArb = fc.double({ min: 0.01, max: 100000, noNaN: true });
const negativeAmountArb = positiveAmountArb.map((v) => -v);
const nonZeroAmountArb = fc.oneof(positiveAmountArb, negativeAmountArb);

/**
 * Feature: import-sign-conventions, Property 3: Normalization sign correctness
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 *
 * For any non-zero raw amount and any valid SignConventionConfig:
 * - Normalizing as EXPENSE produces a negative amount (or excludes)
 * - Normalizing as INCOME produces a positive amount (or excludes)
 * - Normalizing as REFUND produces a positive amount
 * - Normalizing as TRANSFER produces negative for withdrawals, positive for deposits
 * - Normalizing as TRADE produces negative for buys, positive for sells
 */
describe('Property 3: Normalization sign correctness', () => {
  it('EXPENSE normalization produces a negative amount when money_out, positive when money_in/refund/spending, or excludes', () => {
    fc.assert(
      fc.property(nonZeroAmountArb, validConfigArb3, (raw, config) => {
        const result = normalizeAmount(raw, 'EXPENSE', config);
        if ('excluded' in result) {
          // Only excluded when negative raw + ignore
          expect(result.excluded).toBe(true);
          expect(raw).toBeLessThan(0);
          expect(config.expense.negativeMeaning).toBe('ignore');
        } else {
          if (raw > 0 && config.expense.positiveMeaning === 'money_out') {
            // Positive raw means money out → stored as negative
            expect(result.amount).toBeLessThan(0);
          } else if (raw > 0 && config.expense.positiveMeaning === 'money_in') {
            // Positive raw means money in (refund scenario) → stored as positive
            expect(result.amount).toBeGreaterThan(0);
          } else if (
            raw < 0 &&
            (config.expense.negativeMeaning === 'refund' ||
              config.expense.negativeMeaning === 'spending')
          ) {
            // Negative raw treated as refund or spending → stored as positive (abs value)
            expect(result.amount).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 20 },
    );
  });

  it('INCOME normalization always produces a positive amount', () => {
    fc.assert(
      fc.property(nonZeroAmountArb, validConfigArb3, (raw, config) => {
        const result = normalizeAmount(raw, 'INCOME', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('REFUND normalization always produces a positive amount', () => {
    fc.assert(
      fc.property(nonZeroAmountArb, validConfigArb3, (raw, config) => {
        const result = normalizeAmount(raw, 'REFUND', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('TRANSFER normalization produces negative for withdrawals and positive for deposits', () => {
    fc.assert(
      fc.property(nonZeroAmountArb, validConfigArb3, (raw, config) => {
        const result = normalizeAmount(raw, 'TRANSFER', config);
        expect(result).not.toHaveProperty('excluded');
        const amt = (result as { amount: number }).amount;

        const isPositiveRaw = raw > 0;
        const positiveMeansWithdrawal = config.transfer.positiveMeaning === 'withdrawal';

        // Withdrawal when: (positive raw + positive means withdrawal) or (negative raw + positive means deposit)
        const isWithdrawal = isPositiveRaw === positiveMeansWithdrawal;

        if (isWithdrawal) {
          expect(amt).toBeLessThan(0);
        } else {
          expect(amt).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 },
    );
  });

  it('TRADE normalization produces negative for buys and positive for sells', () => {
    fc.assert(
      fc.property(nonZeroAmountArb, validConfigArb3, (raw, config) => {
        const result = normalizeAmount(raw, 'TRADE', config);
        expect(result).not.toHaveProperty('excluded');
        const amt = (result as { amount: number }).amount;

        const isPositiveRaw = raw > 0;
        const positiveMeansBuy = config.trade.positiveMeaning === 'buy';

        // Buy when: (positive raw + positive means buy) or (negative raw + positive means sell)
        const isBuy = isPositiveRaw === positiveMeansBuy;

        if (isBuy) {
          expect(amt).toBeLessThan(0);
        } else {
          expect(amt).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 },
    );
  });
});

/**
 * Feature: import-sign-conventions, Property 4: Negative amount handling respects config
 * Validates: Requirements 4.6, 4.7
 *
 * For any negative raw amount:
 * - When negativeMeaning is "ignore", normalizeAmount returns { excluded: true }
 * - When negativeMeaning is "flip_sign", normalizeAmount returns a result with positive amount
 * - When negativeMeaning is "refund", normalizeAmount returns a result with positive amount
 */
describe('Property 4: Negative amount handling respects config', () => {
  it('EXPENSE with negativeMeaning "ignore" excludes negative amounts', () => {
    const configWithIgnore = validConfigArb3.map((c) => ({
      ...c,
      expense: { ...c.expense, negativeMeaning: 'ignore' as const },
    }));

    fc.assert(
      fc.property(negativeAmountArb, configWithIgnore, (raw, config) => {
        const result = normalizeAmount(raw, 'EXPENSE', config);
        expect(result).toEqual({ excluded: true });
      }),
      { numRuns: 20 },
    );
  });

  it('INCOME with negativeMeaning "ignore" still produces a positive amount (income always positive)', () => {
    const configWithIgnore = validConfigArb3.map((c) => ({
      ...c,
      income: { ...c.income, negativeMeaning: 'ignore' as const },
    }));

    fc.assert(
      fc.property(negativeAmountArb, configWithIgnore, (raw, config) => {
        const result = normalizeAmount(raw, 'INCOME', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('INCOME with negativeMeaning "flip_sign" returns a positive amount', () => {
    const configWithFlip = validConfigArb3.map((c) => ({
      ...c,
      income: { ...c.income, negativeMeaning: 'flip_sign' as const },
    }));

    fc.assert(
      fc.property(negativeAmountArb, configWithFlip, (raw, config) => {
        const result = normalizeAmount(raw, 'INCOME', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('EXPENSE with negativeMeaning "refund" returns a positive amount', () => {
    const configWithRefund = validConfigArb3.map((c) => ({
      ...c,
      expense: { ...c.expense, negativeMeaning: 'refund' as const },
    }));

    fc.assert(
      fc.property(negativeAmountArb, configWithRefund, (raw, config) => {
        const result = normalizeAmount(raw, 'EXPENSE', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });

  it('EXPENSE with negativeMeaning "spending" returns a positive amount', () => {
    const configWithSpending = validConfigArb3.map((c) => ({
      ...c,
      expense: { ...c.expense, negativeMeaning: 'spending' as const },
    }));

    fc.assert(
      fc.property(negativeAmountArb, configWithSpending, (raw, config) => {
        const result = normalizeAmount(raw, 'EXPENSE', config);
        expect(result).not.toHaveProperty('excluded');
        expect((result as { amount: number }).amount).toBeGreaterThan(0);
      }),
      { numRuns: 20 },
    );
  });
});
