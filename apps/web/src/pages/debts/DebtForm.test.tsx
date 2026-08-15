import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../../test/wrapper.js';
import type { DebtRecord } from '../../hooks/useDebts.js';

// ─── Mocks ───

const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();
const mockCreateEscrowMutate = vi.fn();

vi.mock('../../hooks/useApi.js', () => ({
  useCreateDebt: () => ({ mutate: mockCreateMutate, isPending: false }),
  useUpdateDebt: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useCreateEscrowRecord: () => ({ mutate: mockCreateEscrowMutate, isPending: false }),
  useEscrowHistory: () => ({ data: undefined }),
}));

import DebtForm from './DebtForm.js';

// ─── Helpers ───

const accounts = [
  { id: 'acc-1', name: 'Chase Checking' },
  { id: 'acc-2', name: 'Savings' },
];

const expenses = [
  { id: 'exp-1', name: 'Mortgage Payment' },
  { id: 'exp-2', name: 'Car Payment' },
];

function makeDebt(overrides?: Partial<DebtRecord>): DebtRecord {
  return {
    id: 'debt-1',
    name: 'Home Mortgage',
    type: 'MORTGAGE',
    originalBalance: 300000,
    currentBalance: 250000,
    apr: 6.5,
    minimumPayment: 1900,
    frequency: 'MONTHLY',
    startDate: '2022-01-15T00:00:00.000Z',
    maturityDate: '2052-01-15T00:00:00.000Z',
    termMonths: 360,
    linkedAccountId: 'acc-1',
    linkedExpenseId: 'exp-1',
    note: 'Primary residence',
    managementUrl: 'https://bank.com/manage',
    escrowEnabled: false,
    createdAt: '2022-01-01T00:00:00.000Z',
    updatedAt: '2022-06-01T00:00:00.000Z',
    ...overrides,
  } as DebtRecord;
}

// ─── Tests ───

describe('DebtForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('renders correctly', () => {
    it('renders section headings', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Debt Information')).toBeInTheDocument();
      expect(screen.getByText('Loan Terms')).toBeInTheDocument();
      expect(screen.getByText('Payment Information')).toBeInTheDocument();
      expect(screen.getByText('Additional Information')).toBeInTheDocument();
    });

    it('renders the name input field', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('textbox', { name: /Name/ })).toBeInTheDocument();
    });

    it('shows Add button in add mode', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    it('shows Save button in edit mode', () => {
      render(
        <DebtForm editing={makeDebt()} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('shows Cancel button', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  describe('escrow toggle', () => {
    it('shows escrow toggle when type is MORTGAGE', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      // Default type is MORTGAGE so the escrow toggle label should be visible
      expect(screen.getByText('Enable escrow for this debt')).toBeInTheDocument();
    });

    it('shows escrow fields when toggle is enabled', async () => {
      const user = userEvent.setup();

      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('Monthly Escrow Amount')).toBeInTheDocument();
        expect(screen.getByText('Period Start Date')).toBeInTheDocument();
        expect(screen.getByText('Period End Date')).toBeInTheDocument();
      });
    });

    it('hides escrow fields when toggle is disabled', async () => {
      const user = userEvent.setup();

      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      await waitFor(() => {
        expect(screen.getByText('Monthly Escrow Amount')).toBeInTheDocument();
      });

      await user.click(toggle);

      await waitFor(() => {
        expect(screen.queryByText('Monthly Escrow Amount')).not.toBeInTheDocument();
      });
    });
  });

  describe('form population from editing prop', () => {
    it('populates name from editing debt record', () => {
      const debt = makeDebt();

      render(
        <DebtForm editing={debt} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Home Mortgage');
    });

    it('shows heading "Edit Debt" when editing', () => {
      render(
        <DebtForm editing={makeDebt()} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Edit Debt')).toBeInTheDocument();
    });

    it('shows heading "Add Debt" when creating', () => {
      render(
        <DebtForm editing={null} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Add Debt')).toBeInTheDocument();
    });

    it('hides escrow toggle for non-mortgage type', () => {
      const debt = makeDebt({ type: 'AUTO_LOAN', name: 'Car Loan' });

      render(
        <DebtForm editing={debt} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.queryByText('Enable Escrow')).not.toBeInTheDocument();
    });

    it('populates note field from editing', () => {
      const debt = makeDebt();

      render(
        <DebtForm editing={debt} accounts={accounts} expenses={expenses} onClose={vi.fn()} />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByRole('textbox', { name: /Note/ })).toHaveValue('Primary residence');
    });
  });
});
