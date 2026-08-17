import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const toolbarWrapper = style({
  position: 'fixed',
  bottom: vars.space['4'],
  left: '14rem',
  right: 0,
  zIndex: vars.z.sticky,
  display: 'flex',
  justifyContent: 'center',
  padding: `0 ${vars.space['4']} 0 ${vars.space['2']}`,
  pointerEvents: 'none',
  transition: `left ${vars.duration.normal} ${vars.easing.inOut}`,
});

export const toolbarInner = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  borderRadius: vars.radius.lg,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  background: vars.color.surface,
  padding: vars.space['1'],
  boxShadow: vars.shadow.lg,
  pointerEvents: 'auto',
  width: '100%',
});

export const selectedCount = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.textSecondary,
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  marginLeft: 'auto',
});

export const selectWrapper = style({
  minWidth: '15rem',
});
