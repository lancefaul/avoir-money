import StatCard from '../../components/StatCard.js';
import { formatCurrency, formatDate } from '../../lib/utils.js';
import * as s from './reconcile-page.css.js';
import type { Residual } from './types.js';

interface ResidualHeaderProps {
  residual: Residual;
  /** Last day of the statement, used to date the app-side figure. */
  periodEnd: Date;
}

/** Below this, two money figures are the same figure. */
const EPSILON = 0.005;

/**
 * The residual, pinned for the whole session.
 *
 * Separate figures rather than a verdict: the user has to see *which* side is
 * wrong to decide what to correct, and a single "off by $x" hides that. Uses
 * the dashboard's stat cards so the two most consequential numbers in the app
 * are read the same way in both places.
 *
 * The app figure is dated on its face. It is the balance as the statement
 * closed, not today's — comparing a live balance against a statement that
 * closed days ago would invent a difference out of every transaction entered
 * since. Without the date it reads as the account's current balance and
 * disagrees with the account card for reasons nobody can see.
 *
 * Activity after the period end is shown when there is any, and is NEVER
 * subtracted from the difference. Netting it out would let an error inside the
 * period cancel an equal and opposite error outside it, and both would vanish
 * from the one number this whole feature exists to keep honest — which is the
 * silent-absorption failure that hid a reversed a four-figure payment for four
 * months. It is displayed because it is very often the entire explanation, and
 * the screen previously reported it as "still unexplained" while holding every
 * figure needed to explain it.
 */
export default function ResidualHeader({ residual, periodEnd }: ResidualHeaderProps) {
  const {
    statementEndingBalance,
    expectedBalance,
    residual: diff,
    isBalanced,
    activityAfterPeriodEnd: after,
  } = residual;

  const hasLaterActivity = Math.abs(after) >= EPSILON;
  /*
   * The difference is exactly the activity dated after the period.
   *
   * That is not a coincidence and it is not a discrepancy: it means the ending
   * balance was read at a later moment than the statement was exported. Saying
   * so turns an unactionable "unexplained" into a one-step fix.
   */
  const explainedByLaterActivity = hasLaterActivity && Math.abs(diff - after) < EPSILON;

  return (
    <div>
      <div className={s.statGrid} role="status" aria-live="polite">
        <StatCard
          label="Statement Balance"
          value={statementEndingBalance}
          sub="Per your statement"
        />
        <StatCard
          label="Avoir Balance"
          value={expectedBalance}
          sub={`As of ${formatDate(periodEnd)}`}
        />
        {hasLaterActivity && (
          <StatCard
            label="Activity After"
            value={after}
            sub={`Dated after ${formatDate(periodEnd)}`}
          />
        )}
        {/* Zero is the goal here, so a balanced difference is the green one. */}
        <StatCard
          label="Difference"
          value={diff}
          color={isBalanced ? 'green' : 'red'}
          sub={isBalanced ? 'Fully explained' : 'Still unexplained'}
        />
      </div>

      {explainedByLaterActivity && (
        <p className={s.periodNotice}>
          <span>
            The difference is exactly the {formatCurrency(after)} dated after{' '}
            {formatDate(periodEnd)} — so your ending balance was read later than your statement was
            exported.
          </span>
          <span>
            Export the statement again through today and re-analyze. The period will cover the same
            span as the balance, and these transactions will match against real statement lines
            instead of sitting outside the period.
          </span>
        </p>
      )}
    </div>
  );
}
