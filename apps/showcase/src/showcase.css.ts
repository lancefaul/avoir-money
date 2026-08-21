import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* ── Reset ── */
globalStyle('*, *::before, *::after', { boxSizing: 'border-box', margin: 0, padding: 0 });
globalStyle('html, body, #root', { height: '100%' });

/* ── Theme wrapper ── */
export const themeWrap = style({
  height: '100%',
  background: vars.color.background,
});

/* ── Page shell ── */
export const page = style({
  fontSize: vars.font.lg,
  lineHeight: vars.font.leadingNormal,
  fontVariantNumeric: 'tabular-nums',
  background: vars.color.background,
  color: vars.color.textPrimary,
  minHeight: '100%',
  padding: vars.space['12'],
});

export const pageTitle = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  marginBottom: vars.space['6'],
});

export const pageSubtitle = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['3xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  marginBottom: vars.space['8'],
});

/* ── Theme toggle ── */
export const themeToggleWrap = style({
  position: 'sticky',
  top: vars.space['4'],
  float: 'right',
  zIndex: vars.z.toast,
  display: 'inline-flex',
  gap: vars.space['1'],
});

/* ── Sections ── */
export const section = style({ marginBottom: vars.space['13'] });

export const sectionLabel = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingWide,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  marginBottom: vars.space['6'],
  paddingBottom: vars.space['2'],
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const ann = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  marginTop: vars.space['1'],
});

/* ── Swatches ── */
export const row = style({
  display: 'flex',
  gap: vars.space['3'],
  flexWrap: 'wrap',
  alignItems: 'flex-start',
});

export const swatch = style({
  borderRadius: vars.radius.md,
  overflow: 'hidden',
  width: '8.125rem',
  flexShrink: 0,
});
export const swatchBlock = style({ height: '3.25rem', width: '100%' });
export const swatchMeta = style({
  padding: `${vars.space['1']} ${vars.space['2']}`,
  background: vars.color.surface,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  borderTop: 'none',
  borderRadius: `0 0 ${vars.radius.md} ${vars.radius.md}`,
});
export const swatchName = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});
export const swatchHex = style({
  fontSize: '0.625rem',
  color: vars.color.textTertiary,
});
export const swatchRole = style({
  fontSize: '0.625rem',
  color: vars.color.textSecondary,
  marginTop: vars.space['0.5'],
});

/* ── Color ramp bar ── */
export const ramp = style({
  display: 'flex',
  borderRadius: vars.radius.xl,
  overflow: 'hidden',
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  marginBottom: vars.space['2'],
});
export const rampStop = style({
  flex: 1,
  height: '2.75rem',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  paddingBottom: vars.space['1'],
});
export const rampStopLabel = style({
  fontSize: '0.5625rem',
  fontWeight: vars.font.semibold,
  opacity: 0.65,
});

/* ── Pairing cards ── */
export const pairingCard = style({
  background: vars.color.surface,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  borderRadius: vars.radius.xl,
  overflow: 'hidden',
  boxShadow: vars.shadow.sm,
  marginBottom: vars.space['5'],
});
export const pairingHeader = style({
  padding: `${vars.space['3']} ${vars.space['5']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  background: vars.color.surfaceRaised,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});
export const pairingHeaderName = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});
export const pairingHeaderMeta = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  marginTop: vars.space['0.5'],
});
export const pairingBody = style({ padding: `${vars.space['6']} ${vars.space['7']}` });

export const typeRow = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: vars.space['5'],
  padding: `${vars.space['2']} 0`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});
export const typeSample = style({ flex: 1 });
export const typeSpec = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  minWidth: '16.25rem',
  lineHeight: vars.font.leadingSnug,
});

/* ── Card ── */
export const card = style({
  background: vars.color.surface,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  borderRadius: vars.radius.xl,
  padding: vars.space['6'],
  boxShadow: vars.shadow.sm,
});

/* ── Dashboard mockup ── */
export const statGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: vars.space['4'],
  marginBottom: vars.space['6'],
});
export const statCard = style({
  background: vars.color.surfaceRaised,
  borderRadius: vars.radius.xl,
  padding: vars.space['4'],
});
export const statLabel = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingWide,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  marginBottom: vars.space['1'],
});
export const statValue = style({
  fontFamily: vars.font.display,
  fontSize: '1.625rem',
  color: vars.color.textPrimary,
  lineHeight: vars.font.leadingTight,
  fontVariantNumeric: 'tabular-nums',
});
export const statSub = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
  marginTop: vars.space['1'],
});
export const sectionHeading = style({
  fontFamily: vars.font.display,
  fontSize: '1.375rem',
  color: vars.color.textPrimary,
  marginBottom: vars.space['4'],
  lineHeight: vars.font.leadingSnug,
});

/* ── Table ── */
export const tableWrap = style({
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  borderRadius: vars.radius.xl,
  overflow: 'hidden',
});
export const tableHead = style({
  display: 'grid',
  gridTemplateColumns: '2fr 1fr 1fr 1fr',
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});
export const tableHeadCell = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingWide,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
});
export const tableRow = style({
  display: 'grid',
  gridTemplateColumns: '2fr 1fr 1fr 1fr',
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  alignItems: 'center',
  selectors: {
    '&:last-child': { borderBottom: 'none' },
    '&:hover': { background: vars.color.surfaceRaised },
  },
});
export const rowName = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});
export const rowSub = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  marginTop: vars.space['0.5'],
});
export const rowNum = style({
  fontSize: vars.font.base,
  fontVariantNumeric: 'tabular-nums',
  color: vars.color.textPrimary,
  textAlign: 'right' as const,
});

/* ── Chips ── */
export const chipRow = style({
  display: 'flex',
  gap: vars.space['2'],
  flexWrap: 'wrap',
  marginBottom: vars.space['5'],
});
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['1'],
  padding: `${vars.space['1']} ${vars.space['2']}`,
  borderRadius: vars.radius.full,
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
});

/* ── Spacing bars ── */
export const spacingRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  marginBottom: vars.space['2'],
});
export const spacingBar = style({
  height: '0.625rem',
  background: vars.color.brand400,
  borderRadius: vars.radius.xs,
  flexShrink: 0,
});
export const spacingLabel = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

/* ── Radius demos ── */
export const radiusGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(6, 1fr)',
  gap: vars.space['3'],
});
export const radiusDemo = style({
  background: vars.color.surfaceRaised,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  height: '3.25rem',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: vars.space['0.5'],
});
export const radiusName = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

/* ── Shadow demos ── */
export const shadowGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: vars.space['4'],
});
export const shadowDemo = style({
  background: vars.color.surface,
  borderRadius: vars.radius.xl,
  height: '4rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});
export const shadowName = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

/* ── Nav tabs ── */
export const nav = style({
  display: 'flex',
  gap: vars.space['1'],
  marginBottom: vars.space['10'],
});

export const navTab = style({
  padding: `${vars.space['1']} ${vars.space['4']}`,
  borderRadius: vars.radius.md,
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  cursor: 'pointer',
  transition: `all ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&[data-active="true"]': {
      background: vars.color.neutral100,
      color: vars.color.textPrimary,
    },
    '&:hover:not([data-active="true"])': {
      background: vars.color.surfaceRaised,
      color: vars.color.textPrimary,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
    },
  },
});

export * from './showcase-icons.css.js';
