import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox.js';

describe('Checkbox', () => {
  it('checked={false} sets aria-checked="false"', () => {
    render(<Checkbox checked={false} label="Accept" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept' });
    expect(checkbox).toHaveAttribute('aria-checked', 'false');
  });

  it('checked={true} sets aria-checked="true" with check icon visible', () => {
    render(<Checkbox checked={true} label="Accept" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Accept' });
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    // Check icon is rendered as an SVG inside the checkbox box
    const label = checkbox.closest('label')!;
    const svg = label.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('indeterminate={true} sets aria-checked="mixed" with minus icon visible', () => {
    render(<Checkbox checked={false} indeterminate={true} label="Select all" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' });
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    // Minus icon is rendered as an SVG
    const label = checkbox.closest('label')!;
    const svg = label.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('click fires onChange with toggled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Toggle me" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Toggle me' });
    await user.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('disabled={true} sets disabled attribute', () => {
    render(<Checkbox checked={false} disabled={true} label="Disabled" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Disabled' });
    expect(checkbox).toBeDisabled();
  });

  it('standalone={true} renders no label text', () => {
    render(<Checkbox checked={false} standalone={true} label="Hidden label" />);
    expect(screen.queryByText('Hidden label')).not.toBeInTheDocument();
  });

  it('label and helper props render visible text', () => {
    render(<Checkbox checked={false} label="Terms" helper="Read the fine print" />);
    expect(screen.getByText('Terms')).toBeInTheDocument();
    expect(screen.getByText('Read the fine print')).toBeInTheDocument();
  });
});
