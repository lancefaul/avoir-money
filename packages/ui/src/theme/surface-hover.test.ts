/**
 * `surfaceHover` — the fill under a row in a floating panel.
 *
 * Asserted against the theme SOURCE files rather than the compiled contract,
 * because a vanilla-extract theme compiles to `var(--…)` references: at runtime
 * `vars.color.surfaceHover` is a variable name, not a colour, so the actual
 * values only exist in the source.
 *
 * The rule the token exists to enforce: **a hovered row moves AWAY from the
 * panel it sits on, in the direction that reads as coming forward** — darker on
 * a light panel, lighter on a dark one. Which direction that is falls out of the
 * panel's own lightness, so the tests derive it rather than listing themes.
 *
 * Both failures this replaced came from borrowing `surfaceRaised` for the job.
 * That token means "this card sits above the page", which is a different
 * question, and it broke in opposite directions at the two ends of the palette:
 * in the light themes it sat a hair under white (a ~2% step nobody could see),
 * and in the dark themes it is the page canvas — BELOW the card — so a hovered
 * row receded instead of lifting.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every theme in the contract. `cipherpunk` is wired but absent from ThemeGallery. */
const THEMES = [
  'light',
  'arctic',
  'dark',
  'midnight',
  'empire',
  'empire-dark',
  'empire-midnight',
  'empire-oled',
  'cipherpunk',
] as const;

/**
 * The themes a user can actually pick — the Empire pair since 2026-08-09. The
 * rest are retired: kept and still covered by the THEMES-wide assertions above,
 * but no longer offered, so the stricter on-screen bar below does not apply.
 */

/**
 * The Empire family — one theme in four greys. Midnight and OLED were generated
 * from Empire Dark on 2026-08-10 by substituting the neutral ramp and every
 * token that aliases a neutral stop; brand, accent, status, selection and
 * focus are byte-identical across the three dark ones. Naming the set keeps
 * the exclusions below from drifting into a list of `t !== '...'` clauses.
 */
const EMPIRE = ['empire', 'empire-dark', 'empire-midnight', 'empire-oled'] as const;
const isEmpire = (t: string): boolean => (EMPIRE as readonly string[]).includes(t);

const SELECTABLE = THEMES.filter((t) => isEmpire(t));

const source = (name: string): string => readFileSync(join(HERE, `theme-${name}.css.ts`), 'utf8');

/** Assignment of `key` in a theme file, as its literal oklch string. */
function tokenValue(src: string, key: string): string {
  const m = src.match(new RegExp(`\\n\\s+${key}:\\s*'([^']+)'`));
  if (!m) throw new Error(`token ${key} not found`);
  return m[1]!;
}

/**
 * Every palette stop in a theme — neutral, brand and accent — keyed by name.
 *
 * Scanned neutrals only until 2026-08-09, which quietly encoded "a hover fill is
 * a grey" rather than the rule DESIGN.md actually states: a semantic token must
 * be an exact copy of A PALETTE STOP. Empire tints its hover with `brand100`, so
 * the narrower scan would have rejected a value that satisfies the real rule.
 */
function paletteStops(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/\n\s+((?:neutral|brand|accent)\d+):\s*'([^']+)'/g))
    out.set(m[1]!, m[2]!);
  return out;
}

