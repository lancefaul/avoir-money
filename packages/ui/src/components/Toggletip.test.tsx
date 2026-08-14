import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggletip } from './Toggletip.js';

describe('Toggletip', () => {
  it('click toggle shows/hides toggletip content', async () => {
    const user = userEvent.setup();
    render(
      <Toggletip trigger={<button type="button">Toggle me</button>}>
        <p>Info text</p>
      </Toggletip>,
    );

    const trigger = screen.getByRole('button', { name: 'Toggle me' });

    // Initially hidden
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Click to show
    await user.click(trigger);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Info text');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Click again to hide
    await user.click(trigger);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
