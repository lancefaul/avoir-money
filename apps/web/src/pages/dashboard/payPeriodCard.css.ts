import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { upTo } from '@budget-tracker/ui/theme/breakpoints.js';

/* ── Card wrapper ── */
export const card = style({
  background: vars.color.neutral0,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.lg,
  overflow: 'hidden',
});

export const cardHeader = style({
  padding: `${vars.space['4']} ${vars.space['5']}`,
});

export const cardTitle = style({
  fontSize: vars.font.lg,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
});

/* ── Section header (INCOME, EXPENSES) ── */
export const sectionLabel = style({
  fontFamily: vars.font.label,
  letterSpacing: vars.font.trackingLabel,
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  padding: `${vars.space['2']} 0.25rem`,
});

export const sectionLabelSpaced = style({
  paddingTop: vars.space['4'],
});

/* ── Table ──
 * tableLayout: fixed makes <col> widths in the colgroup literal and final —
 * the browser will NOT grow a column to fit its content. This is required
 * for the name column to actually truncate instead of expanding past its
 * allotted share whenever a row has spare horizontal room. All column
 * widths are declared on the <col> elements in TableColgroup, not here. */
export const table = style({
  width: '100%',
  fontSize: vars.font.base,
  tableLayout: 'fixed',
  borderCollapse: 'collapse',
});

export const cell = style({
  padding: '0.25rem',
  '@media': {
    [upTo('md')]: {
      paddingTop: vars.space['2'],
      paddingBottom: vars.space['2'],
    },
  },
});

export const cellFirst = style({
  width: '4.5rem',
  maxWidth: '4.5rem',
  paddingLeft: vars.space['5'],
  paddingRight: vars.space['5'],
});

export const cellLast = style({
  width: '4.5rem',
  maxWidth: '4.5rem',
  paddingLeft: vars.space['5'],
  paddingRight: vars.space['5'],
});

export const row = style({
  background: vars.color.neutral0,
  height: '2.625rem',
  '@media': {
    [upTo('md')]: {
      height: 'auto',
    },
  },
});

export const nameCell = style({
  color: vars.color.textPrimary,
  fontWeight: vars.font.medium,
});

/* Name text — always visible, truncates on its own line. */
export const nameCellPrimary = style({
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/*
 * Due-date sub-line inside the name cell. Hidden by default (the standalone
 * secondaryCell column shows the date above 680px). Shown at <=680px, which
 * is exactly when the secondaryCell column's <col> width collapses to 0 —
 * see TableColgroup's `narrow` branch. This is a pure CSS toggle; the <td>
 * structure/count never changes at any breakpoint.
 */
export const nameCellDate = style({
  display: 'none',
  fontSize: vars.font.xs,
  fontWeight: vars.font.regular,
  color: vars.color.textTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '@media': {
    [upTo('md')]: {
      display: 'block',
    },
  },
});

export const secondaryCell = style({
  color: vars.color.textSecondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const amountCell = style({
  textAlign: 'right',
  fontWeight: vars.font.medium,
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
});

export const actionsCell = style({
  textAlign: 'right',
});

/* ── Amount colors ── */
export const textPaid = style({ color: vars.color.success700 });
export const textOverdue = style({ color: vars.color.danger400 });

/* ── Last data row in a section — adds breathing room before the total row ── */
export const sectionLastRow = style({});

globalStyle(`${sectionLastRow} td`, {
  paddingBottom: vars.space['4'],
});

/* ── Positive / negative total colors ── */
export const totalPositive = style({ color: vars.color.success700 });
export const totalNegative = style({ color: vars.color.danger400 });

/* ── Section total row (Income Total, Expenses Total) ── */
export const sectionTotalRow = style({
  height: '2.75rem',
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
  borderBottom: `${vars.border.thin} solid ${vars.color.border}`,
  background: vars.color.neutral0,
});

/*
 * UI face, not the label face: these read as sentences ("Cash After
 * Expenses"), not as eyebrows, and Oswald at 0.16em tracking made them
 * compete with the section headers above them.
 */
export const sectionTotalLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
  padding: '0.25rem',
});

export const sectionTotalAmount = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.semibold,
  textAlign: 'right',
  padding: '0.25rem',
  fontVariantNumeric: 'tabular-nums',
});

/* ── Footer / cash remaining row ── */
export const footerRow = style({
  height: '2.75rem',
  borderTop: `${vars.border.thin} solid ${vars.color.border}`,
});

/* ── Empty state ── */
export const emptyText = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
  padding: `${vars.space['2']} 0.25rem`,
});
