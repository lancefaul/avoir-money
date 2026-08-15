import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createWrapper } from '../test/wrapper.js';
import { useUIStore } from '../store/ui.js';

/**
 * jsdom has no matchMedia — mock it per the Investments.test.tsx convention.
 * `mockViewportWidth(w)` makes useIsNarrow behave as if the viewport were
 * w px wide: a `(max-width: Npx)` query matches when w <= N.
 */
function mockViewportWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const m = /\(max-width:\s*([\d.]+)px\)/.exec(query);
      const max = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      return {
        matches: width <= max,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

beforeEach(() => {
  mockViewportWidth(1280);
});

const mockUseBudgetItems = vi.fn();
const mockUseBudgetItemGroups = vi.fn();
const mockUseActivePlan = vi.fn();
const mockUseBudgets = vi.fn();

vi.mock('../hooks/useBudgetItems.js', () => ({
  useBudgetItems: (...args: any[]) => mockUseBudgetItems(...args),
  useBudgetItemGroups: (...args: any[]) => mockUseBudgetItemGroups(...args),
  useCreateBudgetItem: () => ({ mutate: vi.fn() }),
  useUpdateBudgetItem: () => ({ mutate: vi.fn() }),
  useDeleteBudgetItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useReassignBudgetItem: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBudgetItemGroup: () => ({ mutate: vi.fn() }),
  useUpdateBudgetItemGroup: () => ({ mutate: vi.fn() }),
  useDeleteBudgetItemGroup: () => ({ mutate: vi.fn() }),
}));

vi.mock('../hooks/useBudgets.js', () => ({
  useActivePlan: (...args: any[]) => mockUseActivePlan(...args),
  useBudgets: (...args: any[]) => mockUseBudgets(...args),
}));

vi.mock('../hooks/useApi.js', () => ({
  useCurrentPeriod: () => ({ data: undefined, isLoading: false }),
}));

// Mock sub-components that have their own tests
vi.mock('./budgets/BudgetItemForm.js', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="budget-item-form">
      <h2>Add Budget</h2>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock('./budgets/BudgetItemDeleteDialog.js', () => ({
  default: () => <div data-testid="budget-item-delete-dialog" />,
}));

vi.mock('./budgets/YearPlanModal.js', () => ({
  default: () => <div data-testid="year-plan-modal" />,
}));

import BudgetsPage from './Budgets.js';

// ── Default mock data ──────────────────────────────────────────────────────
const budgetItemsData = [
  {
    id: 'c1',
    name: 'Mortgage',
    groupId: 'g1',
    groupName: 'HOUSING',
    groupColor: '#3b82f6',
    icon: '🏠',
    isCustom: false,
  },
  {
    id: 'c2',
    name: 'Groceries',
    groupId: 'g2',
    groupName: 'FOOD',
    groupColor: '#10b981',
    icon: '🛒',
    isCustom: true,
  },
  {
    id: 'c3',
    name: 'Uncategorized',
    groupId: 'g1',
    groupName: 'HOUSING',
    groupColor: '#3b82f6',
    icon: null,
    isCustom: false,
  },
];

const budgetGroupsData = [
  { id: 'g1', name: 'HOUSING', color: '#3b82f6' },
  { id: 'g2', name: 'FOOD', color: '#10b981' },
];

const activePlanData = {
  data: { id: 'plan-1', year: 2026, status: 'ACTIVE', versions: [] },
  currentYearPlan: { id: 'plan-1', year: 2026, status: 'ACTIVE', versions: [] },
};

const budgetsData = [
  {
    id: 'b1',
    budgetItemId: 'c1',
    budgetItemName: 'Mortgage',
    groupId: 'g1',
    groupName: 'HOUSING',
    groupColor: '#3b82f6',
    groupEmoji: null,
    emoji: '🏠',
    amount: 2000,
    frequency: 'MONTHLY',
    actual: 1800,
  },
  {
    id: 'b2',
    budgetItemId: 'c2',
    budgetItemName: 'Groceries',
    groupId: 'g2',
    groupName: 'FOOD',
    groupColor: '#10b981',
    groupEmoji: null,
    emoji: '🛒',
    amount: 500,
    frequency: 'MONTHLY',
    actual: 450,
  },
];

beforeEach(() => {
  mockUseBudgetItems.mockReturnValue({ data: budgetItemsData });
  mockUseBudgetItemGroups.mockReturnValue({ data: budgetGroupsData });
  mockUseActivePlan.mockReturnValue(activePlanData);
  mockUseBudgets.mockReturnValue({ data: budgetsData });
});

describe('Budgets Page', () => {
  it('renders category groups', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText(/HOUSING/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/FOOD/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders categories within groups', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    // Budget names appear in card layout (emoji and name may be separate elements)
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
  });

  it('renders category icons', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    // Emoji icons rendered as badge elements
    expect(screen.getByText('🏠')).toBeInTheDocument();
    expect(screen.getByText('🛒')).toBeInTheDocument();
  });

  it('shows Add Budget button', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add Budget')).toBeInTheDocument();
  });

  it('shows Add Group button', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add Group')).toBeInTheDocument();
  });

  it('shows plan year in page context', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    // With active plan mocked, the page should render budget content (no empty state)
    expect(screen.getByText('HOUSING')).toBeInTheDocument();
  });

  it('opens add budget form', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('Add Budget'));
    expect(screen.getByTestId('budget-item-form')).toBeInTheDocument();
  });

  it('opens new group form', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByText('Add Group'));
    expect(screen.getByText('Add Budget Group')).toBeInTheDocument();
  });

  it('has a sort & view filter icon button', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'Sort & view options' })).toBeInTheDocument();
  });

  it('collapses Add Group / Add Budget to icon buttons below 540px', () => {
    mockViewportWidth(500);
    render(<BudgetsPage />, { wrapper: createWrapper() });
    // Text labels gone, but the buttons stay reachable by accessible name
    expect(screen.queryByText('Add Group')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Budget')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Budget' })).toBeInTheDocument();
  });

  it('lists sort and view options with defaults checked when the menu opens', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'Sort & view options' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Most Spent %' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Pay Period' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Monthly' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('sets category count in page title via store', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    // pageTitle is a ReactNode (JSX element), verify it's truthy (set by PageHeader)
    expect(useUIStore.getState().pageTitle).toBeTruthy();
  });
});

describe('Budgets Page — empty state (no year plan)', () => {
  beforeEach(() => {
    mockUseActivePlan.mockReturnValue({
      data: undefined,
      currentYearPlan: undefined,
    });
    mockUseBudgets.mockReturnValue({ data: [] });
  });

  it('shows empty state prompting to create a year plan', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Set up a year plan to start tracking budgets')).toBeInTheDocument();
  });

  it('shows Create Plan button in empty state', () => {
    render(<BudgetsPage />, { wrapper: createWrapper() });
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeInTheDocument();
  });
});
