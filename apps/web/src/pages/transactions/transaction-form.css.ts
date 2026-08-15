import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* ── Transfer arrow icon between from/to ── */
export const transferRow = style({
  display: 'flex',
  alignItems: 'flex-end',
  gap: vars.space['3'],
});

export const transferArrow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '2.375rem',
  color: vars.color.textTertiary,
  flexShrink: 0,
});

/* ── Helper text (e.g. "Net amount after rewards") ── */
export const helperText = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

/* ── Warning helper text (e.g. "Linked to recurring") ── */
export const helperTextWarning = style({
  fontSize: vars.font.sm,
  color: vars.color.warning400,
});

/* ── Section heading (all-caps subheading with divider) ── */
export const sectionHeading = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  paddingBottom: vars.space['2'],
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  marginTop: vars.space['2'],
});
