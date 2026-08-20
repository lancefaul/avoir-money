import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PolicyFormModal from './PolicyFormModal.js';
import type { InsurancePolicyWithBalance } from '@budget-tracker/core';

function makePolicy(
  overrides: Partial<InsurancePolicyWithBalance> = {},
): InsurancePolicyWithBalance {
  return {
    id: 'pol_1',
    type: 'MEDICAL',
    year: 2026,
    employer: 'Acme Corp',
    premium: 250,
    deductibleLimit: 3000,
    oopmLimit: 6000,
    status: 'ACTIVE',
    endedOn: null,
    closedOn: null,
    deductibleOverride: false,
    oopmOverride: false,
    metadata: {
      insurer: 'Blue Cross',
      policyId: 'BC-123',
      groupNumber: 'GRP-456',
    },
    budgetId: 'bud_1',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    balance: {
      deductibleSpent: 500,
      deductibleRaw: 500,
      deductibleLimit: 3000,
      oopmSpent: 800,
      oopmRaw: 800,
      oopmLimit: 6000,
      deductibleOverride: false,
      oopmOverride: false,
    },
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof PolicyFormModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();

  const result = render(
    <PolicyFormModal open={true} onClose={onClose} onSubmit={onSubmit} {...props} />,
  );

  return { onClose, onSubmit, user, ...result };
}

describe('PolicyFormModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('renders policy fields', () => {
    it('renders year, employer, premium labels and section headings', () => {
      setup();

      expect(screen.getByText('Plan Terms')).toBeInTheDocument();
      expect(screen.getByText('Policy Details')).toBeInTheDocument();
      expect(screen.getByLabelText(/Year/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Employer/)).toBeInTheDocument();
    });

    it('renders "Add Insurance Policy" title for create mode', () => {
      setup();
      expect(screen.getByText('Add Insurance Policy')).toBeInTheDocument();
    });

    it('renders "Edit Insurance Policy" title when editing', () => {
      setup({ policy: makePolicy() });
      expect(screen.getByText('Edit Insurance Policy')).toBeInTheDocument();
    });

    it('renders metadata fields (insurer)', () => {
      setup();
      expect(screen.getByLabelText(/Insurer/)).toBeInTheDocument();
    });

    it('does not render when open is false', () => {
      setup({ open: false });
      expect(screen.queryByText('Add Insurance Policy')).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('disables year field in edit mode', () => {
      setup({ policy: makePolicy() });
      expect(screen.getByLabelText(/Year/)).toBeDisabled();
    });

    it('submits directly without confirmation in edit mode', async () => {
      const { user, onSubmit } = setup({ policy: makePolicy() });

      await user.click(screen.getByRole('button', { name: /Save/ }));

      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe('create mode', () => {
    it('submits directly without confirmation (no auto-freeze)', async () => {
      const { user, onSubmit } = setup();

      const employerInput = screen.getByLabelText(/Employer/);
      await user.clear(employerInput);
      await user.type(employerInput, 'NewCo');

      const insurerInput = screen.getByLabelText(/Insurer/);
      await user.clear(insurerInput);
      await user.type(insurerInput, 'Aetna');

      await user.click(screen.getByRole('button', { name: /Add/ }));

      expect(onSubmit).toHaveBeenCalled();
    });
  });
});
