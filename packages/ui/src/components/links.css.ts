import { style } from '@vanilla-extract/css';
import { vars } from '../theme/contract.css.js';

/**
 * Links read semantic tokens, not a ramp.
 *
 * They named `brand*` directly until 2026-08-10, which meant every theme got
 * the same ramp whether it suited it or not — and Empire Dark wanted links on
 * the accent (brass) while Empire light keeps them green. A component naming a
 * ramp cannot be redirected by a theme, so the three values moved into the
 * contract and each theme now answers for itself.
 *
 * Every theme's stop choice still clears 4.5:1 for the text against its own
 * surface; see the note on the tokens. The underline is decoration and is
 * deliberately softer.
 */

export const linkDefault = style({
  color: vars.color.textLink,
  textDecoration: 'underline',
  textDecorationThickness: vars.border.thin,
  textUnderlineOffset: vars.border.thick,
  textDecorationColor: vars.color.textLinkUnderline,
  cursor: 'pointer',
  transition: `color ${vars.duration.normal} ${vars.easing.default}, text-decoration-color ${vars.duration.normal} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      color: vars.color.textLinkHover,
      textDecorationColor: vars.color.textLink,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      borderRadius: vars.space['0.5'],
    },
  },
});

export const linkInfo = style({
  color: vars.color.textLink,
  textDecoration: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationThickness: vars.border.thin,
  textUnderlineOffset: vars.border.thick,
  textDecorationColor: vars.color.textLinkUnderline,
  cursor: 'help',
  transition: `color ${vars.duration.normal} ${vars.easing.default}, text-decoration-color ${vars.duration.normal} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      color: vars.color.textLinkHover,
      textDecorationColor: vars.color.textLink,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      borderRadius: vars.space['0.5'],
    },
  },
});

export const linkExternal = style({
  color: vars.color.textLink,
  textDecoration: 'underline',
  textDecorationThickness: vars.border.thin,
  textUnderlineOffset: vars.border.thick,
  textDecorationColor: vars.color.textLinkUnderline,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25em',
  transition: `color ${vars.duration.normal} ${vars.easing.default}, text-decoration-color ${vars.duration.normal} ${vars.easing.default}`,
  selectors: {
    '&:hover': {
      color: vars.color.textLinkHover,
      textDecorationColor: vars.color.textLink,
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: vars.focus.shadow,
      borderRadius: vars.space['0.5'],
    },
  },
});
