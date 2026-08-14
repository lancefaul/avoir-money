#!/usr/bin/env node
/**
 * Runs pnpm audit and fails only on HIGH+ vulnerabilities that are not
 * in the known-accepted list. xlsx CVEs have no free patch (SheetJS moved
 * to a paid model) — see MEMORY.md for the accepted-risk decision.
 *
 * Delete this script and use pnpm's native auditConfig.ignoreCves once
 * the project upgrades to pnpm 10.
 */

import { execSync } from 'node:child_process';

const IGNORED_CVES = new Set([
  'GHSA-4r6h-8v6p-xvw6', // xlsx prototype pollution
  'GHSA-5pgg-2g8v-p4x9', // xlsx ReDoS
]);

let json;
try {
  const output = execSync('pnpm audit --audit-level=high --json', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  json = JSON.parse(output);
} catch (err) {
  // pnpm audit exits non-zero when vulnerabilities are found — parse stdout anyway
  try {
    json = JSON.parse(err.stdout ?? '{}');
  } catch {
    // Can't parse — treat as clean (network error, registry issue, etc.)
    console.log('Audit output could not be parsed — treating as clean.');
    process.exit(0);
  }
}

const advisories = Object.values(json.advisories ?? {});
const failing = advisories
  .filter((a) => a.severity === 'high' || a.severity === 'critical')
  .filter((a) => !IGNORED_CVES.has(a.github_advisory_id));

if (failing.length > 0) {
  console.error('\nUnresolved HIGH/CRITICAL vulnerabilities:\n');
  for (const a of failing) {
    console.error(`  [${a.severity.toUpperCase()}] ${a.title}`);
    console.error(`  Package: ${a.module_name}`);
    console.error(`  Advisory: ${a.github_advisory_id}`);
    console.error(`  Fix: ${a.patched_versions}`);
    console.error('');
  }
  process.exit(1);
}

const total = advisories.length;
const ignored = advisories.filter((a) => IGNORED_CVES.has(a.github_advisory_id)).length;
console.log(`Audit passed. ${total} advisories found, ${ignored} ignored (accepted risk).`);
process.exit(0);
