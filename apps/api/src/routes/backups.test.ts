/**
 * Backup availability — a recorded backup whose file is gone must say so.
 *
 * `Backup.status` records how the run went. It cannot record what became of the
 * file afterwards, and nothing re-checked: 25 of 30 COMPLETED rows survived a
 * working-tree rebuild that took their files with it, and the list reported all
 * 30 as fine. Restore then failed inside `pg_restore`'s file access and came
 * back as a 500 quoting a raw filesystem path — an unrestorable backup was only
 * discoverable by attempting a destructive operation.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DO NOT add a happy-path restore test here.
 *
 * `performRestore` shells out to `docker exec budget-tracker-db pg_restore`
 * against the database named `budget_tracker` — the PRODUCTION container, not
 * the test one on 5433. A test that got far enough to run it would overwrite
 * real data. Every test below asserts a REFUSAL, and each one returns before
 * `performRestore` is reached.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '@budget-tracker/db';
import { get, post } from '../test/helpers.js';

let dir: string;
let presentFile: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backup-availability-'));
  presentFile = join(dir, 'present.dump');
  await writeFile(presentFile, 'not a real dump, only its existence matters');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A COMPLETED backup row pointing wherever the caller says. */
async function backupRow(filepath: string, status = 'COMPLETED') {
  return prisma.backup.create({
    data: {
      filename: filepath.split('/').pop()!,
      filepath,
      sizeBytes: 1234,
      status: status as 'COMPLETED' | 'FAILED',
      completedAt: new Date(),
    },
  });
}

describe('GET /backups — availability', () => {
  it('reports a backup whose file is on disk as available', async () => {
    const row = await backupRow(presentFile);

    const res = await get('/backups');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; available: boolean }[];

    expect(body.find((b) => b.id === row.id)?.available).toBe(true);
  });

  it('reports a backup whose file is gone as unavailable', async () => {
    // The exact shape of the incident: the row is COMPLETED and looks healthy.
    const row = await backupRow(join(dir, 'vanished.dump'));

    const res = await get('/backups');
    const body = (await res.json()) as { id: string; status: string; available: boolean }[];
    const found = body.find((b) => b.id === row.id);

    expect(found?.status).toBe('COMPLETED');
    expect(found?.available).toBe(false);
  });

  it('reports a FAILED run as unavailable without needing to touch the disk', async () => {
    // A failed run never wrote a file, so there is nothing to check.
    const row = await backupRow(join(dir, 'never-written.dump'), 'FAILED');

    const res = await get('/backups');
    const body = (await res.json()) as { id: string; available: boolean }[];

    expect(body.find((b) => b.id === row.id)?.available).toBe(false);
  });
});

describe('POST /backups/:id/restore — refusing a missing file', () => {
  it('returns 404, not 500, when the file is gone', async () => {
    // Returns before performRestore, so nothing is shelled out to. This is the
    // regression: it used to reach pg_restore and fail there as a 500.
    const row = await backupRow(join(dir, 'gone.dump'));

    const res = await post(`/backups/${row.id}/restore`, { confirmText: 'RESTORE' });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no longer on disk/i);
  });

  it('does not leak the filesystem path in the message', async () => {
    const row = await backupRow(join(dir, 'secret-path.dump'));

    const res = await post(`/backups/${row.id}/restore`, { confirmText: 'RESTORE' });
    const body = (await res.json()) as { error: string };

    expect(body.error).not.toContain(dir);
    expect(body.error).not.toContain('ENOENT');
  });

  it('still rejects a bad confirmation before anything else', async () => {
    const row = await backupRow(join(dir, 'gone2.dump'));

    const res = await post(`/backups/${row.id}/restore`, { confirmText: 'nope' });

    // Schema-level rejection: confirmText is a literal.
    expect([400, 422]).toContain(res.status);
  });
});

describe('GET /backups/:id/download — refusing a missing file', () => {
  it('returns 404 with the same wording restore uses', async () => {
    const row = await backupRow(join(dir, 'gone3.dump'));

    const res = await get(`/backups/${row.id}/download`);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/no longer on disk/i);
  });
});
