import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';
import { prisma } from '@budget-tracker/db';
import {
  BackupConfigSchema,
  UpdateBackupConfigSchema,
  BackupSchema,
  BackupListSchema,
  RestoreBackupSchema,
  RestoreUploadSchema,
  RestoreResultSchema,
  type BackupStatus,
  type BackupFrequency,
  type BackupSource,
} from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { performBackup, performRestore, deleteBackupFile, importDump } from '../lib/backup.js';
import { validateDumpFile, MAX_DUMP_BYTES } from '../lib/dump-validation.js';
import {
  stageUpload,
  resolveUpload,
  discardUpload,
  sweepStaleUploads,
} from '../lib/upload-staging.js';
import { rescheduleBackups } from '../lib/backup-scheduler.js';

const app = createRouter();

/**
 * Is this backup's dump file still on disk?
 *
 * `Backup.status` records how the run went, not what became of the file. A
 * COMPLETED row whose file has since been moved or pruned is unrestorable, and
 * nothing in the record says so — the failure only surfaced once `pg_restore`
 * tried to open it, as a 500 carrying a raw filesystem path. Checking here
 * turns that into something the list can show and the write paths can refuse
 * up front.
 */
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch {
    // Any failure to stat — missing, unreadable, bad path — means we cannot
    // restore from it, which is all the caller needs to know.
    return false;
  }
}

/** The message shown whenever a recorded backup's file is no longer on disk. */
const FILE_GONE =
  'This backup’s file is no longer on disk, so it cannot be used. It may have been moved, pruned by the retention policy, or lost.';

// ─── GET /config ───

const getConfigRoute = createRoute({
  method: 'get',
  path: '/config',
  tags: ['Backups'],
  summary: 'Get backup configuration',
  responses: {
    200: {
      content: { 'application/json': { schema: BackupConfigSchema } },
      description: 'Backup configuration',
    },
  },
});

app.openapi(getConfigRoute, async (c) => {
  let config = await prisma.backupConfig.findFirst();
  if (!config) {
    config = await prisma.backupConfig.create({ data: {} });
  }
  return c.json(
    {
      id: config.id,
      enabled: config.enabled,
      path: config.path,
      frequency: config.frequency as BackupFrequency,
      retentionCount: config.retentionCount,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    },
    200,
  );
});

// ─── PUT /config ───

const updateConfigRoute = createRoute({
  method: 'put',
  path: '/config',
  tags: ['Backups'],
  summary: 'Update backup configuration',
  request: {
    body: { content: { 'application/json': { schema: UpdateBackupConfigSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BackupConfigSchema } },
      description: 'Updated backup configuration',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid path or configuration',
    },
  },
});

