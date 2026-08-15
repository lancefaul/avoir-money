import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Wrapper ── */
export const dpWrap = style({
  position: 'relative',
});

/* ── Trigger (reuses input styling) ── */
export const dpTrigger = style({
  width: '100%',
  height: '2.375rem',
  display: 'flex',
  alignItems: 'center',
  padding: `0 ${vars.space['3']}`,
  gap: vars.space['2'],
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
});

export const dpTriggerOpen = style({
  borderColor: vars.focus.color,
  boxShadow: vars.focus.shadow,
});

globalStyle(`${dpTrigger}:hover:not(.${dpTriggerOpen}):not([aria-disabled="true"])`, {
  borderColor: vars.color.inputBorderHover,
  background: vars.color.inputBgHover,
});

globalStyle(`${dpTrigger}:focus-visible:not(.${dpTriggerOpen})`, {
  borderColor: vars.focus.color,
  boxShadow: vars.focus.shadow,
});

export const dpTriggerDisabled = style({
  background: vars.color.inputBgDisabled,
  color: vars.color.textTertiary,
  cursor: 'not-allowed',
  borderColor: vars.color.border,
  boxShadow: 'none',
});

export const dpTriggerError = style({
  borderColor: vars.color.borderError,
  borderWidth: vars.border.thick,
  boxShadow: vars.color.inputShadowError,
});

export const dpCalIcon = style({
  flexShrink: 0,
  color: vars.color.textTertiary,
  display: 'flex',
  alignItems: 'center',
});

export const dpValue = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const dpPlaceholder = style({
  color: vars.color.textPlaceholder,
});

/* ── Masked input (inline typing) ── */
export const dpMaskedInput = style({
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  padding: 0,
  width: '100%',
  selectors: {
    '&::placeholder': { color: vars.color.textPlaceholder },
  },
});

/* ── Popover ── */
export const dpPopover = style({
  position: 'fixed',
  zIndex: vars.z.popover,
  background: vars.color.surface,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.md,
  padding: vars.space['4'],
  width: '17.5rem',
});

export const dpPopoverRange = style({
  width: '36.25rem',
});

export const dpPopoverOpening = style({
  opacity: 0,
  transform: 'scale(0.95) translateY(-0.25rem)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
});

export const dpPopoverOpen = style({
  opacity: 1,
  transform: 'scale(1) translateY(0)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
});

export const dpPopoverClosing = style({
  opacity: 0,
  transform: 'scale(0.95) translateY(-0.25rem)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.in}, transform ${vars.duration.fast} ${vars.easing.in}`,
});

/* ── Header ── */
export const dpHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: vars.space['3'],
});

export const dpNav = style({
  width: '1.75rem',
  height: '1.75rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  padding: 0,
  selectors: {
    '&:hover': { background: vars.color.surfaceHover, color: vars.color.textPrimary },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});

export const dpNavHidden = style({
  visibility: 'hidden',
});

export const dpMonthLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

/* ── Day-of-week headers ── */
export const dpDow = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  marginBottom: vars.space['1'],
});

export const dpDowCell = style({
  textAlign: 'center',
  padding: `${vars.space['1']} 0`,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingWide,
  color: vars.color.textTertiary,
});

/* ── Day grid ── */
export const dpGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: vars.space['0.5'],
});

/* ── Day cell ── */
export const dpDay = style({
  position: 'relative',
  width: '100%',
  aspectRatio: '1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  background: 'none',
  border: 'none',
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  fontVariantNumeric: 'tabular-nums',
  outline: 'none',
  padding: 0,
  selectors: {
    '&:hover:not(:disabled)': { background: vars.color.surfaceHover },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
    '&:disabled': { color: vars.color.textTertiary, cursor: 'not-allowed', opacity: '0.4' },
  },
});

export const dpDayOutside = style({
  color: vars.color.textTertiary,
  selectors: {
    '&:hover:not(:disabled)': { color: vars.color.textSecondary },
  },
});

