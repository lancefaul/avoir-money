import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['6'],
  padding: `${vars.space['2']} ${vars.space['4']}`,
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
  fontSize: vars.font.base,
});

/* ── Narrow (<=680): search + summary render in the (non-scrolling) header ── */

/** Search field row — no top padding (title row provides the space above); horizontal padding matches the header title row. */
export const searchRow = style({
  paddingTop: 0,
  paddingBottom: vars.space['3'],
  paddingLeft: vars.space['4'],
  paddingRight: vars.space['4'],
});

/**
 * Underline under the search, applied only when a summary row follows it.
 * When the search is the last row, the header's own bottom border serves as
 * the underline (avoids a doubled 2px line).
 */
export const searchRowDivider = style({
  borderBottom: `${vars.border.thin} solid ${vars.color.border}`,
});

/** Summary values as a 2x2 grid — content inset, underline spans the full width. */
export const grid = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: `${vars.space['2']} ${vars.space['4']}`,
  paddingLeft: vars.space['4'],
  paddingRight: vars.space['4'],
  paddingTop: vars.space['3'],
  paddingBottom: vars.space['3'],
  borderBottom: `${vars.border.thin} solid ${vars.color.border}`,
  fontSize: vars.font.base,
});

export const stat = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

export const statLabel = style({
  color: vars.color.textTertiary,
});

export const statValue = style({
  fontWeight: vars.font.semibold,
  fontVariantNumeric: 'tabular-nums',
});

export const statPositive = style({
  color: vars.color.success700,
});

export const statNegative = style({
  color: vars.color.danger400,
});
