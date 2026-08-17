import { style, styleVariants, keyframes, globalStyle } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';
import { upTo } from '../theme/breakpoints.js';

/* ── Keyframes ── */
const slideUpIn = keyframes({
  from: { opacity: 0, transform: 'translateY(1rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const slideDownIn = keyframes({
  from: { opacity: 0, transform: 'translateY(-1rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

const fadeScaleOut = keyframes({
  from: { opacity: 1, transform: 'scale(1)' },
  to: { opacity: 0, transform: 'scale(0.95)' },
});

/* ── Container (positions the toast stack) ── */
export const container = style({
  position: 'fixed',
  zIndex: vars.z.toast,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  pointerEvents: 'none',
});

export const containerPosition = styleVariants({
  'bottom-right': { bottom: vars.space['4'], right: vars.space['4'], alignItems: 'flex-end' },
  'bottom-left': { bottom: vars.space['4'], left: vars.space['4'], alignItems: 'flex-start' },
  'bottom-center': { bottom: vars.space['4'], left: '50%', transform: 'translateX(-50%)' },
  'top-right': { top: vars.space['4'], right: vars.space['4'], alignItems: 'flex-end' },
  'top-left': { top: vars.space['4'], left: vars.space['4'], alignItems: 'flex-start' },
  'top-center': { top: vars.space['4'], left: '50%', transform: 'translateX(-50%)' },
});

/* ── Stack wrapper (holds all toasts in a stacked layout) ── */
export const stackWrapper = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
});

/* ── Individual toast card ── */
export const toast = style({
  position: 'relative',
  background: vars.color.surface,
  borderRadius: vars.radius.lg,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  boxShadow: vars.shadow.lg,
  width: '22rem',
  overflow: 'hidden',
  pointerEvents: 'auto',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

/**
 * Flat — no drop shadow.
 *
 * A floating toast casts `shadow.lg` because it sits above the page. The same
 * component placed *in* the page is not floating, and the shadow makes it read
 * as a stray card rather than part of the layout. Shadow is elevation, and an
 * inline notice has none.
 */
export const toastFlat = style({
  boxShadow: 'none',
});

/**
 * Fills its container instead of the fixed 22rem stack width.
 *
 * That width exists so stacked toasts line up in a corner. In page flow the
 * container decides, and a fixed narrow card inside a wide column reads as
 * floating — the very thing `toastFlat` is removing.
 */
export const toastFullWidth = style({
  width: '100%',
});

/* ── Filled variant (colored background per severity) ── */
export const toastFilled = styleVariants({
  success: { background: vars.color.success50, borderColor: vars.color.success200 },
  error: { background: vars.color.danger50, borderColor: vars.color.danger300 },
  warning: { background: vars.color.warning50, borderColor: vars.color.warning200 },
  info: { background: vars.color.info50, borderColor: vars.color.info200 },
});

/*
 * Notification variant — uses textInverse to create an inverted appearance
 * that stands out from the page in all themes.
 */
export const toastNotification = style({
  background: vars.color.textInverse,
  borderColor: vars.color.neutral700,
});

export const toastEnterBottom = style({
  animation: `${slideUpIn} ${vars.duration.slow} ${vars.easing.out}`,
});

export const toastEnterTop = style({
  animation: `${slideDownIn} ${vars.duration.slow} ${vars.easing.out}`,
});

export const toastExit = style({
  animation: `${fadeScaleOut} ${vars.duration.normal} ${vars.easing.in} forwards`,
});

/* ── Stacked (behind) toasts ── */
export const stackedToast = style({
  position: 'absolute',
  left: 0,
  right: 0,
  pointerEvents: 'none',
  opacity: 0.6,
  transition: `all ${vars.duration.normal} ${vars.easing.default}`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});

export const stackedFirst = style({
  transform: 'scale(0.96)',
  opacity: 0.5,
});

export const stackedSecond = style({
  transform: 'scale(0.92)',
  opacity: 0.35,
});

/* ── Header row ── */
export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  padding: `${vars.space['3']} ${vars.space['4']}`,
  '@media': {
    [upTo('md')]: {
      flexWrap: 'wrap',
    },
  },
});

/* ── Severity icon ── */
export const icon = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
});

export const iconColor = styleVariants({
  success: { color: vars.color.success400 },
  error: { color: vars.color.danger400 },
  warning: { color: vars.color.warning400 },
  info: { color: vars.color.info400 },
  notification: { color: vars.color.brand400 },
});

