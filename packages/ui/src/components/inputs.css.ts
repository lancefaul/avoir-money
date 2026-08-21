import { style, globalStyle } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Number spinner suppression ── */
globalStyle(
  'input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button',
  {
    WebkitAppearance: 'none',
    margin: 0,
  },
);
globalStyle('input[type=number]', { MozAppearance: 'textfield' });

/* ── Base input ── */
export const input = style({
  width: '100%',
  height: '2.375rem',
  padding: `0 ${vars.space['3']}`,
  fontSize: vars.font.base,
  fontWeight: vars.font.regular,
  color: vars.color.textPrimary,
  background: vars.color.inputBg,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  outline: 'none',
  transition: `border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}, background ${vars.duration.normal} ${vars.easing.default}`,
  boxShadow: vars.color.inputShadow,
  WebkitAppearance: 'none',
  appearance: 'none',
  selectors: {
    '&::placeholder': { color: vars.color.textPlaceholder },
    '&:hover:not(:disabled):not(:focus)': {
      borderColor: vars.color.inputBorderHover,
      background: vars.color.inputBgHover,
    },
    '&:focus': {
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
    '&:disabled': {
      background: vars.color.inputBgDisabled,
      color: vars.color.textTertiary,
      cursor: 'not-allowed',
      borderColor: vars.color.border,
      boxShadow: 'none',
    },
  },
});

export const inputError = style({
  borderColor: vars.color.borderError,
  borderWidth: vars.border.thick,
  boxShadow: vars.color.inputShadowError,
  selectors: {
    '&:focus': {
      borderColor: vars.color.borderError,
      boxShadow: vars.color.inputShadowError,
    },
  },
});

/* ── Textarea ── */
export const textarea = style({
  width: '100%',
  padding: `${vars.space['2']} ${vars.space['3']}`,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  background: vars.color.inputBg,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  outline: 'none',
  resize: 'none',
  minHeight: '5.5rem',
  lineHeight: '1.55',
  transition: `border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}`,
  boxShadow: vars.color.inputShadow,
  selectors: {
    '&::placeholder': { color: vars.color.textPlaceholder },
    '&:hover:not(:focus)': { borderColor: vars.color.inputBorderHover },
    '&:focus': {
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
  },
});

/* ── Input wrapper (prefix / suffix / action) ── */
export const inputWrap = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
});

export const inputPrefix = style({
  position: 'absolute',
  left: vars.space['3'],
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  pointerEvents: 'none',
  userSelect: 'none',
  lineHeight: '1',
});

export const inputSuffix = style({
  position: 'absolute',
  right: vars.space['3'],
  top: '50%',
  transform: 'translateY(-50%)',
  fontSize: vars.font.base,
  color: vars.color.textSecondary,
  pointerEvents: 'none',
  userSelect: 'none',
  lineHeight: '1',
});

export const inputIconLeft = style({
  position: 'absolute',
  left: vars.space['3'],
  top: '50%',
  transform: 'translateY(-50%)',
  color: vars.color.textTertiary,
  pointerEvents: 'none',
  display: 'flex',
  alignItems: 'center',
});

/* ── SearchInput container (used inside dropdown panels) ── */
export const searchWrap = style({
  padding: vars.space['1'],
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

/* ── Inline action positioning ── */
export const inputActionSlot = style({
  position: 'absolute',
  right: vars.space['1'],
  top: '50%',
  transform: 'translateY(-50%)',
});

export const inputActions = style({
  position: 'absolute',
  right: vars.space['1'],
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
});

/* ── Field chrome ── */
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['1'],
});

export const fieldLabel = style({
  fontSize: vars.font.base,
  fontWeight: vars.font.medium,
  color: vars.color.textPrimary,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
});

export const fieldLabelGroup = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['0'],
});

export const fieldRequired = style({
  color: vars.color.danger400,
  fontSize: vars.font.lg,
  lineHeight: '1',
});

export const fieldHelper = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
  lineHeight: '1.4',
});

export const fieldError = style({
  fontSize: vars.font.sm,
  color: vars.color.danger400,
  lineHeight: '1.4',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
});

globalStyle(`${fieldError} > svg`, { flexShrink: 0, marginTop: '-0.09375rem' });

/* ── Form layout helpers ── */
export const formStack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['4'],
});

export const formGrid2 = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: `${vars.space['3']} ${vars.space['4']}`,
});

export const formGrid3 = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: `${vars.space['3']} ${vars.space['4']}`,
});

/* ── Select (native) ── */
export const select = style({
  width: '100%',
  height: '2.375rem',
  padding: `0 ${vars.space['8']} 0 ${vars.space['3']}`,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  background: vars.color.inputBg,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  outline: 'none',
  cursor: 'pointer',
  WebkitAppearance: 'none',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239B9790' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: `right ${vars.space['3']} center`,
  transition: `border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}`,
  boxShadow: vars.color.inputShadow,
  selectors: {
    '&:hover': { borderColor: vars.color.inputBorderHover },
    '&:focus': { borderColor: vars.focus.color, boxShadow: vars.focus.shadow },
    '&:disabled': {
      background: vars.color.inputBgDisabled,
      color: vars.color.textTertiary,
      cursor: 'not-allowed',
    },
  },
});

/* ── Resizable textarea wrapper ── */
export const textareaWrap = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
});

export const textareaHandle = style({
  position: 'absolute',
  bottom: 0,
  left: '50%',
  transform: 'translate(-50%, 50%)',
  width: vars.space['12'],
  height: vars.space['3'],
  background: vars.color.neutral300,
  borderRadius: vars.radius.full,
  cursor: 'ns-resize',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  zIndex: '1',
  selectors: {
    '&:hover': { background: vars.color.neutral400 },
    '&:active': { background: vars.color.neutral450 },
  },
});

export const textareaHandleIcon = style({
  color: vars.color.neutral0,
  opacity: 0.7,
  display: 'flex',
  alignItems: 'center',
});

/* ── Section heading (uppercase divider used in form drawers) ── */
export const sectionHeading = style({
  fontSize: vars.font.xs,
  fontWeight: vars.font.semibold,
  letterSpacing: vars.font.trackingLabel,
  fontFamily: vars.font.label,
  textTransform: 'uppercase',
  color: vars.color.textTertiary,
  paddingBottom: vars.space['2'],
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  marginTop: vars.space['2'],
});