app.openapi(updateConfigRoute, async (c) => {
  const body = c.req.valid('json');

  // Get or create config
  let config = await prisma.backupConfig.findFirst();
  if (!config) {
    config = await prisma.backupConfig.create({ data: {} });
  }

  // Update config
  const updated = await prisma.backupConfig.update({
    where: { id: config.id },
    data: body,
  });

  // Reschedule the backup timer
  await rescheduleBackups();

  return c.json(
    {
      id: updated.id,
      enabled: updated.enabled,
      path: updated.path,
      frequency: updated.frequency as BackupFrequency,
      retentionCount: updated.retentionCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
    200,
  );
});

// ─── POST /run ───

const runBackupRoute = createRoute({
  method: 'post',
  path: '/run',
  tags: ['Backups'],
  summary: 'Trigger a manual backup now',
  responses: {
    201: {
      content: { 'application/json': { schema: BackupSchema } },
      description: 'Backup created',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Backup failed',
    },
  },
});

app.openapi(runBackupRoute, async (c) => {
  const config = await prisma.backupConfig.findFirst();
  const retentionCount = config?.retentionCount ?? 7;

  try {
    const backup = await performBackup('', retentionCount);
    return c.json(
      {
        id: backup.id,
        filename: backup.filename,
        filepath: backup.filepath,
        sizeBytes: Number(backup.sizeBytes),
        status: backup.status as BackupStatus,
        error: backup.error,
        completedAt: backup.completedAt,
        createdAt: backup.createdAt,
        // It was just written, so the file is there by construction.
        available: backup.status === 'COMPLETED',
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown backup error';
    return c.json({ error: message }, 500);
  }
});

// ─── GET / ───

const listBackupsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Backups'],
  summary: 'List all backups',
  responses: {
    200: {
      content: { 'application/json': { schema: BackupListSchema } },
      description: 'List of backups',
    },
  },
});

app.openapi(listBackupsRoute, async (c) => {
  const backups = await prisma.backup.findMany({ orderBy: { createdAt: 'desc' } });
  // Checked per row so the screen can say which backups are actually usable
  // before the user commits to a restore. A FAILED run never wrote a file, so
  // it is reported unavailable without touching the disk.
  const availability = await Promise.all(
    backups.map((b) =>
      b.status === 'COMPLETED' ? fileExists(b.filepath) : Promise.resolve(false),
    ),
  );
  return c.json(
    backups.map((b, i) => ({
      id: b.id,
      filename: b.filename,
      filepath: b.filepath,
      sizeBytes: Number(b.sizeBytes),
      status: b.status as BackupStatus,
      source: b.source as BackupSource,
      error: b.error,
      completedAt: b.completedAt,
      createdAt: b.createdAt,
      available: availability[i]!,
    })),
    200,
  );
});

// ─── POST /:id/restore ───

const restoreBackupRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Backups'],
  summary: 'Restore database from a backup',
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: RestoreBackupSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RestoreResultSchema } },
      description: 'Restore completed',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid confirmation text',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Backup not found',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Restore failed',
    },
  },
});

app.openapi(restoreBackupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { confirmText } = c.req.valid('json');

  if (confirmText !== 'RESTORE') {
    return c.json({ error: 'Type RESTORE to confirm' }, 400);
  }

  const backup = await prisma.backup.findUnique({ where: { id } });
  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  if (backup.status !== 'COMPLETED') {
    return c.json({ error: 'Can only restore from completed backups' }, 400);
  }

  // Refuse before doing anything destructive. Without this the missing file was
  // only discovered inside pg_restore, which surfaced as a 500 quoting a raw
  // filesystem path — an unknowable precondition reported as a server fault.
  if (!(await fileExists(backup.filepath))) {
    return c.json({ error: FILE_GONE }, 404);
  }

  try {
    const { safetyBackupId } = await performRestore(backup.filepath);
    return c.json({ message: 'Database restored successfully', safetyBackupId }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown restore error';
    return c.json({ error: message }, 500);
  }
});

// ─── POST /upload ───

/*
 * Uploading an external dump.
 *
 * Deliberately a plain Hono route rather than an `app.openapi()` one: the body
 * is a binary multipart file, which a Zod request schema cannot describe in a
 * way that would validate anything real. The validation that matters is
 * explicit below and far stricter than a schema would be — magic bytes, a
 * pg_restore parse, and a check that the archive is this application's
 * database.
 *
 * Nothing here trusts the client. The file's own name is discarded, the
 * destination is chosen by `stageUpload`, and the caller gets back an opaque id
 * rather than a path.
 */
app.post('/upload', async (c) => {
  // An abandoned upload holds a full copy of the database in the temp dir, so
  // stale ones are swept whenever a new upload arrives.
  await sweepStaleUploads();

  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Could not read the uploaded file.' }, 400);
  }

  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: 'No file was uploaded.' }, 400);
  }

  // Checked before the bytes are read into memory, not after.
  if (file.size > MAX_DUMP_BYTES) {
    return c.json(
      {
        error: `That file is larger than the ${Math.floor(MAX_DUMP_BYTES / 1024 / 1024)}MB limit.`,
      },
      400,
    );
  }
  if (file.size === 0) {
    return c.json({ error: 'That file is empty.' }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const staged = await stageUpload(bytes);

  const result = await validateDumpFile(staged.filepath, bytes.byteLength);
  if (!result.valid) {
    // A rejected file is never left on disk — it cannot be restored, so keeping
    // it only leaves a copy of someone's data in a temp directory.
    await discardUpload(staged.uploadId);
    return c.json({ error: result.message }, 400);
  }

  return c.json(
    {
      uploadId: staged.uploadId,
      sizeBytes: bytes.byteLength,
      tableCount: result.tables.length,
      archiveCreatedAt: result.archiveCreatedAt,
      sourceDatabase: result.sourceDatabase,
    },
    201,
  );
});

