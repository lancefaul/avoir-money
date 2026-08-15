import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Trigger ── */
export const trigger = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['2'],
  height: '2.375rem',
  padding: `0 ${vars.space['3']}`,
  fontSize: vars.font.base,
  color: vars.color.textPrimary,
  background: vars.color.inputBg,
  border: `${vars.border.thin} solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  userSelect: 'none',
  transition: `border-color ${vars.duration.normal} ${vars.easing.default}, box-shadow ${vars.duration.normal} ${vars.easing.default}, background ${vars.duration.normal} ${vars.easing.default}`,
  boxShadow: vars.color.inputShadow,
  outline: 'none',
  selectors: {
    '&:hover': {
      borderColor: vars.color.inputBorderHover,
      background: vars.color.inputBgHover,
    },
    '&:focus-visible': {
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
  },
});

export const triggerOpen = style({
  borderColor: vars.focus.color,
  boxShadow: vars.focus.shadow,
});

export const triggerEmoji = style({
  fontSize: '1.25rem',
  lineHeight: '1',
});

export const triggerPlaceholder = style({
  color: vars.color.textPlaceholder,
  display: 'flex',
  alignItems: 'center',
});

export const triggerPlaceholderText = style({
  color: vars.color.textPlaceholder,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const triggerLabel = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  textTransform: 'capitalize',
});

export const triggerChevron = style({
  color: vars.color.textTertiary,
  transition: `transform ${vars.duration.normal} ${vars.easing.default}`,
  display: 'flex',
  marginLeft: 'auto',
  flexShrink: 0,
});

export const triggerChevronOpen = style({
  transform: 'rotate(180deg)',
});

/* ── Panel ── */
export const panel = style({
  display: 'flex',
  flexDirection: 'column',
});

export const searchWrap = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['2'],
  padding: `${vars.space['2']} ${vars.space['3']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const searchInput = style({
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  fontSize: vars.font.sm,
  color: vars.color.textPrimary,
  '::placeholder': {
    color: vars.color.textPlaceholder,
  },
});

export const groupTabs = style({
  display: 'flex',
  gap: vars.space['0.5'],
  overflowX: 'auto',
  padding: `${vars.space['1']} ${vars.space['2']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
});

export const groupTab = style({
  flexShrink: 0,
  padding: `${vars.space['1']} ${vars.space['2']}`,
  fontSize: '1rem',
  borderRadius: vars.radius.xs,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      background: vars.color.neutral100,
    },
  },
});

export const groupTabActive = style({
  background: vars.color.brand50,
  boxShadow: `inset 0 0 0 ${vars.border.thin} ${vars.color.brand200}`,
});

export const groupTabsWrap = style({
  padding: `${vars.space['2']} ${vars.space['2']}`,
  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
  overflowX: 'auto',
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(8, 1fr)',
  gap: vars.space['0.5'],
  padding: `${vars.space['1']} ${vars.space['2']}`,
  maxHeight: '13rem',
  overflowY: 'auto',
});

export const emojiButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  fontSize: '1.25rem',
  borderRadius: vars.radius.xs,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      background: vars.color.brand50,
    },
  },
});

export const noResults = style({
  gridColumn: '1 / -1',
  padding: `${vars.space['6']} 0`,
  textAlign: 'center',
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
});

export const footer = style({
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  padding: `${vars.space['2']} ${vars.space['3']}`,
  fontSize: vars.font.xs,
  color: vars.color.textTertiary,
});
