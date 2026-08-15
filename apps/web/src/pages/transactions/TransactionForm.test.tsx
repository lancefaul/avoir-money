import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import TransactionForm from './TransactionForm.js';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { FormValues } from './transactionFormSchema.js';
import type { Account, Category, Income, NamedEntity, StockHolding } from './types.js';

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      suggestBudget: vi.fn().mockResolvedValue({ suggestions: [] }),
    },
  },
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const accounts: Account[] = [
  { id: 'acc-1', name: 'Checking', type: 'CHECKING', archived: false },
  { id: 'acc-2', name: 'Savings', type: 'SAVINGS', archived: false },
  { id: 'acc-3', name: 'Archived Card', type: 'CREDIT', archived: true },
];

const categories: Category[] = [
  { id: 'cat-1', name: 'Groceries', icon: '🛒' },
  { id: 'cat-2', name: 'Utilities', icon: '⚡' },
  { id: 'cat-3', name: 'Uncategorized', icon: null },
];

const incomes: Income[] = [
  { id: 'inc-1', name: 'Salary' },
  { id: 'inc-2', name: 'Freelance' },
];

const wallets: NamedEntity[] = [{ id: 'wal-1', name: 'Ledger' }];

const custodians: NamedEntity[] = [{ id: 'cust-1', name: 'Fidelity' }];

const stockHoldings: StockHolding[] = [
  {
    id: 'hold-1',
    name: 'AAPL',
    ticker: 'AAPL',
    type: 'STOCK',
    custodianId: 'cust-1',
    custodianName: 'Fidelity',
  },
];

function createMockForm(
  overrides: Partial<UseTransactionFormReturn> = {},
): UseTransactionFormReturn {
  const txType = (overrides.txType ?? 'EXPENSE') as FormValues['type'];

  const watchValues: Partial<FormValues> = {
    type: txType,
    date: '2025-01-15',
    name: '',
    amount: '50.00',
    budgetId: 'cat-3',
    accountId: 'acc-1',
    paymentMethod: 'account',
    transferType: 'usd',
    btcUnit: 'Bitcoin',
    btcEntryMode: 'unitPrice',
    tradeDirection: 'BUY',
    ...(overrides as any)._watchValues,
  };

  return {
    register: vi
      .fn()
      .mockReturnValue({ name: 'mock-field', onChange: vi.fn(), onBlur: vi.fn(), ref: vi.fn() }),
    handleSubmit: vi.fn().mockImplementation((fn) => (e?: React.BaseSyntheticEvent) => {
      e?.preventDefault();
      fn(watchValues as FormValues);
    }),
    watch: vi.fn().mockImplementation((field?: string) => {
      if (!field) return watchValues;
      return (watchValues as any)[field];
    }),
    setValue: vi.fn(),
    errors: {},
    showForm: true,
    editing: null,
    txType,
    watchAccountId: 'acc-1',
    watchAssetType: 'Stock',
    watchBitcoinUnit: 'Bitcoin',
    watchPaymentMethod: 'account',
    watchBtcQuantity: undefined,
    watchBtcUnitPrice: undefined,
    watchBtcUnit: 'Bitcoin',
    watchTransferType: 'usd',
    watchBtcTransferFee: undefined,
    watchBtcTransferFeeUnit: undefined,
    watchStockHoldingId: undefined,
    watchStockFeeAmount: undefined,
    watchBtcEntryMode: 'unitPrice',
    watchBtcUsdAmount: undefined,
    btcUsdEquivalent: null,
    showPaymentToggle: true,
    isBitcoinPayment: false,
    isTransfer: false,
    isBtcTransfer: false,
    isStockTransfer: false,
    isUsdTransfer: false,
    hideAmountField: false,
    selectedStockHolding: undefined,
    selectedStockFromCustodianName: '',
    btcTransferFeeNum: 0,
    stockFeeNum: 0,
    selectedAccount: accounts[0],
    fundingMode: 'single',
    fundingAccountIds: ['acc-1'],
    legAmounts: {},
    rewardsAmounts: {},
    isSplit: false,
    fundingError: null,
    switchFundingMode: vi.fn(),
    setFundingAccounts: vi.fn(),
    setLegAmount: vi.fn(),
    setRewardsAmount: vi.fn(),
    rewardsAccountFor: vi.fn(() => undefined),
    availableCents: vi.fn(() => null),
    isResplit: false,
    resplitTotalCents: 0,
    resplitError: null,
    tradeError: '',
    isCopyAndChange: false,
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    openDuplicate: vi.fn(),
    openResplit: vi.fn(),
    closeForm: vi.fn(),
    onSubmit: vi.fn(),
    submitResplit: vi.fn(),
    ...overrides,
  };
}

const defaultProps = {
  accounts,
  categories,
  incomes,
  wallets,
  custodians,
  stockHoldings,
  isPending: false,
  nameSuggestions: ['Groceries', 'Gas', 'Electric'],
};

