import type { ReactNode } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Combine,
  Landmark,
  Lightbulb,
  Link2,
  MinusCircle,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Badge, Tooltip } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency, formatDateNumeric } from '../../lib/utils.js';
import * as tx from '../tx-row.css.js';
import type { AppSide, ResolutionItem, StagedAction, StatementSide } from './types.js';

import * as s from './reconcile-page.css.js';

/**
 * What a row's badge can say: an intended operation, or how it turned out.
 *
 * The outcomes join the operations in one scale because they occupy the same
 * badge in the same column — step 3 shows intentions before Apply and results
 * after, and a reader scanning that column should not have to know which phase
 * they are in to read it.
 */
export type RowStatus = StagedAction['kind'] | 'done' | 'failed';

/**
 * The card chrome a decision is drawn in, shared by steps 2 and 3.
 *
 * Extracted because step 3 shows the same decisions a second time — as a list
 * of what is about to be written — and a review that renders its subject
 * differently from where the user decided it is asking them to re-identify
 * every row. Same rows, same order, same columns; only the buttons change.
 *
 * Rows use the transaction log's chrome (`tx-row.css.ts`) so a transaction
 * looks the same wherever it appears. The columns differ because the data does:
 * the bank half is a statement line with no category, account or transaction id,
 * so those columns would be empty in every row.
 */
