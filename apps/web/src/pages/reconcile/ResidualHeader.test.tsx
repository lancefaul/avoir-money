/**
 * The residual shows its working — statement, app, and the gap — rather than a
 * verdict. A user who only sees "off by $x" cannot tell which side is wrong,
 * which is the one thing they need in order to decide what to correct.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResidualHeader from './ResidualHeader.js';
import type { Residual } from './types.js';

const PERIOD_END = new Date('2026-07-17T00:00:00.000Z');

/**
 * The value shown on one named card.
 *
 * Scoped rather than queried globally: "Activity After" and "Difference" can
 * legitimately hold the SAME figure — that is precisely the case being tested —
 * so a bare text query cannot tell which card it found.
 */
function cardValue(label: string): string {
  const card = screen.getByText(label).closest('div');
  const value = card?.querySelectorAll('p')[1];
  return value?.textContent ?? '';
}

const residual = (over: Partial<Residual> = {}): Residual => ({
  openingBalance: 0,
  transactionSum: -200,
  expectedBalance: 800,
  statementEndingBalance: 940,
  residual: 140,
  isBalanced: false,
  activityAfterPeriodEnd: 0,
  ...over,
});

describe('ResidualHeader', () => {
  it('names both sides and the gap', () => {
    render(<ResidualHeader residual={residual()} periodEnd={PERIOD_END} />);
    expect(screen.getByText('Statement Balance')).toBeTruthy();
    expect(screen.getByText('Avoir Balance')).toBeTruthy();
    expect(screen.getByText('Difference')).toBeTruthy();
  });

  it('dates the app figure so it is not read as the live balance', () => {
    // It is the balance as the statement closed. Undated, it disagrees with the
    // account card by every transaction entered since, for no visible reason.
    render(<ResidualHeader residual={residual()} periodEnd={PERIOD_END} />);
    expect(screen.getByText('As of Jul 17, 2026')).toBeTruthy();
  });

  it('shows each figure', () => {
    render(<ResidualHeader residual={residual()} periodEnd={PERIOD_END} />);
    expect(screen.getByText('$940.00')).toBeTruthy();
    expect(screen.getByText('$800.00')).toBeTruthy();
    expect(screen.getByText('$140.00')).toBeTruthy();
  });

  it('shows a zero difference plainly when balanced', () => {
    // The figures are the whole message — no separate verdict line restating
    // what the Difference card already says.
    render(
      <ResidualHeader
        residual={residual({ statementEndingBalance: 800, residual: 0, isBalanced: true })}
        periodEnd={PERIOD_END}
      />,
    );
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.queryByText(/unaccounted for/)).toBeNull();
    expect(screen.queryByText(/ready to finish/i)).toBeNull();
  });

  it('announces changes without stealing focus', () => {
    // The figure updates after every resolution; a live region reports it to a
    // screen reader without moving the user out of the list they are working.
    const { container } = render(<ResidualHeader residual={residual()} periodEnd={PERIOD_END} />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute('role')).toBe('status');
  });

  /**
   * The Prime Visa case, 2026-07-20.
   *
   * A statement exported through Jul 17 against an ending balance read on Jul
   * 20: the app held 19 transactions dated after the period, summing to exactly
   * the −$483.90 the screen was calling "still unexplained". Every figure needed
   * to explain it was already in hand and none of them were shown.
   */
  it('shows activity dated after the period when there is any', () => {
    render(
      <ResidualHeader
        residual={residual({ residual: -483.9, activityAfterPeriodEnd: -483.9 })}
        periodEnd={PERIOD_END}
      />,
    );

    expect(screen.getByText('Activity After')).toBeInTheDocument();
    expect(cardValue('Activity After')).toBe('-$483.90');
  });

  it('hides that card when everything falls inside the period', () => {
    // The common case. A fourth card reading $0.00 would be noise.
    render(<ResidualHeader residual={residual()} periodEnd={PERIOD_END} />);

    expect(screen.queryByText('Activity After')).not.toBeInTheDocument();
  });

  it('names the cause when the gap is exactly the later activity', () => {
    render(
      <ResidualHeader
        residual={residual({ residual: -483.9, activityAfterPeriodEnd: -483.9 })}
        periodEnd={PERIOD_END}
      />,
    );

    expect(screen.getByText(/read later than your statement was exported/i)).toBeInTheDocument();
    expect(screen.getByText(/export the statement again/i)).toBeInTheDocument();
  });

  /**
   * The safety property. Netting later activity out of the difference would let
   * an error inside the period cancel an equal and opposite one outside it, and
   * both would vanish — the silent-absorption failure this feature exists to
   * prevent. The difference must keep reporting the period, untouched.
   */
  it('never reduces the difference by the later activity', () => {
    render(
      <ResidualHeader
        residual={residual({ residual: -483.9, activityAfterPeriodEnd: -483.9 })}
        periodEnd={PERIOD_END}
      />,
    );

    // The Difference card specifically — not the Activity card, which shows the
    // same figure. That ambiguity is the whole point of scoping by card.
    expect(cardValue('Difference')).toBe('-$483.90');
    expect(screen.getByText('Still unexplained')).toBeInTheDocument();
    expect(screen.queryByText('Fully explained')).not.toBeInTheDocument();
  });

  it('stays quiet when later activity exists but does not account for the gap', () => {
    // A real discrepancy that merely coexists with post-period rows. Suggesting
    // a re-export here would send the user after the wrong thing.
    render(
      <ResidualHeader
        residual={residual({ residual: 140, activityAfterPeriodEnd: -60 })}
        periodEnd={PERIOD_END}
      />,
    );

    expect(screen.getByText('Activity After')).toBeInTheDocument();
    expect(screen.queryByText(/read later than your statement/i)).not.toBeInTheDocument();
  });
});
