import { z } from 'zod';

// ─── Enums ───

export const BackupFrequencySchema = z.enum(['DAILY', 'WEEKLY']);
export type BackupFrequency = z.infer<typeof BackupFrequencySchema>;

export const BackupStatusSchema = z.enum(['COMPLETED', 'FAILED', 'RESTORING']);

/**
 * Where a backup came from.
 *
 * Retention deletes within a source and never across: a PRE_RESTORE snapshot is
 * the rollback point for the restore that just ran, and an IMPORTED dump was
 * supplied by hand because it existed nowhere else, so neither is ever evicted.
 * MANUAL and SCHEDULED are both pruned to `retentionCount`, but only ever by
 * their own kind — sharing a bucket would let a daily schedule delete the backup
 * you took deliberately before a risky import.
 *
 * SCHEDULED arrived with the v0.9 backup scheduler and migration
 * `0005_backup_source_scheduled`. It is listed here because this enum is what
 * the frontend parses `GET /backups` with: while it was missing, the Settings
 * backup list threw on the first scheduled backup and rendered nothing.
 */
export const BackupSourceSchema = z.enum(['MANUAL', 'PRE_RESTORE', 'IMPORTED', 'SCHEDULED']);
export type BackupSource = z.infer<typeof BackupSourceSchema>;
export type BackupStatus = z.infer<typeof BackupStatusSchema>;

// ─── BackupConfig ───

export const BackupConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  path: z.string(),
  frequency: BackupFrequencySchema,
  retentionCount: z.number().int().min(1).max(100),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type BackupConfig = z.infer<typeof BackupConfigSchema>;

export const UpdateBackupConfigSchema = z.object({
  enabled: z.boolean().optional(),
  path: z.string().min(1).optional(),
  frequency: BackupFrequencySchema.optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
});
export type UpdateBackupConfig = z.infer<typeof UpdateBackupConfigSchema>;

// ─── Backup ───

export const BackupSchema = z.object({
  id: z.string(),
  filename: z.string(),
  filepath: z.string(),
  sizeBytes: z.coerce.number(), // BigInt serialized as number
  status: BackupStatusSchema,
  /** Optional so a client reading an older response still parses. */
  source: BackupSourceSchema.optional(),
  error: z.string().nullable(),
  completedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  /**
   * Whether the dump file is still on disk, checked at read time.
   *
   * `status` records how the backup *ran*; it says nothing about what happened
   * to the file afterwards. A row can be COMPLETED for months and its file
   * moved, pruned, or lost — as 25 of 30 were when a working tree was rebuilt —
   * and nothing in the list gave that away. Restore then failed deep inside
   * `pg_restore`'s file access, so the only way to learn a backup was
   * unrestorable was to attempt a destructive operation.
   *
   * Optional so a client reading an older response still parses; treat absent
   * as "unknown", not as "missing".
   */
  available: z.boolean().optional(),
});
export type Backup = z.infer<typeof BackupSchema>;

export const BackupListSchema = z.array(BackupSchema);

// ─── Restore Request ───

export const RestoreBackupSchema = z.object({
  confirmText: z.literal('RESTORE'),
});

// ─── Uploading an external dump ───

/**
 * What validation found in an uploaded file.
 *
 * Returned before anything destructive is possible, so the confirmation is made
 * against the archive's own contents rather than against a filename the user is
 * trusting from memory.
 */
export const DumpPreviewSchema = z.object({
  uploadId: z.string(),
  sizeBytes: z.number(),
  tableCount: z.number(),
  /** `Archive created at …` from the dump header, verbatim. */
  archiveCreatedAt: z.string().nullable(),
  /** The database the dump was taken from. */
  sourceDatabase: z.string().nullable(),
});
export type DumpPreview = z.infer<typeof DumpPreviewSchema>;

export const RestoreUploadSchema = z.object({
  confirmText: z.literal('RESTORE'),
});

/** A restore reports the snapshot it took first, so the rollback point is named. */
export const RestoreResultSchema = z.object({
  message: z.string(),
  safetyBackupId: z.string().nullable(),
});
