import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import BulkActionsToolbar from './BulkActionsToolbar.js';

// Mock matchMedia — the toolbar reads the collapsed sidebar state via useIsNarrow
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../store/toast.js', () => ({
  useToastStore: { getState: () => ({ addToast: vi.fn() }) },
}));

import { api } from '../../lib/api.js';
import { useToastStore } from '../../store/toast.js';

const categories = [
  { id: 'cat-1', name: 'Groceries', icon: '🛒' },
  { id: 'cat-2', name: 'Utilities', icon: null },
];

const accounts = [
  { id: 'acc-1', name: 'Checking', type: 'CHECKING', archived: false },
  { id: 'acc-2', name: 'Savings', type: 'SAVINGS', archived: false },
  { id: 'acc-3', name: 'Old Card', type: 'CREDIT', archived: true },
];

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const defaultProps = {
  selected: new Set(['tx-1', 'tx-2']),
  transactionIds: ['tx-1', 'tx-2', 'tx-3'],
  categories,
  accounts,
  onSelectAll: vi.fn(),
  onUnselectAll: vi.fn(),
  onBulkComplete: vi.fn(),
};

function setup(overrides: Partial<typeof defaultProps> = {}) {
  const props = {
    ...defaultProps,
    onSelectAll: overrides.onSelectAll ?? vi.fn(),
    onUnselectAll: overrides.onUnselectAll ?? vi.fn(),
    onBulkComplete: overrides.onBulkComplete ?? vi.fn(),
    ...overrides,
  };
  const user = userEvent.setup();
  const result = render(<BulkActionsToolbar {...props} />, { wrapper: createWrapper() });
  return { props, user, ...result };
}

describe('BulkActionsToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.transactions.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (api.transactions.delete as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it('does not render when no items are selected', () => {
    setup({ selected: new Set() });
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('renders selected count when items are selected', () => {
    setup();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('renders Change Budget, Change Account, and Delete buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Change Budget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('opens bulk category change modal when Change Budget is clicked', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Budget' }));
    expect(screen.getByText(/Change Budget for 2 transactions/)).toBeInTheDocument();
  });

  it('opens bulk account change modal when Change Account is clicked', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Account' }));
    expect(screen.getByText(/Change Account for 2 transactions/)).toBeInTheDocument();
  });

  it('calls api.transactions.update for each selected item on bulk category change', async () => {
    const onBulkComplete = vi.fn();
    const { user } = setup({ onBulkComplete });

    await user.click(screen.getByRole('button', { name: 'Change Budget' }));

    // Open the custom Select dropdown by clicking the combobox trigger
    const combobox = screen.getByRole('combobox');
    await user.click(combobox);

    // Click the option in the dropdown
    await user.click(screen.getByText('🛒 Groceries'));

    // Click Apply
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(api.transactions.update).toHaveBeenCalledTimes(2);
      expect(api.transactions.update).toHaveBeenCalledWith('tx-1', { budgetId: 'cat-1' });
      expect(api.transactions.update).toHaveBeenCalledWith('tx-2', { budgetId: 'cat-1' });
    });

    await waitFor(() => {
      expect(onBulkComplete).toHaveBeenCalled();
    });
  });

  it('calls api.transactions.update for each selected item on bulk account change', async () => {
    const onBulkComplete = vi.fn();
    const { user } = setup({ onBulkComplete });

    await user.click(screen.getByRole('button', { name: 'Change Account' }));

    // Open the custom Select dropdown
    const combobox = screen.getByRole('combobox');
    await user.click(combobox);

    // Click the option
    await user.click(screen.getByText('Checking'));

    // Click Apply
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(api.transactions.update).toHaveBeenCalledTimes(2);
      expect(api.transactions.update).toHaveBeenCalledWith('tx-1', { accountId: 'acc-1' });
      expect(api.transactions.update).toHaveBeenCalledWith('tx-2', { accountId: 'acc-1' });
    });

    await waitFor(() => {
      expect(onBulkComplete).toHaveBeenCalled();
    });
  });

  it('opens confirm dialog and calls api.transactions.delete on bulk delete', async () => {
    const onBulkComplete = vi.fn();
    const { user } = setup({ onBulkComplete });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // Confirm dialog should appear
    expect(screen.getByText(/Delete 2 transactions\? This cannot be undone\./)).toBeInTheDocument();

    // Click the confirm Delete button inside the dialog
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(api.transactions.delete).toHaveBeenCalledTimes(2);
      expect(api.transactions.delete).toHaveBeenCalledWith('tx-1');
      expect(api.transactions.delete).toHaveBeenCalledWith('tx-2');
    });

    await waitFor(() => {
      expect(onBulkComplete).toHaveBeenCalled();
    });
  });

  it('shows error toast when some bulk updates fail', async () => {
    const addToast = vi.fn();
    (useToastStore as any).getState = () => ({ addToast });
    (api.transactions.update as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('fail'));

    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Change Budget' }));

    // Open the custom Select dropdown
    const combobox = screen.getByRole('combobox');
    await user.click(combobox);

    // Click the option
    await user.click(screen.getByText('🛒 Groceries'));

    // Click Apply
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', '1 transaction(s) failed to update');
    });
  });

  it('disables Apply button when no value is selected', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Budget' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('closes modal when Cancel is clicked', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Change Budget' }));
    expect(screen.getByText(/Change Budget for 2 transactions/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Change Budget for 2 transactions/)).not.toBeInTheDocument();
  });
});