/* ── Title ── */
export const title = style({
  flex: 1,
  fontSize: vars.font.base,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
  lineHeight: vars.font.leadingSnug,
});

/* ── Header actions (undo, expand, dismiss) ── */
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  flexShrink: 0,
});

/**
 * Applied when customActions are provided: below 640px the action buttons
 * flow onto their own row under the title instead of squeezing beside it.
 */
export const actionsCustom = style({
  '@media': {
    [upTo('md')]: {
      flexBasis: '100%',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
    },
  },
});

/* ── Description (collapsible body) ── */
export const body = style({
  overflow: 'hidden',
  transition: `max-height ${vars.duration.normal} ${vars.easing.default}, opacity ${vars.duration.normal} ${vars.easing.default}`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});

export const bodyExpanded = style({
  maxHeight: '10rem',
  opacity: 1,
});

export const bodyCollapsed = style({
  maxHeight: '0',
  opacity: 0,
});

export const description = style({
  padding: `0 ${vars.space['4']} ${vars.space['3']}`,
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
  lineHeight: vars.font.leadingRelaxed,
});

/* ── Progress bar ── */
export const progressTrack = style({
  height: '0.1875rem',
  background: vars.color.neutral100,
  width: '100%',
  cursor: 'pointer',
  position: 'relative',
});

export const progressBar = style({
  height: '100%',
  transition: 'none',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});

/*
 * Mirrors `iconColor` exactly — the progress bar carries the toast's severity,
 * same as its icon does.
 *
 * All five variants read `accent400` until 2026-08-10, so the bar was never
 * semantic; it only looked correct while accent WAS the brand green, which made
 * a green bar under a success toast a coincidence rather than a rule. The
 * moment accent became brass every bar went gold, including a gold bar under a
 * red error toast. Reading the severity token makes the colour follow the
 * variant in every theme: green in Empire light, gold in the Empire dark trio
 * (whose success ramp is the accent ramp).
 */
export const progressColor = styleVariants({
  success: { background: vars.color.success400 },
  error: { background: vars.color.danger400 },
  warning: { background: vars.color.warning400 },
  info: { background: vars.color.info400 },
  notification: { background: vars.color.brand400 },
});

/* ── Countdown text ── */
export const countdown = style({
  padding: `${vars.space['1']} ${vars.space['4']} ${vars.space['2']}`,
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  lineHeight: vars.font.leadingNormal,
});

export const countdownBold = style({
  fontWeight: vars.font.semibold,
  color: vars.color.textSecondary,
});

export const countdownAction = style({
  fontWeight: vars.font.semibold,
  color: vars.color.textSecondary,
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      color: vars.color.textPrimary,
    },
  },
});

/*
 * Notification variant — text/track overrides via globalStyle.
 * Uses textOnBrand (always readable on neutral900 in every theme)
 * and neutral ramp mid-tones for secondary content.
 */

globalStyle(`${toastNotification} ${title}`, {
  color: vars.color.textOnBrand,
});

globalStyle(`${toastNotification} ${icon}`, {
  color: vars.color.textOnBrand,
});

globalStyle(`${toastNotification} ${description}`, {
  color: vars.color.neutral400,
});

globalStyle(`${toastNotification} ${progressTrack}`, {
  background: vars.color.neutral700,
});

globalStyle(`${toastNotification} ${countdown}`, {
  color: vars.color.neutral450,
});

globalStyle(`${toastNotification} ${countdownBold}`, {
  color: vars.color.neutral400,
});

globalStyle(`${toastNotification} ${countdownAction}`, {
  color: vars.color.neutral400,
});

globalStyle(`${toastNotification} ${countdownAction}:hover`, {
  color: vars.color.textOnBrand,
});

/* Override trueGhost button color inside notification toasts */
globalStyle(`${toastNotification} ${actions} button`, {
  color: vars.color.neutral400,
  borderColor: 'transparent',
});

globalStyle(`${toastNotification} ${actions} button:hover`, {
  color: vars.color.textOnBrand,
  background: 'rgba(128, 128, 128, 0.15)',
  borderColor: 'rgba(128, 128, 128, 0.2)',
});

globalStyle(`${toastNotification} ${actions} button:active`, {
  background: 'rgba(128, 128, 128, 0.25)',
});
