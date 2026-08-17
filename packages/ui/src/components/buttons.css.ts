import { style, globalKeyframes } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Base ── */
export const btnBase = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.space['2'],
  fontWeight: vars.font.medium,
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  lineHeight: '1',
  textDecoration: 'none',
  position: 'relative',
  outline: 'none',
  transition: `background ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}, transform ${vars.duration.fast} ${vars.easing.default}, opacity ${vars.duration.normal} ${vars.easing.default}, border-color ${vars.duration.normal} ${vars.easing.default}, color ${vars.duration.normal} ${vars.easing.default}`,
  selectors: {
    '&:active:not(:disabled)': { transform: 'scale(0.965)' },
    '&:disabled': { opacity: '0.35', cursor: 'not-allowed', transform: 'none' },
  },
});

/* ── Sizes ── */
export const btnSm = style({
  height: '1.875rem',
  padding: '0 0.75rem',
  fontSize: vars.font.sm,
  borderRadius: vars.radius.sm,
  gap: vars.space['1'],
});

export const btnMd = style({
  height: '2.375rem',
  padding: '0 1rem',
  fontSize: vars.font.base,
  borderRadius: vars.radius.sm,
});

export const btnLg = style({
  height: '2.625rem',
  padding: '0 1.25rem',
  fontSize: vars.font.lg,
  borderRadius: vars.radius.md,
});

export const btnIconSm = style({
  width: '1.875rem',
  height: '1.875rem',
  padding: 0,
  borderRadius: vars.radius.sm,
});

export const btnIconMd = style({
  width: '2.375rem',
  height: '2.375rem',
  padding: 0,
  borderRadius: vars.radius.sm,
});

export const btnIconLg = style({
  width: '2.625rem',
  height: '2.625rem',
  padding: 0,
  borderRadius: vars.radius.md,
});

export const btnIconRoundSm = style({
  width: '1.875rem',
  height: '1.875rem',
  padding: 0,
  borderRadius: vars.radius.full,
});

/* ── Variants ── */

export const btnPrimary = style({
  background: `linear-gradient(180deg, ${vars.color.brandButtonFrom} 0%, ${vars.color.brandButtonTo} 100%)`,
  color: vars.color.textOnBrand,
  border: `1px solid ${vars.color.brandButtonBorder}`,
  boxShadow: vars.shadow.sm,
  selectors: {
    '&:hover:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.brandButtonHoverFrom} 0%, ${vars.color.brandButtonHoverTo} 100%)`,
      boxShadow: vars.shadow.md,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.brandButtonTo} 0%, ${vars.color.brandButtonTo} 100%)`,
      boxShadow: 'none',
    },
  },
});

export const btnSecondary = style({
  background: `linear-gradient(180deg, ${vars.color.secondaryButtonFrom} 0%, ${vars.color.secondaryButtonTo} 100%)`,
  color: vars.color.textPrimary,
  border: `1px solid ${vars.color.secondaryButtonBorder}`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.secondaryButtonHoverFrom} 0%, ${vars.color.secondaryButtonHoverTo} 100%)`,
      boxShadow: vars.shadow.md,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.secondaryButtonTo} 0%, ${vars.color.secondaryButtonTo} 100%)`,
      boxShadow: 'none',
    },
  },
});

export const btnTrueGhost = style({
  background: 'transparent',
  color: vars.color.textSecondary,
  border: `${vars.border.thin} solid transparent`,
  selectors: {
    '&:hover:not(:disabled)': {
      // `controlHover`, not `surfaceHover`. This read the panel-row token until
      // 2026-08-09, on the reasoning that one fill for every hover gesture keeps
      // a button and a menu row responding identically — which held right up
      // until the two were meant to be different colours, and the button
      // silently followed menu rows onto the accent. Still NOT `surfaceRaised`:
      // that is the page canvas in the dark themes, so it would darken.
      background: vars.color.controlHover,
      color: vars.color.textPrimary,
      borderColor: vars.color.border,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: vars.color.neutral200,
    },
  },
});

export const btnDanger = style({
  background: `linear-gradient(180deg, ${vars.color.dangerButtonFrom} 0%, ${vars.color.dangerButtonTo} 100%)`,
  color: vars.color.neutral0,
  border: `1px solid ${vars.color.dangerButtonBorder}`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.dangerButtonHoverFrom} 0%, ${vars.color.dangerButtonHoverTo} 100%)`,
      boxShadow: vars.shadow.md,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: `linear-gradient(180deg, ${vars.color.dangerButtonTo} 0%, ${vars.color.dangerButtonTo} 100%)`,
      boxShadow: 'none',
    },
  },
});

