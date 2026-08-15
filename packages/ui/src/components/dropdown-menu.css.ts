import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';
import * as pp from './popover-panel.css.js';

/* ─── Trigger ─── */

export const trigger = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: vars.radius.sm,
  border: `${vars.border.thin} solid transparent`,
  background: 'transparent',
  color: vars.color.textSecondary,
  cursor: 'pointer',
  transition: `background ${vars.duration.normal} ${vars.easing.default}, color ${vars.duration.normal} ${vars.easing.default}, border-color ${vars.duration.normal} ${vars.easing.default}`,
  outline: 'none',
  selectors: {
    '&:hover': {
      // Same fill as a menu row — opening a menu and highlighting a row in it
      // are one gesture. No longer shared with the ghost button, which moved to
      // `controlHover` on 2026-08-09 so the two could take different colours.
      background: vars.color.surfaceHover,
      color: vars.color.textPrimary,
      borderColor: vars.color.border,
    },
    '&:active': { background: vars.color.surfacePressed },
    '&:focus-visible': { boxShadow: vars.focus.shadow },
    '&:disabled': { opacity: '0.35', cursor: 'not-allowed' },
  },
});

export const triggerOpen = style({
  // Matches the hover fill on purpose: while its menu is open the trigger IS
  // the active element, and holding a different colour made it look like the
  // hover had been lost the moment the pointer moved into the menu.
  background: vars.color.surfaceHover,
  color: vars.color.textPrimary,
  borderColor: vars.color.border,
});

/* ─── Menu container ─── */

export const menu = style([
  pp.panel,
  {
    minWidth: '13rem',
    maxWidth: '15rem',
    /*
     * Tall enough for a full menu, capped so it can never leave the viewport.
     *
     * 28rem used to cut the last item off a menu of ordinary length — the
     * transactions filter runs to roughly 30rem, so "Clear filters" sat below
     * the fold and the menu scrolled for the sake of one row. Long lists are
     * not the reason this cap exists: a searchable sub-menu scrolls inside its
     * own panel (`submenu`, 20rem), so what is measured here is only the outer
     * list of entries.
     *
     * The `min()` keeps both properties. The viewport term is what makes the
     * positioning safe: `DropdownMenuContent` clamps the menu's bottom edge by
     * moving `top` upward, which can only stay on screen while the menu is
     * shorter than the viewport. Capping at `100dvh - 1rem` guarantees that.
     */
    maxHeight: `min(40rem, calc(100dvh - ${vars.space['4']}))`,
    overflowY: 'auto',
    padding: `${vars.space['1']} 0`,
    outline: 'none',
    transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
  },
]);

export const menuOpening = pp.panelOpening;
export const menuOpen = pp.panelOpen;
export const menuClosing = pp.panelClosing;

/* ─── Bottom-sheet mode (narrow viewports) ───
   Below the sheet breakpoint the menu is presented like a modal window: a
   dimmed scrim plus a panel pinned to the bottom of the viewport, inset 1rem
   on every side. Declared after `menu` so these win the same-specificity tie —
   the panel's own min/max width and max height must all be overridden. */

export const sheetScrim = style({
  position: 'fixed',
  inset: 0,
  zIndex: vars.z.popover,
  background: vars.color.overlay,
});

export const sheet = style({
  top: 'auto',
  left: vars.space['4'],
  right: vars.space['4'],
  bottom: vars.space['4'],
  width: 'auto',
  minWidth: 0,
  maxWidth: 'none',
  // Grows upward from the bottom, stopping 1rem short of the top edge.
  maxHeight: `calc(100dvh - ${vars.space['8']})`,
  // The panel itself clips; the scrolling region is inside a page, so the
  // pinned Back/Cancel rows stay put while only the items scroll.
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  padding: 0,
  transformOrigin: 'bottom center',
});

/**
 * A page within a sheet — pinned regions wrapping a scrolling middle.
 *
 * The display rule is scoped to `:not([hidden])` deliberately: the root page is
 * hidden via the `hidden` attribute while drilled in, and an unconditional
 * `display: flex` would outrank the UA's `[hidden] { display: none }`.
 */
export const sheetPage = style({
  selectors: {
    '&:not([hidden])': {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
    },
  },
});

/** The scrolling middle of a sheet page. */
export const sheetScroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  // Keeps the first item clear of the panel's top edge on the root page, which
  // has no pinned region above it.
  paddingTop: vars.space['1'],
});

/**
 * A pinned region — Back at the top, Cancel at the bottom. Never scrolls away,
 * so an escape is always reachable without scrolling back through the list.
 */
export const sheetPinned = style({
  flexShrink: 0,
  background: vars.color.surface,
});

/* Items carry a rounded highlight inset 4px horizontally (see `item`). These
   restore the matching inset against the panel's outer edge — the panel itself
   has no padding in sheet mode, so without them a pinned row's highlight sits
   flush against the rounded corners. */

