import { style, globalStyle, keyframes } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { upTo } from '@budget-tracker/ui/theme/breakpoints.js';
import { consoleSurface } from '../../components/console.css.js';

const promptSlideUp = keyframes({
  from: { opacity: 0, transform: 'translateY(1rem)' },
  to: { opacity: 1, transform: 'translateY(0)' },
});

export const panel = style({
  maxWidth: '75rem',
  maxHeight: 'calc(100vh - 4rem)',
  width: '100%',
  height: '100%',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  scrollbarGutter: 'auto',
});

export const stepIndicatorWrap = style({
  padding: `${vars.space['5']} ${vars.space['6']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const contentWrap = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
});

export const contentScroll = style({
  flex: 1,
  overflowY: 'auto',
  padding: vars.space['6'],
  scrollbarGutter: 'stable',
  minHeight: 0,
});

export const contentFlush = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
  position: 'relative',
});

export const contentHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: `${vars.space['6']} ${vars.space['6']} ${vars.space['4']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const contentBody = style({
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
});

export const actionBar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['3'],
  padding: `${vars.space['4']} ${vars.space['6']}`,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const actionBarRight = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
});

export const sectionHeading = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  margin: 0,
});

export const sectionDescription = style({
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  margin: 0,
});

export const monitorEntry = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: vars.space['4'],
  borderRadius: vars.radius.lg,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  background: vars.color.neutral0,
});

export const monitorEntryTitle = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.warning400,
  margin: 0,
});

export const monitorEntryDescription = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  margin: 0,
});

export const monitorActions = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: vars.space['2'],
});

/**
 * The monitor's running log.
 *
 * The console look itself moved to `components/console.css.ts` when Software
 * Updates needed the same surface for a package-manager command — two elements
 * that must be the same colour, defined apart, is the shape of every drift bug
 * in ERRORS.md. What stays here is the part that is about THIS container: it
 * fills the flex column and scrolls vertically.
 */
export const terminal = style([
  consoleSurface,
  {
    padding: vars.space['6'],
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
]);

export const terminalLine = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  fontFamily: vars.font.code,
});

export const bottomPanel = style({
  flexShrink: 0,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  background: vars.color.neutral50,
  padding: `${vars.space['4']} ${vars.space['6']}`,
});

export const promptOverlay = style({
  position: 'absolute',
  bottom: vars.space['4'],
  left: vars.space['4'],
  right: vars.space['4'],
  zIndex: 10,
});

globalStyle(`${promptOverlay} > div`, {
  width: '100%',
  maxWidth: '100%',
});

export const promptCard = style({
  background: vars.color.surface,
  borderRadius: vars.radius.lg,
  border: `${vars.border.thin} solid ${vars.color.warning200}`,
  boxShadow: vars.shadow.lg,
  padding: `${vars.space['4']} ${vars.space['5']}`,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['4'],
  animation: `${promptSlideUp} ${vars.duration.normal} ${vars.easing.out}`,
  '@media': {
    [upTo('md')]: {
      flexWrap: 'wrap',
    },
  },
});

export const promptContent = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  flex: 1,
  minWidth: 0,
});

export const promptIcon = style({
  color: vars.color.warning400,
  flexShrink: 0,
});

export const promptTitle = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const promptActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  flexShrink: 0,
  // Below 640px the actions flow onto their own row under the message
  '@media': {
    [upTo('md')]: {
      flexBasis: '100%',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
    },
  },
});

export const dropdownCompact = style({
  scrollbarWidth: 'none',
});
