/**
 * Breakpoints are the single source of truth for responsive thresholds.
 *
 * Before this module the numbers lived in ~30 files: 25 named constants, 14 CSS
 * media queries, and a few inline `matchMedia` strings. Two of them disagreed —
 * `1023.98` and `1024` were both in use for the same threshold.
 *
 * They were briefly computed as `designWidth × ROOT_SCALE`, which was right for
 * the migration to a 110% root scale (a media query is the one thing
 * `html { font-size }` does not move). That derivation is now gone: once the
 * thresholds are tuned by eye AT 110%, multiplying them by 110% again
 * double-counts the scale.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bp, below, from, upTo } from './breakpoints.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'] as const;

describe('the scale', () => {
  it('exposes every step', () => {
    expect(Object.keys(bp).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(below).sort()).toEqual([...KEYS].sort());
  });

  it('increases monotonically', () => {
    const values = KEYS.map((k) => bp[k]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(new Set(values).size).toBe(values.length);
  });

  it('holds the tuned values', () => {
    // Measured, not derived — see the note in breakpoints.ts. Pinned so a stray
    // edit to one number is visible in a diff as a changed expectation rather
    // than as a silent layout shift.
    expect(bp).toEqual({ xs: 550, sm: 594, md: 740, lg: 880, xl: 1140, xxl: 1320 });
  });

  it('does not re-derive itself from the root scale', () => {
    // The circularity that was removed: these were tuned by eye AT 110%, so
    // multiplying them by 110% again double-counts the scale.
    // Asserted on the IMPORT, not the text: the module's docblock explains why
    // the derivation went, and matching prose would fail on its own explanation.
    const src = readFileSync(join(HERE, 'breakpoints.ts'), 'utf8');
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(code).not.toContain('ROOT_SCALE');
    expect(code).not.toMatch(/from '\.\/scale\.js'/);
  });

  it('keeps max-width a hair under min-width so a pair never both match', () => {
    for (const k of KEYS) {
      expect(below[k]).toBeCloseTo(bp[k] - 0.02, 2);
      expect(below[k]).toBeLessThan(bp[k]);
    }
  });

  it('rounds to two decimals — these become CSS strings', () => {
    for (const k of KEYS) {
      expect(String(bp[k])).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(String(below[k])).toMatch(/^\d+(\.\d{1,2})?$/);
    }
  });

  it('builds usable media conditions', () => {
    expect(from('md')).toBe(`screen and (min-width: ${bp.md}px)`);
    expect(upTo('md')).toBe(`screen and (max-width: ${below.md}px)`);
  });
});

/**
 * The source-of-truth guarantee.
 *
 * A single stray literal reintroduces the original problem quietly: that one
 * component keeps its old threshold while everything else moves, and nothing
 * fails. So the rule is enforced rather than documented.
 */
describe('no breakpoint literals survive outside this module', () => {
  const ROOTS = [join(HERE, '../..'), join(HERE, '../../../../apps/web/src')];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(full, out);
      } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  const files = ROOTS.flatMap((r) => walk(r)).filter(
    (f) => !f.endsWith('breakpoints.ts') && !f.endsWith('scale.ts'),
  );

  it('scans a realistic number of files', () => {
    // Guards the guard — a wrong path makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it('finds no hardcoded media-query width', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          if (/\((?:max|min)-width:\s*[\d.]+px\)/.test(line)) {
            offenders.push(`${f.split('/src/')[1]}:${i + 1} ${t}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('finds no numeric breakpoint constant or inline threshold', () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('//') || t.startsWith('*')) return;
          if (/BREAKPOINT\w*\s*=\s*[\d.]+/.test(t) || /useIsNarrow\(\s*[\d.]+\s*\)/.test(t)) {
            offenders.push(`${f.split('/src/')[1]}:${i + 1} ${t}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
