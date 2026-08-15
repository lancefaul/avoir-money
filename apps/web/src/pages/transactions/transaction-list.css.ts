/**
 * Transaction-log styles.
 *
 * The row chrome shared with the reconciler — card, table, cells, amount
 * colours, row metrics — lives in `../tx-row.css.ts` and is re-exported here so
 * this page's imports stay unchanged. What remains below is the log's own:
 * columns and states no other screen has.
 */
import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export {
  card,
  table,
  cell,
  nameCell,
  nameWithBadge,
  nameText,
  nameBadge,
  secondaryCell,
  tertiaryCell,
  amountCell,
  amountPositive,
  amountNegative,
  amountNeutral,
  row,
} from '../tx-row.css.js';

export const listWrap = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['6'],
});

export const dateHeading = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  padding: `0 ${vars.space['1']}`,
  paddingBottom: vars.space['1'],
  lineHeight: '1',
});

export const cellCheck = style({
  width: '3rem',
  maxWidth: '3rem',
  paddingLeft: vars.space['1'],
  paddingRight: vars.space['1'],
});

export const actionsCell = style({
  textAlign: 'right',
});

export const splitCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  color: vars.color.info700,
  background: vars.color.info50,
  borderRadius: vars.radius.full,
  padding: `${vars.space['0.5']} ${vars.space['1']}`,
});

/** Marks a transaction linked to a recurring expense/income. Neutral tone keeps
 *  it calm (recurring rows are common) and distinct from the split (info) and
 *  account-count (brand) badges. */
export const recurringBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  color: vars.color.neutral700,
  background: vars.color.neutral100,
  borderRadius: vars.radius.full,
  padding: `${vars.space['0.5']} ${vars.space['1']}`,
});

/* Account-count pill on a collapsed purchase group (payment-split, ADR-030) —
   brand-tinted to read distinctly from the info-tinted category-split pill. */
export const accountCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  color: vars.color.brand700,
  background: vars.color.brand50,
  borderRadius: vars.radius.full,
  padding: `${vars.space['0.5']} ${vars.space['1']}`,
});

export const noBudget = style({
  color: vars.color.textTertiary,
  fontSize: vars.font.sm,
});

export const rowSelected = style({
  // Not `accent50` — see the token's note in contract.css.ts. That stop is
  // 0.3% off Empire Dark's surface, so a selected row was invisible there.
  background: vars.color.surfaceSelected,
});

export const rowUncategorized = style({
  background: vars.color.danger50,
});
