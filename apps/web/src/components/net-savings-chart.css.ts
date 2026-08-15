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

export const amount = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  fontWeight: vars.font.regular,
  lineHeight: vars.font.leadingTight,
  marginTop: vars.space['1'],
  marginBottom: vars.space['4'],
  color: vars.color.textPrimary,
});

export const tooltip = style({
  fontSize: vars.font.sm,
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.sm,
  padding: `${vars.space['2']} ${vars.space['3']}`,
  boxShadow: vars.shadow.sm,
});

export const tooltipLabel = style({
  fontWeight: vars.font.medium,
  color: vars.color.textSecondary,
  marginBottom: vars.space['1'],
});

export const tooltipPositive = style({
  fontWeight: vars.font.semibold,
  color: vars.color.success700,
});

export const tooltipNegative = style({
  fontWeight: vars.font.semibold,
  color: vars.color.danger400,
});

export const loadingWrap = style({
  display: 'flex',
  height: '17.5rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const errorText = style({
  fontSize: vars.font.sm,
  color: vars.color.danger400,
});
