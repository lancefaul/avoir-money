import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Base tag ── */
export const tag = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['2'],
  padding: `${vars.space['1']} ${vars.space['2']}`,
  // Asymmetric radius: pill left, xs (4px) right
  borderRadius: `${vars.space['4']} ${vars.radius.xs} ${vars.radius.xs} ${vars.space['4']}`,
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  lineHeight: vars.font.leadingNormal,
  whiteSpace: 'nowrap',
  background: vars.color.neutral100,
  color: vars.color.textPrimary,
});

/* ── Sizes ── */
export const tagSm = style({
  fontSize: vars.font.xs,
  padding: `${vars.space['0.5']} ${vars.space['1']}`,
  gap: vars.space['1'],
  // sm: pill left, xs (4px) right
  borderRadius: `${vars.space['3']} ${vars.radius.xs} ${vars.radius.xs} ${vars.space['3']}`,
});

export const tagLg = style({
  fontSize: vars.font.base,
  padding: `${vars.space['1']} ${vars.space['3']}`,
  // lg: pill left, xs (4px) right
  borderRadius: `${vars.space['5']} ${vars.radius.xs} ${vars.radius.xs} ${vars.space['5']}`,
});

/* ── Dot colors (the leading dot inherits from these via currentColor on ::before) ── */
/* Tags are always neutral background. The dot shows the semantic color. */

export const tagDot = style({
  width: vars.space['2'],
  height: vars.space['2'],
  borderRadius: vars.radius.full,
  flexShrink: 0,
});

export const dotPositive = style({ background: vars.color.success400 });
export const dotNegative = style({ background: vars.color.danger400 });
export const dotWarning = style({ background: vars.color.warning400 });
export const dotInfo = style({ background: vars.color.info400 });
export const dotNeutral = style({ background: vars.color.neutral400 });
export const dotBrand = style({ background: vars.color.brand400 });

/* ── Close button ── */
export const tagCloseable = style({
  paddingRight: vars.space['1'],
});

export const tagCloseableSm = style({
  paddingRight: vars.space['0.5'],
});

export const tagClose = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: vars.space['4'],
  height: vars.space['4'],
  borderRadius: vars.radius.xs,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  opacity: 0.6,
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
  marginLeft: `calc(${vars.space['1']} - ${vars.space['2']})`,
  transition: `background ${vars.duration.fast} ${vars.easing.default}, opacity ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      opacity: 1,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      opacity: 1,
    },
  },
});

/* ── Selectable tag (button element) ── */
export const tagSelectable = style({
  cursor: 'pointer',
  border: 'none',
  outline: 'none',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}, box-shadow ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      background: vars.color.neutral200,
    },
    '&:focus-visible': {
      boxShadow: vars.focus.shadow,
    },
  },
});

/* Selected states — tag becomes the vivid semantic color */
export const tagSelectedPositive = style({
  background: vars.color.success400,
  color: vars.color.onSuccess,
  selectors: {
    '&:hover': { background: vars.color.success200 },
  },
});

export const tagSelectedNegative = style({
  background: vars.color.danger400,
  color: vars.color.onDanger,
  selectors: {
    '&:hover': { background: vars.color.danger300 },
  },
});

export const tagSelectedWarning = style({
  background: vars.color.warning400,
  color: vars.color.onWarning,
  selectors: {
    '&:hover': { background: vars.color.warning200 },
  },
});

export const tagSelectedInfo = style({
  background: vars.color.info400,
  color: vars.color.onInfo,
  selectors: {
    '&:hover': { background: vars.color.info200 },
  },
});

export const tagSelectedNeutral = style({
  background: vars.color.neutral400,
  color: vars.color.onNeutral,
  selectors: {
    '&:hover': { background: vars.color.neutral300 },
  },
});

export const tagSelectedBrand = style({
  background: vars.color.brand400,
  color: vars.color.textOnBrand,
  selectors: {
    '&:hover': { background: vars.color.brand200 },
  },
});

/* When selected, dot inherits the tag's text color (onColor token) */
export const dotSelected = style({
  background: 'currentColor',
});

export const dotSelectedWarning = style({
  background: 'currentColor',
});
