import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const card = style({
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  padding: vars.space['5'],
  marginBottom: vars.space['6'],
});

export const header = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  marginBottom: vars.space['4'],
});

export const valueSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
});

export const changeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  fontSize: vars.font.sm,
});

export const changePositive = style({
  color: vars.color.success700,
  fontWeight: vars.font.medium,
});

export const changeNegative = style({
  color: vars.color.danger400,
  fontWeight: vars.font.medium,
});

export const periodLabel = style({
  color: vars.color.textTertiary,
});

export const totalValue = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  lineHeight: vars.font.leadingTight,
});

export const chartWrap = style({
  width: '100%',
  height: '15rem',
});

/**
 * Range filter when it moves below the chart (under 640px, where it no longer
 * fits beside the portfolio value). Still inside the card.
 */
export const rangeFooter = style({
  display: 'flex',
  justifyContent: 'center',
  marginTop: vars.space['4'],
});

export const emptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '15rem',
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});