/** Lightness percentage out of an `oklch(L% C H)` string. */
function lightness(oklch: string): number {
  const m = oklch.match(/oklch\(\s*([\d.]+)%/);
  if (!m) throw new Error(`not an oklch value: ${oklch}`);
  return Number(m[1]);
}

/** Panel lightness vs hover lightness, for one theme. */
function step(name: string): { panel: number; hover: number; delta: number } {
  const src = source(name);
  const panel = lightness(tokenValue(src, 'surface'));
  const hover = lightness(tokenValue(src, 'surfaceHover'));
  return { panel, hover, delta: hover - panel };
}

describe('surfaceHover', () => {
  it.each(THEMES)('%s defines it', (name) => {
    expect(() => tokenValue(source(name), 'surfaceHover')).not.toThrow();
  });

  it.each(THEMES)('%s maps it to an exact palette stop', (name) => {
    // DESIGN.md: a semantic token must be an exact copy of a palette stop, not
    // a value near one. A hand-tweaked colour is invisible until the palette
    // moves and the token silently stops tracking it.
    const src = source(name);
    expect([...paletteStops(src).values()]).toContain(tokenValue(src, 'surfaceHover'));
  });

  it.each(THEMES)('%s moves hover away from the panel, never toward it', (name) => {
    // The load-bearing assertion. A dark theme whose hover goes DARKER than the
    // card is the bug that shipped; so is a light theme whose hover goes
    // lighter. Direction is derived from the panel, so this holds for any theme
    // added later without editing the test.
    const { panel, delta } = step(name);
    const panelIsLight = panel > 50;
    if (panelIsLight) expect(delta).toBeLessThan(0);
    else expect(delta).toBeGreaterThan(0);
  });

  it.each(THEMES)('%s clears a perceptible step', (name) => {
    // The original complaint was 1.77% (Dune) and 2.00% (Arctic) — present in
    // the file, invisible on screen.
    expect(Math.abs(step(name).delta)).toBeGreaterThanOrEqual(3);
  });

  it.each(SELECTABLE)('%s clears the step every approved theme reads at', (name) => {
    // The five pickable themes all sit at 4%+; only the unreachable cipherpunk
    // is tighter, and nobody has judged it on screen.
    expect(Math.abs(step(name).delta)).toBeGreaterThanOrEqual(4);
  });

  it('never reuses surfaceRaised in a theme where the two disagree in direction', () => {
    // Why the token was added at all: `surfaceRaised` is the page canvas in the
    // dark themes, i.e. BELOW the card, so borrowing it inverts the gesture.
    // Pinned as an explicit list so a future "simplification" that collapses
    // the two tokens fails loudly here rather than in someone's eyes.
    for (const name of ['dark', 'midnight'] as const) {
      const src = source(name);
      expect(tokenValue(src, 'surfaceHover')).not.toBe(tokenValue(src, 'surfaceRaised'));
    }
  });
});

/**
 * `controlHover` — the ghost button's own hover fill.
 *
 * Split out of `surfaceHover` on 2026-08-09 after the button quietly followed
 * menu rows onto the accent ramp. The original sharing was reasoned, not
 * careless — "one fill for every hover gesture, so a ghost button and a menu row
 * respond identically" — and it was correct right up until the two roles were
 * asked to be different colours. That is the recurring shape: a token borrowed
 * because it happens to match today becomes unreachable the moment one consumer
 * needs to diverge. Same story as `sidebarSurface` and `navItemSelected`.
 */
describe('controlHover', () => {
  it('is what the ghost button actually reads', () => {
    const buttons = readFileSync(join(HERE, '../components/buttons.css.ts'), 'utf8');
    const ghost = buttons.slice(buttons.indexOf('export const btnTrueGhost'));
    const body = ghost.slice(0, ghost.indexOf('});'));
    expect(body).toContain('vars.color.controlHover');
    expect(body).not.toContain('vars.color.surfaceHover');
  });

  it.each(THEMES)('%s keeps it neutral, never brand or accent', (name) => {
    // The property that makes the split worth having. A ghost button is chrome;
    // it should not pick up whatever colour the menus are wearing this week.
    const src = source(name);
    const neutrals = [...src.matchAll(/\n\s+(neutral\d+): '([^']+)'/g)].map((m) => m[2]!);
    expect(neutrals).toContain(tokenValue(src, 'controlHover'));
  });

  it.each(THEMES)('%s moves it away from the panel, like any other hover', (name) => {
    const src = source(name);
    const panel = lightness(tokenValue(src, 'surface'));
    const delta = lightness(tokenValue(src, 'controlHover')) - panel;
    if (panel > 50) expect(delta).toBeLessThan(0);
    else expect(delta).toBeGreaterThan(0);
    expect(Math.abs(delta)).toBeGreaterThanOrEqual(3);
  });
});

/** A press must be distinguishable from the hover it replaces. */
describe('surfacePressed', () => {
  it.each(SELECTABLE)('%s presses deeper than it hovers', (name) => {
    const src = source(name);
    const panel = lightness(tokenValue(src, 'surface'));
    const hover = lightness(tokenValue(src, 'surfaceHover'));
    const pressed = lightness(tokenValue(src, 'surfacePressed'));
    // "Deeper" is further from the panel, whichever direction that is.
    expect(Math.abs(pressed - panel)).toBeGreaterThan(Math.abs(hover - panel));
  });
});
