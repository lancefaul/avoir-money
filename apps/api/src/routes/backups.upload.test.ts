/**
 * Uploading an external dump.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DO NOT add a test that completes an upload restore.
 *
 * `POST /upload/:id/restore` reaches `performRestore`, which runs
 * `pg_restore --clean` inside `budget-tracker-db` against `budget_tracker` —
 * the PRODUCTION container, not the test one on 5433. A test that got that far
 * would drop and replace real data. Same standing rule as `backups.test.ts`.
 *
 * Every test below either stops at upload (which never restores anything) or
 * asserts a REFUSAL that returns before `performRestore` is reached.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../app.js';
import { discardUpload } from '../lib/upload-staging.js';

const execFileAsync = promisify(execFile);
// Same override the production code and vitest.config use: CI names its
// Postgres container itself, so this cannot be a literal.
const CONTAINER = process.env.BACKUP_DB_CONTAINER ?? 'budget-tracker-db-test';
const DB = 'budget_tracker_test';
const AUTH = `Bearer ${process.env['API_KEY'] ?? 'budget-tracker-dev-key'}`;

let dir: string;
let realDump: Buffer;
let foreignDump: Buffer;
let truncated: Buffer;
const staged: string[] = [];

async function dump(table?: string): Promise<Buffer> {
  const args = ['exec', CONTAINER, 'pg_dump', '-U', 'budget', '-d', DB, '-Fc'];
  if (table) args.push('-t', `"${table}"`);
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 100 * 1024 * 1024,
    encoding: 'buffer',
  });
  return stdout as unknown as Buffer;
}

/** POST a file to /backups/upload as multipart, the way the browser will. */
async function upload(bytes: Uint8Array | string, filename = 'backup.dump') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  return app.request('/api/v1/backups/upload', {
    method: 'POST',
    headers: { Authorization: AUTH },
    body: form,
  });
}

async function restoreUpload(uploadId: string, confirmText: string) {
  return app.request(`/api/v1/backups/upload/${uploadId}/restore`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmText }),
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backup-upload-'));
  realDump = await dump();
  foreignDump = await dump('Backup');
  const p = join(dir, 'real.dump');
  await writeFile(p, realDump);
  const full = await readFile(p);
  truncated = full.subarray(0, Math.floor(full.length / 3));
}, 60_000);

afterAll(async () => {
  for (const id of staged.splice(0)) await discardUpload(id);
  await rm(dir, { recursive: true, force: true });
});

describe('POST /backups/upload', () => {
  it('accepts a genuine dump and describes what it found', async () => {
    // Uploading is not restoring — this stops at validation, having touched no
    // database. The preview is the whole point: the confirmation that follows
    // is made against the archive's contents, not against a filename.
    const res = await upload(realDump);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      uploadId: string;
      tableCount: number;
      sourceDatabase: string | null;
      archiveCreatedAt: string | null;
    };
    staged.push(body.uploadId);

    expect(body.tableCount).toBeGreaterThan(0);
    expect(body.sourceDatabase).toBe(DB);
    expect(body.archiveCreatedAt).toBeTruthy();
  });

  it('refuses a file that is not a dump', async () => {
    const res = await upload('date,description,amount\n2026-08-08,Coffee,-4.50\n', 'export.dump');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/custom-format/i);
  });

  it('refuses a truncated archive', async () => {
    const res = await upload(truncated);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/truncated|corrupted/i);
  });

  it('refuses a valid dump of a different database', async () => {
    // Well-formed and perfectly restorable — and it would replace this database
    // with someone else's. Only the contents check catches it.
    const res = await upload(foreignDump);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/not from Budget Tracker/i);
  });

  it('refuses an empty file', async () => {
    const res = await upload('');
    expect(res.status).toBe(400);
  });

  it('refuses a request with no file at all', async () => {
    const form = new FormData();
    form.append('notafile', 'hello');
    const res = await app.request('/api/v1/backups/upload', {
      method: 'POST',
      headers: { Authorization: AUTH },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('leaves nothing staged when it refuses', async () => {
    // A rejected upload cannot be restored, so keeping it would only leave a
    // copy of someone's data in the temp directory.
    const res = await upload(foreignDump);
    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty('uploadId');
  });
});

describe('POST /backups/upload/:uploadId/restore — refusals', () => {
  it('refuses a wrong confirmation before touching anything', async () => {
    const res = await upload(realDump);
    const { uploadId } = (await res.json()) as { uploadId: string };
    staged.push(uploadId);

    // Schema-level rejection: confirmText is a literal, so this never reaches
    // the handler — which is the point. The refusal happens before anything
    // resolves a path or opens a file.
    const attempt = await restoreUpload(uploadId, 'restore');
    expect([400, 422]).toContain(attempt.status);
  });

  it.each([
    ['parent traversal', '..%2F..%2F..%2Fetc'],
    ['unknown id', 'up-neverexisted'],
    ['empty-ish id', '%20'],
  ])('refuses %s with 404 rather than resolving a path', async (_label, id) => {
    // The confirmation is correct here on purpose: the id must be refused on
    // its own merits, not because something earlier happened to reject it.
    const res = await restoreUpload(id, 'RESTORE');
    expect(res.status).toBe(404);
  });

  it('refuses an upload that was already discarded', async () => {
    const res = await upload(realDump);
    const { uploadId } = (await res.json()) as { uploadId: string };
    await discardUpload(uploadId);

    const attempt = await restoreUpload(uploadId, 'RESTORE');
    expect(attempt.status).toBe(404);
    expect(((await attempt.json()) as { error: string }).error).toMatch(/expired/i);
  });
});
