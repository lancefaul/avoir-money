import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* Icon showcase styles (grid, sizes, color usage, icon+text patterns) —
   split from showcase.css.ts and re-exported from there. */

/* ── Icon grid ── */
export const iconGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(6.25rem, 1fr))',
  gap: vars.space['0.5'],
});

export const iconCell = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: vars.space['2'],
  padding: vars.space['3'],
  borderRadius: vars.radius.md,
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      background: vars.color.surfaceRaised,
    },
  },
});

export const iconName = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
  textAlign: 'center' as const,
});

export const iconGroupLabel = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingWide,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  marginTop: vars.space['5'],
  marginBottom: vars.space['3'],
});

/* ── Icon sizes ── */
export const sizeRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['6'],
  padding: `${vars.space['3']} 0`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});

export const sizeDemo = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
});

export const sizeLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
  minWidth: '3.75rem',
});

export const sizeSpec = style({
  fontSize: vars.font.xs,
  color: vars.color.textSecondary,
  flex: 1,
});

export const sizeUsage = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

/* ── Icon color usage ── */
export const colorRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['3'],
  padding: `${vars.space['3']} 0`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});

export const colorSwatch = style({
  width: '2rem',
  height: '2rem',
  borderRadius: vars.radius.md,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

export const colorInfo = style({ flex: 1 });

export const colorName = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

export const colorDesc = style({
  fontSize: vars.font.sm,
  color: vars.color.textSecondary,
});

/* ── Icon + text patterns ── */
export const patternRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  padding: `${vars.space['3']} 0`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  fontSize: vars.font.base,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});

export const patternLabel = style({
  color: vars.color.textSecondary,
  minWidth: '10rem',
  fontSize: vars.font.xs,
});

export const col = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: vars.space['1'],
});

export const note = style({
  fontSize: vars.font.sm,
  lineHeight: vars.font.leadingRelaxed,
  color: vars.color.textSecondary,
  background: vars.color.surfaceRaised,
  border: `${vars.border.hairline} solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  padding: `${vars.space['3']} ${vars.space['4']}`,
  marginTop: vars.space['4'],
});
