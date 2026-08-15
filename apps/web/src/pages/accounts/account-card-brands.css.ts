import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* Brand-replica card faces (Prime Visa, Cash Wallet, Fidelity, Apple, Amazon,
   cash bill, C-note, HSA), extracted from account-card.css.ts. Re-exported
   from there so consumers keep a single import surface. */
/* ═══════════════════════════════════════════════════════
   Prime Visa — Whole Foods Market card replica
   DS gloves off per user instruction — hardcoded
   colors replicate the real Prime Visa credit card.
   ═══════════════════════════════════════════════════════ */

export const cardPrimeVisa = style({
  background:
    'linear-gradient(90deg, #0a2a1e 0%, #1a5c3a 35%, #1f6b42 50%, #1a5c3a 65%, #0a2a1e 100%)',
  aspectRatio: '1.586 / 1',
  padding: vars.space['5'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
});

export const primeVisaTexture = style({
  position: 'absolute',
  inset: 0,
  opacity: 0.12,
  backgroundImage: `repeating-linear-gradient(
    180deg,
    transparent,
    transparent 1px,
    rgba(255,255,255,0.15) 1px,
    rgba(255,255,255,0.15) 2px
  ),
  repeating-linear-gradient(
    180deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.1) 3px,
    rgba(0,0,0,0.1) 4px
  )`,
  pointerEvents: 'none',
  zIndex: 0,
});

export const primeVisaCarrots = style({
  position: 'absolute',
  top: '1%',
  left: '65%',
  width: '35%',
  height: '100%',
  objectFit: 'inherit',
  opacity: 1,
  pointerEvents: 'none',
  zIndex: 0,
});

export const primeVisaWfLogo = style({
  width: '30%',
  maxWidth: '5.5rem',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
  filter: 'brightness(0) invert(1)',
});

export const primeVisaVisaLogo = style({
  width: '3.5rem',
  height: 'auto',
  filter: 'brightness(0) invert(1) brightness(0.85)',
});

/**
 * The real card prints its balance in pure white. The shared `balanceCredit`
 * uses the dark contract's `textPrimary`, which is a warm silver — correct for
 * the generic credit card, too dim for this brand replica.
 */
export const primeVisaBalance = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#FFFFFF',
});

export const primeVisaBottomRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'relative',
  zIndex: 1,
});

/* ═══════════════════════════════════════════════════════
   Cash Wallet Card — modeled after HSA card
   DS gloves off per user instruction — hardcoded
   colors replicate the real Cash Wallet debit card.
   ═══════════════════════════════════════════════════════ */

export const cardCashApp = style({
  background: '#000000',
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
});

export const cashAppLogo = style({
  width: '40%',
  maxWidth: '7rem',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const cashAppBalanceRow = style({
  position: 'absolute',
  bottom: vars.space['6'],
  left: vars.space['6'],
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#FFFFFF',
  zIndex: 1,
});

export const cashAppBottomRight = style({
  position: 'absolute',
  bottom: vars.space['6'],
  right: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: vars.space['1'],
  zIndex: 1,
});

export const cashAppDebitLabel = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: '#FFFFFF',
  marginRight: vars.space['1'],
});

export const cashAppVisaLogo = style({
  width: '2.5rem',
  height: 'auto',
});

/* ═══════════════════════════════════════════════════════
   Fidelity Cash Management card
   DS gloves off per user instruction — hardcoded
   colors replicate the real Fidelity debit card.
   ═══════════════════════════════════════════════════════ */

export const cardFidelity = style({
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  backgroundImage: 'url(/fidelity-card-background.svg)',
  backgroundSize: 'cover',
  backgroundPosition: 'center',
});

export const fidelityTriangles = style({
  display: 'none',
});

export const fidelityFullLogo = style({
  width: '35%',
  maxWidth: '6rem',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const fidelityCircleLogo = style({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '35%',
  height: 'auto',
  zIndex: 0,
  pointerEvents: 'none',
  opacity: 0.9,
});

export const fidelityBalanceRow = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#FFFFFF',
});

export const fidelityBottom = style({
  marginTop: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'relative',
  zIndex: 1,
});

export const fidelityBottomRight = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: vars.space['1'],
});

export const fidelityDebitLabel = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: '#FFFFFF',
  marginRight: vars.space['1'],
});

export const fidelityVisaLogo = style({
  width: '2.5rem',
  height: 'auto',
});

/* ═══════════════════════════════════════════════════════
   Apple Gift Card
   White background, centered logo, dark text.
   ═══════════════════════════════════════════════════════ */

