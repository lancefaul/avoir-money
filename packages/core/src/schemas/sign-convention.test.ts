import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGN_CONVENTION_CONFIG, normalizeAmount } from './sign-convention.js';

describe('DEFAULT_SIGN_CONVENTION_CONFIG', () => {
  it('defaults expense to positiveMeaning=money_out, negativeMeaning=refund', () => {
    expect(DEFAULT_SIGN_CONVENTION_CONFIG.expense).toEqual({
      positiveMeaning: 'money_out',
      negativeMeaning: 'refund',
    });
  });

  it('defaults income to positiveMeaning=money_in, negativeMeaning=flip_sign', () => {
    expect(DEFAULT_SIGN_CONVENTION_CONFIG.income).toEqual({
      positiveMeaning: 'money_in',
      negativeMeaning: 'flip_sign',
    });
  });

  it('defaults transfer to positiveMeaning=withdrawal', () => {
    expect(DEFAULT_SIGN_CONVENTION_CONFIG.transfer).toEqual({
      positiveMeaning: 'withdrawal',
    });
  });

  it('defaults trade to positiveMeaning=buy', () => {
    expect(DEFAULT_SIGN_CONVENTION_CONFIG.trade).toEqual({
      positiveMeaning: 'buy',
    });
  });

  it('defaults refund to positiveMeaning=money_in', () => {
    expect(DEFAULT_SIGN_CONVENTION_CONFIG.refund).toEqual({
      positiveMeaning: 'money_in',
    });
  });
});

describe('normalizeAmount - zero amounts', () => {
  const types = ['EXPENSE', 'INCOME', 'TRANSFER', 'TRADE', 'REFUND'] as const;

  it.each(types)('returns { excluded: true } for zero amount with type %s', (type) => {
    const result = normalizeAmount(0, type, DEFAULT_SIGN_CONVENTION_CONFIG);
    expect(result).toEqual({ excluded: true });
  });
});

describe('normalizeAmount - specific examples with default config', () => {
  const config = DEFAULT_SIGN_CONVENTION_CONFIG;

  it('EXPENSE +100 → { amount: -100 }', () => {
    expect(normalizeAmount(100, 'EXPENSE', config)).toEqual({ amount: -100 });
  });

  it('EXPENSE -50 → { amount: 50 } (refund)', () => {
    expect(normalizeAmount(-50, 'EXPENSE', config)).toEqual({ amount: 50 });
  });

  it('INCOME +3000 → { amount: 3000 }', () => {
    expect(normalizeAmount(3000, 'INCOME', config)).toEqual({ amount: 3000 });
  });

  it('INCOME -500 → { amount: 500 } (flip_sign)', () => {
    expect(normalizeAmount(-500, 'INCOME', config)).toEqual({ amount: 500 });
  });

  it('TRANSFER +85.08 → { amount: -85.08 } (withdrawal)', () => {
    expect(normalizeAmount(85.08, 'TRANSFER', config)).toEqual({ amount: -85.08 });
  });

  it('TRANSFER -85.08 → { amount: 85.08 } (deposit)', () => {
    expect(normalizeAmount(-85.08, 'TRANSFER', config)).toEqual({ amount: 85.08 });
  });

  it('TRADE +1000 → { amount: -1000 } (buy)', () => {
    expect(normalizeAmount(1000, 'TRADE', config)).toEqual({ amount: -1000 });
  });

  it('TRADE -500 → { amount: 500 } (sell)', () => {
    expect(normalizeAmount(-500, 'TRADE', config)).toEqual({ amount: 500 });
  });

  it('REFUND +75 → { amount: 75 }', () => {
    expect(normalizeAmount(75, 'REFUND', config)).toEqual({ amount: 75 });
  });

  it('REFUND -75 → { amount: 75 }', () => {
    expect(normalizeAmount(-75, 'REFUND', config)).toEqual({ amount: 75 });
  });
});
