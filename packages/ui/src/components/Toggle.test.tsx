import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from './Toggle.js';

describe('Toggle', () => {
  it('checked={false} sets aria-checked="false"', () => {
    render(<Toggle checked={false} label="Dark mode" />);
    const toggle = screen.getByRole('switch', { name: 'Dark mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('checked={true} sets aria-checked="true"', () => {
    render(<Toggle checked={true} label="Dark mode" />);
    const toggle = screen.getByRole('switch', { name: 'Dark mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('click fires onChange with toggled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Notifications" />);
    const toggle = screen.getByRole('switch', { name: 'Notifications' });
    await user.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Space key fires onChange with toggled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={true} onChange={onChange} label="Notifications" />);
    const toggle = screen.getByRole('switch', { name: 'Notifications' });
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disabled={true} sets disabled attribute and blocks onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} disabled={true} onChange={onChange} label="Locked" />);
    const toggle = screen.getByRole('switch', { name: 'Locked' });
    expect(toggle).toBeDisabled();
    await user.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('labelPosition="right" renders label after switch in DOM order', () => {
    render(<Toggle checked={false} label="Right label" labelPosition="right" />);
    const toggle = screen.getByRole('switch');
    const label = screen.getByText('Right label');
    // The switch button should come before the label in DOM order
    const parent = toggle.parentElement!;
    const children = Array.from(parent.children);
    const switchIndex = children.indexOf(toggle);
    const labelIndex = children.indexOf(label.closest('div')!);
    expect(switchIndex).toBeLessThan(labelIndex);
  });
});
