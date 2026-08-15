import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

export const tooltipPortal = style({
  position: 'fixed',
  zIndex: vars.z.tooltip,
  pointerEvents: 'none',
  opacity: 0,
  transition: `opacity ${vars.duration.fast} ${vars.easing.default}`,
});

export const tooltipVisible = style({
  opacity: 1,
});

export const tooltipBubble = style({
  background: vars.color.textInverse,
  color: vars.color.textOnBrand,
  fontSize: vars.font.sm,
  lineHeight: vars.font.leadingSnug,
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderRadius: vars.radius.sm,
  maxWidth: '14rem',
  whiteSpace: 'normal',
  boxShadow: vars.shadow.md,
});

export const tooltipArrow = style({
  position: 'absolute',
  width: vars.space['2'],
  height: vars.space['2'],
  background: vars.color.textInverse,
  transform: 'rotate(45deg)',
});
