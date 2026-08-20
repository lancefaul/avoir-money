/**
 * The shared visual language for a transaction row.
 *
 * Owned here rather than by the Transactions page because two screens now
 * render rows that must look identical — the transaction log and the
 * reconciler's decision cards — while carrying genuinely different columns. The
 * log has a checkbox, a category, an account and an actions menu; a reconcile
 * row has a side badge and no account, and its bank half is not a transaction
 * at all but a statement line with no id, category, or account to show.
 *
 * So what is shared is the *chrome* — the card, the row metrics, the cell
 * treatments and the amount colours — and each screen composes its own columns
 * from it. Sharing the markup instead would mean a component whose column set
 * is conditional on which page is asking, which is the same drift in a costlier
 * shape.
 *
 * `transaction-list.css.ts` re-exports every name here, so the Transactions page
 * imports are unchanged.
 */
import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

export const card = style({
  borderRadius: vars.radius.lg,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  background: vars.color.neutral0,
  overflow: 'hidden',
});

/*
 * table-layout: fixed is REQUIRED. Each date group renders as a SEPARATE
 * <table>. Separate tables can only align their columns with each other if
 * column widths are deterministic and content-independent — which is exactly
 * what `fixed` provides (widths come purely from the <col> elements, never
 * from content). Under `auto`, every table measures its own content and picks
 * its own widths, so sections never line up.
 *
 * The <colgroup> gives the checkbox column a fixed rem width, the name column
 * NO width (auto) so it absorbs all leftover space and truncates via
 * overflow:hidden, and the rest fixed percentages. Under fixed layout the
 * browser honors each specified width exactly and hands the single auto
 * column everything left over — identical across every table => aligned.
 *
 * The same rule binds the reconciler: every decision renders its own table, so
 * their columns only line up down the page because the widths are declared.
 */
export const table = style({
  width: '100%',
  fontSize: vars.font.base,
  tableLayout: 'fixed',
  borderCollapse: 'collapse',
});

export const cell = style({
  padding: '0.25rem',
});

export const nameCell = style({
  color: vars.color.textPrimary,
  fontWeight: vars.font.medium,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

/**
 * A name cell that carries a badge alongside the text.
 *
 * The wrapper needs its own `overflow: hidden` and `minWidth: 0` because an
 * inline flex container inside a truncating cell otherwise escapes the cell's
 * clip, and the badge needs `flexShrink: 0` because flexible text crushes its
 * siblings before it truncates itself. Both are documented failures — see the
 * date-grouped-table and standalone-checkbox entries in ERRORS.md.
 */
export const nameWithBadge = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  overflow: 'hidden',
  minWidth: 0,
});

export const nameText = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const nameBadge = style({
  flexShrink: 0,
});

export const secondaryCell = style({
  color: vars.color.textSecondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tertiaryCell = style({
  color: vars.color.textTertiary,
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

export const amountPositive = style({ color: vars.color.success700 });
export const amountNegative = style({ color: vars.color.danger400 });
export const amountNeutral = style({ color: vars.color.textPrimary });

export const row = style({
  background: vars.color.neutral0,
  height: '2.375rem',
});
