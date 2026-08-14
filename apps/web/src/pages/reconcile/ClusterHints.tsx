import { Badge } from '@budget-tracker/ui';
import { formatCount, formatCurrency } from '../../lib/utils.js';
import { ItemRows, RowTable, StatusRow } from './DecisionRows.js';
import type { ClusterHint, ResolutionItem } from './types.js';
import * as s from './reconcile-page.css.js';

/**
 * Same-merchant leftovers that do NOT add up, shown together — advisory only.
 *
 * The case this exists for: the bank prints one "CITY UTILITIES" charge, the app
 * holds two "CityWater" rows, and they do not sum. `findCombinations` requires
 * an exact sum, so it declines them, and they scatter into opposite sections —
 * one under "on statement, not in app", the others under "in app, not on
 * statement" — with nothing linking them. The relationship is obvious to a
 * human and invisible to the screen, so the user has to spot it themselves.
 *
 * This gathers them into one card showing both sides and the gap between them.
 * It deliberately offers NO action. The rows do not sum, so they can never feed
 * the merge endpoint (which refuses a non-summing set) — and a wrong grouping
 * here would invite combining transactions that are genuinely distinct, which
 * is worse than showing nothing. It is a spotlight and an on-ramp: once the gap
 * is visible, the user corrects a row with the tools that are already safe, and
 * the matcher picks the group up on the next run.
 *
 * Member rows still appear, and are still resolved, in their own sections below.
 * Nothing here is a decision, so nothing here is staged.
 */
export default function ClusterHints({ clusters }: { clusters: ClusterHint[] }) {
  if (clusters.length === 0) return null;

  return (
    <div className={s.group}>
      <div className={s.groupHeader}>
        <div className={s.groupHeadLine}>
          <span className={s.groupTitle}>Looks related</span>
          <Badge variant="neutral" size="sm">
            {formatCount(clusters.length)}
          </Badge>
        </div>
        <span className={s.groupHint}>
          Same merchant on both sides, but the amounts do not add up — so these are not offered as a
          combination. Resolve the rows in their sections below, or correct one so the totals agree.
        </span>
      </div>

      {clusters.map((cluster) => (
        <RowTable key={cluster.key}>
          <ItemRows item={asItem(cluster)} />
          {/*
           * No `kind`, so this renders the undecided lightbulb — the same
           * treatment a decision card uses for its recommendation. That is
           * exactly right here: the card is telling the user something, not
           * recording anything they have chosen.
           */}
          <StatusRow
            text={`Statement ${formatCurrency(cluster.statementTotal)} vs app ${formatCurrency(
              cluster.appTotal,
            )} — off by ${formatCurrency(cluster.gap)}`}
          />
        </RowTable>
      ))}
    </div>
  );
}

/**
 * A cluster in the shape `ItemRows` renders.
 *
 * Both sides are already `StatementSide[]` / `AppSide[]`, so this only supplies
 * the fields the row renderer needs. `delta: 0` because a cluster explains
 * nothing on its own — its members carry their own deltas in their own sections,
 * and counting them here as well would double them in the residual.
 */
function asItem(cluster: ClusterHint): ResolutionItem {
  return {
    key: cluster.key,
    statements: cluster.statements,
    apps: cluster.apps,
    delta: 0,
  };
}
