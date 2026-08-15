import { StrictMode } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker, DateRangePicker } from './DatePicker.js';
import * as dp from './datepicker.css.js';

/*
 * The popover's phase class is the only observable for "the user can actually
 * see this" — the portal is in the DOM whenever phase !== 'closed', and jsdom
 * has no layout, so `opacity: 0` is invisible to presence assertions.
 *
 * The global setup mocks every vanilla-extract `style()` to the same
 * 'mock-style' string, which would make the three phases indistinguishable.
 * Overriding just this module's phase classes keeps them apart without
 * touching the shared mock that every other UI test depends on.
 */
vi.mock('./datepicker.css.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./datepicker.css.js')>()),
  dpPopoverOpening: 'phase-opening',
  dpPopoverOpen: 'phase-open',
  dpPopoverClosing: 'phase-closing',
}));

/* ── Helpers ── */

/**
 * DatePicker uses double-rAF for phase transitions (opening → open).
 * Flush those frames so the portal content actually renders.
 */
async function flushRAF() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

/* ── DatePicker Tests ── */

describe('DatePicker', () => {
  // Regression: the close-animation setTimeout(setPhase('closed')) and the open
  // double-rAF used to leak past unmount, firing setState after the test env was
  // torn down → "window is not defined" (same class as the Tooltip flake). The
  // unmount cleanup must cancel both. Asserted via spies because vi.getTimerCount
  // is polluted by React 19's own scheduler timer; cancelAnimationFrame in
  // particular is called only by our cleanup (React's scheduler never uses rAF).
  it('cancels its open-rAF and close-timer on unmount while open/closing', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const cancelRafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
    try {
      const { unmount } = render(<DatePicker onChange={() => {}} />);
      fireEvent.click(screen.getByRole('combobox')); // open() → schedules the rAF
      fireEvent.mouseDown(document.body); // outside → close() → schedules close timer

      clearTimeoutSpy.mockClear();
      cancelRafSpy.mockClear();
      unmount();

      expect(cancelRafSpy).toHaveBeenCalled();
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      cancelRafSpy.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clicking input opens calendar popover', async () => {
    const user = userEvent.setup();
    render(<DatePicker onChange={() => {}} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();

    // Calendar should be visible — month navigation buttons are present
    expect(screen.getByLabelText('Previous month')).toBeInTheDocument();
    expect(screen.getByLabelText('Next month')).toBeInTheDocument();
    // Day-of-week headers should be visible
    expect(screen.getByText('Su')).toBeInTheDocument();
    expect(screen.getByText('Mo')).toBeInTheDocument();
  });

  it('clicking day cell fires onChange with selected date', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Start with June 2024 visible
    const value = new Date(2024, 5, 1); // June 1, 2024
    render(<DatePicker value={value} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();

    // Click day 15 in the calendar
    const day15 = screen.getByText('15');
    await user.click(day15);

    expect(onChange).toHaveBeenCalledTimes(1);
    const selectedDate: Date = onChange.mock.calls[0][0];
    expect(selectedDate.getFullYear()).toBe(2024);
    expect(selectedDate.getMonth()).toBe(5); // June
    expect(selectedDate.getDate()).toBe(15);
  });

  it('month navigation arrows display previous/next month', async () => {
    const user = userEvent.setup();
    // Start with June 2024
    const value = new Date(2024, 5, 15);
    render(<DatePicker value={value} onChange={() => {}} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();

    // Should show June 2024
    expect(screen.getByText('June 2024')).toBeInTheDocument();

    // Click next month
    await user.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('July 2024')).toBeInTheDocument();

    // Click previous month twice to go back to May
    await user.click(screen.getByLabelText('Previous month'));
    await user.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('May 2024')).toBeInTheDocument();
  });

  // Regression: navigating across the year boundary must advance/retreat the
  // year by exactly one. A previous bug called setViewYear inside the
  // setViewMonth updater, which React Strict Mode double-invoked — jumping the
  // year by two (Dec 2026 → Jan 2028). Rendered under StrictMode to reproduce.
  it('advances the year by exactly one across December (Strict Mode safe)', async () => {
    const user = userEvent.setup();
    const value = new Date(2026, 11, 15); // Dec 15, 2026
    render(
      <StrictMode>
        <DatePicker value={value} onChange={() => {}} />
      </StrictMode>,
    );

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();
    expect(screen.getByText('December 2026')).toBeInTheDocument();

    // Next: December 2026 → January 2027 (not January 2028)
    await user.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('January 2027')).toBeInTheDocument();

    // Previous: January 2027 → December 2026 (not December 2025)
    await user.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('December 2026')).toBeInTheDocument();
  });

  /*
   * Regression: the picker rendered but stayed invisible, so it read as "the
   * date picker doesn't open anymore."
   *
   * `mountedRef` starts true and the unmount cleanup sets it false, but the
   * effect had NO setup body — so nothing ever set it back. Strict Mode runs
   * setup → cleanup → setup, leaving `mountedRef.current === false` on a
   * component that is very much mounted. `open()`'s double-rAF then skipped
   * `setPhase('open')` forever, the phase stuck at 'opening', and
   * `dpPopoverOpening` is `opacity: 0`.
   *
   * Presence assertions cannot catch this: the popover IS in the DOM (the
   * portal renders whenever phase !== 'closed') and jsdom has no layout, so
   * every existing test passed while the component was unusable in the browser.
   * The phase CLASS is the observable that corresponds to "the user can see it".
   *
   * Exact token match, not `toContain` — Vanilla Extract's generated
   * `dpPopoverOpen` name is a substring of `dpPopoverOpening`.
   */
  it('reaches the open phase under Strict Mode, not stuck invisible at opening', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DatePicker value={null} onChange={() => {}} />
      </StrictMode>,
    );

    await user.click(screen.getByRole('combobox'));
    await flushRAF();

    const classes = screen.getByRole('dialog').className.split(/\s+/);
    expect(classes).toContain(dp.dpPopoverOpen);
    expect(classes).not.toContain(dp.dpPopoverOpening);
  });

  it('rendering with value displays formatted date and selected day cell', async () => {
    const user = userEvent.setup();
    const value = new Date(2024, 5, 15); // June 15, 2024

    render(<DatePicker value={value} onChange={() => {}} />);

    // Dashes, matching the app's own formatDateNumeric ('MM-dd-yyyy'). The
    // pickers used slashes and were the only numeric dates in the app that did.
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('06-15-2024');

    // Open the calendar to verify the selected day
    await user.click(trigger);
    await flushRAF();

    // The calendar should show June 2024
    expect(screen.getByText('June 2024')).toBeInTheDocument();
  });

  it('disabled={true} prevents calendar from opening', async () => {
    const user = userEvent.setup();
    render(<DatePicker disabled onChange={() => {}} />);

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-disabled', 'true');

    await user.click(trigger);
    await flushRAF();

    // Calendar should not open — no navigation buttons
    expect(screen.queryByLabelText('Previous month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next month')).not.toBeInTheDocument();
  });
});