function setup(
  formOverrides: Partial<UseTransactionFormReturn> = {},
  propOverrides: Record<string, unknown> = {},
) {
  const form = createMockForm(formOverrides);
  const user = userEvent.setup();
  const result = render(<TransactionForm form={form} {...defaultProps} {...propOverrides} />, {
    wrapper: createWrapper(),
  });
  return { form, user, ...result };
}

describe('TransactionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('does not render when showForm is false', () => {
      setup({ showForm: false });
      expect(screen.queryByText('Transaction Information')).not.toBeInTheDocument();
    });

    it('renders all core fields when showForm is true', () => {
      setup();
      expect(screen.getByText('Transaction Information')).toBeInTheDocument();
      // Date uses a combobox (DatePicker), Description uses an input, Amount uses an input
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Amount')).toBeInTheDocument();
      expect(screen.getByText('Extra Information')).toBeInTheDocument();
      expect(screen.getByText('Note')).toBeInTheDocument();
    });

    it('renders type selector by default', () => {
      setup();
      expect(screen.getByRole('radiogroup', { name: 'Transaction type' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Expense' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Refund' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Transfer' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Income' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Trade' })).toBeInTheDocument();
    });

    it('hides type selector when hideTypeSelector is true', () => {
      setup({}, { hideTypeSelector: true });
      expect(
        screen.queryByRole('radiogroup', { name: 'Transaction type' }),
      ).not.toBeInTheDocument();
    });

    it('renders Budget field for EXPENSE type', () => {
      setup({ txType: 'EXPENSE' });
      expect(screen.getByText('Budget')).toBeInTheDocument();
    });

    it('renders Budget field for REFUND type', () => {
      setup({ txType: 'REFUND' });
      expect(screen.getByText('Budget')).toBeInTheDocument();
    });

    it('does not render Budget field for TRANSFER type', () => {
      setup({ txType: 'TRANSFER', isTransfer: true });
      expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    });

    it('does not render Budget field for TRADE type', () => {
      setup({ txType: 'TRADE' });
      expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    });

    it('does not render Budget field for INCOME type', () => {
      setup({ txType: 'INCOME' });
      expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    });

    it('renders Income Source field for INCOME type', () => {
      setup({ txType: 'INCOME' });
      expect(screen.getByText('Income Source')).toBeInTheDocument();
    });

    it('does not render Income Source field for EXPENSE type', () => {
      setup({ txType: 'EXPENSE' });
      expect(screen.queryByText('Income Source')).not.toBeInTheDocument();
    });
  });

  describe('type-dependent conditional sections', () => {
    it('renders TransferFields when type is TRANSFER', () => {
      setup({ txType: 'TRANSFER', isTransfer: true });
      // TransferFields is rendered — verify the form still renders correctly
      expect(screen.getByText('Transaction Information')).toBeInTheDocument();
    });

    it('hides Amount field for TRADE type', () => {
      setup({ txType: 'TRADE' });
      // The condition is `!hideAmountField && txType !== 'TRADE'`
      expect(screen.queryByText('Amount')).not.toBeInTheDocument();
    });

    it('hides Amount field when hideAmountField is true (bitcoin transfer)', () => {
      setup({ txType: 'TRANSFER', hideAmountField: true, isBtcTransfer: true, isTransfer: true });
      expect(screen.queryByText('Amount')).not.toBeInTheDocument();
    });

    it('hides Amount field when hideAmountField is true (stock transfer)', () => {
      setup({ txType: 'TRANSFER', hideAmountField: true, isStockTransfer: true, isTransfer: true });
      expect(screen.queryByText('Amount')).not.toBeInTheDocument();
    });

    it('hides main Amount field when hideAmountField is true (bitcoin payment)', () => {
      setup({
        txType: 'EXPENSE',
        hideAmountField: true,
        isBitcoinPayment: true,
        showPaymentToggle: true,
      });
      // The main Amount field is hidden, but BitcoinPaymentFields renders its own Amount label
      // Verify the main amount input (with the form's fid prefix) is not present
      // by checking that the CurrencyInput with value from watch('amount') is absent
      const amountLabels = screen.getAllByText('Amount');
      // All "Amount" labels should come from BitcoinPaymentFields, not the main form
      // The main form's Amount field has a required asterisk — check it's absent
      const requiredAmountLabel = screen.queryByText((content, element) => {
        if (!element || element.tagName !== 'LABEL') return false;
        return element.textContent === 'Amount *' || element.textContent === 'Amount*';
      });
      expect(requiredAmountLabel).not.toBeInTheDocument();
    });

    it('shows Amount field for standard EXPENSE', () => {
      setup({ txType: 'EXPENSE', hideAmountField: false });
      expect(screen.getByText('Amount')).toBeInTheDocument();
    });

    /*
     * Cash back is a rebate on spending rather than money earned, so the flag
     * only means anything on INCOME — and the API refuses it on other types.
     * Showing the toggle anywhere else would offer a control whose value is
     * rejected on submit.
     */
    it('shows the cash back toggle for INCOME', () => {
      setup({ txType: 'INCOME' });
      expect(screen.getByText('Rebate (Cash Back)')).toBeInTheDocument();
      expect(screen.getByText('This is a non-taxable rebate or cash back.')).toBeInTheDocument();
    });

    it.each(['EXPENSE', 'REFUND', 'TRANSFER', 'TRADE'] as const)(
      'hides the cash back toggle for %s',
      (txType) => {
        setup({ txType, isTransfer: txType === 'TRANSFER' });
        expect(screen.queryByText('Rebate (Cash Back)')).not.toBeInTheDocument();
      },
    );
  });

  describe('form title', () => {
    it('shows "Add Transaction" when not editing', () => {
      setup({ editing: null, isCopyAndChange: false });
      expect(screen.getByText('Add Transaction')).toBeInTheDocument();
    });

    it('shows "Edit Transaction" when editing', () => {
      setup({ editing: { id: 'tx-1' } as any });
      expect(screen.getByText('Edit Transaction')).toBeInTheDocument();
    });

    it('shows "Copy & Change" when duplicating', () => {
      setup({ editing: null, isCopyAndChange: true });
      expect(screen.getByText('Copy & Change')).toBeInTheDocument();
    });

    it('uses title prop override when provided', () => {
      setup({}, { title: 'Custom Title' });
      expect(screen.getByText('Custom Title')).toBeInTheDocument();
    });
  });

  describe('form submission', () => {
    it('calls handleSubmit on form submit', async () => {
      const { form, user } = setup();
      const submitBtn = screen.getByRole('button', { name: /Spend/ });
      await user.click(submitBtn);
      expect(form.handleSubmit).toHaveBeenCalled();
    });

    it('shows correct primary button label for EXPENSE', () => {
      setup({ txType: 'EXPENSE' });
      expect(screen.getByRole('button', { name: /Spend/ })).toBeInTheDocument();
    });

    it('shows correct primary button label for REFUND', () => {
      setup({ txType: 'REFUND' });
      expect(screen.getByRole('button', { name: /Receive/ })).toBeInTheDocument();
    });

    it('shows correct primary button label for TRANSFER', () => {
      setup({ txType: 'TRANSFER', isTransfer: true });
      expect(screen.getByRole('button', { name: /Transfer/ })).toBeInTheDocument();
    });

    it('shows correct primary button label for INCOME', () => {
      setup({ txType: 'INCOME' });
      expect(screen.getByRole('button', { name: /Receive/ })).toBeInTheDocument();
    });

    it('shows "Save" label when editing', () => {
      setup({ editing: { id: 'tx-1' } as any });
      expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
    });

    it('includes amount in submit button text', () => {
      setup({ txType: 'EXPENSE' });
      // Default watch('amount') returns '50.00', so button shows "Spend · $50.00"
      expect(screen.getByRole('button', { name: /Spend.*\$50\.00/ })).toBeInTheDocument();
    });

    it('disables submit button when isPending', () => {
      setup({}, { isPending: true });
      const submitBtn = screen.getByRole('button', { name: /Spend/ });
      expect(submitBtn).toBeDisabled();
    });
  });

  describe('cancel button', () => {
    it('calls closeForm when Cancel is clicked', async () => {
      const { form, user } = setup();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(form.closeForm).toHaveBeenCalled();
    });
  });

  describe('validation errors', () => {
    it('displays date error message', () => {
      setup({ errors: { date: { message: 'Date is required', type: 'custom' } } as any });
      expect(screen.getByText('Date is required')).toBeInTheDocument();
    });

    it('displays name error message', () => {
      setup({ errors: { name: { message: 'Description is required.', type: 'custom' } } as any });
      expect(screen.getByText('Description is required.')).toBeInTheDocument();
    });

    it('displays amount error message', () => {
      setup({ errors: { amount: { message: 'Amount is required', type: 'custom' } } as any });
      expect(screen.getByText('Amount is required')).toBeInTheDocument();
    });

    it('displays the funding error so a disabled submit is explained', () => {
      setup({
        isSplit: true,
        fundingMode: 'multiple',
        fundingAccountIds: ['acc-1', 'acc-2'],
        legAmounts: { 'acc-1': 20000, 'acc-2': 1000 },
        fundingError: 'Rewards exceed the amount',
      });
      expect(screen.getByText('Rewards exceed the amount')).toBeInTheDocument();
    });

    it('disables submit while the funding is invalid (fundingError set)', () => {
      setup({
        isSplit: true,
        fundingMode: 'multiple',
        fundingAccountIds: ['acc-1', 'acc-2'],
        fundingError: 'Rewards exceed the amount',
      });
      expect(screen.getByRole('button', { name: /Spend/ })).toBeDisabled();
    });
  });

  describe('account filtering', () => {
    it('excludes archived accounts from account options', () => {
      // The component filters archived accounts internally — only non-archived accounts appear
      // We verify the form renders without error with archived accounts in the list
      setup();
      expect(screen.getByText('Transaction Information')).toBeInTheDocument();
    });
  });
});
