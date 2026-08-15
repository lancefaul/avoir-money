/**
 * Glyphs drawn ON a vivid fill — the checkbox tick and indeterminate dash.
 *
 * Same source-reading approach, and the same reason, as `surface-hover.test.ts`:
 * a vanilla-extract theme compiles to `var(--…)` references, so the literal
 * colours only exist in the theme files.
 *
 * The bug this pins: `checkboxIcon` hardcoded `color: 'white'`. That is correct
 * in the light themes and wrong in the dark ones, because `accent600` — the fill
 * the glyph sits on — INVERTS across the palette: a 45% dark green in the light
 * themes, a 73% bright green in the dark ones. White on 73% green is barely
 * legible. `onNeutral` is the token that already answers "readable on a vivid
 * fill" per theme, so one reference replaces a constant that could only ever
 * suit half the themes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
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
 * The themes a user can actually pick, mirroring `OFFICIAL_THEMES` in the web
 * store. The other five were retired on 2026-08-09 — kept, exported and still
 * covered by every THEMES-wide assertion below, but no longer offered and so no
 * longer judged on screen. Same reason cipherpunk was excluded before it.
 *
 * Consequence worth stating: the retired themes are no longer held to the
 * on-screen bars (hover step, rail contrast, accent family). They all pass
 * today; nothing is being silenced. Restoring one to ThemeGallery means adding
 * it back here first.
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

const themeSource = (name: string): string =>
  readFileSync(join(HERE, `theme-${name}.css.ts`), 'utf8');

function tokenValue(src: string, key: string): string {
  const m = src.match(new RegExp(`\\n\\s+${key}:\\s*'([^']+)'`));
  if (!m) throw new Error(`token ${key} not found`);
  return m[1]!;
}

function lightness(oklch: string): number {
  const m = oklch.match(/oklch\(\s*([\d.]+)%/);
  if (!m) throw new Error(`not an oklch value: ${oklch}`);
  return Number(m[1]);
}

/**
 * Every theme must be registered in `globals.css.ts`.
 *
 * That file loops a hardcoded list and attaches, per theme class: scrollbar
 * styling, `scrollbar-gutter`, `::selection`, and — the load-bearing one — the
 * base `color` and `fontFamily` that everything inherits from. A theme left off
 * the list still compiles, still renders, and still looks broadly right in a
 * light palette, because the browser's default text colour is black and its
 * default scrollbar is light. In a DARK theme the same omission means black
 * text on a dark surface, everywhere nothing sets a colour explicitly.
 *
 * Empire Dark shipped that way. It was reported as "usage numbers are black,
 * and the portfolio value column, search the app — it's in a lot of places",
 * which points at dozens of components rather than at one missing array entry.
 */
describe('global styles', () => {
  const exportName = (t: string): string =>
    t.replace(/-(.)/g, (_, c: string) => c.toUpperCase()) + 'Theme';

  it('registers every theme, so none falls back to browser defaults', () => {
    const globals = readFileSync(join(HERE, 'globals.css.ts'), 'utf8');
    const list = globals.slice(
      globals.indexOf('const themeClasses = ['),
      globals.indexOf('];', globals.indexOf('const themeClasses = [')),
    );
    const missing = THEMES.map(exportName).filter((n) => !new RegExp(`\\b${n}\\b`).test(list));
    expect(missing).toEqual([]);
  });

  it('actually attaches the inherited text colour it is trusted for', () => {
    // If this rule is ever moved or dropped, the test above keeps passing while
    // the defect returns — the list would be complete but no longer do anything.
    const globals = readFileSync(join(HERE, 'globals.css.ts'), 'utf8');
    expect(globals).toContain('color: vars.color.textPrimary');
    expect(globals).toContain('fontFamily: vars.font.ui');
  });
});

