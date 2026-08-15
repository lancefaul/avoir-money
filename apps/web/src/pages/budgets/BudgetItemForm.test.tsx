import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetStatusResponse, BudgetExpenseLinkResponse } from '@budget-tracker/core';
import { createWrapper } from '../../test/wrapper.js';

// ─── Mocks ───

const mockCreateBudgetItem = vi.fn();
const mockUpdateBudgetItem = vi.fn();
const mockCreateBudget = vi.fn();
const mockUpdateBudget = vi.fn();
const mockBulkLinkMutate = vi.fn();
const mockUnlinkMutate = vi.fn();

let mockLinkedExpenses: BudgetExpenseLinkResponse[] = [];
let mockAllExpenses: Array<{
  id: string;
  name: string;
  amount: number;
  frequency: string;
  budgetId: string;
  archivedAt: Date | null;
  isLinkedToBudget?: boolean;
}> = [];

vi.mock('../../hooks/useBudgetItems.js', () => ({
  useCreateBudgetItem: () => ({ mutateAsync: mockCreateBudgetItem }),
  useUpdateBudgetItem: () => ({ mutateAsync: mockUpdateBudgetItem }),
}));

vi.mock('../../hooks/useBudgets.js', () => ({
  useCreateBudget: () => ({ mutateAsync: mockCreateBudget }),
  useUpdateBudget: () => ({ mutateAsync: mockUpdateBudget }),
}));

vi.mock('../../hooks/useBudgetLinks.js', () => ({
  useBudgetLinks: () => ({ data: mockLinkedExpenses }),
  useBulkLinkExpenses: () => ({
    mutateAsync: mockBulkLinkMutate,
    mutate: mockBulkLinkMutate,
    isPending: false,
  }),
  useUnlinkExpense: () => ({ mutateAsync: mockUnlinkMutate, mutate: mockUnlinkMutate }),
}));

vi.mock('../../hooks/useExpenses.js', () => ({
  useExpenses: () => ({ data: mockAllExpenses }),
}));

// Mock EmojiPicker from @budget-tracker/ui to render a simple testable input
vi.mock('@budget-tracker/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@budget-tracker/ui')>();
  return {
    ...actual,
    EmojiPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
      <div>
        <label htmlFor="emoji-test-input">Icon</label>
        <input
          id="emoji-test-input"
          aria-label="Icon"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    ),
  };
});

import BudgetItemForm from './BudgetItemForm.js';

// ─── Helpers ───

const groups = [{ id: 'g1', name: 'Housing' }];

