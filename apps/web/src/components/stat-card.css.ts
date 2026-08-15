import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const card = style({
  position: 'relative',
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  padding: vars.space['5'],
});

export const label = style({
  fontFamily: vars.font.label,
  letterSpacing: vars.font.trackingLabel,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const value = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  fontWeight: vars.font.regular,
  lineHeight: vars.font.leadingTight,
  marginTop: vars.space['1'],
});

export const valueGreen = style({ color: vars.color.success700 });
export const valueRed = style({ color: vars.color.danger400 });
export const valueBlue = style({ color: vars.color.info400 });
export const valueGray = style({ color: vars.color.textPrimary });

export const subtitle = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  color: vars.color.textTertiary,
  marginTop: vars.space['0.5'],
  whiteSpace: 'pre-line',
});

export const action = style({
  position: 'absolute',
  right: vars.space['4'],
  top: vars.space['4'],
});

export const progress = style({
  marginTop: vars.space['3'],
});
