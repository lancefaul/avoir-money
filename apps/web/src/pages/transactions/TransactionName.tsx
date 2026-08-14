import { Badge, Tooltip } from '@budget-tracker/ui';
import * as tl from './transaction-list.css.js';

/**
 * Marks the escape-hatch adjustment that closed a reconciliation.
 *
 * Requirement 6.7: an adjustment must be distinguishable from an ordinary
 * transaction everywhere transactions are listed. An adjustment that blends in
 * is functionally the same as the silent absorption this feature was built to
 * eliminate — the amount would still be in the ledger, but nothing would say it
 * was never explained.
 */
export function AdjustmentBadge() {
  return (
    <span className={tl.nameBadge}>
      <Tooltip content="Created to close a reconciliation that would not balance" focusable>
        <Badge variant="warning" size="sm">
          Adjustment
        </Badge>
      </Tooltip>
    </span>
  );
}

interface TransactionNameProps {
  name: string;
  isAdjustment?: boolean;
}

/**
 * A transaction's name in a plain (non-flex) truncating cell, badged when it is
 * a reconciliation adjustment. Lists that already lay their name cell out as a
 * flex row use {@link AdjustmentBadge} directly instead.
 */
export default function TransactionName({ name, isAdjustment }: TransactionNameProps) {
  if (!isAdjustment) return <>{name}</>;

  return (
    <span className={tl.nameWithBadge}>
      <span className={tl.nameText}>{name}</span>
      <AdjustmentBadge />
    </span>
  );
}