// ─── POST /upload/:uploadId/restore ───

const restoreUploadRoute = createRoute({
  method: 'post',
  path: '/upload/{uploadId}/restore',
  tags: ['Backups'],
  summary: 'Restore the database from a previously uploaded dump',
  request: {
    params: z.object({ uploadId: z.string() }),
    body: { content: { 'application/json': { schema: RestoreUploadSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RestoreResultSchema } },
      description: 'Restore completed',
    },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid confirmation, or the dump no longer validates',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Upload not found or expired',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Restore failed',
    },
  },
});

app.openapi(restoreUploadRoute, async (c) => {
  const { uploadId } = c.req.valid('param');
  const { confirmText } = c.req.valid('json');

  if (confirmText !== 'RESTORE') {
    return c.json({ error: 'Type RESTORE to confirm' }, 400);
  }

  // The only place a client string becomes a path, and it is refused unless it
  // is a plain token resolving inside the staging root.
  const filepath = await resolveUpload(uploadId);
  if (!filepath) {
    return c.json({ error: 'That upload has expired. Please upload the file again.' }, 404);
  }

  // Re-validated rather than trusted from the upload step. The verdict is what
  // stands between this file and `pg_restore --clean`, and re-running it costs
  // one read of a file already on disk.
  const { size } = await stat(filepath);
  const check = await validateDumpFile(filepath, size);
  if (!check.valid) {
    await discardUpload(uploadId);
    return c.json({ error: check.message }, 400);
  }

  try {
    // Adopted BEFORE the restore. A dump supplied by hand exists nowhere else,
    // and recording it after would lose it if the restore failed part-way.
    await importDump(filepath);
    const { safetyBackupId } = await performRestore(filepath);
    return c.json({ message: 'Database restored successfully', safetyBackupId }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown restore error';
    return c.json({ error: message }, 500);
  } finally {
    await discardUpload(uploadId);
  }
});

// ─── GET /:id/download ───

const downloadBackupRoute = createRoute({
  method: 'get',
  path: '/{id}/download',
  tags: ['Backups'],
  summary: 'Download a backup file',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Backup file stream' },
    400: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Invalid backup state',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Backup not found',
    },
  },
});

app.openapi(downloadBackupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const backup = await prisma.backup.findUnique({ where: { id } });
  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  if (backup.status !== 'COMPLETED') {
    return c.json({ error: 'Can only download completed backups' }, 400);
  }

  // Already refused a missing file correctly; wording is shared with restore so
  // the same failure reads the same way wherever it surfaces.
  let fileBuffer: Buffer;
  try {
    await stat(backup.filepath);
    fileBuffer = await readFile(backup.filepath);
  } catch {
    return c.json({ error: FILE_GONE }, 404);
  }

  return c.newResponse(new Uint8Array(fileBuffer), 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${backup.filename}"`,
    'Content-Length': String(fileBuffer.length),
  });
});

// ─── DELETE /:id ───

const deleteBackupRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Backups'],
  summary: 'Delete a backup',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Backup deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Backup not found',
    },
  },
});

app.openapi(deleteBackupRoute, async (c) => {
  const { id } = c.req.valid('param');
  const backup = await prisma.backup.findUnique({ where: { id } });
  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  // Delete the file from disk
  await deleteBackupFile(backup.filepath);

  // Delete the database record
  await prisma.backup.delete({ where: { id } });

  return c.body(null, 204);
});

export default app;
