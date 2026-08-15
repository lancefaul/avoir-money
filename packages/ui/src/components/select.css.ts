import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/* ── Trigger ── */
export const csTrigger = style({
  position: 'relative',
  width: '100%',
  height: '2.375rem',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space['1'],
  padding: `0 ${vars.space['7']} 0 ${vars.space['3']}`,
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
    '&:hover:not([data-disabled])': {
      borderColor: vars.color.inputBorderHover,
      background: vars.color.inputBgHover,
    },
    '&:focus-visible:not([data-disabled])': {
      borderColor: vars.focus.color,
      boxShadow: vars.focus.shadow,
    },
  },
});

export const csTriggerOpen = style({
  borderColor: vars.focus.color,
  boxShadow: vars.focus.shadow,
});

export const csTriggerDisabled = style({
  background: vars.color.inputBgDisabled,
  color: vars.color.textTertiary,
  cursor: 'not-allowed',
  borderColor: vars.color.border,
  boxShadow: 'none',
});

export const csTriggerError = style({
  borderColor: vars.color.borderError,
  boxShadow: vars.color.inputShadowError,
});

export const csTriggerMulti = style({
  height: 'auto',
  minHeight: '2.375rem',
  padding: `${vars.space['2']} ${vars.space['7']} ${vars.space['2']} ${vars.space['2']}`,
  flexWrap: 'wrap',
  rowGap: vars.space['2'],
  columnGap: vars.space['1'],
});

/**
 * Large-chip trigger — trims the top/bottom padding so a single row of 1.75rem
 * chips keeps the trigger at its default 2.375rem height. The trigger is
 * border-box, so 28px chip + 2×4px padding + 2×1px border = 38px, matching the
 * base trigger. Composed after `csTriggerMulti` so it overrides the padding only.
 */
export const csTriggerMultiLg = style({
  paddingTop: vars.space['1'],
  paddingBottom: vars.space['1'],
});

export const csLabel = style({
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
});

export const csPlaceholder = style({ color: vars.color.textPlaceholder });

export const csMultiPlaceholder = style({ paddingLeft: vars.space['1'] });

export const csChevron = style({
  position: 'absolute',
  right: vars.space['3'],
  top: '50%',
  transform: 'translateY(-50%)',
  color: vars.color.textTertiary,
  transition: `transform ${vars.duration.normal} ${vars.easing.default}`,
  display: 'flex',
  pointerEvents: 'none',
});

export const csChevronOpen = style({ transform: 'translateY(-50%) rotate(180deg)' });

/* ── Footer ── */
export const csFooter = style({
  padding: `${vars.space['1']} ${vars.space['3']}`,
  borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
});

export const csCount = style({
  fontSize: vars.font.sm,
  color: vars.color.textTertiary,
  textAlign: 'center',
});

export const csFooterBtnStart = style({ justifySelf: 'start' });
export const csFooterBtnEnd = style({ justifySelf: 'end' });

/* ── Empty state ── */
export const csEmpty = style({
  padding: `${vars.space['5']} ${vars.space['3']}`,
  textAlign: 'center',
  fontSize: vars.font.base,
  color: vars.color.textTertiary,
});

/* ── Scrollable items wrapper (pinned search/footer stay outside) ── */
export const csItemsScroll = style({
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  maxHeight: '14.75rem',
  padding: `${vars.space['1']} 0`,
  outline: 'none',
});
