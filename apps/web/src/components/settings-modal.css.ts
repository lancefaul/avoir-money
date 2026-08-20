import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const panel = style({
  maxWidth: '75rem',
  maxHeight: 'calc(100vh - 4rem)',
  width: '100%',
  height: '100%',
});

export const body = style({
  display: 'flex',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  padding: 0,
  scrollbarGutter: 'auto',
});

export const sideNav = style({
  width: '13rem',
  borderRadius: `0 0 0 ${vars.radius.xl}`,
  background: vars.color.neutral50,
  borderRight: `${vars.border.hairline} solid ${vars.color.border}`,
});

globalStyle(`${sideNav} > div:first-child`, {
  display: 'none',
});

globalStyle(`${sideNav} > div:nth-child(2)`, {
  paddingTop: vars.space['3'],
});

/* Light-colored nav items */
globalStyle(`${sideNav} button`, {
  color: vars.color.textSecondary,
});

globalStyle(`${sideNav} button:hover`, {
  background: vars.color.neutral100,
  color: vars.color.textPrimary,
});

export const navItemActive = style({});

globalStyle(`${sideNav} button.${navItemActive}`, {
  background: vars.color.neutral800,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
});

globalStyle(`${sideNav} button.${navItemActive}:hover`, {
  background: vars.color.neutral800,
  color: vars.color.neutral0,
});

export const contentWrap = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
});

export const content = style({
  flex: 1,
  overflowY: 'auto',
  padding: vars.space['6'],
  minHeight: 0,
});

export const contentFlush = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
});

export const contentHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['4'],
  padding: `${vars.space['6']} ${vars.space['6']} ${vars.space['4']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const contentScroll = style({
  flex: 1,
  overflowY: 'auto',
  padding: vars.space['6'],
  scrollbarGutter: 'stable',
  minHeight: 0,
});

export const contentBody = style({
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  minHeight: 0,
});

export const actionBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['4']} ${vars.space['6']}`,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  flexShrink: 0,
});

export const modalBodyFlush = style({
  padding: `0 ${vars.space['6']} ${vars.space['6']}`,
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  lineHeight: vars.font.leadingRelaxed,
});

/**
 * Padding for content inside `contentBody` that should NOT be flush.
 *
 * `contentBody` deliberately has none — it holds full-width tables whose rows
 * are meant to reach both edges. An empty state in the same slot inherits that
 * and ends up touching the panel edge while every other settings pane has room
 * around it. Matches `contentScroll`, which is what those other panes use.
 */
export const bodyInset = style({
  padding: vars.space['6'],
});