function makeBudgetData(overrides?: Partial<BudgetStatusResponse>): BudgetStatusResponse {
  return {
    id: 'budget-1',
    yearPlanId: 'plan-1',
    budgetId: 'c1',
    categoryName: 'Test',
    categoryGroup: 'Housing',
    removedAt: null,
    seasonal: false,
    highWaterMark: 0,
    linkedExpenseCount: 0,
    doneForYear: false,
    version: {
      id: 'ver-1',
      amount: 250,
      frequency: 'MONTHLY',
      monthlyEquivalent: 250,
      activeMonths: [],
      effectiveDate: '2025-03-15T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      manualOverride: false,
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    actualSpending: 100,
    status: 'under',
    ...overrides,
  };
}

function makeLink(overrides?: Partial<BudgetExpenseLinkResponse>): BudgetExpenseLinkResponse {
  return {
    id: 'link-1',
    categoryBudgetId: 'budget-1',
    expenseId: 'exp-1',
    expenseName: 'Netflix',
    expenseAmount: 15.99,
    expenseFrequency: 'MONTHLY',
    monthlyEquivalent: 15.99,
    isPaused: false,
    isArchived: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── Tests ───

describe('BudgetItemForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLinkedExpenses = [];
    mockAllExpenses = [];
  });

  // 1. Budget fields render when yearPlanId is provided
  describe('budget fields visibility', () => {
    it('renders amount, frequency, and effective month when yearPlanId is provided', () => {
      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByLabelText(/^Amount/)).toBeInTheDocument();
      // Frequency and Effective Month use DS Select (combobox) — verify via displayed text
      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText('Frequency')).toBeInTheDocument();
      expect(screen.getByText('Effective Month')).toBeInTheDocument();
    });

    it('hides budget fields when yearPlanId is null', () => {
      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId={null}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByLabelText(/^Amount/)).not.toBeInTheDocument();
      expect(screen.queryByText('Frequency')).not.toBeInTheDocument();
      expect(screen.queryByText('Effective Month')).not.toBeInTheDocument();
    });
  });

  // 2. Editing pre-fills budget fields from version data
  describe('edit mode pre-fills', () => {
    it('pre-fills name, group, and budget fields from editing + budgetData', () => {
      const budgetData = makeBudgetData();

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={budgetData}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      // Category fields
      expect(screen.getByLabelText(/^Name/)).toHaveValue('Rent');
      // Mocked EmojiPicker renders an input with the emoji value
      expect(screen.getByLabelText('Icon')).toHaveValue('🏠');
      // Group is a DS Select (combobox) — verify it shows the selected label
      expect(screen.getByText('Housing')).toBeInTheDocument();

      // Budget fields from version — CurrencyInput displays formatted text
      expect(screen.getByLabelText(/^Amount/)).toHaveValue('250.00');
      // Frequency and Effective Month are DS Selects — verify displayed labels
      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText('March')).toBeInTheDocument();
    });
  });

  // 3. Validation rejects amount ≤ 0
  describe('validation', () => {
    it('shows error when amount is 0', async () => {
      const user = userEvent.setup();

      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      await user.type(screen.getByLabelText(/^Name/), 'Groceries');
      // CurrencyInput starts at 0 (undefined amount) — submitting without entering a value triggers validation
      await user.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(screen.getByText(/amount/i)).toBeInTheDocument();
      });

      expect(mockCreateBudgetItem).not.toHaveBeenCalled();
    });

    it('shows error when amount is not provided', async () => {
      const user = userEvent.setup();

      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      await user.type(screen.getByLabelText(/^Name/), 'Groceries');
      await user.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(screen.getByText(/amount/i)).toBeInTheDocument();
      });

      expect(mockCreateBudgetItem).not.toHaveBeenCalled();
    });
  });

  // 4. Submit creates category then creates budget (sequential API calls)
  describe('submit flow', () => {
    it('creates category then budget on submit', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();

      mockCreateBudgetItem.mockResolvedValue({ id: 'new-cat-id' });
      mockCreateBudget.mockResolvedValue({ id: 'new-budget-id' });

      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={onSave}
        />,
        { wrapper: createWrapper() },
      );

      await user.type(screen.getByLabelText('Icon'), '🛒');
      await user.type(screen.getByLabelText(/^Name/), 'Groceries');
      // CurrencyInput: type '15000' → 15000 cents → $150.00
      const amountInput = screen.getByLabelText(/^Amount/);
      await user.type(amountInput, '15000');
      await user.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(mockCreateBudgetItem).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Groceries', groupId: 'g1' }),
        );
      });

      await waitFor(() => {
        expect(mockCreateBudget).toHaveBeenCalledWith(
          expect.objectContaining({
            yearPlanId: 'plan-1',
            budgetId: 'new-cat-id',
            amount: 150,
            frequency: 'MONTHLY',
          }),
        );
      });

      // createCategory is called before createBudget
      const catCallOrder = mockCreateBudgetItem.mock.invocationCallOrder[0]!;
      const budgetCallOrder = mockCreateBudget.mock.invocationCallOrder[0]!;
      expect(catCallOrder).toBeLessThan(budgetCallOrder);

      expect(onSave).toHaveBeenCalled();
    });

    it('updates category and budget in edit mode with existing budget', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const budgetData = makeBudgetData();

      mockUpdateBudgetItem.mockResolvedValue({});
      mockUpdateBudget.mockResolvedValue({});

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={budgetData}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={onSave}
        />,
        { wrapper: createWrapper() },
      );

      // CurrencyInput: clear with repeated Backspace, then type new value
      const amountInput = screen.getByLabelText(/^Amount/);
      // Amount is pre-filled with 250.00 (25000 cents) — 5 digits to clear
      await user.type(amountInput, '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}');
      await user.type(amountInput, '30000');
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockUpdateBudgetItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
      });

      await waitFor(() => {
        expect(mockUpdateBudget).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'budget-1',
            body: expect.objectContaining({ amount: 300 }),
          }),
        );
      });

      expect(onSave).toHaveBeenCalled();
    });

    it('skips budget creation when yearPlanId is null', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();

      mockCreateBudgetItem.mockResolvedValue({ id: 'new-cat-id' });

      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId={null}
          onClose={vi.fn()}
          onSave={onSave}
        />,
        { wrapper: createWrapper() },
      );

      await user.type(screen.getByLabelText('Icon'), '📦');
      await user.type(screen.getByLabelText(/^Name/), 'Misc');
      await user.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(mockCreateBudgetItem).toHaveBeenCalled();
      });

      expect(mockCreateBudget).not.toHaveBeenCalled();
      expect(onSave).toHaveBeenCalled();
    });

    it('does not close form when budget creation fails (409)', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();

      mockCreateBudgetItem.mockResolvedValue({ id: 'new-cat-id' });
      mockCreateBudget.mockRejectedValue(new Error('Budget already exists'));

      render(
        <BudgetItemForm
          editing={null}
          budgetData={null}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={onSave}
        />,
        { wrapper: createWrapper() },
      );

      await user.type(screen.getByLabelText('Icon'), '🛒');
      await user.type(screen.getByLabelText(/^Name/), 'Groceries');
      const amountInput = screen.getByLabelText(/^Amount/);
      await user.type(amountInput, '15000');
      await user.click(screen.getByRole('button', { name: /^add$/i }));

      await waitFor(() => {
        expect(mockCreateBudget).toHaveBeenCalled();
      });

      // onSave should NOT be called because the budget creation failed
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  // 5. LinkExpensesSection rendering
  describe('Link Expenses section', () => {
    it('renders eligible expenses with name, amount, frequency, and monthly equivalent', () => {
      mockAllExpenses = [
        {
          id: 'exp-1',
          name: 'Netflix',
          amount: 15.99,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
        {
          id: 'exp-2',
          name: 'Gym',
          amount: 50,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Linked Expenses')).toBeInTheDocument();
      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.getByText('Gym')).toBeInTheDocument();
    });

    it('excludes archived and ONE_TIME expenses from eligible list', () => {
      mockAllExpenses = [
        {
          id: 'exp-1',
          name: 'Active',
          amount: 10,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
        {
          id: 'exp-2',
          name: 'Archived',
          amount: 20,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: new Date(),
          isLinkedToBudget: false,
        },
        {
          id: 'exp-3',
          name: 'OneTime',
          amount: 30,
          frequency: 'ONE_TIME',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.queryByText('Archived')).not.toBeInTheDocument();
      expect(screen.queryByText('OneTime')).not.toBeInTheDocument();
    });

    it('excludes already-linked expenses from eligible list', () => {
      mockLinkedExpenses = [makeLink({ expenseId: 'exp-1', expenseName: 'Netflix' })];
      mockAllExpenses = [
        {
          id: 'exp-1',
          name: 'Netflix',
          amount: 15.99,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
        {
          id: 'exp-2',
          name: 'Gym',
          amount: 50,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      // Netflix is in the linked panel (excluded from eligible via linkedExpenseIds Set).
      // Gym should still appear in the link table.
      expect(screen.getByText('Gym')).toBeInTheDocument();
      // Netflix appears in the LinkedExpensesPanel, not in the eligible link buttons
      expect(screen.queryByRole('button', { name: /Link Netflix/ })).not.toBeInTheDocument();
    });

    it('stages selected expenses and commits on save', async () => {
      const user = userEvent.setup();
      mockAllExpenses = [
        {
          id: 'exp-1',
          name: 'Netflix',
          amount: 15.99,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
        {
          id: 'exp-2',
          name: 'Gym',
          amount: 50,
          frequency: 'MONTHLY',
          budgetId: 'c1',
          archivedAt: null,
          isLinkedToBudget: false,
        },
      ];

      mockUpdateBudgetItem.mockResolvedValue({});
      mockUpdateBudget.mockResolvedValue({});
      mockBulkLinkMutate.mockResolvedValue({ results: [] });

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      // LinkExpensesSection uses IconButtons with aria-label "Link <name>"
      await user.click(screen.getByRole('button', { name: /Link Netflix/ }));
      await user.click(screen.getByRole('button', { name: /Link Gym/ }));

      // Bulk link should NOT be called yet (staged only)
      expect(mockBulkLinkMutate).not.toHaveBeenCalled();

      // Save commits the staged links
      await user.click(screen.getByRole('button', { name: /^save$/i }));

      await waitFor(() => {
        expect(mockBulkLinkMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            categoryBudgetId: 'budget-1',
            expenseIds: expect.arrayContaining(['exp-1', 'exp-2']),
          }),
        );
      });
    });
  });

  // 6. LinkedExpensesPanel and derived baseline
  describe('Linked Expenses panel', () => {
    it('displays linked expenses with monthly equivalents and committed baseline', () => {
      mockLinkedExpenses = [
        makeLink({
          id: 'link-1',
          expenseName: 'Netflix',
          expenseAmount: 15.99,
          monthlyEquivalent: 15.99,
          expenseFrequency: 'MONTHLY',
        }),
        makeLink({
          id: 'link-2',
          expenseId: 'exp-2',
          expenseName: 'Gym',
          expenseAmount: 50,
          monthlyEquivalent: 50,
          expenseFrequency: 'MONTHLY',
        }),
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Linked Expenses')).toBeInTheDocument();
      expect(screen.getByText('Netflix')).toBeInTheDocument();
      expect(screen.getByText('Gym')).toBeInTheDocument();
      // Committed baseline = 15.99 + 50 = 65.99, displayed as "$65.99/mo"
      expect(screen.getByText('Committed')).toBeInTheDocument();
      expect(screen.getByText(/\$65\.99/)).toBeInTheDocument();
    });

    it('displays paused expenses with status label', () => {
      mockLinkedExpenses = [
        makeLink({ id: 'link-1', expenseName: 'Active Sub', isPaused: false, isArchived: false }),
        makeLink({
          id: 'link-2',
          expenseId: 'exp-2',
          expenseName: 'Paused Sub',
          isPaused: true,
          isArchived: false,
        }),
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Paused')).toBeInTheDocument();
      // The paused row uses inline style opacity: 0.5
      const pausedRow = screen.getByText('Paused Sub').closest('tr');
      expect(pausedRow).toHaveStyle({ opacity: '0.5' });
    });

    it('displays archived expenses with status label', () => {
      mockLinkedExpenses = [
        makeLink({ id: 'link-1', expenseName: 'Active Sub', isPaused: false, isArchived: false }),
        makeLink({
          id: 'link-2',
          expenseId: 'exp-2',
          expenseName: 'Old Sub',
          isPaused: false,
          isArchived: true,
        }),
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Archived')).toBeInTheDocument();
      const archivedRow = screen.getByText('Old Sub').closest('tr');
      expect(archivedRow).toHaveStyle({ opacity: '0.5' });
    });
  });

  // 7. Manual override indicator
  describe('manual override', () => {
    it('does not show override badge when no expenses are linked', () => {
      mockLinkedExpenses = [];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData()}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByText('Manual override')).not.toBeInTheDocument();
      expect(screen.queryByText('Reset to derived')).not.toBeInTheDocument();
    });

    it('renders the committed baseline in LinkedExpensesPanel when expenses are linked', async () => {
      mockLinkedExpenses = [
        makeLink({ monthlyEquivalent: 100, expenseAmount: 100, expenseFrequency: 'MONTHLY' }),
      ];

      render(
        <BudgetItemForm
          editing={{ id: 'c1', name: 'Rent', icon: '🏠', groupId: 'g1' }}
          budgetData={makeBudgetData({ highWaterMark: 100 })}
          groups={groups}
          yearPlanId="plan-1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
        { wrapper: createWrapper() },
      );

      // LinkedExpensesPanel renders with committed baseline
      await waitFor(() => {
        expect(screen.getByText('Committed')).toBeInTheDocument();
      });
      expect(screen.getAllByText(/\$100\.00/).length).toBeGreaterThan(0);
    });
  });
});
