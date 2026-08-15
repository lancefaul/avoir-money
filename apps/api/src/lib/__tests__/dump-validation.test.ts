/**
 * The safety boundary for restoring an uploaded dump.
 *
 * `performRestore` runs `pg_restore --clean` against the PRODUCTION container,
 * so it cannot be exercised by a test at all — the sibling `backups.test.ts`
 * carries a standing instruction never to try. Every test there asserts a
 * refusal. That makes this file the only place the safe/unsafe decision is
 * actually verified, so it is checked against real archives rather than mocks:
 * a mocked `pg_restore` would prove only that the mock agrees with itself.
 *
 * Fixtures are generated from the TEST database, and validation is pointed at
 * the test container (see vitest.config.ts). `pg_restore --list` opens no
 * database, so nothing here can reach production even by accident.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDumpFile, MAX_DUMP_BYTES } from '../dump-validation.js';

const execFileAsync = promisify(execFile);
// Same override the production code and vitest.config use: CI names its
// Postgres container itself, so this cannot be a literal.
const CONTAINER = process.env.BACKUP_DB_CONTAINER ?? 'budget-tracker-db-test';
const DB = 'budget_tracker_test';

let dir: string;
let realDump: string;
let truncatedDump: string;
let notADump: string;
let foreignDump: string;
let emptyFile: string;

/** pg_dump the test database into `out`, optionally restricted to one table. */
async function dumpTo(out: string, table?: string) {
  const args = ['exec', CONTAINER, 'pg_dump', '-U', 'budget', '-d', DB, '-Fc'];
  if (table) args.push('-t', `"${table}"`);
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 100 * 1024 * 1024,
    encoding: 'buffer',
  });
  await writeFile(out, stdout);
}

async function size(p: string) {
  return (await stat(p)).size;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dump-validation-'));

  realDump = join(dir, 'real.dump');
  await dumpTo(realDump);

  // A valid archive of a database that is not this one. Restricting to a single
  // table nobody requires reproduces exactly the shape that matters: a
  // well-formed, perfectly restorable dump whose contents would replace this
  // database with something else.
  foreignDump = join(dir, 'foreign.dump');
  await dumpTo(foreignDump, 'Backup');

  // Cut off mid-transfer. Still begins with PGDMP, so only pg_restore can tell.
  truncatedDump = join(dir, 'truncated.dump');
  const full = await readFile(realDump);
  await writeFile(truncatedDump, full.subarray(0, Math.floor(full.length / 3)));

  notADump = join(dir, 'statement.dump');
  await writeFile(notADump, 'date,description,amount\n2026-08-08,Coffee,-4.50\n');

  emptyFile = join(dir, 'empty.dump');
  await writeFile(emptyFile, '');
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('validateDumpFile', () => {
  it('accepts a genuine dump of this database', async () => {
    const res = await validateDumpFile(realDump, await size(realDump));

    expect(res.valid).toBe(true);
    if (!res.valid) return;
    // The tables the check is built around must genuinely be found, otherwise
    // the accept is meaningless.
    expect(res.tables).toEqual(expect.arrayContaining(['Transaction', 'Account', 'Budget']));
  });

  it('reports what it found so the user confirms against the file, not the filename', async () => {
    const res = await validateDumpFile(realDump, await size(realDump));

    expect(res.valid).toBe(true);
    if (!res.valid) return;
    expect(res.sourceDatabase).toBe(DB);
    expect(res.archiveCreatedAt).toBeTruthy();
  });

  it('refuses a file that is not a custom-format archive', async () => {
    const res = await validateDumpFile(notADump, await size(notADump));

    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.reason).toBe('not_custom_format');
  });

  it('refuses an empty file', async () => {
    const res = await validateDumpFile(emptyFile, 0);

    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.reason).toBe('not_custom_format');
  });

  it('refuses a truncated archive that magic bytes alone would pass', async () => {
    // This is the case the cheap check cannot catch: the header is intact and
    // only pg_restore reading the archive reveals the file is incomplete.
    const magic = (await readFile(truncatedDump)).subarray(0, 5).toString('latin1');
    expect(magic).toBe('PGDMP');

    const res = await validateDumpFile(truncatedDump, await size(truncatedDump));
    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.reason).toBe('unreadable_archive');
  });

  it('refuses a valid dump of a different database', async () => {
    // The highest-value check: this archive is well-formed and would restore
    // cleanly. Nothing about its format is wrong — only its contents.
    const res = await validateDumpFile(foreignDump, await size(foreignDump));

    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.reason).toBe('wrong_database');
    expect(res.missingTables).toEqual(expect.arrayContaining(['Transaction', 'Account', 'Budget']));
  });

  it('names what is missing rather than failing vaguely', async () => {
    const res = await validateDumpFile(foreignDump, await size(foreignDump));

    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.message).toMatch(/Transaction/);
    expect(res.message).toMatch(/not from Budget Tracker/i);
  });

  it('refuses an oversized file before reading it', async () => {
    // Size is passed in, so the caller can refuse a stream before it is written
    // to disk at all. The path here is real but never opened.
    const res = await validateDumpFile(realDump, MAX_DUMP_BYTES + 1);

    expect(res.valid).toBe(false);
    if (res.valid) return;
    expect(res.reason).toBe('too_large');
  });

  it('never leaks a host path in a rejection message', async () => {
    // Rejections are shown to the user. The 2026-08-08 restore fix removed a
    // raw filesystem path from a failure message; nothing here should add one.
    const results = await Promise.all([
      validateDumpFile(notADump, await size(notADump)),
      validateDumpFile(truncatedDump, await size(truncatedDump)),
      validateDumpFile(foreignDump, await size(foreignDump)),
    ]);

    for (const res of results) {
      expect(res.valid).toBe(false);
      if (res.valid) continue;
      expect(res.message).not.toMatch(/\/tmp|\/home|\.dump/);
    }
  });
});
