import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Container ── */
export const wrapper = style({
  display: 'flex',
  alignItems: 'flex-start',
  width: '100%',
});

/* ── Step item ── */
export const step = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  flex: 1,
  position: 'relative',
  minWidth: 0,
});

/* ── Icon container ── */
export const iconBase = style({
  width: '2.25rem',
  height: '2.25rem',
  borderRadius: vars.radius.full,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  position: 'relative',
  zIndex: 1,
  transition: `background ${vars.duration.normal} ${vars.easing.default}, border-color ${vars.duration.normal} ${vars.easing.default}`,
});

/*
 * The completed/active trail reads `selectionFill`, not a ramp.
 *
 * Empire light draws progress in green and Empire Dark in gold, so the colour
 * is the theme's call. All three pieces move together — completed dots, the
 * active dot and the connector between them are one trail, and splitting them
 * across two ramps would read as a rendering fault rather than a distinction.
 */
export const iconCompleted = style({
  background: vars.color.selectionFill,
  color: vars.color.textOnBrand,
});

export const iconActive = style({
  background: vars.color.selectionFill,
  color: vars.color.textOnBrand,
  boxShadow: `0 0 0 ${vars.space['1']} ${vars.color.selectionSoft}`,
});

export const iconPending = style({
  background: vars.color.neutral200,
  border: `${vars.border.thin} solid ${vars.color.border}`,
  color: vars.color.textTertiary,
});

/* ── Labels ── */
export const labelWrap = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: vars.space['0.5'],
  marginTop: vars.space['2'],
  textAlign: 'center',
  maxWidth: '8rem',
});

export const label = style({
  fontSize: vars.font.sm,
  fontWeight: vars.font.semibold,
  color: vars.color.textPrimary,
  lineHeight: vars.font.leadingSnug,
});

export const labelPending = style({
  color: vars.color.textTertiary,
});

export const description = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.regular,
  color: vars.color.textSecondary,
  lineHeight: vars.font.leadingSnug,
});

export const descriptionPending = style({
  color: vars.color.textTertiary,
});

/* ── Connector line ── */
export const connector = style({
  position: 'absolute',
  top: '1.125rem',
  left: 'calc(50% + 1.5rem)',
  right: 'calc(-50% + 1.5rem)',
  height: '0.125rem',
  borderRadius: vars.radius.full,
  transition: `background ${vars.duration.normal} ${vars.easing.default}`,
});

export const connectorCompleted = style({
  background: vars.color.selectionFill,
});

export const connectorPending = style({
  background: vars.color.neutral200,
});
