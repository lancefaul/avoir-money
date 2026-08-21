import { Badge } from '@budget-tracker/ui';
import { formatCount, formatCurrency, formatDate } from '../../lib/utils.js';
import { ItemRows, RowTable, StatusRow } from './DecisionRows.js';
import type { ReentryHint, ResolutionItem } from './types.js';
import * as s from './reconcile-page.css.js';

/**
 * A whole period that looks entered twice.
 *
 * Why this needs its own card rather than a note on each row: the rows are
 * individually unremarkable. A copy dated a month from its original is
 * indistinguishable from an ordinary unmatched transaction, and thirty of them
 * read as thirty unrelated discrepancies — which is exactly how a re-imported
 * month used to present. The claim can only be made about the set, so the set is
 * what the screen shows, with the period and the money named.
 *
 * It offers NO action, for the same reason `ClusterHints` does not. Deleting a
 * month of transactions on the strength of a heuristic is not something a screen
 * should offer with a button; the member rows remain listed and resolvable in
 * their own sections below. This only says the word out loud.
 */
export default function ReentryHints({ reentries }: { reentries: ReentryHint[] }) {
  if (reentries.length === 0) return null;

  return (
    <div className={s.group}>
      <div className={s.groupHeader}>
        <div className={s.groupHeadLine}>
          <span className={s.groupTitle}>Possibly entered twice</span>
          <Badge variant="neutral" size="sm">
            {formatCount(reentries.length)}
          </Badge>
        </div>
        <span className={s.groupHint}>
          These transactions each have an identical twin that already reconciled, and there are
          enough of them to look like a period recorded a second time. Check before deleting
          anything — the rows are still listed individually below.
        </span>
      </div>

      {reentries.map((reentry) => (
        <RowTable key={reentry.key}>
          <ItemRows item={asItem(reentry)} />
          {/*
           * No `kind`, so this renders the undecided lightbulb — the same
           * treatment used for a recommendation. Correct here: the card is
           * telling the user something, not recording a choice.
           */}
          <StatusRow
            text={`${formatCount(reentry.apps.length)} rows worth ${formatCurrency(
              reentry.total,
            )}, duplicating ${formatDate(reentry.start)} – ${formatDate(reentry.end)}`}
          />
        </RowTable>
      ))}
    </div>
  );
}

/**
 * A re-entry in the shape `ItemRows` renders.
 *
 * `delta: 0` because the card explains nothing on its own — each member carries
 * its own delta in its own section, and counting them here too would double them
 * in the residual.
 */
function asItem(reentry: ReentryHint): ResolutionItem {
  return { key: reentry.key, statements: [], apps: reentry.apps, delta: 0 };
}
