import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { from } from '@budget-tracker/ui/theme/breakpoints.js';

/* ── Greeting ── */
export const greeting = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['4xl'],
  // DM Serif Display ships only 400; anything heavier is faux-bold.
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  lineHeight: vars.font.leadingTight,
});

export const greetingSub = style({
  fontSize: vars.font.lg,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
  marginTop: vars.space['1'],
});

/* ── Card container (shared by chart wrappers and pay-period sections) ── */
export const card = style({
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  padding: vars.space['5'],
});

/* ── Grid layouts ── */
export const grid3 = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.space['4'],
  '@media': {
    [from('lg')]: {
      gridTemplateColumns: 'repeat(3, 1fr)',
    },
  },
});

const _grid4 = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: vars.space['4'],
});

const _grid1 = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.space['4'],
});

export const gridCharts = style({
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: vars.space['4'],
  '@media': {
    [from('lg')]: {
      gridTemplateColumns: 'repeat(2, 1fr)',
    },
  },
});

/* ── Pay period heading ── */
/* "Pay Period" and "Year to Date" — section eyebrows, so the label face. */
export const payPeriodLabel = style({
  fontFamily: vars.font.label,
  letterSpacing: vars.font.trackingLabel,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
});

export const payPeriodDate = style({
  fontFamily: vars.font.display,
  fontSize: vars.font['3xl'],
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  marginTop: vars.space['1'],
});

/* ── Table header row inside pay-period cards ── */
const _tableHeader = style({
  fontSize: vars.font.xs,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  letterSpacing: vars.font.trackingLabel,
  color: vars.color.textTertiary,
  fontWeight: vars.font.medium,
});

/* ── Section title inside pay-period cards ── */
const _sectionTitle = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  color: vars.color.textSecondary,
});

/* ── Period total amount ── */
const _sectionTotal = style({
  fontSize: vars.font.lg,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

/* ── Empty / loading placeholder text ── */
export const placeholder = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});

/* ── Page-level vertical stack (replaces Tailwind space-y-6) ── */
export const pageStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['6'],
});
