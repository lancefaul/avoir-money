import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';
import { upTo } from '../theme/breakpoints.js';

export const layout = style({ display: 'flex', height: '100%', overflow: 'hidden' });

/** Expanded rail width. Shared so the brand lockup can fill it exactly. */
const SIDEBAR_WIDTH = '14rem';

export const sidebar = style({
  display: 'flex',
  flexDirection: 'column',
  width: SIDEBAR_WIDTH,
  flexShrink: 0,
  // Semantic, not a palette stop: a theme has to be able to give its rail a
  // colour. Reading `neutral900` directly made Empire's nav its charcoal seed —
  // black, in a theme with no other black in it.
  background: vars.color.sidebarSurface,
  /*
   * `textSecondary`, not `rgba(255,255,255,0.6)`.
   *
   * Every colour in this file was a translucent white, which is correct on a
   * dark rail and invisible on a light one — the same defect as `checkboxIcon`
   * hardcoding `white`, and the reason `on-vivid-fills.test.ts` used to assert
   * "the rail must stay dark". That was never a design requirement; it was this
   * file's limitation stated as one. Tokens invert with the palette, so the
   * constraint dissolves and a theme can put its rail wherever it likes.
   */
  color: vars.color.textSecondary,
  borderRight: `${vars.border.thin} solid ${vars.color.border}`,
  transition: `width ${vars.duration.normal} ${vars.easing.inOut}`,
  overflow: 'hidden',
  '@media': {
    [upTo('xl')]: {
      width: '3.25rem',
    },
  },
});
export const sidebarCollapsed = style({ width: '3.25rem' });

export const brand = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['4']} ${vars.space['3']}`,
  flexShrink: 0,
});
export const brandCentered = style({ justifyContent: 'center', padding: `${vars.space['4']} 0` });
export const brandIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});
export const brandIconCircle = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: vars.radius.full,
});
export const brandIconImage = style({
  display: 'block',
  flexShrink: 0,
  width: '1.75rem',
  height: '1.75rem',
});
/**
 * The wordmark beside the app mark.
 *
 * Upright, not italic. The italic was added when the rail was permanently dark
 * and the wordmark was doing all the brand work on its own; beside the round
 * badge it reads as emphasis on a word that needs none, and it is the one
 * italic in the entire interface.
 *
 * `textPrimary`, not `rgba(255,255,255,0.85)` — the wordmark has to survive a
 * light rail like everything else in this file.
 */
export const brandText = style({
  fontFamily: vars.font.display,
  fontSize: vars.font.xl,
  fontWeight: vars.font.semibold,
  letterSpacing: '0.0625rem',
  color: vars.color.textPrimary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const navList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: `${vars.space['1']} ${vars.space['2']}`,
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
});
export const navListCentered = style({ padding: `${vars.space['1']} 0`, alignItems: 'center' });

export const navItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['4'],
  padding: `0 ${vars.space['2']}`,
  height: '2.25rem',
  borderRadius: vars.radius.sm,
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  width: '100%',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  selectors: {
    '&:hover': { background: vars.color.surfaceHover, color: vars.color.textPrimary },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});
/**
 * The selected rail item.
 *
 * `navItemSelected` + `neutral0` — byte-for-byte what `tabs.css.ts` uses for a
 * selected tab. ADR-026 decided the rail and the horizontal tabs are one
 * visual language and refactored the tabs to match the rail; the rail itself
 * was left reading translucent white and so never actually joined. It does now,
 * which means a theme states its selection colour once and both obey.
 *
 * Consequence worth naming: in the dark themes `navItemSelected` is gold, so a
 * selected rail item there stops being a faint white wash and becomes the same
 * gold as the selected tab beside it. That is the convergence, not a side
 * effect of it.
 *
 * # The hover has to restate the colour
 *
 * `:hover` here declares BOTH, and the colour is the load-bearing half. Both
 * this rule and `navItem`'s `:hover` have specificity (0,2,0), so the later one
 * wins per property — and this rule used to declare only a background. The
 * label therefore fell through to `navItem:hover`'s `textPrimary`, which is
 * near-black in a light theme: hovering a selected item turned its white label
 * black on its own dark pill, and the fill never moved.
 */
export const navItemActive = style({
  background: vars.color.navItemSelected,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  selectors: {
    '&:hover': {
      background: vars.color.navItemSelectedHover,
      color: vars.color.neutral0,
    },
  },
});

export const navItemIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.25rem',
  height: '2.25rem',
  borderRadius: vars.radius.sm,
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  outline: 'none',
  flexShrink: 0,
  selectors: {
    '&:hover': { background: vars.color.surfaceHover, color: vars.color.textPrimary },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
  },
});
/** The collapsed rail's selected item. Same pairing, same hover, as `navItemActive`. */
export const navItemIconActive = style({
  background: vars.color.navItemSelected,
  color: vars.color.neutral0,
  selectors: {
    '&:hover': {
      background: vars.color.navItemSelectedHover,
      color: vars.color.neutral0,
    },
  },
});

export const navItemActiveBrand = style({
  background: vars.color.brand400,
  color: vars.color.neutral0,
  fontWeight: vars.font.semibold,
  selectors: { '&:hover': { background: vars.color.brand400 } },
});
export const navItemIconActiveBrand = style({
  background: vars.color.brand400,
  color: vars.color.neutral0,
  selectors: { '&:hover': { background: vars.color.brand400 } },
});

export const iconWrap = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '1.25rem',
  height: '1.25rem',
});
export const labelWrap = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
});

export const rightIconWrap = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '1.25rem',
  height: '1.25rem',
  color: vars.color.textTertiary,
  marginLeft: 'auto',
});

export const navSection = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  padding: `${vars.space['3']} ${vars.space['3']} ${vars.space['1']}`,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const collapseBtn = style({
  width: '100%',
  height: '2.625rem',
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  borderRadius: 0,
  flexShrink: 0,
  selectors: {
    '&:active:not(:disabled)': { transform: 'none' },
  },
});

export const content = style({ flex: 1, overflow: 'auto', minWidth: 0 });

export const navBottom = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: `${vars.space['2']} ${vars.space['2']}`,
  flexShrink: 0,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
});
export const navBottomCentered = style({ padding: `${vars.space['2']} 0`, alignItems: 'center' });
