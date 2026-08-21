import { describe, it, expect } from 'vitest';
import type { Transaction } from '@budget-tracker/core';
import type { TransactionLogEntry } from '@budget-tracker/core';
import { collapsePurchaseGroups } from './collapsePurchaseGroups.js';

/** Minimal core Transaction for the log — only the fields the collapser reads matter. */
function tx(partial: Partial<Transaction> & { id: string }): TransactionLogEntry {
  return {
    kind: 'transaction',
    data: {
      type: 'EXPENSE',
      name: 'x',
      amount: 0,
      netAmount: 0,
      date: new Date('2026-07-25T00:00:00Z'),
      payPeriodId: null,
      expenseId: null,
      incomeId: null,
      accountId: null,
      toAccountId: null,
      budgetId: null,
      note: null,
      purchaseGroupId: null,
      createdAt: new Date('2026-07-25T00:00:00Z'),
      ...partial,
    } as Transaction,
  };
}

describe('collapsePurchaseGroups', () => {
  it('leaves ungrouped transactions untouched (same array reference)', () => {
    const entries = [tx({ id: 'a', accountId: 'acc-1' }), tx({ id: 'b', accountId: 'acc-2' })];
    const result = collapsePurchaseGroups(entries);
    expect(result.entries).toBe(entries); // no allocation when nothing collapses
    expect(result.groupMetaByAnchorId.size).toBe(0);
  });

  it('collapses a group to its Anchor, hiding the legs and counting the accounts', () => {
    const entries = [
      tx({ id: 'anchor', accountId: null, purchaseGroupId: 'g1', amount: 100 }),
      tx({ id: 'leg1', accountId: 'acc-1', purchaseGroupId: 'g1', amount: 60 }),
      tx({ id: 'leg2', accountId: 'acc-2', purchaseGroupId: 'g1', amount: 40 }),
      tx({ id: 'plain', accountId: 'acc-1' }),
    ];
    const { entries: out, groupMetaByAnchorId } = collapsePurchaseGroups(entries);

    // Legs gone; Anchor and the plain row remain.
    expect(out.map((e) => (e.kind === 'transaction' ? e.data.id : ''))).toEqual([
      'anchor',
      'plain',
    ]);

    const meta = groupMetaByAnchorId.get('anchor');
    expect(meta).toEqual({ legCount: 2, legAccountIds: ['acc-1', 'acc-2'] });
  });

  it('does NOT collapse when the Anchor is absent (account-filtered ledger keeps the leg)', () => {
    // A per-account ledger filters by accountId, so the null-account Anchor is
    // never in the list — the account's own leg must stay a normal row.
    const entries = [
      tx({ id: 'leg1', accountId: 'acc-1', purchaseGroupId: 'g1', amount: 60 }),
      tx({ id: 'plain', accountId: 'acc-1' }),
    ];
    const { entries: out, groupMetaByAnchorId } = collapsePurchaseGroups(entries);
    expect(out).toHaveLength(2);
    expect(groupMetaByAnchorId.size).toBe(0);
  });

  it('collapses several independent groups at once', () => {
    const entries = [
      tx({ id: 'a1', accountId: null, purchaseGroupId: 'g1' }),
      tx({ id: 'a1l1', accountId: 'acc-1', purchaseGroupId: 'g1' }),
      tx({ id: 'a2', accountId: null, purchaseGroupId: 'g2' }),
      tx({ id: 'a2l1', accountId: 'acc-2', purchaseGroupId: 'g2' }),
      tx({ id: 'a2l2', accountId: 'acc-3', purchaseGroupId: 'g2' }),
    ];
    const { entries: out, groupMetaByAnchorId } = collapsePurchaseGroups(entries);
    expect(out.map((e) => (e.kind === 'transaction' ? e.data.id : ''))).toEqual(['a1', 'a2']);
    expect(groupMetaByAnchorId.get('a1')?.legCount).toBe(1);
    expect(groupMetaByAnchorId.get('a2')?.legCount).toBe(2);
  });
});
