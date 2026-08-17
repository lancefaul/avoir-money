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

/**
 * Repositioning when the tooltip's own size changes while it is open.
 *
 * `useAnchorPosition` measures both rects once and only re-runs on `visible` or
 * its options, so a tooltip whose content changes mid-hover kept coordinates
 * computed for its previous width. `x` is derived from the tip's half-width and
 * then clamped against the viewport using that same stale width, which is why
 * the error is invisible mid-screen and obvious at an edge.
 *
 * Reported from the title bar's privacy toggle: hover, click, do not move the
 * pointer, and the relabelled tooltip hangs off to one side.
 */
describe('Tooltip repositioning', () => {
  let observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];

  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = class {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push({ cb, targets: [] });
      }
      observe(el: Element) {
        observers[observers.length - 1]!.targets.push(el);
      }
      unobserve() {}
      disconnect() {}
      // jsdom has no ResizeObserver, so it is stubbed. The cast is unavoidable
      // and confined to a test: a hand-written double cannot satisfy the real
      // constructor type, and the alternative is not exercising the observer
      // path at all — which is the path the fix lives on.
    } as unknown as typeof ResizeObserver;
  });

  function openTooltip(content: string) {
    const utils = render(
      <Tooltip content={content}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const span = screen.getByRole('button', { name: 'Trigger' }).parentElement!;
    act(() => {
      fireEvent.mouseEnter(span);
    });
    return utils;
  }

  it('watches the floating element for size changes while open', () => {
    vi.useFakeTimers();
    try {
      openTooltip('Hide values');
      act(() => {
        vi.runAllTimers();
      });
      // The wiring is the fix. Without an observer nothing can trigger a
      // recalculation, because the effect that positions never re-runs.
      expect(observers.length).toBeGreaterThan(0);
      expect(observers.some((o) => o.targets.length > 0)).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('recomputes the offset when the content grows', () => {
    vi.useFakeTimers();
    try {
      // jsdom has no layout, so the widths have to be supplied. The trigger
      // stays put; only the tooltip grows, which is the reported case.
      let tipWidth = 80;
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const isTip = this.getAttribute('role') === 'tooltip';
        return {
          width: isTip ? tipWidth : 40,
          height: 20,
          top: 100,
          bottom: 120,
          left: 500,
          right: 540,
          x: 500,
          y: 100,
          toJSON: () => ({}),
        } as DOMRect;
      };

      try {
        const { rerender } = openTooltip('Hide values');
        act(() => {
          vi.runAllTimers();
        });
        const tip = document.querySelector('[role="tooltip"]') as HTMLElement | null;
        expect(tip, 'the positioned element is the one carrying role=tooltip').not.toBeNull();
        const before = tip?.style.left;

        // The label changes and the box grows, exactly as clicking the toggle does.
        tipWidth = 260;
        rerender(
          <Tooltip content="Values are hidden — click to show">
            <button type="button">Trigger</button>
          </Tooltip>,
        );
        act(() => {
          for (const o of observers) {
            // Firing with no entries on purpose: it is the shape a real
            // notification never has, and it is what caught the guard being
            // seeded with a value a real notification CAN produce.
            o.cb([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
          }
        });

        expect(tip?.style.left).not.toBe(before);
      } finally {
        Element.prototype.getBoundingClientRect = original;
      }
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
