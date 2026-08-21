import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Container ── */
export const btnGroup = style({
  display: 'flex',
  alignItems: 'center',
  background: vars.color.surfaceRaised,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.full,
  padding: vars.space['0.5'],
  gap: vars.space['0'],
  outline: 'none',
});

/* ── Size variants ── */
export const btnGroupSm = style({ height: '1.625rem' });
export const btnGroupMd = style({ height: '1.875rem' });

/* ── Segment ── */
export const btnGroupSegment = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: vars.font.medium,
  border: 'none',
  background: 'transparent',
  color: vars.color.textTertiary,
  borderRadius: vars.radius.full,
  cursor: 'pointer',
  transition: `background ${vars.duration.normal} ${vars.easing.default}, color ${vars.duration.normal} ${vars.easing.default}`,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  outline: 'none',
  selectors: {
    '&:hover:not([aria-checked="true"])': {
      background: vars.color.neutral200,
      color: vars.color.textPrimary,
    },
    '&:active:not([aria-checked="true"])': {
      background: vars.color.neutral300,
    },
    '&:focus-visible': {
      boxShadow: vars.focus.shadow,
    },
  },
});

/* ── Segment sizes ── */
export const btnGroupSegmentSm = style({
  fontSize: vars.font.xs,
  height: '1.375rem',
  padding: `0 ${vars.space['2']}`,
});

export const btnGroupSegmentMd = style({
  fontSize: vars.font.sm,
  height: '1.625rem',
  padding: `0 ${vars.space['3']}`,
});

/* ── Active segment ── */
/*
 * The chosen segment reads the ACCENT ramp in every theme — brass in Empire
 * light, gold in Empire Dark. That is a deliberate exception to the `selection*`
 * tokens the checkbox, datepicker day and account card use: those go green in
 * light, and button groups were asked for accent in both.
 *
 * A light brass with a near-black label, so the pair is `accentFill`/`onAccent`
 * rather than `textOnBrand` — on this fill Empire light needs a dark label where
 * the brand fill needs a white one.
 *
 * The fill is a token, not a ramp stop, because the accent ramp inverts between
 * the themes: the pale brass Empire light wants is `accent200`, and that same
 * stop in dark is a mid-brass where the near-black label reads 3.01:1. Each
 * theme names its own, and both still darken/lighten correctly on press.
 */
export const btnGroupSegmentActive = style({
  background: vars.color.accentFill,
  color: vars.color.onAccent,
  fontWeight: vars.font.semibold,
  selectors: {
    '&:hover': {
      background: vars.color.accentFillHover,
    },
    '&:active': {
      background: vars.color.accentFillPressed,
    },
  },
});
