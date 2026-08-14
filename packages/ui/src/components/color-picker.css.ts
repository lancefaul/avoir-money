import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Trigger ── */
export const trigger = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['2'],
  height: '2.375rem',
  padding: `0 ${vars.space['3']}`,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  background: vars.color.inputBg,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  userSelect: 'none',
  transition: `border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}, background ${vars.duration.normal} ${vars.easing.default}`,
  boxShadow: vars.color.inputShadow,
  outline: 'none',
  selectors: {
    '&:hover:not([data-disabled])': {
      borderColor: vars.color.inputBorderHover,
      background: vars.color.inputBgHover,
    },
    '&:focus-visible:not([data-disabled])': {
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
  },
});

export const triggerOpen = style({
  borderColor: vars.focus.color,
  boxShadow: vars.focus.shadow,
});

export const triggerDisabled = style({
  background: vars.color.inputBgDisabled,
  color: vars.color.textTertiary,
  cursor: 'not-allowed',
  borderColor: vars.color.border,
  boxShadow: 'none',
});

export const triggerSwatch = style({
  width: '1.25rem',
  height: '1.25rem',
  borderRadius: vars.radius.xs,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const triggerSwatchEmpty = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: `linear-gradient(to top right, transparent calc(50% - 1px), ${vars.color.danger400} calc(50% - 1px), ${vars.color.danger400} calc(50% + 1px), transparent calc(50% + 1px))`,
  backgroundColor: vars.color.neutral0,
});

export const triggerLabel = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
});

export const triggerPlaceholder = style({
  color: vars.color.textPlaceholder,
});

export const triggerChevron = style({
  color: vars.color.textTertiary,
  transition: `transform ${vars.duration.normal} ${vars.easing.default}`,
  display: 'flex',
  marginLeft: 'auto',
  flexShrink: 0,
});

export const triggerChevronOpen = style({
  transform: 'rotate(180deg)',
});

/* ── Panel ── */
export const panel = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
  paddingTop: vars.space['2'],
  paddingBottom: vars.space['2'],
});

export const row = style({
  display: 'flex',
  flexWrap: 'nowrap',
  gap: vars.space['1'],
  padding: `0 ${vars.space['3']}`,
});

export const divider = style({
  height: '0',
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  margin: `${vars.space['1']} 0`,
});

/* ── Swatch ── */
export const swatch = style({
  width: '1.5rem',
  height: '1.5rem',
  borderRadius: vars.radius.full,
  border: `${vars.border.thin} solid transparent`,
  cursor: 'pointer',
  transition: `transform ${vars.duration.fast} ${vars.easing.default}, box-shadow ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  padding: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  selectors: {
    '&:hover': {
      transform: 'scale(1.2)',
    },
    '&:focus-visible': {
      boxShadow: vars.focus.shadow,
    },
  },
});

export const swatchSelected = style({
  border: `${vars.border.thick} solid ${vars.color.textPrimary}`,
  transform: 'scale(1.15)',
  selectors: {
    '&:hover': {
      transform: 'scale(1.25)',
    },
  },
});

export const swatchLight = style({
  border: `${vars.border.thin} solid ${vars.color.border}`,
});