export const dpDayToday = style({});

/* Today dot */
globalStyle(`${dpDayToday}::after`, {
  content: '""',
  position: 'absolute',
  bottom: vars.space['0.5'],
  left: '50%',
  transform: 'translateX(-50%)',
  width: vars.space['1'],
  height: vars.space['1'],
  borderRadius: vars.radius.full,
  background: vars.color.accent600,
});

/*
 * Selection and hover are different questions, and each theme answers them.
 *
 * Selection is state the user has committed, so it reads `selectionFill*`.
 * Hover is transient feedback and shares `surfaceHover`/`surfacePressed` with
 * the menus. Empire light puts selection on green and hover on brass; Empire
 * Dark swaps them — selection brass, hover green. That swap is exactly why
 * these are tokens rather than ramp stops.
 *
 * `dpDayToday` (the today dot) and `dpDayHoverMid` (the range preview under the
 * cursor) are neither: one is a marker, the other IS a hover.
 */
export const dpDaySelected = style({
  background: vars.color.selectionFill,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  borderRadius: vars.radius.sm,
  selectors: {
    '&:hover:not(:disabled)': {
      background: vars.color.selectionFillHover,
      color: vars.color.neutral0,
    },
  },
});

/* Override today dot color when selected */
globalStyle(`${dpDaySelected}.${dpDayToday}::after`, {
  background: vars.color.neutral0,
});

export const dpDayKeyboardFocus = style({
  boxShadow: vars.focus.shadow,
});

/* ── Range styles ── */
export const dpDayRangeStart = style({
  background: vars.color.selectionFill,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  borderRadius: `${vars.radius.sm} 0 0 ${vars.radius.sm}`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: vars.color.selectionFillHover,
      color: vars.color.neutral0,
    },
  },
});

export const dpDayRangeEnd = style({
  background: vars.color.selectionFill,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  borderRadius: `0 ${vars.radius.sm} ${vars.radius.sm} 0`,
  selectors: {
    '&:hover:not(:disabled)': {
      background: vars.color.selectionFillHover,
      color: vars.color.neutral0,
    },
  },
});

export const dpDayRangeStartEnd = style({
  borderRadius: vars.radius.sm,
});

export const dpDayRangeMid = style({
  background: vars.color.selectionSoft,
  color: vars.color.onSelectionSoft,
  borderRadius: 0,
});

export const dpDayHoverMid = style({
  background: vars.color.accent50,
  color: vars.color.accent700,
  borderRadius: 0,
  opacity: '0.7',
});

/* Override today dot on range endpoints */
globalStyle(`${dpDayRangeStart}.${dpDayToday}::after, ${dpDayRangeEnd}.${dpDayToday}::after`, {
  background: vars.color.neutral0,
});

/* ── Footer ── */
export const dpFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: vars.space['3'],
  paddingTop: vars.space['3'],
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const dpBtnToday = style({
  fontSize: vars.font.sm,
  color: vars.color.accent600,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: `${vars.space['0.5']} ${vars.space['2']}`,
  borderRadius: vars.radius.xs,
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  selectors: {
    '&:hover': { background: vars.color.accent50 },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});

export const dpBtnClear = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: `${vars.space['0.5']} ${vars.space['2']}`,
  borderRadius: vars.radius.xs,
  transition: `color ${vars.duration.fast} ${vars.easing.default}, background ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  selectors: {
    '&:hover': { color: vars.color.textPrimary, background: vars.color.surfaceHover },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});

/* ── Range: two months side by side ── */
export const dpMonths = style({
  display: 'flex',
  gap: vars.space['6'],
});

export const dpMonth = style({
  flex: 1,
});

export const dpMonthsDivider = style({
  width: vars.border.hairline,
  background: vars.color.border,
  flexShrink: 0,
});

export const dpRangeHint = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});