export const cardApple = style({
  background: '#FFFFFF',
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  border: `${vars.border.thin} solid ${vars.color.border}`,
});

export const appleLogo = style({
  position: 'absolute',
  top: '48%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '32%',
  maxWidth: '10rem',
  height: 'auto',
  zIndex: 0,
  pointerEvents: 'none',
});

export const costcoLogo = style({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '50%',
  maxWidth: '10rem',
  height: 'auto',
  zIndex: 0,
  pointerEvents: 'none',
});

export const appleBottom = style({
  marginTop: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const appleBalanceRow = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#1a1a1a',
});

/* ═══════════════════════════════════════════════════════
   Amazon Gift Card replica
   DS gloves off per user instruction — hardcoded
   colors replicate the real Amazon gift card.
   ═══════════════════════════════════════════════════════ */

export const cardAmazon = style({
  background: '#232F3E',
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
});

export const amazonLogo = style({
  width: '35%',
  maxWidth: '6rem',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const amazonSmile = style({
  position: 'absolute',
  top: '47%',
  left: '50%',
  transform: 'translate(-50%, -30%)',
  width: '50%',
  height: 'auto',
  zIndex: 0,
  pointerEvents: 'none',
});

export const amazonBottom = style({
  marginTop: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  position: 'relative',
  zIndex: 1,
});

export const amazonBalanceRow = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#FFFFFF',
});

const _amazonBottomActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  marginRight: `calc(-1 * ${vars.space['4']})`,
});

/* ═══════════════════════════════════════════════════════
   Cash Card — same anatomy as the branded gift cards
   (logo top-left, decorative mark centered, balance
   bottom-left) with the Great Seal standing in for a
   brand logo. Deep greenback background.
   ═══════════════════════════════════════════════════════ */

/* Colors sampled from a Series 1969 $1 note: warm ivory paper, near-black
   intaglio ink, and Treasury green reserved for the seal and serial numbers. */
const BILL_PAPER = '#F2F0E6';
const BILL_PAPER_EDGE = '#E4E1D2';
const BILL_GREEN = '#2C6E49';

export const cardCashSeal = style({
  background: `linear-gradient(160deg, ${BILL_PAPER}, ${BILL_PAPER_EDGE})`,
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
});

/**
 * Washington engraving in its native intaglio black, held back to a watermark
 * weight so the balance stays legible over it — the way the portrait sits on
 * the note itself.
 */
export const cashWashington = style({
  position: 'absolute',
  top: '50%',
  right: '4%',
  transform: 'translateY(-50%)',
  height: '118%',
  width: 'auto',
  opacity: 0.22,
  zIndex: 0,
  pointerEvents: 'none',
});

export const cashSealLogo = style({
  // The seal is square, so it takes a smaller share of the card's width than a
  // wordmark would while reading at the same optical size as the brand logos.
  width: '20%',
  maxWidth: '4.5rem',
  aspectRatio: '1 / 1',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const cashSealBottom = style({
  marginTop: 'auto',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: vars.space['3'],
  position: 'relative',
  zIndex: 1,
});

/**
 * Legibility comes from quieting the engraving under the text (see the scrim
 * below), not from blurring the type. The ink stays crisp — no text-shadow.
 */
export const cashSealBalanceRow = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: BILL_GREEN,
  flexShrink: 0,
});

/**
 * Paper-colored scrim: fades the portrait out toward the bottom edge so the
 * balance and name sit on near-clean paper. Sits above the engraving, below
 * the text. One per note, since each prints on its own paper.
 */
const scrimBase = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: '45%',
  zIndex: 0,
  pointerEvents: 'none',
} as const;

export const cashScrim = style({
  ...scrimBase,
  background: `linear-gradient(to top, ${BILL_PAPER_EDGE} -45%, rgba(228,225,210,0.72) 55%, rgba(228,225,210,0) 100%)`,
});

/* Treasury green — the ink the note reserves for the seal and serial numbers. */
export const cashSealName = style({
  fontSize: vars.font.xl,
  fontWeight: vars.font.semibold,
  color: BILL_GREEN,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});

/* ── $100 variant (checking/savings) ──
   Colors sampled from a Series 2021 $100: cool blue-grey paper, black
   intaglio, and the note's signature copper for the numerals — with the
   Treasury seal staying green, as it is on the real note.

   Declared AFTER the $1 styles it overrides: both set `color` at the same
   specificity, so the cascade is decided by source order. */
