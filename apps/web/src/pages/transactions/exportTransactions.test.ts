import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { exportTransactions, type ExportFilters } from './exportTransactions.js';

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      list: vi.fn(),
      listChildren: vi.fn(),
    },
    accounts: { list: vi.fn() },
    budgetItems: { list: vi.fn() },
    investments: {
      custodians: { list: vi.fn() },
      wallets: { list: vi.fn() },
    },
  },
}));

vi.mock('../../lib/utils.js', () => ({
  localToday: () => '2026-06-01',
}));

vi.mock('@budget-tracker/core', () => ({
  formatTransactionsToCSV: vi.fn(() => 'csv-content'),
}));

import { api } from '../../lib/api.js';
import { formatTransactionsToCSV } from '@budget-tracker/core';

const csvMock = formatTransactionsToCSV as Mock;

function csvArg(): unknown[] {
  return csvMock.mock.calls[0]![0] as unknown[];
}

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    name: 'Groceries',
    amount: 50,
    date: '2026-01-15T00:00:00.000Z',
    type: 'EXPENSE',
    accountId: 'acc-1',
    toAccountId: null,
    budgetId: 'bud-1',
    note: null,
    ...overrides,
  };
}

describe('exportTransactions', () => {
  let createObjectURLMock: Mock;
  let revokeObjectURLMock: Mock;
  let clickMock: Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    createObjectURLMock = vi.fn(() => 'blob:http://localhost/fake-url');
    revokeObjectURLMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL;

    clickMock = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickMock } as unknown as HTMLElement;
      }
      return document.createElement(tag);
    });

    // Default mocks for lookup APIs
    (api.accounts.list as Mock).mockResolvedValue([{ id: 'acc-1', name: 'Chase Checking' }]);
    (api.budgetItems.list as Mock).mockResolvedValue([{ id: 'bud-1', name: 'Food' }]);
    (api.investments.custodians.list as Mock).mockResolvedValue([]);
    (api.investments.wallets.list as Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetches all pages', () => {
    it('fetches a single page when hasMore is false', async () => {
      (api.transactions.list as Mock).mockResolvedValue({
        transactions: [makeTx()],
        hasMore: false,
        nextCursor: null,
      });

      await exportTransactions();

      expect(api.transactions.list).toHaveBeenCalledTimes(1);
      expect(api.transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500, cursor: undefined, skipGenerate: true }),
      );
    });

    it('fetches multiple pages using cursor-based pagination', async () => {
      (api.transactions.list as Mock)
        .mockResolvedValueOnce({
          transactions: [makeTx({ id: 'tx-1' })],
          hasMore: true,
          nextCursor: 'cursor-abc',
        })
        .mockResolvedValueOnce({
          transactions: [makeTx({ id: 'tx-2' })],
          hasMore: false,
          nextCursor: null,
        });

      await exportTransactions();

      expect(api.transactions.list).toHaveBeenCalledTimes(2);
      expect(api.transactions.list).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ limit: 500, cursor: undefined }),
      );
      expect(api.transactions.list).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ limit: 500, cursor: 'cursor-abc' }),
      );
    });

    it('passes search filter to the API', async () => {
      (api.transactions.list as Mock).mockResolvedValue({
        transactions: [],
        hasMore: false,
        nextCursor: null,
      });

      await exportTransactions({ search: 'coffee' });

      expect(api.transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'coffee' }),
      );
    });
  });

  describe('applies client filters', () => {
    beforeEach(() => {
      (api.transactions.list as Mock).mockResolvedValue({
        transactions: [
          makeTx({ id: 'tx-1', type: 'EXPENSE', accountId: 'acc-1', budgetId: 'bud-1' }),
          makeTx({ id: 'tx-2', type: 'INCOME', accountId: 'acc-2', budgetId: 'bud-2' }),
          makeTx({
            id: 'tx-3',
            type: 'TRANSFER',
            accountId: 'acc-1',
            toAccountId: 'acc-3',
            budgetId: null,
          }),
        ],
        hasMore: false,
        nextCursor: null,
      });
    });

    it('filters by type', async () => {
      const filters: ExportFilters = { types: ['EXPENSE'] };
      await exportTransactions(filters);

      expect(csvMock).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'tx-1' })]),
      );
      const arg = csvArg();
      expect(arg).toHaveLength(1);
    });

    it('filters by accountIds (matches accountId or toAccountId)', async () => {
      const filters: ExportFilters = { accountIds: ['acc-3'] };
      await exportTransactions(filters);

      const arg = csvArg() as Array<{ id: string }>;
      expect(arg).toHaveLength(1);
      expect(arg[0]!.id).toBe('tx-3');
    });

    it('filters by budgetIds', async () => {
      const filters: ExportFilters = { budgetIds: ['bud-2'] };
      await exportTransactions(filters);

      const arg = csvArg() as Array<{ id: string }>;
      expect(arg).toHaveLength(1);
      expect(arg[0]!.id).toBe('tx-2');
    });

    it('applies multiple filters together', async () => {
      const filters: ExportFilters = { types: ['EXPENSE', 'TRANSFER'], accountIds: ['acc-1'] };
      await exportTransactions(filters);

      const arg = csvArg() as Array<{ id: string }>;
      expect(arg).toHaveLength(2);
      expect(arg.map((t) => t.id).sort()).toEqual(['tx-1', 'tx-3']);
    });
  });

  describe('produces CSV download', () => {
    beforeEach(() => {
      (api.transactions.list as Mock).mockResolvedValue({
        transactions: [makeTx()],
        hasMore: false,
        nextCursor: null,
      });
    });

    it('creates a Blob with CSV content and correct MIME type', async () => {
      await exportTransactions();

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blob = createObjectURLMock.mock.calls[0]![0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('text/csv');
    });

    it('creates an anchor element with correct download filename', async () => {
      await exportTransactions();

      const createElement = document.createElement as Mock;
      expect(createElement).toHaveBeenCalledWith('a');
    });

    it('triggers a click on the anchor to initiate download', async () => {
      await exportTransactions();

      expect(clickMock).toHaveBeenCalledTimes(1);
    });

    it('revokes the object URL after download', async () => {
      await exportTransactions();

      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-url');
    });

    it('calls formatTransactionsToCSV with exportable transactions', async () => {
      await exportTransactions();

      expect(csvMock).toHaveBeenCalledTimes(1);
      const arg = csvArg() as Array<Record<string, unknown>>;
      expect(arg).toHaveLength(1);
      expect(arg[0]).toMatchObject({
        id: 'tx-1',
        name: 'Groceries',
        amount: 50,
        accountName: 'Chase Checking',
        categoryName: 'Food',
      });
    });

    it('fetches children for transactions with childCount > 0', async () => {
      (api.transactions.list as Mock).mockResolvedValue({
        transactions: [makeTx({ id: 'tx-parent', childCount: 2 })],
        hasMore: false,
        nextCursor: null,
      });
      (api.transactions.listChildren as Mock).mockResolvedValue({
        children: [
          {
            id: 'child-1',
            parentId: 'tx-parent',
            budgetId: 'bud-1',
            preTaxAmount: 30,
            taxAmount: 3,
            taxRate: 0.1,
            lineTotal: 33,
            note: null,
          },
          {
            id: 'child-2',
            parentId: 'tx-parent',
            budgetId: null,
            preTaxAmount: 17,
            taxAmount: 0,
            taxRate: null,
            lineTotal: 17,
            note: 'tip',
          },
        ],
      });

      await exportTransactions();

      expect(api.transactions.listChildren).toHaveBeenCalledWith('tx-parent');
      const arg = csvArg() as Array<{ children: Array<Record<string, unknown>> }>;
      expect(arg[0]!.children).toHaveLength(2);
      expect(arg[0]!.children[0]).toMatchObject({
        id: 'child-1',
        amount: 33,
        categoryName: 'Food',
      });
      expect(arg[0]!.children[1]).toMatchObject({ id: 'child-2', amount: 17, note: 'tip' });
    });
  });
});
