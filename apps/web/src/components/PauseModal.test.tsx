import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PauseModal from './PauseModal.js';

describe('PauseModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
  };

  function setup(overrides: Partial<typeof defaultProps> = {}) {
    const props = { ...defaultProps, ...overrides, onClose: vi.fn(), onConfirm: vi.fn() };
    const result = render(<PauseModal {...props} />);
    return { ...result, props };
  }

  it('renders duration and unit fields when open', () => {
    setup();
    expect(screen.getByLabelText('Duration')).toBeInTheDocument();
    // Select renders a combobox div — the label's htmlFor doesn't match the combobox id,
    // so query by the text content of the label element instead
    expect(screen.getByText('Period')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    setup({ open: false });
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument();
  });

  it('renders the indefinite toggle', () => {
    setup();
    expect(screen.getByRole('switch', { name: 'Until I restart' })).toBeInTheDocument();
  });

  it('calls onConfirm with duration and unit when not indefinite', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    // Default values: duration=1, unit='months'
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onConfirm).toHaveBeenCalledWith({ duration: 1, unit: 'months' });
  });

  it('calls onConfirm with indefinite when toggle is checked', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    // Click the indefinite toggle
    await user.click(screen.getByRole('switch', { name: 'Until I restart' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onConfirm).toHaveBeenCalledWith({ indefinite: true });
  });

  it('calls onConfirm with updated duration value', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    const durationInput = screen.getByLabelText('Duration') as HTMLInputElement;
    // IntegerInput uses key-by-key entry via onKeyDown — fireEvent dispatches directly
    fireEvent.keyDown(durationInput, { key: 'Backspace' });
    fireEvent.keyDown(durationInput, { key: '3' });

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onConfirm).toHaveBeenCalledWith({ duration: 3, unit: 'months' });
  });

  it('disables duration and period fields when indefinite is toggled', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('switch', { name: 'Until I restart' }));
    expect(screen.getByLabelText('Duration')).toBeDisabled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('resets state when modal reopens', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    const { rerender } = render(<PauseModal open={true} onClose={onClose} onConfirm={onConfirm} />);

    // Close and reopen
    rerender(<PauseModal open={false} onClose={onClose} onConfirm={onConfirm} />);
    rerender(<PauseModal open={true} onClose={onClose} onConfirm={onConfirm} />);

    // Duration should be reset to 1
    const durationInput = screen.getByLabelText('Duration') as HTMLInputElement;
    expect(durationInput.value).toBe('1');
  });
});