const C_NOTE_PAPER = '#DCE4E7';
const C_NOTE_PAPER_EDGE = '#C7D3D9';

/* The $100 differs from the $1 only in paper, portrait, seal, and scrim — the
   balance and account name stay Treasury green on both, as on the notes. */
export const cardCNote = style({
  background: `linear-gradient(160deg, ${C_NOTE_PAPER}, ${C_NOTE_PAPER_EDGE})`,
});

export const cNoteScrim = style({
  ...scrimBase,
  background: `linear-gradient(to top, ${C_NOTE_PAPER_EDGE} -45%, rgba(199,211,217,0.72) 55%, rgba(199,211,217,0) 100%)`,
});

/* ═══════════════════════════════════════════════════════
   HSA Card — Optum debit card replica
   DS gloves off per user instruction — hardcoded
   colors replicate the real Optum HSA debit card.
   ═══════════════════════════════════════════════════════ */

export const cardHsa = style({
  background: '#d4f0f0',
  aspectRatio: '1.586 / 1',
  padding: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
});

export const hsaLogo = style({
  width: '40%',
  maxWidth: '7rem',
  height: 'auto',
  position: 'relative',
  zIndex: 1,
});

export const hsaBalanceRow = style({
  position: 'absolute',
  bottom: vars.space['6'],
  left: vars.space['6'],
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#1B2A4A',
  zIndex: 1,
});

export const hsaBottomRight = style({
  position: 'absolute',
  bottom: vars.space['6'],
  right: vars.space['6'],
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: vars.space['1'],
  zIndex: 1,
});

export const hsaDebitLabel = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: '#1B2A4A',
  marginRight: vars.space['1'],
});

export const hsaMastercardLogo = style({
  width: '2.5rem',
  height: 'auto',
});

/* ── X Money — X (Twitter) brushed-metal debit/flex ──
   A light silver card (dark text, no darkTheme) with a large embossed X and a
   dark Visa mark, mirroring the physical card. Brand-replica colours are
   hardcoded here by the same convention as the cards above. */
export const cardXMoney = style({
  // Even brushed silver — no bright highlight band (no "flash"). The brushed
  // texture overlay supplies the metallic feel.
  background: 'linear-gradient(150deg, #d0d0d5 0%, #c3c3c9 52%, #b6b6bc 100%)',
  aspectRatio: '1.586 / 1',
  padding: vars.space['5'],
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  color: '#1a1a1f',
});

/* Fine brushed-metal lines. */
export const xMoneyTexture = style({
  position: 'absolute',
  inset: 0,
  opacity: 0.16,
  backgroundImage: `repeating-linear-gradient(
    180deg,
    transparent,
    transparent 1px,
    rgba(255,255,255,0.6) 1px,
    rgba(255,255,255,0.6) 2px
  ),
  repeating-linear-gradient(
    180deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.08) 3px,
    rgba(0,0,0,0.08) 4px
  )`,
  pointerEvents: 'none',
  zIndex: 0,
});

/* The big embossed X: the logo silhouette masked over a same-tone silver
   gradient, with a highlight/shadow pair so it reads as pressed into the metal. */
export const xMoneyMark = style({
  // Positioned box holds the glyph; contain fits it inside. To tune: left/top
  // move the X (bigger left/top = further right/down), width/height size it.
  position: 'absolute',
  width: '93%',
  height: '110%',
  left: '16%',
  top: '6%',
  WebkitMaskImage: 'url(/x-logo.svg)',
  maskImage: 'url(/x-logo.svg)',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  background: 'linear-gradient(135deg, #f6f6f8 0%, #d2d2d7 46%, #eeeef0 56%, #b6b6bc 100%)',
  filter: 'drop-shadow(0 1px 1px rgba(255,255,255,0.55)) drop-shadow(0 -1px 1px rgba(0,0,0,0.16))',
  opacity: 0.92,
  pointerEvents: 'none',
  zIndex: 0,
});

export const xMoneyBottomRow = style({
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  position: 'relative',
  zIndex: 1,
});

export const xMoneyBalance = style({
  fontSize: vars.font['2xl'],
  fontWeight: vars.font.semibold,
  color: '#1a1a1f',
});

export const xMoneyVisaWrap = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: vars.space['0.5'],
});

/* White Visa logo filtered to a dark metallic grey. */
export const xMoneyVisaLogo = style({
  width: '3.5rem',
  height: 'auto',
  filter: 'brightness(0) invert(0.18)',
});

export const xMoneyDebitFlex = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  color: '#3a3a40',
  letterSpacing: '0.04em',
});
