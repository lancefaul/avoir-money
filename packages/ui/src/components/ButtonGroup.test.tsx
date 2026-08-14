import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ButtonGroup } from './ButtonGroup.js';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('ButtonGroup', () => {
  it('renders with role="radiogroup" and each option with role="radio"', () => {
    render(<ButtonGroup options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('selected option has aria-checked="true" and others have aria-checked="false"', () => {
    render(<ButtonGroup options={options} value="b" onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[2]).toHaveAttribute('aria-checked', 'false');
  });

  it('right arrow key moves focus to next option and fires onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ButtonGroup options={options} value="a" onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    radios[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('left arrow key on first option wraps to last option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ButtonGroup options={options} value="a" onChange={onChange} />);
    const radios = screen.getAllByRole('radio');
    radios[0]!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('c');
  });
});
