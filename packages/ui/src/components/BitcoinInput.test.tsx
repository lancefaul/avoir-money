import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BitcoinInput } from './BitcoinInput.js';

describe('BitcoinInput', () => {
  it('value={0} displays empty value with BTC placeholder 0.00000000', () => {
    render(<BitcoinInput value={0} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', '0.00000000');
  });

  it('digit key presses accumulate sats value and fire onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<BitcoinInput value={0} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    input.focus();

    let currentValue = 0;
    for (const digit of ['1', '2', '3']) {
      await user.keyboard(digit);
      currentValue = currentValue * 10 + parseInt(digit, 10);
      rerender(<BitcoinInput value={currentValue} onChange={onChange} />);
    }

    // After pressing 1, 2, 3 the accumulated sats value should be 123
    expect(onChange).toHaveBeenLastCalledWith(123);
    // In BTC mode, 123 sats = 0.00000123
    expect(input).toHaveValue('0.00000123');
  });

  it('unit toggle from BTC to sats changes display format without changing underlying value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // 150000000 sats = 1.50000000 BTC
    render(<BitcoinInput value={150_000_000} onChange={onChange} />);
    const input = screen.getByRole('textbox');

    // In BTC mode, should display 1.50000000
    expect(input).toHaveValue('1.50000000');

    // Click the "sats" toggle button to switch to sats mode
    const satsButton = screen.getByRole('radio', { name: 'sats' });
    await user.click(satsButton);

    // In sats mode, should display the whole number with locale formatting
    expect(input).toHaveValue('150,000,000');

    // onChange should NOT have been called — only the display changed
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Backspace removes last digit and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<BitcoinInput value={12345} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    input.focus();

    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(1234);

    rerender(<BitcoinInput value={1234} onChange={onChange} />);
    // 1234 sats in BTC mode = 0.00001234
    expect(input).toHaveValue('0.00001234');
  });
});
