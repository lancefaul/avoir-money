import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../test/wrapper.js';

// Mock matchMedia — the page reads viewport width via useIsNarrow
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

const mockUseExpenses = vi.fn();
const mockUseIncome = vi.fn();

vi.mock('../hooks/useApi.js', () => ({
  useExpenses: (...args: any[]) => mockUseExpenses(...args),
  useIncome: (...args: any[]) => mockUseIncome(...args),
  useBudgetItems: () => ({ data: [] }),
  useAccounts: () => ({ data: [] }),
  useDebts: () => ({ data: [] }),
  useCreateExpense: () => ({ mutate: vi.fn() }),
  useUpdateExpense: () => ({ mutate: vi.fn() }),
  useDeleteExpense: () => ({ mutate: vi.fn() }),
  useArchiveExpense: () => ({ mutate: vi.fn() }),
  useRestoreExpense: () => ({ mutate: vi.fn() }),
  useCreateIncome: () => ({ mutate: vi.fn() }),
  useUpdateIncome: () => ({ mutate: vi.fn() }),
  useDeleteIncome: () => ({ mutate: vi.fn() }),
  useArchiveIncome: () => ({ mutate: vi.fn() }),
  useRestoreIncome: () => ({ mutate: vi.fn() }),
  DebtRecord: {},
}));

vi.mock('../lib/api.js', () => ({
  api: {
    expenses: { pause: vi.fn(), resume: vi.fn() },
    income: { pause: vi.fn(), resume: vi.fn() },
  },
}));

/**
 * The drawer, stubbed down to the two things the page owns: whether it is open,
 * and the hook it hands over.
 *
 * Driving the real ExpenseForm to a valid submit (name, amount, frequency,
 * budget, due day) would make this a test of the form rather than of the page's
 * open-state wiring, and would break on any unrelated field change. A save
 * closes the drawer by calling the form hook's `closeForm` — the create
 * mutation passes exactly that as its `onSuccess` — so calling it here
 * reproduces the post-save state precisely.
 */
vi.mock('./recurring/RecurringFormDrawer.js', () => ({
  default: ({ open, expenseForm }: { open: boolean; expenseForm: { closeForm: () => void } }) =>
    open ? (
      <div>
        <span>DRAWER_OPEN</span>
        <button type="button" onClick={() => expenseForm.closeForm()}>
          simulate successful save
        </button>
      </div>
    ) : null,
}));

import RecurringPage from './Recurring.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Recurring Page — with data', () => {
  beforeEach(() => {
    mockUseExpenses.mockImplementation((params?: { archived?: string }) => {
      if (params?.archived === 'true') return { data: [], isLoading: false };
      return {
        data: [
          {
            id: 'exp-1',
            name: 'Mortgage',
            amount: 1099,
            frequency: 'MONTHLY',
            budgetId: null,
            accountId: null,
            isAutomatic: true,
            skipWeekend: false,
            dueDay: 1,
            dueWeekday: null,
            dueOrdinal: null,
            amountSchedule: null,
            startDate: null,
            endDate: null,
            note: null,
            pausedUntil: null,
            linkedDebtId: null,
            archivedAt: null,
            managementUrl: null,
          },
        ],
        isLoading: false,
      };
    });
    mockUseIncome.mockImplementation((params?: { archived?: string }) => {
      if (params?.archived === 'true') return { data: [], isLoading: false };
      return {
        data: [
          {
            id: 'inc-1',
            name: 'Paycheck',
            amount: 5000,
            frequency: 'BIWEEKLY',
            budgetId: null,
            accountId: null,
            amountSchedule: null,
            startDate: null,
            endDate: null,
            note: null,
            pausedUntil: null,
            archivedAt: null,
            managementUrl: null,
          },
        ],
        isLoading: false,
      };
    });
  });

  it('renders expense and income items', () => {
    render(<RecurringPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
  });

  it('shows Add Recurring button', () => {
    render(<RecurringPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add Recurring')).toBeInTheDocument();
  });
});

describe('Recurring Page — empty state', () => {
  beforeEach(() => {
    mockUseExpenses.mockReturnValue({ data: [], isLoading: false });
    mockUseIncome.mockReturnValue({ data: [], isLoading: false });
  });

  it('shows empty state when no recurring items exist', () => {
    render(<RecurringPage />, { wrapper: createWrapper() });
    expect(
      screen.getByText('No recurring items — add an expense or income to get started'),
    ).toBeInTheDocument();
  });

  it('shows Add Recurring button in empty state', () => {
    render(<RecurringPage />, { wrapper: createWrapper() });
    // Both the page header and empty state have the Add button
    const buttons = screen.getAllByRole('button', { name: /Add Recurring/ });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The drawer's open state must have exactly one owner: the form hooks.
 *
 * It used to have two. The header's "Add Recurring" button set a page-level
 * `showCreateForm` flag *and* called `expenseForm.openCreate()`, and `open` was
 * the OR of both — but a successful save only runs the hook's own `closeForm`.
 * Nothing ever cleared the page flag, so the drawer stayed open over a record it
 * had already created. Editing was unaffected (it never set the flag), which is
 * why this only ever showed up on create.
 */
describe('Recurring Page — drawer open state', () => {
  beforeEach(() => {
    // A non-empty list on purpose: the empty state renders a SECOND "Add
    // Recurring" button, and that one only calls `openCreate()`. It was never
    // affected by this bug, so testing against it would pass either way.
    mockUseExpenses.mockImplementation((params?: { archived?: string }) =>
      params?.archived === 'true'
        ? { data: [], isLoading: false }
        : {
            data: [
              {
                id: 'exp-1',
                name: 'Mortgage',
                amount: 1099,
                frequency: 'MONTHLY',
                budgetId: null,
                accountId: null,
                isAutomatic: true,
                skipWeekend: false,
                dueDay: 1,
                dueWeekday: null,
                dueOrdinal: null,
                amountSchedule: null,
                startDate: null,
                endDate: null,
                note: null,
                pausedUntil: null,
                linkedDebtId: null,
                archivedAt: null,
                managementUrl: null,
              },
            ],
            isLoading: false,
          },
    );
    mockUseIncome.mockReturnValue({ data: [], isLoading: false });
  });

  it('opens the drawer from the header button', async () => {
    const user = userEvent.setup();
    render(<RecurringPage />, { wrapper: createWrapper() });
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();

    await user.click(screen.getByRole('button', { name: /add recurring/i }));
    expect(screen.getByText('DRAWER_OPEN')).toBeTruthy();
  });

  it('closes the drawer when the form closes after a successful save', async () => {
    const user = userEvent.setup();
    render(<RecurringPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('button', { name: /add recurring/i }));
    expect(screen.getByText('DRAWER_OPEN')).toBeTruthy();

    // Exactly what the create mutation's onSuccess does.
    await user.click(screen.getByRole('button', { name: /simulate successful save/i }));
    expect(screen.queryByText('DRAWER_OPEN')).toBeNull();
  });
});
