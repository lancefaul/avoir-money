import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrencyInput } from './CurrencyInput.js';

describe('CurrencyInput', () => {
  it('value={0} displays placeholder or empty value', () => {
    // Without a custom placeholder, value=0 shows the formatted zero "0.00"
    render(<CurrencyInput value={0} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', '0.00');

    // With a custom placeholder, value=0 shows empty string so the placeholder is visible
    const { unmount } = render(<CurrencyInput value={0} placeholder="Enter amount" />);
    const inputWithPlaceholder = screen.getAllByRole('textbox')[1];
    expect(inputWithPlaceholder).toHaveValue('');
    expect(inputWithPlaceholder).toHaveAttribute('placeholder', 'Enter amount');
    unmount();
  });

  it('digit key presses 1,2,3,4,5 fire onChange with 12345 and display shows 123.45', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<CurrencyInput value={0} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    input.focus();

    // Press digits 1 through 5, rerendering with the new value each time
    let currentValue = 0;
    for (const digit of ['1', '2', '3', '4', '5']) {
      await user.keyboard(digit);
      currentValue = currentValue * 10 + parseInt(digit, 10);
      rerender(<CurrencyInput value={currentValue} onChange={onChange} />);
    }

    // After pressing 1,2,3,4,5 the accumulated value should be 12345 cents
    expect(onChange).toHaveBeenLastCalledWith(12345);
    // The display should show 123.45
    expect(input).toHaveValue('123.45');
  });

  it('Backspace removes last digit via integer division by 10', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<CurrencyInput value={12345} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    input.focus();

    await user.keyboard('{Backspace}');
    expect(onChange).toHaveBeenCalledWith(1234);

    rerender(<CurrencyInput value={1234} onChange={onChange} />);
    expect(input).toHaveValue('12.34');
  });

  it('non-digit, non-Backspace keys do not change value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CurrencyInput value={500} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    input.focus();

    await user.keyboard('a');
    await user.keyboard('!');
    await user.keyboard('{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('custom prefix and suffix are visible', () => {
    render(<CurrencyInput value={100} prefix="€" suffix="EUR" />);
    expect(screen.getByText('€')).toBeInTheDocument();
    expect(screen.getByText('EUR')).toBeInTheDocument();
  });

  it('decimals={8} formats with 8 decimal places', () => {
    render(<CurrencyInput value={123} decimals={8} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('0.00000123');
  });

  /**
   * Off by default because most money fields here are magnitudes whose sign is
   * carried by the transaction type — letting those go negative would invert a
   * charge. Genuinely signed figures need it: a credit card's balance is
   * negative in this ledger, so a statement's ending balance cannot be entered
   * without it.
   */
  describe('allowNegative', () => {
    it('ignores a leading minus by default', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<CurrencyInput value={0} onChange={onChange} />);
      screen.getByRole('textbox').focus();

      await user.keyboard('-5');
      expect(onChange).toHaveBeenLastCalledWith(5);
    });

    it('renders an incoming negative value', () => {
      render(<CurrencyInput value={-165077} allowNegative />);
      expect(screen.getByRole('textbox')).toHaveValue('-1,650.77');
    });

    it('keeps accumulating digits negatively once seeded negative', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<CurrencyInput value={-1650} onChange={onChange} allowNegative />);
      screen.getByRole('textbox').focus();

      // -16.50 then "7" must give -165.07, not -164.93: digits accumulate on
      // the magnitude, so the sign has to be held separately.
      await user.keyboard('7');
      expect(onChange).toHaveBeenLastCalledWith(-16507);
    });

    it('toggles the sign back off', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<CurrencyInput value={0} onChange={onChange} allowNegative />);
      screen.getByRole('textbox').focus();

      await user.keyboard('--5');
      expect(onChange).toHaveBeenLastCalledWith(5);
    });

    it('lets an expression resolve below zero instead of clamping', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(<CurrencyInput value={0} onChange={onChange} allowNegative />);
      const input = screen.getByRole('textbox');
      input.focus();

      await user.keyboard('200');
      rerender(<CurrencyInput value={200} onChange={onChange} allowNegative />);
      await user.keyboard('-');
      await user.keyboard('500');
      rerender(<CurrencyInput value={500} onChange={onChange} allowNegative />);
      await user.keyboard('{Enter}');

      // 2.00 - 5.00 = -3.00
      expect(onChange).toHaveBeenLastCalledWith(-300);
    });

    it('still clamps an expression to zero when negatives are not allowed', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(<CurrencyInput value={0} onChange={onChange} />);
      const input = screen.getByRole('textbox');
      input.focus();

      await user.keyboard('200');
      rerender(<CurrencyInput value={200} onChange={onChange} />);
      await user.keyboard('-');
      await user.keyboard('500');
      rerender(<CurrencyInput value={500} onChange={onChange} />);
      await user.keyboard('{Enter}');

      expect(onChange).toHaveBeenLastCalledWith(0);
    });
  });
});
