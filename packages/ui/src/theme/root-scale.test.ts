/**
 * The app renders at 110% of the browser's base font size.
 *
 * This replaces reaching for browser zoom, and it only works because DESIGN.md's
 * units policy was actually followed: every dimension that lays the app out is
 * in `rem`, so one root value scales spacing, radii, type and component sizing
 * together. That invariant is load-bearing and invisible — a single
 * `height: '38px'` added later would simply not scale, and nothing would fail —
 * so the second test here guards the policy, not just the rule.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { ROOT_SCALE } from './scale.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPONENTS = join(HERE, '../components');

describe('root scale', () => {
  const globals = readFileSync(join(HERE, 'globals.css.ts'), 'utf8');

  it('sets the root font size from ROOT_SCALE, not a literal', () => {
    // Derived on purpose: `breakpoints.ts` reads the same constant, because a
    // media query is the one thing a root font-size does not move. Writing the
    // percentage here by hand is what lets the two drift apart — which is
    // precisely the bug that made the responsive layouts overflow.
    expect(globals).toMatch(/globalStyle\(\s*'html'[\s\S]*?fontSize: `\$\{ROOT_SCALE \* 100\}%`/);
    expect(globals).toContain("import { ROOT_SCALE } from './scale.js'");
  });

  it('is currently 110%', () => {
    expect(ROOT_SCALE).toBe(1.1);
  });

  it('expresses it as a percentage, never a pixel value', () => {
    // A percentage compounds with the reader's own browser default, so someone
    // running larger text still gets larger text. `17.6px` would compute to the
    // same thing today and silently overrule that preference forever after.
    const rule = globals.slice(globals.indexOf("globalStyle('html'"));
    const body = rule.slice(0, rule.indexOf('});'));
    expect(body).not.toMatch(/fontSize: [`'][\d.]+px[`']/);
    expect(body).toContain('%');
  });
});

/**
 * Properties whose values decide how big something is. A raw px here does not
 * scale with the root, so it drifts away from everything around it.
 *
 * Deliberately excludes `border*Width` (DESIGN.md's documented exception —
 * hairlines should stay crisp), `transform` (motion distance, not layout), and
 * gradient/shadow internals.
 */
const SIZING = [
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'gap',
  'rowGap',
  'columnGap',
  'top',
  'right',
  'bottom',
  'left',
  'fontSize',
  'borderRadius',
];

describe('the rem policy the root scale depends on', () => {
  const files = readdirSync(COMPONENTS).filter((f) => f.endsWith('.css.ts'));

  it('finds the component style files', () => {
    // Guards the guard: a wrong path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(SIZING)('no component sizes anything with a raw px value: %s', (prop) => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(join(COMPONENTS, file), 'utf8');
      src.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        // A media-query key is a quoted string — `'screen and (max-width: …)'`.
        // Its px is a viewport condition, not a size, and deliberately does not
        // scale with the root (see the note in globals.css.ts).
        // A media-query condition — whether written inline as an object key or
        // hoisted into a `const` (tabs.css.ts does both). Its px is a viewport
        // threshold, not a size.
        if (/\((?:max|min)-(?:width|height):/.test(t)) return;
        // `0px` is dimensionless and scales trivially; `1px`/`0.5px` inside a
        // `border:` shorthand is the documented exception.
        if (/^border:/.test(t)) return;
        const m = new RegExp(`\\b${prop}:\\s*[^,\\n]*?[\\d.]+px`).exec(line);
        if (m && !/\b0px\b/.test(m[0])) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