export function RowTable({ children }: { children: ReactNode }) {
  return (
    <div className={tx.card}>
      <table className={tx.table}>
        {/*
         * Widths are declared, not measured — every decision renders its own
         * table and they only line up down the page because of that.
         *
         * The auto column is the AMOUNT, not the description. Under fixed
         * layout the auto column absorbs all slack and pushes everything after
         * it right, so with the description auto the date was stranded mid-row,
         * a long way from the text it belongs to. Putting the slack last keeps
         * the date against the description and the amount on the right edge.
         */}
        <colgroup>
          <col style={{ width: '4rem' }} />
          <col style={{ width: '42%' }} />
          <col style={{ width: '6rem' }} />
          <col />
        </colgroup>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Every row a decision concerns, bank side first.
 *
 * The unit is the *decision*, not the row: a statement line explained by two
 * app transactions is one thing to resolve, so all three rows appear together.
 * Showing one and describing the others in prose — an earlier shape — meant the
 * user could not see what they were being asked to combine.
 */
export function ItemRows({ item }: { item: ResolutionItem }) {
  const hasBoth = item.statements.length > 0 && item.apps.length > 0;

  return (
    <>
      {item.statements.map((row) => (
        <SideRow key={`s-${row.id}`} side="bank" row={row} />
      ))}
      {/*
       * The rule appears only when both sides are present. On a single-sided
       * decision there is nothing to divide, and an empty section under a lone
       * rule reads as a missing row.
       */}
      {hasBoth && (
        <tr>
          <td colSpan={4} className={s.decisionDivider} />
        </tr>
      )}
      {item.apps.map((row) => (
        <SideRow key={`a-${row.id}`} side="app" row={row} />
      ))}
    </>
  );
}

/**
 * One row, labelled by which side of the reconciliation it came from.
 *
 * The badge carries the label rather than a column header: a card can hold one
 * row or five, from either side or both, so a header row would be repeated
 * noise on the common case and wrong on the single-sided ones.
 */
function SideRow({ side, row }: { side: 'bank' | 'app'; row: StatementSide | AppSide }) {
  const label = 'description' in row ? row.description : row.name;
  // A refund moves money the other way, so it is coloured and signed like one.
  // Without this a $28.85 charge and the $28.85 refund that reversed it render
  // as the same figure in the same colour.
  const credit = row.direction === 'credit';
  const bank = side === 'bank';
  const meaning = bank ? 'From your bank statement' : 'Recorded in Avoir';

  return (
    <tr className={tx.row}>
      <td className={`${tx.cell} ${s.sideCell}`}>
        {/*
         * The side is an icon, not a word. It repeats on every row of every
         * card, so spelled out it becomes the loudest text on a screen whose
         * subject is the descriptions and amounts beside it. `focusable` is
         * what keeps the tooltip reachable without a mouse — the badge is not
         * itself interactive, so it has no focus of its own.
         */}
        <Tooltip content={meaning} focusable>
          <Badge
            variant="neutral"
            size="xl"
            iconOnly
            aria-label={meaning}
            background={bank ? vars.color.info50 : vars.color.accent50}
          >
            {bank ? <Landmark size={16} /> : <BookOpen size={16} />}
          </Badge>
        </Tooltip>
      </td>
      <RowCells label={label} date={row.date} amount={row.amount} credit={credit} />
    </tr>
  );
}

/**
 * The three cells every row shares: what it is, when, and how much.
 *
 * Shared so a row identified by its side and a row identified by the operation
 * about to be performed on it cannot drift apart in alignment or formatting —
 * they are the same row wearing a different badge.
 */
function RowCells({
  label,
  date,
  amount,
  credit,
}: {
  label: string;
  /** Absent when the decision's rows are no longer in hand. */
  date?: string;
  amount?: number;
  credit: boolean;
}) {
  return (
    <>
      <td className={`${tx.cell} ${tx.nameCell}`} title={label}>
        {label}
      </td>
      <td className={`${tx.cell} ${tx.tertiaryCell}`}>{date ? formatDateNumeric(date) : ''}</td>
      <td
        className={`${tx.cell} ${tx.amountCell} ${s.amountEdgeCell} ${
          credit ? tx.amountPositive : tx.amountNegative
        }`}
      >
        {amount === undefined ? '' : `${credit ? '+' : '-'}${formatCurrency(amount)}`}
      </td>
    </>
  );
}

/**
 * How a decision reads once it has been made.
 *
 * The lightbulb is a question; answered, it becomes the answer. Colour carries
 * the weight — a deletion must not look like an acknowledgement — so the badge
 * is the fastest way to scan a long list for what you have decided to destroy
 * versus what you have merely accepted.
 */
const STATUS: Record<RowStatus, { icon: typeof Check; bg: string; fg: string }> = {
  // Outcomes, once the batch has run. A write that landed is no longer an
  // intention, and the two must not look the same on the same screen.
  done: { icon: Check, bg: vars.color.success50, fg: vars.color.success700 },
  failed: { icon: AlertCircle, bg: vars.color.danger50, fg: vars.color.danger400 },
  create: { icon: Plus, bg: vars.color.success50, fg: vars.color.success700 },
  correct: { icon: Check, bg: vars.color.success50, fg: vars.color.success700 },
  edit: { icon: Pencil, bg: vars.color.info50, fg: vars.color.info700 },
  pair: { icon: Link2, bg: vars.color.info50, fg: vars.color.info700 },
  merge: { icon: Combine, bg: vars.color.info50, fg: vars.color.info700 },
  delete: { icon: Trash2, bg: vars.color.danger50, fg: vars.color.danger400 },
  ignore: { icon: MinusCircle, bg: vars.color.neutral100, fg: vars.color.textTertiary },
};

/**
 * A row identified by the operation about to be performed on it.
 *
 * Step 3's shape. There, the section heading already says what is happening —
 * Create, Correct, Delete — so a second row spelling it out under each card was
 * repeating the heading once per item. The operation takes the badge instead,
 * where the bank/app side sat, and the side is no longer the question: by this
 * point the user has decided, and what they are checking is the result.
 *
 * The values shown are the ones about to be written, not the ones being
 * replaced. A correction that displayed the old amount would ask the user to
 * confirm a figure that is not what the change produces.
 */
export function ActionRow({
  kind,
  tooltip,
  label,
  date,
  amount,
  credit,
}: {
  kind: RowStatus;
  tooltip: string;
  label: string;
  date?: string;
  amount?: number;
  credit: boolean;
}) {
  const status = STATUS[kind];
  const Icon = status.icon;

  return (
    <tr className={tx.row}>
      <td className={`${tx.cell} ${s.sideCell}`}>
        {/* `focusable` keeps the tooltip reachable without a mouse — the badge
            is not itself interactive, so it has no focus of its own. */}
        <Tooltip content={tooltip} focusable>
          <span
            className={s.statusBadge}
            style={{ background: status.bg, color: status.fg }}
            role="img"
            aria-label={tooltip}
          >
            <Icon size={16} aria-hidden />
          </span>
        </Tooltip>
      </td>
      <RowCells label={label} date={date} amount={amount} credit={credit} />
    </tr>
  );
}

/**
 * The card's last row: what will happen, and anything you can do about it.
 *
 * Laid out on the table's own columns rather than as one spanning cell. The
 * badge sits in the badge column and the text starts in the description column,
 * so the line lands exactly on the grid the rows above use — which padding
 * guesses never quite did.
 *
 * `kind` absent means undecided: the lightbulb and the group's recommendation.
 */
export function StatusRow({
  kind,
  text,
  children,
}: {
  kind?: RowStatus;
  text: ReactNode;
  children?: ReactNode;
}) {
  const status = kind ? STATUS[kind] : null;
  const StatusIcon = status?.icon ?? Lightbulb;

  return (
    <tr className={s.decisionFooterRow}>
      <td className={`${tx.cell} ${s.sideCell}`}>
        <span
          className={s.statusBadge}
          style={{
            background: status?.bg ?? vars.color.warning50,
            color: status?.fg ?? vars.color.warning700,
          }}
        >
          <StatusIcon size={16} aria-hidden />
        </span>
      </td>
      <td className={tx.cell} colSpan={3}>
        <div className={s.decisionFooter}>
          <span className={status ? s.stagedNote : s.recommendation}>{text}</span>
          {children && <div className={s.decisionActions}>{children}</div>}
        </div>
      </td>
    </tr>
  );
}
