/**
 * Retention must never delete the copy that cannot be recreated.
 *
 * It keeps the newest N and drops the rest, which is right for routine backups
 * and wrong for the other two sources: a PRE_RESTORE snapshot is the rollback
 * point for the restore that just ran, and an IMPORTED dump was supplied by
 * hand precisely because it existed nowhere else. Both are excluded from the
 * count as well as the deletion, so adding one can never evict a real backup.
 *
 * Only database rows are exercised here — nothing runs pg_dump, so no file is
 * written to the real backups/ directory and no database but the test one is
 * touched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@budget-tracker/db';
import { enforceRetention } from '../backup.js';

type Source = 'MANUAL' | 'PRE_RESTORE' | 'IMPORTED';

let clock = 0;
async function row(source: Source) {
  clock += 1;
  return prisma.backup.create({
    data: {
      filename: `${source.toLowerCase()}_${clock}.dump`,
      // Deliberately a path that does not exist: deleteBackupFile treats ENOENT
      // as success, so retention runs fully without this test writing anything.
      filepath: `/nonexistent/${source.toLowerCase()}_${clock}.dump`,
      sizeBytes: 1234,
      status: 'COMPLETED',
      source,
      completedAt: new Date(),
      createdAt: new Date(Date.now() + clock * 1000),
    },
  });
}

beforeEach(async () => {
  await prisma.backup.deleteMany({});
});

describe('enforceRetention', () => {
  it('keeps the newest N routine backups and drops the rest', async () => {
    for (let i = 0; i < 5; i++) await row('MANUAL');

    await enforceRetention(3);

    expect(await prisma.backup.count()).toBe(3);
  });

  it('never deletes a pre-restore snapshot', async () => {
    const snapshot = await row('PRE_RESTORE');
    for (let i = 0; i < 5; i++) await row('MANUAL');

    await enforceRetention(1);

    // It is the rollback point for a restore that has already destroyed the
    // state it captured. Nothing may prune it to make room.
    expect(await prisma.backup.findUnique({ where: { id: snapshot.id } })).not.toBeNull();
  });

  it('never deletes an imported dump', async () => {
    const imported = await row('IMPORTED');
    for (let i = 0; i < 5; i++) await row('MANUAL');

    await enforceRetention(1);

    expect(await prisma.backup.findUnique({ where: { id: imported.id } })).not.toBeNull();
  });

  it('does not count exempt rows toward the limit', async () => {
    // The subtler half. If exempt rows were merely undeletable but still
    // counted, importing a dump would silently evict a real backup while the
    // import itself survived — the opposite of the intent.
    await row('IMPORTED');
    await row('PRE_RESTORE');
    const manual = [];
    for (let i = 0; i < 3; i++) manual.push(await row('MANUAL'));

    await enforceRetention(3);

    const survivors = await prisma.backup.findMany({ where: { source: 'MANUAL' } });
    expect(survivors.map((r) => r.id).sort()).toEqual(manual.map((r) => r.id).sort());
  });
});
