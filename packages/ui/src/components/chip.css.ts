import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/*
 * Multi-select chips are the SAME fill as a selected button-group segment —
 * `accentFill` behind `onAccent`, gold in both Empire themes.
 *
 * Deliberately not the palest-stop-behind-darkest-stop construction a status
 * badge uses (`accent50` + `accent800`). That shape reads as a status: a tinted
 * background carrying coloured text. A chip is a chosen value, the same thing a
 * selected segment is, so it takes the same solid fill and near-black label.
 *
 * The border stays for geometry — removing it would resize the chip — but is
 * painted the fill colour, so the edge is invisible.
 */
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space['0.5'],
  height: '1.25rem',
  padding: `0 ${vars.space['0.5']} 0 ${vars.space['2']}`,
  background: vars.color.accentFill,
  color: vars.color.onAccent,
  border: `${vars.border.thin} solid ${vars.color.accentFill}`,
  borderRadius: vars.radius.full,
  fontSize: vars.font.sm,
  fontWeight: vars.font.medium,
  whiteSpace: 'nowrap',
});

/**
 * Large chip — a taller pill at the default body text size. Composed onto `chip`
 * (`${chip} ${chipLg}`); defined after it so its overrides win. A multi-select
 * using these must also trim its trigger's vertical padding (`csTriggerMultiLg`)
 * so a single row of them keeps the trigger at its default height.
 */
export const chipLg = style({
  height: '1.75rem',
  padding: `0 ${vars.space['1']} 0 ${vars.space['3']}`,
  fontSize: vars.font.base,
});

/** The remove button sized to match a large chip. */
export const chipXLg = style({
  width: '1.375rem',
  height: '1.375rem',
});

export const chipX = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.125rem',
  height: '1.125rem',
  borderRadius: vars.radius.full,
  border: 'none',
  background: 'transparent',
  color: vars.color.onAccent,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}, color ${vars.duration.fast} ${vars.easing.default}`,
  padding: '0',
  selectors: {
    '&:hover': { background: vars.color.accentFillHover, color: vars.color.onAccent },
    '&:focus-visible': { outline: 'none', boxShadow: vars.focus.shadow },
  },
});

export const chipGroup = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.space['1'],
  alignItems: 'center',
});
