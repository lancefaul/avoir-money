import { prisma } from '@budget-tracker/db';
import { performBackup } from './backup.js';

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Start or restart the backup scheduler based on current config.
 * Called on API startup and whenever config changes.
 */
export async function rescheduleBackups(): Promise<void> {
  // Clear existing timer
  if (schedulerTimer !== null) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  const config = await prisma.backupConfig.findFirst();
  if (!config || !config.enabled || !config.path) {
    return; // Backups disabled or not configured
  }

  const intervalMs = config.frequency === 'DAILY' ? DAILY_MS : WEEKLY_MS;

  // Determine next run time based on last successful backup
  const lastBackup = await prisma.backup.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
  });

  let delayMs: number;
  if (lastBackup) {
    const elapsed = Date.now() - lastBackup.createdAt.getTime();
    delayMs = Math.max(0, intervalMs - elapsed);
  } else {
    // No previous backup — run in 1 minute (give server time to fully start)
    delayMs = 60_000;
  }

  schedulerTimer = setTimeout(() => void runScheduledBackup(), delayMs);
}

/**
 * Execute a scheduled backup and reschedule the next one.
 */
async function runScheduledBackup(): Promise<void> {
  const config = await prisma.backupConfig.findFirst();
  if (!config || !config.enabled || !config.path) {
    return;
  }

  try {
    await performBackup(config.path, config.retentionCount);
    console.log(`[backup-scheduler] Backup completed at ${new Date().toISOString()}`);
  } catch (err) {
    console.error('[backup-scheduler] Backup failed:', err);
  }

  // Schedule next run
  const intervalMs = config.frequency === 'DAILY' ? DAILY_MS : WEEKLY_MS;
  schedulerTimer = setTimeout(() => void runScheduledBackup(), intervalMs);
}

/**
 * Stop the backup scheduler (used for graceful shutdown).
 */
export function stopBackupScheduler(): void {
  if (schedulerTimer !== null) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
