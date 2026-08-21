import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

/**
 * The terminal look, in one place.
 *
 * The import monitor has rendered a console since it shipped, and Software
 * Updates needs the same thing to show a package-manager command. Two copies of
 * a colour that must be identical is the two-writers failure this project keeps
 * logging, so the surface is defined once and both compose it.
 *
 * # Why these are literals and not tokens
 *
 * DESIGN.md bans hardcoded colours because a literal cannot be redirected by a
 * theme. That is the whole argument, and it does not apply here: a terminal is
 * meant to look like a terminal in all nine themes, so there is nothing for a
 * theme to say. Making it a token would mean adding a contract entry and the
 * same value nine times — a variable with one value, which is a constant
 * wearing a costume.
 *
 * The one genuinely theme-dependent property is the scrollbar, which belongs to
 * the browser rather than the design, so it keeps its token.
 */
const CONSOLE_BG = '#0d0f14';

/** Muted console text — comments and operators. Not exported until something outside needs it. */
const CONSOLE_MUTED = '#8b9099';

/**
 * The surface only: colour, face and scroll treatment.
 *
 * Deliberately carries no padding, radius or sizing — the import monitor fills
 * a flex column and Software Updates renders a small rounded block, and those
 * are properties of the container rather than of "being a console".
 */
export const consoleSurface = style({
  background: CONSOLE_BG,
  colorScheme: 'dark',
  fontFamily: vars.font.code,
  fontSize: vars.font.base,
  lineHeight: '1.8',
  scrollbarColor: `${vars.color.neutral600} transparent`,
});

/**
 * A short console block: a few lines of copyable command, not a running log.
 *
 * A row rather than a plain box, because the copy control sits inside the block
 * and must not scroll away with a long command. The command is the flex child
 * that scrolls; the button is a sibling that cannot.
 */
export const consoleBlock = style([
  consoleSurface,
  {
    display: 'flex',
    alignItems: 'flex-start',
    gap: vars.space['2'],
    padding: `${vars.space['3']} ${vars.space['4']}`,
    borderRadius: vars.radius.sm,
    margin: 0,
  },
]);

/**
 * The lines themselves.
 *
 * `overflowX: auto` rather than wrapping, because a wrapped shell command reads
 * as two commands and someone will run half of it. `minWidth: 0` is what lets a
 * flex child scroll at all — without it the child sizes to its content and
 * pushes the copy button off the block instead.
 */
export const consoleLines = style({
  flex: 1,
  minWidth: 0,
  overflowX: 'auto',
});

/**
 * One command line inside a block.
 *
 * The colour is a literal for the same reason the background is: the ground is
 * fixed, so a token that inverts with the palette would be legible in half the
 * themes and invisible in the other half. `textPrimary` is near-white in the
 * dark themes and near-black in the light ones — on this surface the second
 * spelling is unreadable, and it is the one the author's theme resolves to.
 */
export const consoleLine = style({
  // `<code>` is inline by default, so a block of them would run together on one
  // line — a comment and the command it describes are separate lines.
  display: 'block',
  margin: 0,
  whiteSpace: 'pre',
  color: '#e6e9ef',
});

/**
 * Syntax colours for a shell command.
 *
 * The data-viz ramp, which is the one family in the contract built to be told
 * apart at a glance — six hues at a single lightness, so nothing in a
 * highlighted line shouts louder than the rest. Its stops invert with the
 * palette (62% in the light themes, 76% in the dark ones) and BOTH clear the
 * fixed console ground comfortably — 6.3:1 and 9.8:1 — which is what makes it
 * safe to use a theme token on a surface that does not follow the theme. Pinned
 * in `on-vivid-fills.test.ts` rather than left to hold by luck.
 *
 * Comments and operators are the exception: dimming them is what every editor
 * does, and a hue would give scaffolding the same weight as the command.
 */
export const syntax = styleVariants({
  /** `# a note` */
  comment: { color: CONSOLE_MUTED },
  /** `sudo` — clay, because elevation is worth a glance, not an alarm. */
  priv: { color: vars.color.dataViz2 },
  /** `pacman`, `apt` */
  program: { color: vars.color.dataViz6 },
  /** `update`, `install` */
  sub: { color: vars.color.dataViz4 },
  /** `-Syu`, `--only-upgrade` */
  flag: { color: vars.color.dataViz3 },
  /** `&&` */
  op: { color: CONSOLE_MUTED },
  /** The package name — left plain so the subject reads as the subject. */
  arg: {},
});

export type SyntaxKind = keyof typeof syntax;
