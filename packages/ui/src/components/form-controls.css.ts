import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/**
 * Checkbox, radio and toggle fills read `selectionFill` — the same token the
 * datepicker's chosen day and the selected account card use.
 *
 * A ticked checkbox IS a committed selection, so it belongs on that role rather
 * than on a ramp: Empire light marks selection green, Empire Dark marks it gold,
 * and this follows each without the component knowing which. All three controls
 * move together on purpose — they share a form, and a gold tick beside a green
 * toggle is worse than either choice made consistently.
 *
 * `brand200` survives below on the DISABLED states, which are deliberately not
 * a selection colour. The tick glyph reads `onNeutral`.
 */

/* ─── Shared: Label row ─── */

const labelRowBase = {
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  minHeight: '2.375rem',
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderRadius: vars.radius.sm,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  background: vars.color.surface,
  boxShadow: vars.color.inputShadow,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, border-color ${vars.duration.fast} ${vars.easing.default}`,
  position: 'relative' as const,
  selectors: {
    '&:hover': {
      background: vars.color.neutral100,
      borderColor: vars.color.inputBorderHover,
    },
  },
} as const;

/* ─── Checkbox ─── */

export const checkboxRow = style(labelRowBase);

export const checkboxBox = style({
  position: 'relative',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  borderRadius: vars.radius.xs,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  background: vars.color.inputBg,
  boxShadow: vars.color.inputShadow,
  transition: `background ${vars.duration.normal} ${vars.easing.default}, border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}`,
});

export const checkboxBoxChecked = style({
  background: vars.color.selectionFill,
  borderColor: vars.color.selectionFill,
  boxShadow: 'none',
});

export const checkboxBoxIndeterminate = style({
  background: vars.color.selectionFill,
  borderColor: vars.color.selectionFill,
  boxShadow: 'none',
});

export const checkboxBoxDisabled = style({
  background: vars.color.inputBgDisabled,
  borderColor: vars.color.border,
  boxShadow: 'none',
});

export const checkboxIcon = style({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  /*
   * The tick sits on `accent600`, whose lightness INVERTS between themes: 45%
   * (dark green) in the light themes, 73% (bright green) in the dark ones. A
   * hardcoded white was therefore only ever right for half of them — on dark's
   * 73% fill it was white-on-light-green and barely legible.
   *
   * `onNeutral` is the token that already carries "readable on a vivid fill",
   * and it resolves to white in the light themes and near-black in the dark
   * ones, so this is one reference rather than a per-theme override.
   */
  color: vars.color.onNeutral,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
});

/* Hidden native input */
export const hiddenInput = style({
  position: 'absolute',
  opacity: 0,
  width: 0,
  height: 0,
  margin: 0,
  padding: 0,
  overflow: 'hidden',
});

/* Focus-visible: when the hidden input is focused, apply ring to the adjacent visual box */
globalStyle(`${hiddenInput}:focus-visible + div`, {
  boxShadow: vars.focus.shadow,
  outline: 'none',
});

/* Hover states for the box when not disabled */
globalStyle(
  `${checkboxRow}:hover ${checkboxBox}:not(.${checkboxBoxChecked}):not(.${checkboxBoxIndeterminate}):not(.${checkboxBoxDisabled})`,
  {
    background: vars.color.inputBgHover,
    borderColor: vars.color.inputBorderHover,
  },
);

globalStyle(`${checkboxRow}:hover .${checkboxBoxChecked}`, {
  background: vars.color.selectionFillHover,
  borderColor: vars.color.selectionFillHover,
});

globalStyle(`${checkboxRow}:hover .${checkboxBoxIndeterminate}`, {
  background: vars.color.selectionFillHover,
  borderColor: vars.color.selectionFillHover,
});

/* ─── Radio ─── */

export const radioRow = style(labelRowBase);

export const radioCircle = style({
  position: 'relative',
  width: '1rem',
  height: '1rem',
  flexShrink: 0,
  borderRadius: vars.radius.full,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  background: vars.color.inputBg,
  boxShadow: vars.color.inputShadow,
  transition: `background ${vars.duration.normal} ${vars.easing.default}, border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}, border-width ${vars.duration.normal} ${vars.easing.default}`,
});

export const radioCircleSelected = style({
  background: 'white',
  borderColor: vars.color.selectionFill,
  borderWidth: vars.border.thick,
  boxShadow: 'none',
});

export const radioCircleDisabled = style({
  background: vars.color.inputBgDisabled,
  borderColor: vars.color.border,
  boxShadow: 'none',
});

export const radioDot = style({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '0.5rem',
  height: '0.5rem',
  borderRadius: vars.radius.full,
  background: vars.color.selectionFill,
});

export const radioDotDisabled = style({
  background: vars.color.brand200,
});

/* Radio hover states */
globalStyle(
  `${radioRow}:hover ${radioCircle}:not(.${radioCircleSelected}):not(.${radioCircleDisabled})`,
  {
    background: vars.color.inputBgHover,
    borderColor: vars.color.inputBorderHover,
  },
);

globalStyle(`${radioRow}:hover .${radioCircleSelected}:not(.${radioCircleDisabled})`, {
  borderColor: vars.color.selectionFillHover,
});

globalStyle(`${radioRow}:hover .${radioCircleSelected}:not(.${radioCircleDisabled}) .${radioDot}`, {
  background: vars.color.selectionFillHover,
});

/* ─── Toggle ─── */

export const toggleRow = style({
  ...labelRowBase,
  justifyContent: 'space-between',
});

export const toggleTrack = style({
  position: 'relative',
  width: '2.25rem',
  height: '1.25rem',
  flexShrink: 0,
  borderRadius: vars.radius.full,
  background: vars.color.neutral300,
  border: 'none',
  cursor: 'pointer',
  transition: `background ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}`,
  outline: 'none',
  padding: 0,
  selectors: {
    '&:hover': { background: vars.color.neutral400 },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});

export const toggleTrackOn = style({
  background: vars.color.selectionFill,
  selectors: {
    '&:hover': { background: vars.color.selectionFillHover },
  },
});

export const toggleTrackDisabled = style({
  background: vars.color.neutral200,
  cursor: 'not-allowed',
  selectors: {
    '&:hover': { background: vars.color.neutral200 },
  },
});

export const toggleTrackDisabledOn = style({
  background: vars.color.brand200,
  cursor: 'not-allowed',
  selectors: {
    '&:hover': { background: vars.color.brand200 },
  },
});

export const toggleThumb = style({
  position: 'absolute',
  top: '0.1875rem',
  left: '0.1875rem',
  width: '0.875rem',
  height: '0.875rem',
  borderRadius: vars.radius.full,
  /*
   * A literal, and deliberately so — DESIGN.md bans these because a literal
   * cannot vary per theme, and here that is exactly the requirement: the thumb
   * must stay light on the OFF track in BOTH themes (6.68:1 dark, and the pale
   * light-theme track relies on the shadow below to define the edge). No token
   * is light in both — `neutral0` and `onNeutral` each invert. The ON state
   * does need to vary, and takes `onNeutral` in `toggleThumbOn`.
   */
  background: 'white',
  boxShadow: vars.shadow.sm,
  transition: `transform ${vars.duration.normal} ${vars.easing.default}`,
  pointerEvents: 'none',
});

export const toggleThumbOn = style({
  transform: 'translateX(1rem)',
  /*
   * The thumb changes colour with the track, because one colour cannot serve
   * both states. Empire Dark's OFF track is 47.1% and its ON track is 83.9%
   * gold — a white thumb reads 6.68:1 on the first and 1.64:1 on the second,
   * which is the "hard to see" report. `onNeutral` is the token that already
   * answers "a mark drawn on a vivid fill", so the ON thumb takes it: 11.03:1
   * in dark, and unchanged in light where `onNeutral` is white anyway.
   */
  background: vars.color.onNeutral,
});

export const toggleThumbDisabled = style({
  background: vars.color.neutral300,
  boxShadow: 'none',
});

/* ─── Group layout ─── */

export const groupWrapper = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  boxShadow: vars.color.inputShadow,
  overflow: 'hidden',
});

/* Rows inside a group: no individual border/radius/shadow */
globalStyle(`${groupWrapper} > label`, {
  border: 'none',
  borderRadius: 0,
  boxShadow: 'none',
});

globalStyle(`${groupWrapper} > label:hover`, {
  borderColor: 'transparent',
});

export const groupLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
  marginBottom: vars.space['2'],
});

export const groupHelper = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

export const groupError = style({});

export const groupErrorMessage = style({
  fontSize: vars.font.sm,
  color: vars.color.danger400,
  marginTop: vars.space['2'],
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
});

/* ─── Control labels ─── */

export const controlLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
});

export const controlHelper = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

export const controlDisabledLabel = style({
  color: vars.color.textTertiary,
  cursor: 'not-allowed',
});

/* ─── Disabled row ─── */

export const disabledRow = style({
  cursor: 'not-allowed',
  borderColor: vars.color.border,
  background: vars.color.inputBgDisabled,
  boxShadow: 'none',
  selectors: {
    '&:hover': {
      background: vars.color.inputBgDisabled,
      borderColor: vars.color.border,
    },
  },
});

/* ─── Standalone (no label) ─── */

export const standaloneWrap = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  // A standalone checkbox is a fixed 32×32 target: when placed in a flex row
  // next to long text it must never be crushed — the text truncates/wraps.
  flexShrink: 0,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  position: 'relative',
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': { background: vars.color.neutral100 },
  },
});

export const standaloneDisabled = style({
  cursor: 'not-allowed',
  selectors: {
    '&:hover': { background: 'transparent' },
  },
});
