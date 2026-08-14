import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* ═══════════════════════════════════════════════════════
   Base card
   ═══════════════════════════════════════════════════════ */

export const cardBase = style({
  overflow: 'hidden',
  position: 'relative',
  borderRadius: vars.radius.lg,
  boxShadow: vars.shadow.md,
  // Same ink as the Washington engraving: black at 22% (= rgba(0,0,0,0.22)).
  border: '1px solid oklch(0% 0 0 / 0.22)',
  selectors: {
    // The credit cards borrow `darkTheme` on the card div (see AccountCard.tsx)
    // only to remap their color tokens. That theme class also carries a global
    // `scrollbar-gutter: stable` (theme/globals.css.ts); because the card is
    // `overflow: hidden` (a scroll container), it reserves a scrollbar-width
    // gutter on the right, shrinking the padding box and pushing every
    // absolutely-positioned child (⋯ menu, carrots, texture, Visa logo) in from
    // the right edge. Cards never scroll, so force the gutter off. The doubled
    // selector outranks the single-class global rule regardless of CSS order.
    '&&': {
      scrollbarGutter: 'auto',
    },
  },
});

export const cardArchived = style({});

/* ═══════════════════════════════════════════════════════
   Credit Card (generic — not a brand replica)

   Every color is a DS token. The card carries the DS
   `darkTheme` class (see AccountCard.tsx), which remaps
   the contract to dark values, so these semantic tokens
   resolve to a dark plastic card under EVERY app theme.

   Raw neutral steps would not survive that: the scale is
   not a clean inversion across themes — `neutral800` is
   34% lightness in Arctic but 84% in Midnight, so a
   literal neutral gradient would render near-white on
   some themes.
   ═══════════════════════════════════════════════════════ */

export const cardCreditCard = style({
  background: `linear-gradient(135deg, ${vars.color.neutral900}, ${vars.color.surface})`,
  aspectRatio: '1.586 / 1',
  padding: vars.space['5'],
  display: 'flex',
  flexDirection: 'column',
});

export const creditTopRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

export const chip = style({
  width: '1.75rem',
  height: '1.25rem',
  background: vars.color.neutral600,
  borderRadius: vars.radius.xs,
});

export const contactless = style({
  color: vars.color.neutral500,
  transform: 'rotate(90deg)',
  display: 'flex',
});

export const balanceCredit = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

export const cardDots = style({
  fontFamily: vars.font.code,
  fontSize: vars.font.base,
  color: vars.color.neutral500,
  letterSpacing: vars.font.trackingLabel,
  display: 'flex',
  gap: vars.space['3'],
  marginTop: vars.space['3'],
});

export const cardNameCredit = style({
  fontSize: vars.font.base,
  color: vars.color.textTertiary,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  letterSpacing: vars.font.trackingLabel,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

const _creditBottom = style({
  marginTop: 'auto',
  marginLeft: `calc(-1 * ${vars.space['5']})`,
  marginRight: `calc(-1 * ${vars.space['5']})`,
  marginBottom: `calc(-1 * ${vars.space['5']})`,
  padding: `${vars.space['2']} ${vars.space['5']}`,
  background: 'rgba(0, 0, 0, 0.3)',
  display: 'flex',
  alignItems: 'center',
});

export const creditSpacer = style({
  flex: 1,
});

export const rewardsLineCredit = style({
  fontSize: vars.font.base,
  // textSecondary (63% L under the dark contract) is too dim over the card's
  // art; neutral700 lifts it while staying under the balance's textPrimary.
  color: vars.color.neutral700,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
  width: '100%',
});

/**
 * Tappable variant of the on-card rewards line (rewards-as-child-account). Same
 * look as rewardsLineCredit but a button that opens the rewards account's ledger.
 */
export const rewardsRowButton = style({
  fontSize: vars.font.base,
  color: vars.color.neutral700,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
  width: '100%',
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  transition: `color ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': { color: vars.color.textPrimary },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      borderRadius: vars.radius.xs,
    },
  },
});

/* "United States of America" footer */
const _cashFooter = style({
  fontSize: vars.font.xs,
  fontWeight: '600',
  color: vars.color.accent400,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  letterSpacing: '0.2em',
  textAlign: 'center',
  position: 'relative',
  zIndex: 2,
  marginTop: vars.space['2'],
});

/* ═══════════════════════════════════════════════════════
   Gift Card
   ═══════════════════════════════════════════════════════ */

export const cardGiftCard = style({
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  aspectRatio: '1.586 / 1',
  padding: vars.space['5'],
  display: 'flex',
  flexDirection: 'column',
});

export const cardNameGift = style({
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  letterSpacing: vars.font.trackingLabel,
});

export const balanceGift = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

export const barcode = style({
  display: 'flex',
  alignItems: 'stretch',
  height: vars.space['6'],
  marginTop: vars.space['3'],
  opacity: 0.15,
  overflow: 'hidden',
});

const _giftBottom = style({
  marginTop: 'auto',
  marginLeft: `calc(-1 * ${vars.space['5']})`,
  marginRight: `calc(-1 * ${vars.space['5']})`,
  marginBottom: `calc(-1 * ${vars.space['5']})`,
  padding: `${vars.space['2']} ${vars.space['5']}`,
  background: vars.color.neutral100,
  display: 'flex',
  alignItems: 'center',
});

export const giftSpacer = style({
  flex: 1,
});

const _rewardsLineGift = style({
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

const _cardDefault = style({
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  padding: vars.space['5'],
});

const _cardNameDefault = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

const _balanceDefault = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

const _balanceWrap = style({
  marginTop: vars.space['3'],
});

const _archivedLabel = style({
  fontSize: vars.font.xs,
  color: vars.color.warning700,
});

export * from './account-card-brands.css.js';

/* ═══════════════════════════════════════════════════════
   Action buttons
   ═══════════════════════════════════════════════════════ */

export const actions = style({
  position: 'absolute',
  top: vars.space['2'],
  right: vars.space['2'],
  display: 'flex',
  gap: vars.space['0.5'],
  zIndex: 2,
});

/* ═══════════════════════════════════════════════════════
   Shared layout helpers
   ═══════════════════════════════════════════════════════ */

const _flexGrow = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
});
