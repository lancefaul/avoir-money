import { style, keyframes } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Overlay ── */
const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });

export const overlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: vars.z.modal,
  background: vars.color.overlay,
  backdropFilter: 'blur(0.25rem)',
  WebkitBackdropFilter: 'blur(0.25rem)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: vars.space['6'],
  animation: `${fadeIn} ${vars.duration.fast} ${vars.easing.out}`,
});

export const overlayClosing = style({
  animation: `${fadeOut} ${vars.duration.fast} ${vars.easing.in}`,
  opacity: 0,
});

export const overlayDrawer = style({
  justifyContent: 'flex-end',
  padding: 0,
});

/* ── Modal panel ── */
const scaleIn = keyframes({
  from: { opacity: 0, transform: 'scale(0.95)' },
  to: { opacity: 1, transform: 'scale(1)' },
});

export const panel = style({
  // The floating layer (DESIGN.md surface hierarchy). Was `neutral50`, which is
  // the same value as `background` in four of the six themes — a coincidence,
  // not a rule, and it broke as soon as Empire's canvas moved off the cream.
  background: vars.color.surfaceOverlay,
  borderRadius: vars.radius.xl,
  boxShadow: vars.shadow.lg,
  width: '100%',
  maxWidth: '32rem',
  animation: `${scaleIn} ${vars.duration.fast} ${vars.easing.out}`,
  outline: 'none',
  display: 'flex',
  flexDirection: 'column',
});

export const panelPinned = style({
  maxWidth: '56rem',
  maxHeight: 'calc(100vh - 3rem)',
});

/* ── Drawer panel ── */
const slideIn = keyframes({
  from: { transform: 'translateX(100%)' },
  to: { transform: 'translateX(0)' },
});
const slideOut = keyframes({
  from: { transform: 'translateX(0)' },
  to: { transform: 'translateX(100%)' },
});

export const drawerPanel = style({
  background: vars.color.surfaceOverlay,
  boxShadow: vars.shadow.lg,
  width: '100%',
  maxWidth: '28rem',
  height: '100%',
  borderRadius: 0,
  animation: `${slideIn} ${vars.duration.normal} ${vars.easing.out}`,
  outline: 'none',
  display: 'flex',
  flexDirection: 'column',
});

export const drawerPanelClosing = style({
  animation: `${slideOut} ${vars.duration.normal} ${vars.easing.in}`,
  transform: 'translateX(100%)',
});

/* ── Header ── */
export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${vars.space['5']} ${vars.space['6']}`,
  flexShrink: 0,
});

export const headerBorder = style({
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const title = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
});

/* ── Body ── */
export const body = style({
  padding: `${vars.space['6']} ${vars.space['6']}`,
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  lineHeight: vars.font.leadingRelaxed,
});

export const bodyFlat = style({
  paddingTop: 0,
  paddingBottom: 0,
});

export const bodyFlatKeepBottom = style({
  paddingTop: 0,
});

export const bodyScroll = style({
  flex: 1,
  overflowY: 'scroll',
  minHeight: 0,
  scrollbarGutter: 'stable',
});

/* ── Subheader (pinned zone above scroll body, below title) ── */
export const subheader = style({
  flexShrink: 0,
  padding: `${vars.space['3']} ${vars.space['6']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  // Matches the panel it sits inside — a subheader is part of that surface,
  // not a band across it.
  background: vars.color.surfaceOverlay,
});

export const bodyDrawer = style({
  paddingTop: vars.space['6'],
});

/* ── Footer ── */
export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: vars.space['2'],
  padding: `${vars.space['4']} ${vars.space['6']}`,
  flexShrink: 0,
});

export const footerEnd = style({
  justifyContent: 'flex-end',
});

export const footerFlat = style({
  paddingTop: '1.5rem',
  paddingBottom: '1.5rem',
});

export const footerBorder = style({
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const footerSpread = style({
  justifyContent: 'space-between',
});

/* ── Dialog (smaller panel) ── */
export const dialogPanel = style({
  maxWidth: '26rem',
});

export const dialogHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${vars.space['5']} ${vars.space['6']} ${vars.space['4']}`,
  flexShrink: 0,
});

export const dialogBody = style({
  padding: `0 ${vars.space['6']}`,
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  lineHeight: vars.font.leadingRelaxed,
});
