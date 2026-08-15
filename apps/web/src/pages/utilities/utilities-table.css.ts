import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/**
 * Due-date sub-line stacked under the bill date in the first column. Only
 * rendered below the narrow breakpoint (see NARROW_BREAKPOINT in ReadingTable),
 * where the standalone "Due" column is dropped entirely — so this carries no
 * media query of its own. The breakpoint lives in one place: the JS hook.
 */
export const dueSubline = style({
  display: 'block',
  fontSize: vars.font.xs,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/**
 * Last cell of a reading row, holding the overflow (⋮) button.
 *
 * Used instead of the shared `cellLast`, whose 20px right padding pushed the ⋮
 * noticeably inboard. Transactions and Recurring leave their action cell on the
 * base 0.25rem cell padding, so the button sits flush with the table's right
 * edge — this matches that. Not folded into `cellLast` itself because the
 * dashboard's PayPeriodCard shares it and was not in scope.
 */
export const actionsCellLast = style({
  paddingLeft: vars.space['5'],
  paddingRight: vars.space['1'],
});
