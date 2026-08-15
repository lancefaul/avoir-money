/**
 * The create shape's whole job is the two rules that keep a purchase honest:
 * the payment legs sum to what was actually paid (net of rewards), and the
 * account side never sneaks a duplicate leg in. Everything downstream — the
 * Anchor, the balance chain — trusts that the legs add up.
 */
import { describe, it, expect } from 'vitest';
import { CreatePurchaseSchema, isPurchaseGroup } from './purchase-group.js';

const base = {
  name: 'Groceries',
  date: '2026-07-25',
  amount: 100,
  payments: [{ accountId: 'acct_a', amount: 100 }],
};

describe('CreatePurchaseSchema', () => {
  it('accepts a single payment that equals the net amount (ordinary path)', () => {
    const r = CreatePurchaseSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(isPurchaseGroup(base)).toBe(false);
  });

  it('accepts a two-account split whose legs sum to the net amount', () => {
    const input = {
      ...base,
      payments: [
        { accountId: 'card', amount: 60 },
        { accountId: 'gift', amount: 40 },
      ],
    };
    const r = CreatePurchaseSchema.safeParse(input);
    expect(r.success).toBe(true);
    expect(isPurchaseGroup(input)).toBe(true);
  });

  it('rejects legs that do not sum to the amount', () => {
    const r = CreatePurchaseSchema.safeParse({
      ...base,
      payments: [
        { accountId: 'card', amount: 60 },
        { accountId: 'gift', amount: 30 }, // 90 ≠ 100
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toContain('payments');
  });

  it('sums in cents so exact-thirds legs are accepted', () => {
    const r = CreatePurchaseSchema.safeParse({
      ...base,
      payments: [
        { accountId: 'a', amount: 33.33 },
        { accountId: 'b', amount: 33.33 },
        { accountId: 'c', amount: 33.34 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects the same account funding a purchase twice', () => {
    const r = CreatePurchaseSchema.safeParse({
      ...base,
      payments: [
        { accountId: 'card', amount: 60 },
        { accountId: 'card', amount: 40 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('requires at least one payment, each positive', () => {
    expect(CreatePurchaseSchema.safeParse({ ...base, payments: [] }).success).toBe(false);
    expect(
      CreatePurchaseSchema.safeParse({
        ...base,
        payments: [{ accountId: 'card', amount: 0 }],
      }).success,
    ).toBe(false);
  });
});
