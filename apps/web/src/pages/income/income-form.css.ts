import { style } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/* ── 3-column grid for by-month amount inputs ── */
export const monthGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: vars.space['2'],
});

export const monthCell = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['0.5'],
});

export const monthLabel = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
});

/* ── 2-column grid for alternating (biweekly / semi-monthly) ── */
const _alternatingGrid = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: vars.space['3'],
});

export const alternatingCell = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
});

export const alternatingLabel = style({
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
});
