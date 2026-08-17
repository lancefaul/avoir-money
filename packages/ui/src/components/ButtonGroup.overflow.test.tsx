import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ButtonGroup } from './ButtonGroup.js';

/**
 * ButtonGroup degrades to a vertical RadioGroup when its segments no longer
 * fit. Segments are `flex: 1` but cannot shrink (default `min-width: auto`
 * resolves to min-content, and `white-space: nowrap` makes that the whole
 * label), so without this the trailing options overflow and become unreachable
 * by pointer — e.g. "Trade" on the 5-option transaction Type selector at phone
 * widths.
 *
 * jsdom reports 0 for scrollWidth/clientWidth and stubs ResizeObserver as a
 * no-op, so both are driven manually here.
 */

const TYPE_OPTIONS = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRADE', label: 'Trade' },
];

let roCallbacks: (() => void)[] = [];

/** Drive layout: every element reports these widths. */
function mockWidths({ scrollWidth, clientWidth }: { scrollWidth: number; clientWidth: number }) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth;
    },
  });
}

beforeEach(() => {
  roCallbacks = [];
  // A ResizeObserver whose callback we can fire on demand.
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      roCallbacks.push(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  // @ts-expect-error — restore jsdom's own (absent) implementations
  delete HTMLElement.prototype.scrollWidth;
  // @ts-expect-error — restore jsdom's own (absent) implementations
  delete HTMLElement.prototype.clientWidth;
});

describe('ButtonGroup — degrades to RadioGroup when it does not fit', () => {
  it('stays a segmented pill while the options fit', () => {
    mockWidths({ scrollWidth: 200, clientWidth: 300 });
    render(<ButtonGroup options={TYPE_OPTIONS} value="EXPENSE" onChange={() => {}} />);

    // Pill segments are buttons with role="radio"; a real RadioGroup uses inputs.
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('swaps to a radio group when the segments overflow', () => {
    mockWidths({ scrollWidth: 400, clientWidth: 300 });
    render(<ButtonGroup options={TYPE_OPTIONS} value="EXPENSE" onChange={() => {}} />);

    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  });

  it('keeps every option reachable after the swap — including the one that was clipped', () => {
    mockWidths({ scrollWidth: 400, clientWidth: 300 });
    render(<ButtonGroup options={TYPE_OPTIONS} value="EXPENSE" onChange={() => {}} />);

    for (const opt of TYPE_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeInTheDocument();
    }
    // "Trade" is the option that overflows off the right edge as a pill.
    expect(screen.getByText('Trade')).toBeVisible();
  });

  it('still reports selection from the radio group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    mockWidths({ scrollWidth: 400, clientWidth: 300 });
    render(<ButtonGroup options={TYPE_OPTIONS} value="EXPENSE" onChange={onChange} />);

    await user.click(screen.getByText('Trade'));

    expect(onChange).toHaveBeenCalledWith('TRADE');
  });

  it('preserves the accessible name across the swap', () => {
    mockWidths({ scrollWidth: 400, clientWidth: 300 });
    render(
      <ButtonGroup
        options={TYPE_OPTIONS}
        value="EXPENSE"
        onChange={() => {}}
        ariaLabel="Transaction type"
      />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Transaction type' })).toBeInTheDocument();
  });

  it('returns to the pill once there is room again', () => {
    mockWidths({ scrollWidth: 400, clientWidth: 300 });
    render(<ButtonGroup options={TYPE_OPTIONS} value="EXPENSE" onChange={() => {}} />);
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(5);

    // Container grows past the width the pill needed (400).
    mockWidths({ scrollWidth: 400, clientWidth: 500 });
    act(() => {
      roCallbacks.forEach((cb) => cb());
    });

    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });
});