export const sheetPinnedTop = style({
  paddingTop: vars.space['1'],
});

export const sheetPinnedBottom = style({
  paddingBottom: vars.space['1'],
});

/* ─── Menu item ─── */

export const item = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  // Exactly the horizontal margin below, expressed as the token rather than its
  // px value: 2 × space[1] = space[2]. Hardcoding 8px meant the width silently
  // stopped matching the margin the moment either the spacing scale or the root
  // font size moved — which the 110% root scale does.
  width: `calc(100% - ${vars.space['2']})`,
  margin: `0 ${vars.space['1']}`,
  padding: `${vars.space['2']} ${vars.space['3']}`,
  border: 'none',
  background: 'transparent',
  borderRadius: vars.radius.sm,
  fontSize: vars.font.base,
  fontWeight: vars.font.regular,
  lineHeight: vars.font.leadingNormal,
  color: vars.color.textPrimary,
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': { background: vars.color.surfaceHover },
    '&:focus-visible': { background: vars.color.surfaceHover },
    '&[data-highlighted]': { background: vars.color.surfaceHover },
    '&:active': { background: vars.color.surfacePressed },
  },
});

export const itemDanger = style({
  color: vars.color.danger400,
  selectors: {
    '&:hover': { background: vars.color.danger50, color: vars.color.danger600 },
    '&:focus-visible': { background: vars.color.danger50, color: vars.color.danger600 },
    '&:active': { background: vars.color.danger50, color: vars.color.danger600 },
  },
});

export const itemDisabled = style({
  color: vars.color.textPlaceholder,
  cursor: 'not-allowed',
  pointerEvents: 'none',
});

export const itemDangerDisabled = style({
  color: vars.color.danger300,
  opacity: 0.5,
  cursor: 'not-allowed',
  pointerEvents: 'none',
});

export const itemChecked = style({
  // `selectionMark`, not a ramp stop: a checked row is a committed selection,
  // and Empire light marks that in green while Empire Dark marks it in brass.
  // Each theme's value clears 4.5:1 against its own panel.
  color: vars.color.selectionMark,
});

export const itemIcon = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
});

/* ─── Keyboard shortcut hint ─── */

export const itemKbd = style({
  fontFamily: vars.font.code,
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  marginLeft: 'auto',
  flexShrink: 0,
});

/* ─── Badge ─── */

export const itemBadge = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingNormal,
  padding: `${vars.space['0.5']} ${vars.space['1']}`,
  borderRadius: vars.radius.full,
  flexShrink: 0,
  marginLeft: 'auto',
  background: vars.color.brand50,
  color: vars.color.brand600,
});

/* ─── Check indicator ─── */

export const itemCheck = style({
  flexShrink: 0,
  width: '0.875rem',
  height: '0.875rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.color.selectionMark,
  marginLeft: 'auto',
});

export const itemCheckHidden = style({
  visibility: 'hidden',
});

/* ─── Submenu arrow ─── */

export const itemArrow = style({
  flexShrink: 0,
  marginLeft: 'auto',
  color: vars.color.textTertiary,
  display: 'flex',
  alignItems: 'center',
});

/* ─── Sub-trigger highlighted when submenu open ─── */

// Same fill as a hovered row on purpose: an open submenu's parent IS the
// highlighted row, and the two drifting apart is immediately visible because
// they sit adjacent in the same panel.
export const itemSubOpen = style({
  background: vars.color.surfaceHover,
});

/* ─── Separator ─── */

export const separator = style({
  height: 0,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  margin: `${vars.space['1']} 0`,
});

/* ─── Label ─── */

export const label = style({
  padding: `${vars.space['2']} ${vars.space['3']} ${vars.space['1']}`,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  userSelect: 'none',
});

/* ─── Submenu panel ─── */

export const submenu = style({
  position: 'fixed',
  zIndex: 1001,
  minWidth: '13rem',
  maxWidth: '15rem',
  maxHeight: '20rem',
  overflowY: 'auto',
  background: vars.color.surface,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.lg,
  padding: `${vars.space['1']} 0`,
  outline: 'none',
  transition: `opacity ${vars.duration.fast} ${vars.easing.out}, transform ${vars.duration.fast} ${vars.easing.out}`,
});

export const submenuOpening = style({
  opacity: 0,
  transform: 'scale(0.95) translateX(-6px)',
});

export const submenuOpenRight = style({
  opacity: 1,
  transform: 'scale(1) translateX(0)',
});

export const submenuOpeningLeft = style({
  opacity: 0,
  transform: 'scale(0.95) translateX(6px)',
});

export const submenuClosing = style({
  opacity: 0,
  transform: 'scale(0.95)',
  transition: `opacity ${vars.duration.fast} ${vars.easing.in}, transform ${vars.duration.fast} ${vars.easing.in}`,
});
