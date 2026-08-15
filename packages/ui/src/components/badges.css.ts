import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Base badge ── */
export const badge = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.space['1'],
  paddingLeft: vars.space['2'],
  paddingRight: vars.space['2'],
  borderRadius: vars.radius.full,
  fontFamily: vars.font.ui,
  fontSize: vars.font.sm,
  fontWeight: vars.font.semibold,
  lineHeight: vars.space['6'],
  whiteSpace: 'nowrap',
  minWidth: vars.space['6'],
  height: vars.space['6'],
});

/* ── Semantic variants ── */
export const badgePositive = style({
  background: vars.color.success50,
  color: vars.color.success700,
});

export const badgeNegative = style({
  background: vars.color.danger50,
  color: vars.color.danger600,
});

export const badgeWarning = style({
  background: vars.color.warning50,
  color: vars.color.warning700,
});

export const badgeInfo = style({
  background: vars.color.info50,
  color: vars.color.info700,
});

export const badgeNeutral = style({
  background: vars.color.neutral100,
  color: vars.color.neutral700,
});

export const badgeBrand = style({
  background: vars.color.brand50,
  color: vars.color.brand700,
});

/* ── Sizes ── */
export const badgeSm = style({
  fontSize: vars.font.xs,
  paddingLeft: vars.space['1'],
  paddingRight: vars.space['1'],
  minWidth: vars.space['5'],
  height: vars.space['5'],
  lineHeight: vars.space['5'],
});

export const badgeLg = style({
  fontSize: vars.font.base,
  paddingLeft: vars.space['3'],
  paddingRight: vars.space['3'],
  minWidth: vars.space['7'],
  height: vars.space['7'],
  lineHeight: vars.space['7'],
});

export const badgeXl = style({
  minWidth: vars.space['8'],
  height: vars.space['8'],
  lineHeight: vars.space['8'],
  fontSize: vars.font.base,
  paddingLeft: vars.space['3'],
  paddingRight: vars.space['3'],
});

export const badgeIconOnly = style({
  padding: '0',
  justifyContent: 'center',
});

/* ── Truncation ── */
/*
 * When applied, the badge may shrink within its container (min-width: 0)
 * and never exceeds it (max-width: 100%). Pair with `badgeLabel` on an inner
 * span so the label text truncates with an ellipsis INSIDE the pill instead
 * of the pill overflowing and getting clipped by the parent cell.
 */
export const badgeTruncate = style({
  minWidth: 0,
  maxWidth: '100%',
});

export const badgeLabel = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

/* ── Interactive (dropdown trigger) ── */
/* Applied when the badge carries a chevron and acts as a trigger (e.g. Select's
 * `trigger` prop): a pointer affordance, a subtle hover lift, and the system
 * focus ring on keyboard focus. */
export const badgeInteractive = style({
  cursor: 'pointer',
  transition: `box-shadow ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      boxShadow: vars.shadow.sm,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
  },
});

export const badgeChevron = style({
  flexShrink: 0,
});

/* ── Dot indicator (CSS pseudo-element) ── */
export const badgeDot = style({
  selectors: {
    '&::before': {
      content: '""',
      display: 'inline-block',
      width: vars.space['1'],
      height: vars.space['1'],
      borderRadius: vars.radius.full,
      background: 'currentColor',
      flexShrink: 0,
    },
  },
});

/* ── Count badge — numeric, always circular minimum ── */
export const badgeCount = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: vars.space['6'],
  height: vars.space['6'],
  padding: `0 ${vars.space['2']}`,
  borderRadius: vars.radius.full,
  fontFamily: vars.font.ui,
  fontSize: vars.font.sm,
  fontWeight: vars.font.semibold,
  lineHeight: '1',
  whiteSpace: 'nowrap',
});

export const badgeCountSm = style({
  minWidth: vars.space['5'],
  height: vars.space['5'],
  padding: `0 ${vars.space['1']}`,
  fontSize: vars.font.xs,
});

export const badgeCountXs = style({
  minWidth: vars.space['4'],
  height: vars.space['4'],
  padding: '0',
  fontSize: vars.font.xs,
});

export const badgeCountLg = style({
  minWidth: vars.space['7'],
  height: vars.space['7'],
  padding: `0 ${vars.space['2']}`,
  fontSize: vars.font.base,
});

export const badgeCountBrand = style({
  background: vars.color.brand600,
  color: vars.color.textOnBrand,
});

export const badgeCountDanger = style({
  background: vars.color.danger400,
  color: vars.color.neutral0,
});

export const badgeCountNeutral = style({
  background: vars.color.neutral100,
  color: vars.color.textPrimary,
});

/* ── Notification dot (no label) ── */
export const dotOnly = style({
  display: 'inline-block',
  width: vars.space['5'],
  height: vars.space['5'],
  borderRadius: vars.radius.full,
});

export const dotBrand = style({
  background: vars.color.brand600,
});

export const dotDanger = style({
  background: vars.color.danger400,
});

/* ── Icon badge wrapper (for positioning dots/counts on icons) ── */
export const iconBadgeWrap = style({
  position: 'relative',
  display: 'inline-flex',
});

export const iconBadgeCount = style({
  position: 'absolute',
  top: '-0.5rem',
  right: '-0.5rem',
});

export const iconBadgeDot = style({
  position: 'absolute',
  top: '-0.5rem',
  right: '-0.5rem',
});