export const btnTrueGhostDanger = style({
  background: 'transparent',
  color: vars.color.danger400,
  border: `${vars.border.thin} solid transparent`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: vars.color.danger50,
      borderColor: vars.color.danger300,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: vars.color.danger50,
    },
  },
});

export const btnTrueGhostBrand = style({
  background: 'transparent',
  color: vars.color.brand600,
  border: `${vars.border.thin} solid transparent`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: vars.color.brand50,
      borderColor: vars.color.brand100,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: vars.color.brand100,
    },
  },
});

export const btnOnDark = style({
  background: 'transparent',
  color: 'rgba(255, 255, 255, 0.7)',
  border: `${vars.border.thin} solid transparent`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: 'rgba(255, 255, 255, 0.12)',
      color: 'rgba(255, 255, 255, 1)',
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: 'rgba(255, 255, 255, 0.18)',
    },
  },
});

export const btnOnDarkDanger = style({
  background: 'transparent',
  color: 'rgba(255, 255, 255, 0.7)',
  border: `${vars.border.thin} solid transparent`,
  selectors: {
    '&:hover:not(:disabled)': {
      // Fixed danger-on-dark (this variant renders on dark card surfaces, so it
      // must not follow the theme). Same rendered colors, expressed in OKLCH per
      // DESIGN.md's color-space rule (translucency via `/ alpha`, not rgba).
      background: 'oklch(67.63% 0.2115 24.81 / 0.2)',
      color: 'oklch(76.15% 0.1421 20.94)',
      borderColor: 'oklch(67.63% 0.2115 24.81 / 0.3)',
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
    '&:active:not(:disabled)': {
      background: 'rgba(255, 80, 80, 0.3)',
    },
  },
});

/* ── Completion states ── */
export const btnSuccess = style({
  background: vars.color.success400,
  color: vars.color.neutral0,
  border: `${vars.border.thin} solid transparent`,
  boxShadow: 'none',
  transition: `background ${vars.duration.slow} ${vars.easing.default}, color ${vars.duration.slow} ${vars.easing.default}, border-color ${vars.duration.slow} ${vars.easing.default}`,
});

export const btnFailure = style({
  background: vars.color.danger400,
  color: vars.color.neutral0,
  border: `${vars.border.thin} solid transparent`,
  boxShadow: 'none',
  transition: `background ${vars.duration.slow} ${vars.easing.default}, color ${vars.duration.slow} ${vars.easing.default}, border-color ${vars.duration.slow} ${vars.easing.default}`,
});

/* ── State transition wrapper ── */
export const btnContent = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.space['2'],
  transition: `opacity ${vars.duration.normal} ${vars.easing.default}`,
});

export const btnContentHidden = style({
  opacity: 0,
  position: 'absolute',
  transition: `opacity ${vars.duration.normal} ${vars.easing.default}`,
});

export const btnContentVisible = style({
  opacity: 1,
  transition: `opacity ${vars.duration.normal} ${vars.easing.default}`,
});

/* ── Spinner ── */
const spinAnim = 'showcase-spin';

globalKeyframes(spinAnim, {
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' },
});

export const spinner = style({
  borderRadius: vars.radius.full,
  border: `${vars.border.thick} solid transparent`,
  animation: `${spinAnim} 0.6s linear infinite`,
  flexShrink: 0,
});
