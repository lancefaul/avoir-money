import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ─── Portal wrapper (fixed positioning) ─── */

export const portal = style({
  position: 'fixed',
  zIndex: vars.z.popover,
  opacity: 0,
  transition: `opacity ${vars.duration.fast} ${vars.easing.default}`,
});

export const portalVisible = style({
  opacity: 1,
});

/* ─── Panel (light popover surface with border + shadow) ─── */

export const panel = style({
  position: 'relative',
  background: vars.color.surface,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.lg,
  fontSize: vars.font.sm,
  lineHeight: vars.font.leadingNormal,
  color: vars.color.textPrimary,
  padding: `${vars.space['3']} ${vars.space['4']}`,
  maxWidth: '20rem',
});

/* ─── Arrow (rotated square matching the panel surface + border) ─── */

export const arrow = style({
  position: 'absolute',
  width: vars.space['2'],
  height: vars.space['2'],
  background: vars.color.surface,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  transform: 'rotate(45deg)',
});

/**
 * Side-specific arrow border clipping.
 * Only two edges of the rotated square are visible; the other two
 * are hidden behind the panel body via z-index layering.
 * We clip the inner edges so the border doesn't show inside the panel.
 */
export const arrowTop = style({
  borderTop: 'none',
  borderLeft: 'none',
});

export const arrowBottom = style({
  borderBottom: 'none',
  borderRight: 'none',
});

export const arrowLeft = style({
  borderBottom: 'none',
  borderLeft: 'none',
});

export const arrowRight = style({
  borderTop: 'none',
  borderRight: 'none',
});
