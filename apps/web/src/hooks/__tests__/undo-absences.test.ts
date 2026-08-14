/**
 * The mutations that must NOT offer Undo.
 *
 * Every absence here is a decision with a reason, and each reason is a property
 * of the schema or the API rather than an opinion — so it can be checked, and
 * so that adding an `undo` later means confronting the reason first.
 *
 * This file exists because the alternative was implicit. The per-domain suites
 * asserted `toEqual({ successMessage })`, which happened to fail if anyone added
 * an inverse — a pin nobody could see, that would read as an annoying assertion
 * to loosen rather than as a rule. Those became `toMatchObject`, and the rules
 * moved here where they say why.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      update: vi.fn().mockResolvedValue({ id: 't1' }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    purchases: {
      create: vi.fn().mockResolvedValue({ purchaseGroupId: null, transactionIds: ['t1'] }),
      updatePayments: vi.fn().mockResolvedValue({ purchaseGroupId: 'g1', transactionIds: [] }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    budgetItems: { delete: vi.fn().mockResolvedValue({ deleted: true }) },
    debts: { delete: vi.fn().mockResolvedValue(undefined) },
    investments: { deleteHolding: vi.fn().mockResolvedValue(undefined) },
  },
}));
vi.mock('../../lib/cache-invalidation.js', () => ({ invalidateTransactionCaches: vi.fn() }));

import {
  useUpdateTransaction,
  useDeleteTransaction,
  useUpdatePurchasePayments,
  useDeletePurchase,
} from '../useTransactionMutations.js';
import { useDeleteBudgetItem } from '../useBudgetItems.js';
import { useDeleteDebt } from '../useDebts.js';
import { useDeleteHolding } from '../useInvestments.js';

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}
const wrapperFor = (qc: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };

/** Run a mutation and report whether it declared an inverse. */
async function declaresUndo(hook: () => { mutate: (v: never) => void }, value: unknown) {
  const qc = client();
  const { result } = renderHook(hook, { wrapper: wrapperFor(qc) });
  await act(async () => {
    (result.current.mutate as (v: unknown) => void)(value);
  });
  await waitFor(() => expect(qc.getMutationCache().getAll().length).toBeGreaterThan(0));
  const meta = qc.getMutationCache().getAll()[0]?.options.meta as { undo?: unknown } | undefined;
  return meta?.undo !== undefined;
}

beforeEach(() => vi.clearAllMocks());

describe('the ledger', () => {
  it('does not offer undo on a transaction update', async () => {
    // `UpdateTx` accepts `occurrenceDate`; `TxShape` does not return it. A
    // restore from the captured record would put back nine fields of ten and
    // leave `occurrenceDate` at whatever the edit set, because an absent field
    // means "no change" — a partial restore reported as a complete one, on the
    // master ledger. Adding `occurrenceDate` to `TxShape` is what unblocks this.
    expect(await declaresUndo(useUpdateTransaction, { id: 't1', body: { amount: 5 } })).toBe(false);
  });

  it('does not offer undo on a transaction delete', async () => {
    // Recreating mints a new id, so child allocations, the purchase group,
    // reconciliation matches, the debt payment and any scheduled row that
    // pointed at the old transaction are left pointing at nothing.
    expect(await declaresUndo(useDeleteTransaction, 't1')).toBe(false);
  });

  it('does not offer undo on a purchase delete or re-split', async () => {
    expect(await declaresUndo(useDeletePurchase, 'g1')).toBe(false);
    expect(
      await declaresUndo(useUpdatePurchasePayments, { groupId: 'g1', body: { payments: [] } }),
    ).toBe(false);
  });
});

describe('deletes that destroy history', () => {
  it('does not offer undo on a budget item delete', async () => {
    // `hard` cascades every Expense, Income and BudgetGoal plus the
    // allocations; `soft` is reversible in principle but the API exposes no
    // restore for a budget item, so there is no inverse to call.
    expect(await declaresUndo(useDeleteBudgetItem, { id: 'b1', mode: 'hard' })).toBe(false);
  });

  it('does not offer undo on a debt delete', async () => {
    // DebtPayment and EscrowRecord both CASCADE from Debt, so the payment and
    // escrow history goes with it.
    expect(await declaresUndo(useDeleteDebt, 'd1')).toBe(false);
  });

  it('does not offer undo on a holding delete', async () => {
    // Deletes every InvestmentSnapshot for the holding — the record of what it
    // was worth over time, and the data the portfolio chart is drawn from.
    expect(await declaresUndo(useDeleteHolding, 'h1')).toBe(false);
  });
});
