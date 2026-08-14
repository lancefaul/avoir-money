#!/usr/bin/env node
/**
 * Where does each piece of shared logic actually run?
 *
 * Reports which `@budget-tracker/core` exports are consumed by the backend
 * (`apps/api`), the frontend (`apps/web` + `packages/ui`), both, or nothing.
 * Feeds `.kiro/docs/PLACEMENT.md`, which exists so the frontend/backend split
 * can be reviewed deliberately at the end of the v0.9 rewrite rather than
 * inherited by accident.
 *
 *   node scripts/placement-map.mjs           # summary
 *   node scripts/placement-map.mjs --full    # every symbol, grouped
 *   node scripts/placement-map.mjs --json    # machine-readable
 *
 * WHY THIS IS A SCRIPT AND NOT A GREP. Two hand-written greps got this wrong
 * on 2026-08-09 and put a false claim into a pushed commit — that the whole
 * `reconcile/` module was frontend-only, when in fact its matcher is used
 * ONLY by the backend and only its hints are frontend. Both failures were the
 * same shape: this repo's imports are multi-line, with the `from` clause last.
 *
 *   - `grep -A 6 "from '@budget-tracker/core'"` reads the lines AFTER the
 *     `from`, i.e. the next import, never the symbols belonging to this one.
 *   - `grep -P` with a `[\s\S]*` pattern does not span lines at all, so it
 *     silently matches only single-line imports — about 10% of them here.
 *
 * A non-greedy `{[\s\S]*?}` is also wrong: it runs past the closing brace of a
 * NEARER import to reach a further `from '@budget-tracker/core'`, swallowing
 * unrelated symbols. The brace group must exclude braces: `{([^{}]*)}`.
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const ROOTS = {
  backend: ['apps/api/src'],
  frontend: ['apps/web/src', 'packages/ui/src'],
  tools: ['tools'],
};

/** Matches one import statement, multi-line, without crossing into another. */
const IMPORT_RE = /import\s+(?:type\s+)?\{([^{}]*)\}\s*from\s*['"]@budget-tracker\/core['"]/g;

function symbolsFor(roots) {
  const found = new Set();
  for (const root of roots) {
    let files = [];
    try {
      files = execSync(`find ${root} \\( -name '*.ts' -o -name '*.tsx' \\) 2>/dev/null`)
        .toString()
        .split('\n')
        .filter((f) => f && !/\.test\.|\.spec\.|__tests__/.test(f));
    } catch {
      continue; // root absent — fine, report on what exists
    }
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) {
        for (let s of m[1].split(',')) {
          s = s
            .trim()
            .replace(/^type\s+/, '')
            .split(/\s+as\s+/)[0]
            .trim();
          if (s) found.add(s);
        }
      }
    }
  }
  return found;
}

const backend = symbolsFor(ROOTS.backend);
const frontend = symbolsFor(ROOTS.frontend);
const tools = symbolsFor(ROOTS.tools);

const all = [...new Set([...backend, ...frontend, ...tools])].sort();
const isSchema = (s) => /Schema$/.test(s);

const groups = { backend: [], frontend: [], both: [], toolsOnly: [] };
for (const s of all) {
  const b = backend.has(s);
  const f = frontend.has(s);
  if (b && f) groups.both.push(s);
  else if (b) groups.backend.push(s);
  else if (f) groups.frontend.push(s);
  else groups.toolsOnly.push(s);
}

const split = (arr) => ({
  logic: arr.filter((s) => !isSchema(s)),
  schemas: arr.filter(isSchema),
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(groups, null, 1));
  process.exit(0);
}

const line = (label, arr) => {
  const { logic, schemas } = split(arr);
  console.log(
    `${label.padEnd(14)} ${String(arr.length).padStart(4)}   (logic ${logic.length}, schemas ${schemas.length})`,
  );
};

console.log('Shared core symbols, by where they are consumed\n');
line('BACKEND only', groups.backend);
line('FRONTEND only', groups.frontend);
line('BOTH', groups.both);
line('TOOLS only', groups.toolsOnly);

if (process.argv.includes('--full')) {
  for (const [name, arr] of Object.entries(groups)) {
    const { logic, schemas } = split(arr);
    console.log(`\n── ${name} ──`);
    if (logic.length) console.log('  logic:   ' + logic.join(', '));
    if (schemas.length) console.log('  schemas: ' + schemas.join(', '));
  }
}

console.log(
  '\nNote: a symbol exported by core but imported nowhere is invisible here by' +
    '\nconstruction — this reports consumers, not definitions. For dead exports,' +
    '\ncompare against the export list in packages/core.',
);
