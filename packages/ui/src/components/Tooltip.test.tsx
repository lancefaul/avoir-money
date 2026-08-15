import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './Tooltip.js';

describe('Tooltip', () => {
  // Regression: a rapid re-trigger (hover then focus) used to leak the first
  // open-delay setTimeout — timerRef only held the latest, so the unmount
  // cleanup couldn't cancel the leaked one. It later fired setVisible() after
  // the test env was torn down, throwing "window is not defined" in a LATER
  // test file. show() must clear the pending timer before scheduling a new one.
  it('leaves no pending open-timer after unmount even when re-triggered', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <Tooltip content="Help">
          <button type="button">Hover me</button>
        </Tooltip>,
      );
      const span = screen.getByRole('button', { name: 'Hover me' }).parentElement!;

      // Arm the open-delay timer twice without letting it fire (the leak path).
      fireEvent.mouseEnter(span);
      fireEvent.focus(span);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();

      // No timer may survive to call setVisible() after teardown.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('mouseenter shows tooltip with role="tooltip"', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Help text">
        <button type="button">Hover me</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole('button', { name: 'Hover me' }));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Help text');
  });

  it('mouseleave removes tooltip', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Disappearing text">
        <button type="button">Hover me</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Hover me' });
    await user.hover(trigger);
    await screen.findByRole('tooltip');

    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('focus shows tooltip', async () => {
    render(
      <Tooltip content="Focus text">
        <button type="button">Focus me</button>
      </Tooltip>,
    );

    act(() => {
      screen.getByRole('button', { name: 'Focus me' }).focus();
    });

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Focus text');
  });

  it('blur removes tooltip', async () => {
    render(
      <Tooltip content="Blur text">
        <button type="button">Focus me</button>
      </Tooltip>,
    );

    const trigger = screen.getByRole('button', { name: 'Focus me' });
    act(() => {
      trigger.focus();
    });
    await screen.findByRole('tooltip');

    act(() => {
      trigger.blur();
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
