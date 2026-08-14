import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

export const panel = style({
  position: 'fixed',
  zIndex: vars.z.popover,
  background: vars.color.surface,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.lg,
  overflow: 'hidden',
});

export const panelOpening = style({
  opacity: 0,
  transform: 'scale(0.95) translateY(-4px)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
});

export const panelOpen = style({
  opacity: 1,
  transform: 'scale(1) translateY(0)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
});

export const panelClosing = style({
  opacity: 0,
  transform: 'scale(0.95) translateY(-4px)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.in}, transform ${vars.duration.fast} ${vars.easing.in}`,
});