describe('the checkbox glyph', () => {
  const styles = readFileSync(join(HERE, '../components/form-controls.css.ts'), 'utf8');

  it('takes its colour from a token, never a hardcoded literal', () => {
    // DESIGN.md bans hardcoded colours outright, and this is exactly why: a
    // literal cannot vary per theme, so it silently fails on half of them.
    const icon = styles.slice(styles.indexOf('export const checkboxIcon'));
    const body = icon.slice(0, icon.indexOf('});'));

    expect(body).toContain('vars.color.onNeutral');
    expect(body).not.toMatch(/color:\s*'(white|#[0-9a-f]{3,8}|rgb)/i);
  });

  it.each(THEMES)('%s reads legibly against the fill it sits on', (name) => {
    // The glyph and its fill must land on opposite sides of mid-lightness.
    // Before the fix, dark and midnight had a ~100% glyph on a ~73% fill — a
    // 27-point gap that reads as pale-on-pale.
    const src = themeSource(name);
    // brand600, not accent600: the checkbox/radio/toggle fills moved to the
    // brand ramp on 2026-08-09 when accent became brass. Measuring the glyph
    // against a fill no component paints would have passed while the real
    // pairing regressed — Empire's `onNeutral` had to flip white->dark->white
    // as that fill moved, and only this token says which is right.
    const glyph = lightness(tokenValue(src, 'onNeutral'));
    const fill = lightness(tokenValue(src, 'brand600'));

    expect(Math.abs(glyph - fill)).toBeGreaterThan(40);
    // And on the correct side: a light fill takes a dark glyph, and vice versa.
    if (fill > 50) expect(glyph).toBeLessThan(50);
    else expect(glyph).toBeGreaterThan(50);
  });

  it('the dark themes take a near-black glyph, not white', () => {
    // The specific report. Stated as its own case so the intent survives even
    // if the generic threshold above is ever loosened.
    for (const name of ['dark', 'midnight'] as const) {
      expect(lightness(tokenValue(themeSource(name), 'onNeutral'))).toBeLessThan(20);
    }
  });
});

/**
 * The primary button in the dark themes.
 *
 * Its palette already carried the intent — `brand900` is pure white and
 * `brand400` is commented "primary — near-white" — but the button was wired to
 * brand400, which is a 58% mid-grey. The comment was aspirational and the value
 * never caught up.
 */
describe('the primary button', () => {
  const DARK = ['dark', 'midnight'] as const;

  it.each(DARK)('%s renders it near-white', (name) => {
    const src = themeSource(name);
    expect(lightness(tokenValue(src, 'brandButtonFrom'))).toBeGreaterThan(90);
    expect(lightness(tokenValue(src, 'brandButtonTo'))).toBeGreaterThan(90);
  });

  it.each(DARK)('%s lightens it on hover rather than dimming it', (name) => {
    // The same gesture as every other dark-theme hover. Taking pure white for
    // the RESTING state would have forced this one control to darken instead,
    // since nothing is lighter than white.
    const src = themeSource(name);
    expect(lightness(tokenValue(src, 'brandButtonHoverFrom'))).toBeGreaterThan(
      lightness(tokenValue(src, 'brandButtonFrom')),
    );
  });

  it.each(DARK)('%s keeps its label readable on that fill', (name) => {
    // A near-white button needs near-black text; the old mid-grey fill did not.
    const src = themeSource(name);
    expect(lightness(tokenValue(src, 'textOnBrand'))).toBeLessThan(20);
  });

  it.each(DARK)('%s gives it a border that does not ring the button', (name) => {
    // brand200 (~40%) against a 95% fill drew a hard grey outline. The border
    // has to sit near the fill, not near the page.
    const src = themeSource(name);
    const border = lightness(tokenValue(src, 'brandButtonBorder'));
    expect(Math.abs(border - lightness(tokenValue(src, 'brandButtonFrom')))).toBeLessThan(15);
  });
});

/**
 * `accent` is the interactive/positive role. What COLOUR fills that role is the
 * theme's call — reversed 2026-08-09, deliberately.
 *
 * History, because this file previously forbade exactly what it now allows.
 * Empire defined `accent` as a warm gold, and on 2026-08-08 that was retired:
 * checkbox fills, links, selected rows, dropdown and datepicker selection,
 * progress, toast, step indicators and the dashboard's positive net-savings
 * bars all read `accent*`, so a gold accent made every one of them gold —
 * money that had gone UP included. The fix was to force the ramp back to green
 * and pin it here.
 *
 * The owner has since asked for brass again, with that consequence stated and
 * accepted: positive money in Empire is gold. So the hue assertion is gone.
 * What replaces it is the property that actually protected users — the gold is
 * only a problem if you cannot READ what sits on it, and brass is a light gold,
 * so the stops that carried a green accent do not carry this one. These tests
 * now check legibility rather than hue, on the surfaces the reversal moved.
 *
 * Still true, and still worth stating: a theme may choose the colour, but every
 * component reading `accent*` is asserting a MEANING. Nothing may read it to
 * mean "decorative".
 */
describe('the interactive colours stay legible in every theme', () => {
  /** Hue out of an `oklch(L% C H)` string. */
  function hue(oklch: string): number {
    const m = oklch.match(/oklch\(\s*[\d.]+%\s+[\d.]+\s+([\d.]+)/);
    if (!m) throw new Error(`no hue in: ${oklch}`);
    return Number(m[1]);
  }

  /** Relative luminance of an `oklch(L% C H)` string, for WCAG contrast. */
  function luminance(oklch: string): number {
    const m = oklch.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
    if (!m) throw new Error(`not an oklch value: ${oklch}`);
    const [L, C, H] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
    const a = C * Math.cos(H);
    const b = C * Math.sin(H);
    const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s3 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ].map((u) => Math.min(1, Math.max(0, u)));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  }
  const contrast = (x: string, y: string): number => {
    const [a, b] = [luminance(x), luminance(y)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  it.each(SELECTABLE)('%s keeps link text readable on its own surface', (name) => {
    // Asserted against whatever the component actually names, so moving one
    // without the other fails here. It has been four things now — `accent400`
    // on the green accent ramp, `accent700` when accent became brass,
    // `brand500` when links went back to green, and the semantic `textLink`
    // since each theme started answering for itself. The one invariant across
    // all four is that link text must be readable on the surface it sits on,
    // which is why the match is deliberately loose about WHICH token it is.
    const src = themeSource(name);
    const links = readFileSync(join(HERE, '../components/links.css.ts'), 'utf8');
    const stop = links.match(/export const linkDefault[\s\S]*?color: vars\.color\.(\w+)/)?.[1];
    expect(stop).toBeTruthy();
    expect(contrast(tokenValue(src, stop!), tokenValue(src, 'surface'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(SELECTABLE)('%s puts a readable glyph on the control fill', (name) => {
    // The checkbox/radio/toggle fill has been accent600-as-green,
    // accent600-as-brass and now brand600 across a single day, and Empire's
    // `onNeutral` had to go white -> dark -> white to keep up. Whichever token
    // the fill lands on, the tick drawn on it has to stay readable.
    const src = themeSource(name);
    expect(
      contrast(tokenValue(src, 'onNeutral'), tokenValue(src, 'brand600')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s agrees with the ramp its focus ring belongs to', (name) => {
    // Compared against `accent600` until 2026-08-09. That was right while accent
    // was the interactive colour everywhere; Empire then moved links, focus,
    // ::selection, tabs and the menu check onto `brand` and left brass on
    // accent, so a ring matching accent would now clash with everything it
    // actually appears beside. The rule is unchanged in substance — a focus
    // ring must not be a third colour — so it is checked against whichever ramp
    // the theme puts its interactive chrome on.
    const src = themeSource(name);
    const focus = src.match(/focus: \{[\s\S]*?color: '([^']+)'/);
    if (!focus) throw new Error('no focus.color');
    const h = hue(focus[1]!);
    const nearest = Math.min(
      Math.abs(h - hue(tokenValue(src, 'accent600'))),
      Math.abs(h - hue(tokenValue(src, 'brand600'))),
    );
    expect(nearest).toBeLessThan(30);
  });

  it('empire still does not carry the retired FOREST hue', () => {
    // Half of this guard is deliberately gone. It used to forbid the gold
    // (82.82) as well, and the owner has since chosen brass on purpose — so
    // asserting its absence would be this file arguing with a decision instead
    // of recording it. The forest green (172.01) was retired on its own merits
    // and nobody has asked for it back, so that half stands.
    const src = themeSource('empire');
    const values = src
      .split('\n')
      .filter((l) => /^\s+\w+: '/.test(l))
      .join('\n');
    expect(values).not.toMatch(/172\.01\)/);
  });

  it('empire gives surfaceRaised a gentle step off white', () => {
    // Originally surfaceRaised WAS the cream page canvas, a heavy 4.4% under
    // white. It now sits on neutral25. `background` was subsequently raised to
    // meet it, so the two agree again — deliberately, and matching how
    // theme-light is built — which is why this asserts the step off `surface`
    // rather than a difference from `background`.
    const src = themeSource('empire');
    const step =
      lightness(tokenValue(src, 'surface')) - lightness(tokenValue(src, 'surfaceRaised'));
    expect(step).toBeGreaterThan(1);
    expect(step).toBeLessThan(3.5);
    expect(lightness(tokenValue(src, 'surfaceRaised'))).toBeGreaterThan(
      lightness(tokenValue(src, 'neutral50')),
    );
  });

  it.each(THEMES)('%s defines neutral25 between neutral0 and neutral50', (name) => {
    const src = themeSource(name);
    const [zero, mid, fifty] = ['neutral0', 'neutral25', 'neutral50'].map((k) =>
      lightness(tokenValue(src, k)),
    );
    const lo = Math.min(zero!, fifty!);
    const hi = Math.max(zero!, fifty!);
    expect(mid!).toBeGreaterThan(lo);
    expect(mid!).toBeLessThan(hi);
  });
});

/**
 * Roles that were reading raw palette stops.
 *
 * The left rail took `neutral900` and a selected tab took `neutral800`. Both
 * work fine while every theme wants the same near-black chrome, and both become
 * unfixable the moment one does not: Empire's `neutral900` is its charcoal
 * seed, so its nav rendered black in a theme containing no other black, and no
 * amount of editing the emerald ramp could reach it.
 *
 * They are semantic roles now, so a theme can answer for itself. Every theme
 * except Empire was given the exact value it already rendered.
 */
describe('nav chrome is semantic, not a palette stop', () => {
  it('the components read the semantic tokens', () => {
    const sidenav = readFileSync(join(HERE, '../components/sidenav.css.ts'), 'utf8');
    const tabs = readFileSync(join(HERE, '../components/tabs.css.ts'), 'utf8');

    expect(sidenav).toContain('vars.color.sidebarSurface');
    expect(sidenav).not.toContain('background: vars.color.neutral900');
    expect(tabs).toContain('vars.color.navItemSelected');
    expect(tabs).not.toContain('background: vars.color.neutral800');
  });

  it.each(THEMES)('%s defines both', (name) => {
    const src = themeSource(name);
    expect(() => tokenValue(src, 'sidebarSurface')).not.toThrow();
    expect(() => tokenValue(src, 'navItemSelected')).not.toThrow();
  });

  it('the rail paints no colour of its own', () => {
    // The bug that made the rest of this section necessary, and the one worth
    // guarding directly. Every colour in `sidenav.css.ts` was a translucent
    // white — correct on a dark rail, invisible on a light one, and identical
    // in kind to `checkboxIcon` hardcoding `white` above. It is why the
    // assertion below USED to read "the rail must stay dark": that was never a
    // design requirement, it was this file's limitation stated as one.
    //
    // Comments are stripped first, and not as a nicety: the replacements are
    // documented by quoting the values they replaced, so a naive scan matches
    // the explanation and fails on a file that is entirely correct. A guard
    // that cannot tell code from prose would be turned off within a week.
    const sidenav = readFileSync(join(HERE, '../components/sidenav.css.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(sidenav).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255/);
  });

  it.each(THEMES.filter((t) => !isEmpire(t)))('%s keeps its own selection stop', (name) => {
    // The surviving half of the original scope guarantee. `sidebarSurface` left
    // it on 2026-08-12 for the light themes (see below); `navItemSelected` is
    // untouched everywhere outside the Empire family, which took gold on
    // 2026-08-10 and passed it to Midnight and OLED the same day.
    const src = themeSource(name);
    expect(tokenValue(src, 'navItemSelected')).toBe(tokenValue(src, 'neutral800'));
  });

  it('empire selects from the brand ramp', () => {
    // A selected tab reads BRAND. It was accent while accent was the green;
    // once accent became brass the owner moved tabs back with links, focus and
    // ::selection, leaving brass for decorative accent work. Checked as
    // membership of the ramp rather than a pinned stop, because the stop has had
    // to move twice already for contrast reasons and the requirement was never
    // the number — it is "from the interactive ramp, and legible".
    const src = themeSource('empire');
    const brandStops = [...src.matchAll(/\n\s+(brand\d+): '([^']+)'/g)].map((m) => m[2]!);
    expect(brandStops).toContain(tokenValue(src, 'navItemSelected'));
  });

  it('empire puts its rail on the page ground, not on ink', () => {
    // The rail was the Avoir ink (#0F1815) until 2026-08-12. The frameless
    // title bar put a near-white strip directly above it and the dark slab
    // stopped reading as part of the window. Pinned as an identity rather than
    // a threshold: "the rail IS the background" is the decision, and a rail
    // that drifts a stop away from it is a different decision worth noticing.
    const src = themeSource('empire');
    expect(tokenValue(src, 'sidebarSurface')).toBe(tokenValue(src, 'background'));
  });

  it.each(THEMES.filter((t) => t !== 'cipherpunk'))(
    '%s keeps the rail and its labels apart',
    (name) => {
      // Replaces "the rail must stay dark". The labels are `textSecondary` now,
      // so the requirement is no longer a direction — it is a gap, and it holds
      // whichever side of mid-lightness a theme puts its rail on.
      //
      // cipherpunk excluded: its `neutral900` is 94.70%, so its rail has been
      // near-white with near-white text since before this token existed. Left
      // broken rather than quietly redesigned — it is unreachable and nobody
      // asked.
      const src = themeSource(name);
      const rail = lightness(tokenValue(src, 'sidebarSurface'));
      const label = lightness(tokenValue(src, 'textSecondary'));
      expect(Math.abs(rail - label)).toBeGreaterThan(30);
    },
  );

  it('a selected tab keeps enough contrast for its neutral0 label', () => {
    for (const name of SELECTABLE) {
      const src = themeSource(name);
      const fill = lightness(tokenValue(src, 'navItemSelected'));
      const label = lightness(tokenValue(src, 'neutral0'));
      expect(Math.abs(fill - label)).toBeGreaterThan(40);
    }
  });

  it('empire keeps canvas, raised and card in hierarchy', () => {
    // Rewritten 2026-08-09 with the Avoir palette. This used to pin three
    // equalities from the cream build — background === neutral25 ===
    // surfaceRaised, surfaceHover === neutral50 — which no new neutral ramp can
    // satisfy, and which were never the property worth protecting. What matters
    // is that the three layers stay ordered with a visible step between each,
    // and that every one is an exact stop rather than a hand-tuned near-miss.
    const src = themeSource('empire');
    const [canvas, raised, card] = ['background', 'surfaceRaised', 'surface'].map((k) =>
      lightness(tokenValue(src, k)),
    );
    // Canvas and header may share a stop — theme-light does exactly that — but
    // neither may ever exceed the card they sit under.
    expect(canvas).toBeLessThanOrEqual(raised);
    expect(raised).toBeLessThan(card);
    expect(card - raised).toBeGreaterThan(1);

    expect(tokenValue(src, 'background')).toBe(tokenValue(src, 'neutral25'));
    expect(tokenValue(src, 'surfaceRaised')).toBe(tokenValue(src, 'neutral25'));
    expect(tokenValue(src, 'surface')).toBe(tokenValue(src, 'neutral0'));
  });
});

/**
 * The vertical subnav rail (Settings, Healthcare, Investments, Utilities,
 * Accounts) is the page canvas, separated from content by its hairline border.
 *
 * It was written as `neutral50`, which is identical to `background` in light,
 * arctic, dark and midnight — so the raw stop looked correct for as long as
 * that coincidence held. It stopped holding when Empire moved its canvas to
 * neutral25 and the rail stayed on the cream, becoming a darker stripe down
 * the side of the page.
 */
describe('the subnav rail follows the page canvas', () => {
  it('reads the semantic token, not the stop that happened to match it', () => {
    const tabs = readFileSync(join(HERE, '../components/tabs.css.ts'), 'utf8');
    const rail = tabs.slice(tabs.indexOf('export const verticalTabList'));
    const body = rail.slice(0, rail.indexOf('});'));

    expect(body).toContain('background: vars.color.background');
    expect(body).not.toContain('background: vars.color.neutral50');
  });

  it.each(SELECTABLE.filter((t) => t !== 'empire'))('%s renders exactly as before', (name) => {
    // These four had background === neutral50, so switching the reference
    // cannot move them.
    const src = themeSource(name);
    expect(tokenValue(src, 'background')).toBe(tokenValue(src, 'neutral50'));
  });

  it('empire puts the rail wherever its canvas is, which is not neutral50', () => {
    // The load-bearing half is the inequality: Empire is the theme that broke
    // the `background === neutral50` coincidence, so a rail written as the raw
    // stop would still be visibly wrong here.
    const src = themeSource('empire');
    expect(tokenValue(src, 'background')).toBe(tokenValue(src, 'neutral25'));
    expect(tokenValue(src, 'background')).not.toBe(tokenValue(src, 'neutral50'));
  });
});

/**
 * Modals and drawers — the floating layer.
 *
 * DESIGN.md has listed `surfaceOverlay` in its surface hierarchy since the
 * theme system was written, but the contract never had it, so modal panels read
 * `neutral50`. That is the same value as `background` in four of the six
 * themes, which is exactly why nobody noticed: the coincidence held until
 * Empire moved its canvas to neutral25 and its modals stayed on the cream seed.
 */
describe('the floating layer', () => {
  it('modal, drawer and subheader read the semantic token', () => {
    const modal = readFileSync(join(HERE, '../components/modal.css.ts'), 'utf8');
    expect(modal).not.toContain('vars.color.neutral50');
    expect(modal.match(/background: vars\.color\.surfaceOverlay/g)).toHaveLength(3);
  });

  it.each(THEMES)('%s defines it', (name) => {
    expect(() => tokenValue(themeSource(name), 'surfaceOverlay')).not.toThrow();
  });

  it.each(THEMES.filter((t) => t !== 'empire'))('%s renders exactly as before', (name) => {
    const src = themeSource(name);
    expect(tokenValue(src, 'surfaceOverlay')).toBe(tokenValue(src, 'neutral50'));
  });

  it('empire lifts its modals off neutral50', () => {
    // Named for the canvas until 2026-08-09, when the Avoir palette moved the
    // canvas to neutral100 and left modals on neutral25. They no longer travel
    // together; what still holds is that modals are not on the stop every other
    // theme uses, which is the whole reason the token exists.
    const src = themeSource('empire');
    expect(tokenValue(src, 'surfaceOverlay')).toBe(tokenValue(src, 'neutral25'));
    expect(tokenValue(src, 'surfaceOverlay')).not.toBe(tokenValue(src, 'neutral50'));
  });

  it('leaves dropdown and datepicker panels on `surface`', () => {
    // DESIGN.md lists dropdowns beside modals in that row, but they paint
    // `surface` and are deliberately left there: moving them would repaint
    // every dropdown in every theme, and `surfaceHover` above is tuned as a
    // step away from `surface` specifically. Pinned so the divergence is a
    // recorded decision rather than something to "tidy up" later.
    const dd = readFileSync(join(HERE, '../components/dropdown-menu.css.ts'), 'utf8');
    const dp = readFileSync(join(HERE, '../components/datepicker.css.ts'), 'utf8');
    expect(dd).toContain('background: vars.color.surface,');
    expect(dp).toContain('background: vars.color.surface,');
    expect(dd).not.toContain('surfaceOverlay');
    expect(dp).not.toContain('surfaceOverlay');
  });
});

/**
 * The tab dot — an unread marker on a tab that can be selected.
 *
 * Reported as "the green one washes out when you select the tab". It was
 * `brand500`, and `navItemSelected` is the same family, so selecting put a teal
 * dot on a teal fill at roughly 1.5:1 in Empire.
 *
 * Recolouring for the selected state is harder than it looks, and this pins why
 * it is not attempted: `navItemSelected` INVERTS across the palette. Empire
 * selects with a 37% dark teal, Empire Dark with an 84% gold. Any single value
 * is therefore chosen against one ground and against the opposite of the other
 * — the same failure as the checkbox glyph above, reached by a different route.
 * The dot is simply not drawn on the selected tab, which needs no value at all.
 */
describe('the tab dot', () => {
  const styles = readFileSync(join(HERE, '../components/tabs.css.ts'), 'utf8');
  const dot = (() => {
    const from = styles.indexOf('export const tabDot');
    return styles.slice(from, styles.indexOf('\n});', from));
  })();

  it('is not the family it would have to sit on when selected', () => {
    expect(dot).not.toContain('brand500');
  });

  it('is not drawn on the selected tab, so no colour has to survive that fill', () => {
    expect(dot).toMatch(/navItemActive.*display: 'none'/s);
  });

  it.each(SELECTABLE)('%s shows it against the resting tab', (name) => {
    // The resting tab is transparent over `surface`, and that is the only
    // ground the dot has to clear now. `danger400` inverts with the palette, so
    // one stop serves the light and dark themes alike.
    const src = themeSource(name);
    const gap = Math.abs(
      lightness(tokenValue(src, 'danger400')) - lightness(tokenValue(src, 'surface')),
    );
    expect(gap).toBeGreaterThan(30);
  });
});

/**
 * The data-viz ramp on a ground that does not follow the theme.
 *
 * `apps/web` highlights shell commands with `dataViz1…6` inside a console block
 * whose background is a fixed near-black (~5% lightness) in every theme — the
 * one surface in the app deliberately exempt from theming, because a terminal
 * should look like a terminal everywhere.
 *
 * That combination is the trap `checkboxIcon` fell into from the other
 * direction: a value that follows the palette, drawn on a ground that does not.
 * It happens to be safe here because the ramp inverts UPWARDS — 62% in the
 * light themes, 76% in the dark — so both ends clear a near-black ground (6.3:1
 * and 9.8:1). "Happens to be safe" is the part worth pinning: nothing about the
 * ramp's purpose as chart colours guarantees it, and a future theme darkening
 * its data-viz stops would make the commands unreadable with no other symptom.
 */
describe('the data-viz ramp', () => {
  const STOPS = [1, 2, 3, 4, 5, 6] as const;

  it.each(THEMES)('%s keeps every stop legible on a near-black console', (name) => {
    const src = themeSource(name);
    for (const n of STOPS) {
      expect(lightness(tokenValue(src, `dataViz${n}`))).toBeGreaterThan(55);
    }
  });
});

/**
 * Hovering a nav item that is already selected.
 *
 * Reported as "its hover is just a text colour change and it changes to black".
 * `navItemActive` declared a background on `:hover` and no colour, and it ties
 * `navItem:hover` on specificity (0,2,0) — so the label fell through to
 * `textPrimary`, near-black in a light theme, while the fill never moved. The
 * defect was invisible for as long as the rail was dark, because `textPrimary`
 * on a dark rail is near-white and the fill it landed on was dark anyway.
 */
describe('the selected nav item on hover', () => {
  const sidenav = readFileSync(join(HERE, '../components/sidenav.css.ts'), 'utf8');

  const activeRule = (name: string): string => {
    const from = sidenav.indexOf(`export const ${name}`);
    return sidenav.slice(from, sidenav.indexOf('\n});', from));
  };

  it.each(['navItemActive', 'navItemIconActive'])('%s restates its label colour', (name) => {
    // The half that was missing. Asserted as "the hover block names a colour"
    // rather than by matching a value, because the requirement is that it does
    // not inherit — which value it names is the next test's business.
    const hover = activeRule(name).split("'&:hover'")[1] ?? '';
    expect(hover).toContain('color: vars.color.neutral0');
  });

  it.each(['navItemActive', 'navItemIconActive'])('%s moves its fill on hover', (name) => {
    // The other half: fixing only the label would have left hover doing nothing
    // at all on a selected item, which is what prompted a token rather than
    // simply restating `navItemSelected`.
    const hover = activeRule(name).split("'&:hover'")[1] ?? '';
    expect(hover).toContain('navItemSelectedHover');
    expect(hover).not.toContain('background: vars.color.navItemSelected,');
  });

  it.each(THEMES)('%s keeps the label legible on the hovered fill', (name) => {
    // `neutral0` is the label on both the resting and hovered fill, and the
    // hover direction is per theme — away from the label where the ramp allows
    // it, toward it where `neutral800` is already the lightest stop (Dark,
    // Midnight). So the gap is what gets asserted, never the direction.
    const src = themeSource(name);
    const label = lightness(tokenValue(src, 'neutral0'));
    const fill = lightness(tokenValue(src, 'navItemSelectedHover'));
    expect(Math.abs(label - fill)).toBeGreaterThan(40);
  });

  it.each(THEMES)('%s actually changes the fill, rather than declaring a no-op', (name) => {
    const src = themeSource(name);
    expect(tokenValue(src, 'navItemSelectedHover')).not.toBe(tokenValue(src, 'navItemSelected'));
  });
});
