import { render, screen } from '@testing-library/react';
import { RadioGroup } from './RadioGroup.js';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('RadioGroup', () => {
  it('renders all options and the selected one is checked', () => {
    render(<RadioGroup options={options} value="b" onChange={() => {}} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);

    // Labels are visible
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();

    // Selected option is checked, others are not
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).toBeChecked();
    expect(radios[2]).not.toBeChecked();

    // aria-checked mirrors checked state
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[2]).toHaveAttribute('aria-checked', 'false');
  });

  it('renders with role="radiogroup" on the container', () => {
    render(<RadioGroup options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });
});
