import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { DB_CONTAINER } from './backup.js';

const execFileAsync = promisify(execFile);

/**
 * Validation for a dump file supplied by hand rather than produced by the app.
 *
 * Restoring runs `pg_restore --clean`, which drops every existing object before
 * writing. There is no partial outcome and no undo, so everything that decides
 * whether a file is safe to hand to that has to happen here, before it is
 * reachable — which is also why this module is separated from the restore
 * itself. `performRestore` targets the production container and therefore
 * cannot be exercised by a test at all; this can, because the only external
 * command it runs is `pg_restore --list`, which parses the archive's header and
 * table of contents and **opens no database connection**.
 *
 * The checks run cheapest-first, and each one catches a failure the next cannot:
 *
 *  1. Magic bytes — a custom-format archive begins with `PGDMP`. Rejects a CSV,
 *     a zip, or a plain-text `.sql` renamed to `.dump` without spawning anything.
 *  2. `pg_restore --list` — the archive is only genuinely readable if pg_restore
 *     can parse it. Catches truncation and corruption, which magic bytes cannot:
 *     a file cut off mid-transfer still starts with `PGDMP`.
 *  3. Expected tables — a valid dump of somebody else's database restores
 *     perfectly and destroys this one. Nothing about the file's format can catch
 *     that; only its contents can.
 */

/** Custom-format archives begin with this. Plain SQL and tar dumps do not. */
const CUSTOM_FORMAT_MAGIC = 'PGDMP';

/**
 * Tables that must appear in the archive for it to be this application's
 * database. Deliberately a small core rather than the full schema — an older
 * dump legitimately predates most tables, but never these.
 */
const REQUIRED_TABLES = ['Transaction', 'Account', 'Budget'];

/**
 * Refuse anything larger than this outright rather than buffering it.
 *
 * The upload is read into memory before it is written, so this is a memory
 * bound, not just a disk one. It matches the `maxBuffer` the dump and restore
 * commands already use. This database's dumps are well under a megabyte, so the
 * limit exists to bound a mistake rather than to accommodate a real file.
 */
export const MAX_DUMP_BYTES = 100 * 1024 * 1024;

export type DumpRejection =
  | 'not_custom_format'
  | 'unreadable_archive'
  | 'wrong_database'
  | 'too_large';

export interface DumpValidationSuccess {
  valid: true;
  /** Tables found in the archive's table of contents, in listing order. */
  tables: string[];
  /** `Archive created at …` from the header, verbatim, or null if absent. */
  archiveCreatedAt: string | null;
  /** `dbname:` from the header, or null if absent. */
  sourceDatabase: string | null;
}

export interface DumpValidationFailure {
  valid: false;
  reason: DumpRejection;
  /** Operator-facing explanation, safe to show — never contains a host path. */
  message: string;
  /** Present for `wrong_database`: what the archive actually contained. */
  tables?: string[];
  missingTables?: string[];
}

export type DumpValidationResult = DumpValidationSuccess | DumpValidationFailure;

/** Read the first bytes without loading the file. */
async function readMagic(filepath: string): Promise<string> {
  const handle = await open(filepath, 'r');
  try {
    const buf = Buffer.alloc(CUSTOM_FORMAT_MAGIC.length);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).toString('latin1');
  } finally {
    await handle.close();
  }
}

/**
 * Table names from a `pg_restore --list` listing.
 *
 * TOC entries look like `215; 1259 16388 TABLE public Account budget`. Matching
 * `TABLE` specifically skips indexes, constraints, sequences and the `TABLE
 * DATA` entries, so a name is counted once whether or not the dump carries its
 * rows — a schema-only dump lists the table but no data for it.
 */
function parseTables(listing: string): string[] {
  const found: string[] = [];
  const re = /^\d+;\s+\d+\s+\d+\s+TABLE\s+\S+\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(listing)) !== null) {
    if (m[1] && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/** A `;     key: value` header line from the listing preamble. */
function parseHeaderField(listing: string, key: string): string | null {
  const m = new RegExp(`^;\\s+${key}:\\s*(.+)$`, 'm').exec(listing);
  return m?.[1]?.trim() ?? null;
}

function parseArchiveCreatedAt(listing: string): string | null {
  const m = /^;\s+Archive created at\s+(.+)$/m.exec(listing);
  return m?.[1]?.trim() ?? null;
}

/**
 * Decide whether a file is safe to hand to `pg_restore --clean`.
 *
 * Never throws for an invalid file — an unreadable archive is an answer, not an
 * error. Only genuine infrastructure failures (docker missing) propagate.
 */
export async function validateDumpFile(
  filepath: string,
  sizeBytes: number,
): Promise<DumpValidationResult> {
  if (sizeBytes > MAX_DUMP_BYTES) {
    return {
      valid: false,
      reason: 'too_large',
      message: `That file is larger than the ${Math.floor(MAX_DUMP_BYTES / 1024 / 1024)}MB limit.`,
    };
  }

  if ((await readMagic(filepath)) !== CUSTOM_FORMAT_MAGIC) {
    return {
      valid: false,
      reason: 'not_custom_format',
      message:
        'That is not a PostgreSQL custom-format dump. Backups are created with ' +
        'pg_dump -Fc; a .sql file or an archive of one will not work.',
    };
  }

  // Read-only: --list parses the archive and connects to nothing. The file is
  // copied in under a name this process chose, never one from the caller.
  const containerPath = `/tmp/${basename(filepath)}`;
  let listing: string;
  try {
    await execFileAsync('docker', ['cp', filepath, `${DB_CONTAINER}:${containerPath}`]);
    const { stdout } = await execFileAsync(
      'docker',
      ['exec', DB_CONTAINER, 'pg_restore', '--list', containerPath],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    listing = stdout;
  } catch {
    // pg_restore exits non-zero on a corrupt or truncated archive. That is a
    // verdict on the file, not a fault, so it is reported as one.
    return {
      valid: false,
      reason: 'unreadable_archive',
      message:
        'That dump could not be read. It may be truncated or corrupted — ' +
        'check the transfer completed and try again.',
    };
  } finally {
    await execFileAsync('docker', ['exec', DB_CONTAINER, 'rm', '-f', containerPath]).catch(
      () => undefined,
    );
  }

  const tables = parseTables(listing);
  const missingTables = REQUIRED_TABLES.filter((t) => !tables.includes(t));
  if (missingTables.length > 0) {
    return {
      valid: false,
      reason: 'wrong_database',
      message:
        'That dump is not from Budget Tracker — it is missing ' +
        `${missingTables.join(', ')}. Restoring it would replace this database ` +
        'with a different one.',
      tables,
      missingTables,
    };
  }

  return {
    valid: true,
    tables,
    archiveCreatedAt: parseArchiveCreatedAt(listing),
    sourceDatabase: parseHeaderField(listing, 'dbname'),
  };
}
