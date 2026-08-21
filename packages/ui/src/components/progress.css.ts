import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Track ── */
export const track = style({
  width: '100%',
  borderRadius: vars.radius.full,
  background: vars.color.neutral100,
  overflow: 'hidden',
});

export const trackSm = style({ height: '0.375rem' });
export const trackMd = style({ height: '0.5rem' });
export const trackLg = style({ height: '0.75rem' });

/* ── Fill ── */
export const fill = style({
  height: '100%',
  borderRadius: vars.radius.full,
  transition: `width ${vars.duration.slow} ${vars.easing.inOut}`,
  minWidth: 0,
});

/* Color variants */
export const fillDefault = style({ background: vars.color.accent600 });
export const fillSuccess = style({ background: vars.color.success400 });
export const fillWarning = style({ background: vars.color.warning400 });
export const fillDanger = style({ background: vars.color.danger400 });
export const fillBrand = style({ background: vars.color.brand600 });

/* Striped overlay — diagonal repeating gradient */
export const fillStriped = style({
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent, transparent 0.375rem, rgba(255,255,255,0.2) 0.375rem, rgba(255,255,255,0.2) 0.75rem)',
  backgroundSize: '1.0625rem 100%',
});

/* ── Labels ── */
export const wrapper = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['2'],
});

export const label = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
});

export const valueText = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.regular,
  color: vars.color.textSecondary,
  fontVariantNumeric: 'tabular-nums',
});

export const helperText = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});

/* ── Segmented (multi-section) ── */
export const segmentedTrack = style({
  width: '100%',
  borderRadius: vars.radius.full,
  background: vars.color.neutral100,
  overflow: 'hidden',
  display: 'flex',
});
