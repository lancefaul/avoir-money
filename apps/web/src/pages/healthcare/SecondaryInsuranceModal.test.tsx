import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SecondaryInsuranceModal from './SecondaryInsuranceModal.js';

function setup(open = true) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const user = userEvent.setup();

  const result = render(
    <SecondaryInsuranceModal open={open} onClose={onClose} onConfirm={onConfirm} label="Medical" />,
  );

  return { onClose, onConfirm, user, ...result };
}

describe('SecondaryInsuranceModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders modal title when open', () => {
    setup(true);
    expect(screen.getByText(/Secondary Insurance – Medical/)).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    setup(false);
    expect(screen.queryByText(/Secondary Insurance – Medical/)).not.toBeInTheDocument();
  });

  it('renders instructions and coverage date label', () => {
    setup(true);
    expect(
      screen.getByText(/What date did secondary insurance cover this balance/),
    ).toBeInTheDocument();
    expect(screen.getByText('Coverage Date')).toBeInTheDocument();
  });

  it('renders Confirm and Cancel buttons', () => {
    setup(true);
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
  });

  it('calls onClose when Cancel button is clicked', async () => {
    const { user, onClose } = setup(true);
    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when Confirm is clicked', async () => {
    const { user, onConfirm } = setup(true);
    await user.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Should be called with a date string in YYYY-MM-DD format
    expect(onConfirm.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
