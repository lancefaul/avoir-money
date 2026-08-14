import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/**
 * A secondary value stacked under the first column's primary value, used when a
 * column is merged away at a narrow width — the custodian under a holding's symbol,
 * the custody type under a wallet's name.
 *
 * Carries no media query of its own: it is only rendered below the relevant
 * breakpoint, which lives in one place (the JS hook in each panel).
 */
export const subline = style({
  display: 'block',
  fontSize: vars.font.xs,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