/* ── DateRangePicker Tests ── */

describe('DateRangePicker', () => {
  it('start/end selection fires onChange with DateRange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Open with June 2024 visible
    const value = { start: null, end: null };
    render(<DateRangePicker value={value} onChange={onChange} />);

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();

    // The range picker shows two months side by side.
    // Click a start date (day 10 in the left month)
    const day10Buttons = screen.getAllByText('10');
    await user.click(day10Buttons[0]); // first "10" is in the left month

    // After clicking start, onChange should not fire yet (only start selected)
    expect(onChange).not.toHaveBeenCalled();

    // Click an end date (day 20 in the left month)
    const day20Buttons = screen.getAllByText('20');
    await user.click(day20Buttons[0]); // first "20" is in the left month

    // Now onChange should fire with a DateRange
    expect(onChange).toHaveBeenCalledTimes(1);
    const range = onChange.mock.calls[0][0];
    expect(range).toHaveProperty('start');
    expect(range).toHaveProperty('end');
    expect(range.start).toBeInstanceOf(Date);
    expect(range.end).toBeInstanceOf(Date);
    expect(range.start.getDate()).toBe(10);
    expect(range.end.getDate()).toBe(20);
  });

  // Regression: same year-boundary double-increment bug as DatePicker, in the
  // range picker's leftMonth/leftYear navigation. Reproduced under StrictMode.
  it('advances the year by exactly one across December (Strict Mode safe)', async () => {
    const user = userEvent.setup();
    const value = { start: new Date(2026, 11, 1), end: new Date(2026, 11, 5) };
    render(
      <StrictMode>
        <DateRangePicker value={value} onChange={() => {}} />
      </StrictMode>,
    );

    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await flushRAF();
    // Left month = December 2026, right month = January 2027
    expect(screen.getByText('December 2026')).toBeInTheDocument();

    // Next: left → January 2027, right → February 2027 (not 2028)
    await user.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('January 2027')).toBeInTheDocument();
    expect(screen.getByText('February 2027')).toBeInTheDocument();
  });

  // Same mountedRef-never-reset bug as DatePicker — the two components carry
  // identical copies of the open/close lifecycle, so they need identical guards.
  it('reaches the open phase under Strict Mode, not stuck invisible at opening', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <DateRangePicker value={{ start: null, end: null }} onChange={() => {}} />
      </StrictMode>,
    );

    await user.click(screen.getByRole('combobox'));
    await flushRAF();

    const classes = screen.getByRole('dialog').className.split(/\s+/);
    expect(classes).toContain(dp.dpPopoverOpen);
    expect(classes).not.toContain(dp.dpPopoverOpening);
  });
});
