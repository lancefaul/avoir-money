import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const title = style({
  fontFamily: vars.font.label,
  letterSpacing: vars.font.trackingLabel,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
});

export const amountRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: vars.space['1'],
  marginTop: vars.space['1'],
});

export const amount = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  fontWeight: vars.font.regular,
  lineHeight: vars.font.leadingTight,
});

export const separator = style({
  fontSize: vars.font.xl,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
});

export const budgetAmount = style({
  fontSize: vars.font.xl,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
});

export const amountOver = style({
  color: vars.color.danger400,
});

export const amountOk = style({
  color: vars.color.textPrimary,
});

export const subtitle = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textTertiary,
  marginTop: vars.space['1'],
});

export const pinnedLabel = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 'fit-content',
  margin: '0 auto',
  fontSize: vars.font.lg,
  fontWeight: vars.font.medium,
  borderRadius: vars.radius.sm,
  padding: `${vars.space['1']} ${vars.space['2']}`,
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  boxShadow: vars.shadow.sm,
});

export const overLabel = style({
  color: vars.color.danger400,
  fontWeight: vars.font.medium,
});

export const underLabel = style({
  color: vars.color.success700,
  fontWeight: vars.font.medium,
});

export const onTrackLabel = style({
  color: vars.color.textSecondary,
  fontWeight: vars.font.medium,
});
