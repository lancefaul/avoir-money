import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { from } from '@budget-tracker/ui/theme/breakpoints.js';

export const wrapper = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const typeGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['3'],
});

export const typeHeading = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

export const cardButton = style({
  all: 'unset',
  cursor: 'pointer',
  borderRadius: vars.radius.lg,
  transition: `box-shadow ${vars.duration.normal} ${vars.easing.default}`,
  selectors: {
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
  },
});

export const cardButtonSelected = style({
  // `selectionFill`, not a ramp stop: a chosen account is a committed selection,
  // and the two Empire themes mark that differently — green in light, gold in
  // dark. The halo is the same colour blurred, which reads as a glow in both.
  boxShadow: `0 0 0 0.1875rem ${vars.color.neutral50}, 0 0 0 0.375rem ${vars.color.selectionFill}, 0 0 0.75rem ${vars.color.selectionFill}`,
});

/* ── Account strip: horizontal, always above the ledger ── */

/** Full-width panel of horizontally-scrolling account cards, above the ledger. */
export const topPanel = style({
  flexShrink: 0,
  background: vars.color.neutral50,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

/** The horizontal scroller: type / Hidden / Archived groups run left-to-right. */
export const stripScroll = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: vars.space['5'],
  overflowX: 'auto',
  padding: vars.space['4'],
});

/** A group's cards run left-to-right. */
export const cardListRow = style({
  display: 'flex',
  flexDirection: 'row',
  gap: vars.space['3'],
});

/**
 * Card width inside the strip (the rail's card width: 22rem − 2×1rem padding).
 * `zoom` scales layout and content proportionally: 0.8 below 1200px (≈16rem
 * effective), 0.9 at ≥1200px (≈18rem effective).
 */
export const stripCard = style({
  width: '20rem',
  flexShrink: 0,
  zoom: 0.8,
  '@media': {
    [from('xxl')]: {
      zoom: 0.9,
    },
  },
});

export const main = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
});

export const content = style({
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
  scrollbarGutter: 'stable',
});

export const contentInner = style({
  maxWidth: '75rem',
  margin: '0 auto',
});

/**
 * Consequence line under the Starting Balance field.
 *
 * Editing the opening shifts the account's current balance by the same amount.
 * That movement is the whole point of the edit, so it is shown before saving
 * rather than discovered afterwards — an invisible figure absorbing changes is
 * exactly what let a reversed card payment hide for four months.
 */
export const openingConsequence = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['0.5'],
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.info50,
  border: `${vars.border.hairline} solid ${vars.color.info200}`,
  fontSize: vars.font.sm,
  color: vars.color.info700,
  lineHeight: '1.4',
});

export const openingConsequenceValues = style({
  fontFamily: vars.font.display,
  fontSize: vars.font.lg,
  color: vars.color.textPrimary,
});

export const openingConsequenceArrow = style({
  color: vars.color.textTertiary,
  padding: `0 ${vars.space['1']}`,
});

/**
 * Shown when a rewards adjustment would take the balance below zero.
 *
 * Same block as the opening-balance consequence above, in warning rather than
 * info, because the two say different things: that one reports a movement that
 * is certain to happen, this one flags a result that is legal but implausible.
 * Going negative stays allowed — when the tracked balance was already too low,
 * refusing the entry preserves the wrong figure instead of correcting it.
 */
export const rewardsNegativeWarning = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['0.5'],
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderRadius: vars.radius.sm,
  background: vars.color.warning50,
  border: `${vars.border.hairline} solid ${vars.color.warning200}`,
  fontSize: vars.font.sm,
  color: vars.color.warning700,
  lineHeight: '1.4',
});

/**
 * The ledger's title row: account name on the left, its actions on the right.
 * The Reconcile button lives here rather than in the page header because a
 * reconciliation belongs to the account being viewed, not to the page.
 */
export const ledgerTitleRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['3'],
  marginBottom: vars.space['3'],
});

/**
 * The slot the empty state fills when there are no accounts.
 *
 * `stripScroll` is a flex ROW built for cards, so an empty state dropped into it
 * is a flex item sized to its own content — narrow, and nothing like the
 * full-width empty state every other page shows. `flex: 1` makes it take the
 * row. It stays inside the strip rather than replacing it because `stripRef`'s
 * wheel handler attaches on mount, and a strip that only appears once accounts
 * load would never receive one.
 */
export const emptySlot = style({
  flex: 1,
  minWidth: 0,
});
