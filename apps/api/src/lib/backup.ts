import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  access,
  stat,
  writeFile as fsWriteFile,
  copyFile,
  unlink,
  mkdir,
  constants,
} from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '@budget-tracker/db';

const execFileAsync = promisify(execFile);

// Database connection details for the production database (used by docker exec)
const DB_NAME = process.env.BACKUP_DB_NAME ?? 'budget_tracker';
const DB_USER = process.env.BACKUP_DB_USER ?? 'budget';
const DB_PASSWORD = process.env.BACKUP_DB_PASSWORD ?? 'budget';

/**
 * The container whose `pg_dump` / `pg_restore` binaries are used.
 *
 * Exported and env-overridable so dump *validation* can run somewhere harmless:
 * `pg_restore --list` opens no database at all, so it only needs the binary,
 * and pointing it at the test container keeps the validator's tests away from
 * the production one entirely. The default is unchanged.
 */
export const DB_CONTAINER = process.env.BACKUP_DB_CONTAINER ?? 'budget-tracker-db';

/** Fixed backup directory — always `backups/` at the workspace root. */
const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, '..', '..', '..', '..', 'backups');

/**
 * Generate a timestamped backup filename.
 */
function generateFilename(source: 'MANUAL' | 'PRE_RESTORE' | 'IMPORTED' = 'MANUAL'): string {
  const prefix =
    source === 'PRE_RESTORE'
      ? 'pre_restore'
      : source === 'IMPORTED'
        ? 'imported'
        : 'budget_tracker_backup';
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${prefix}_${y}${mo}${d}_${h}${mi}${s}.dump`;
}

/**
 * Validate that a backup path exists, is a directory, and is writable.
 * Returns an error message string, or null if valid.
 */
export async function validateBackupPath(_path?: string): Promise<string | null> {
  // Always use the fixed backup directory
  return null;
}

/**
 * Ensure the backup directory exists, creating it if needed.
 */
async function ensureBackupDir(): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });
  return BACKUP_DIR;
}

/**
 * Run pg_dump against the production database and save to the configured path.
 * Uses pg_dump directly (host must have PostgreSQL client tools installed, or
 * the Docker container must be accessible via docker exec).
 */
export async function performBackup(
  _backupPath: string,
  retentionCount: number,
  source: 'MANUAL' | 'PRE_RESTORE' | 'IMPORTED' = 'MANUAL',
): Promise<{
  id: string;
  filename: string;
  filepath: string;
  sizeBytes: bigint;
  status: string;
  error: string | null;
  completedAt: Date | null;
  createdAt: Date;
}> {
  const backupDir = await ensureBackupDir();
  const filename = generateFilename(source);
  const filepath = join(backupDir, filename);

  try {
    // Use docker exec to run pg_dump inside the container and pipe to host file
    await execFileAsync(
      'docker',
      [
        'exec',
        DB_CONTAINER,
        'pg_dump',
        '-U',
        DB_USER,
        '-d',
        DB_NAME,
        '-Fc', // Custom format (compressed, supports pg_restore)
      ],
      {
        env: { ...process.env, PGPASSWORD: DB_PASSWORD },
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
        encoding: 'buffer',
      },
    ).then(async ({ stdout }) => {
      await fsWriteFile(filepath, stdout);
    });

    // Get file size
    const fileStat = await stat(filepath);

    // Record in database
    const backup = await prisma.backup.create({
      data: {
        filename,
        filepath,
        sizeBytes: fileStat.size,
        status: 'COMPLETED',
        source,
        completedAt: new Date(),
      },
    });

    // Enforce retention policy — delete oldest backups beyond retentionCount
    await enforceRetention(retentionCount);

    return backup;
  } catch (err) {
    // Record failed backup
    await prisma.backup.create({
      data: {
        filename,
        filepath,
        sizeBytes: 0n,
        status: 'FAILED',
        source,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    });
    throw err;
  }
}

/**
 * Restore the production database from a backup file using pg_restore.
 *
 * Takes a PRE_RESTORE snapshot first, always. `pg_restore --clean` drops every
 * existing object before writing, so without this the current state is simply
 * gone — which is what made the 2026-08-05 incident expensive. It is done here
 * rather than at the route so no future caller can restore without one.
 *
 * **A failed snapshot aborts the restore.** Being unable to capture the current
 * state is exactly when destroying it is least acceptable, so the failure is
 * propagated rather than warned about and stepped over.
 *
 * Returns the snapshot's id so the caller can name the rollback point.
 */
export async function performRestore(filepath: string): Promise<{ safetyBackupId: string }> {
  // Verify the file exists BEFORE snapshotting — a restore that was never going
  // to run should not leave a snapshot behind suggesting one did.
  await access(filepath, constants.R_OK);

  const config = await prisma.backupConfig.findFirst();
  const safety = await performBackup('', config?.retentionCount ?? 7, 'PRE_RESTORE');

  // Copy the backup file into the Docker container
  const containerPath = `/tmp/${filepath.split('/').pop()}`;
  await execFileAsync('docker', ['cp', filepath, `${DB_CONTAINER}:${containerPath}`]);

  // Run pg_restore inside the container
  // --clean drops existing objects, --if-exists avoids errors on missing objects
  await execFileAsync(
    'docker',
    [
      'exec',
      '-e',
      `PGPASSWORD=${DB_PASSWORD}`,
      DB_CONTAINER,
      'pg_restore',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '--clean',
      '--if-exists',
      containerPath,
    ],
    {
      maxBuffer: 100 * 1024 * 1024,
    },
  );

  // Clean up the temporary file inside the container
  await execFileAsync('docker', ['exec', DB_CONTAINER, 'rm', '-f', containerPath]);

  return { safetyBackupId: safety.id };
}

/**
 * Adopt a validated dump as a recorded backup.
 *
 * Moves the file into `backups/` under a name this process generates and
 * records it as IMPORTED, so a dump recovered from elsewhere becomes a local
 * backup instead of disappearing after one use — the gap the 2026-08-05
 * incident exposed.
 *
 * The uploaded file's own name is discarded rather than stored: it is attacker-
 * shaped input whose only safe use would be display, and a generated name keeps
 * imported rows sorting alongside every other backup.
 */
export async function importDump(tempPath: string): Promise<{ id: string; filepath: string }> {
  const backupDir = await ensureBackupDir();
  const filename = generateFilename('IMPORTED');
  const filepath = join(backupDir, filename);

  await copyFile(tempPath, filepath);
  const fileStat = await stat(filepath);

  const row = await prisma.backup.create({
    data: {
      filename,
      filepath,
      sizeBytes: fileStat.size,
      status: 'COMPLETED',
      source: 'IMPORTED',
      completedAt: new Date(),
    },
  });

  return { id: row.id, filepath };
}

/**
 * Delete a backup file from disk. Does not throw if file is already gone.
 */
export async function deleteBackupFile(filepath: string): Promise<void> {
  try {
    await unlink(filepath);
  } catch (err) {
    // File already gone is fine
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Enforce retention policy by deleting the oldest completed backups
 * that exceed the retention count.
 */
export async function enforceRetention(retentionCount: number): Promise<void> {
  /*
   * Only MANUAL rows are eligible. A PRE_RESTORE snapshot is the rollback point
   * for the restore that just ran, and an IMPORTED dump was supplied by hand
   * because it existed nowhere else — deleting either to make room for a
   * routine backup would destroy the only copy of something unrecoverable.
   * They are excluded from the count as well as the deletion, so importing a
   * dump cannot silently evict a real backup.
   */
  const completedBackups = await prisma.backup.findMany({
    where: { status: 'COMPLETED', source: 'MANUAL' },
    orderBy: { createdAt: 'desc' },
  });

  if (completedBackups.length <= retentionCount) return;

  const toDelete = completedBackups.slice(retentionCount);
  for (const backup of toDelete) {
    await deleteBackupFile(backup.filepath);
    await prisma.backup.delete({ where: { id: backup.id } });
  }
}
