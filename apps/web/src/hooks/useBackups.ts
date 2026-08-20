import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { beforeOf, capturedBefore } from '../lib/undo.js';
import type { UpdateBackupConfig } from '@budget-tracker/core';

export const useBackupConfig = () =>
  useQuery({ queryKey: ['backup-config'], queryFn: () => api.backups.getConfig() });

export const useBackups = () =>
  useQuery({ queryKey: ['backups'], queryFn: () => api.backups.list() });

export const useUpdateBackupConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateBackupConfig) => api.backups.updateConfig(data),
    // The config is a single object rather than a list, so it is read straight
    // from the cache rather than through `captureBefore`.
    onMutate: () => ({ before: qc.getQueryData<UpdateBackupConfig>(['backup-config']) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backup-config'] });
    },
    meta: {
      successMessage: 'Backup settings updated',
      undoneMessage: 'Backup settings restored',
      canUndo: capturedBefore,
      undo: (_d: unknown, _v: unknown, context: unknown) =>
        api.backups.updateConfig(beforeOf<UpdateBackupConfig>(context)!),
    },
  });
};

/*
 * Nothing below is undoable, and each for a different reason:
 *
 *   run            — a completed backup is a file on disk. "Undoing" it would
 *                    mean deleting the artifact the action exists to produce.
 *   restore        — replaces the entire database. There is no prior state left
 *                    to return to; the restore IS the recovery mechanism.
 *   restoreUpload  — the same, from an uploaded file.
 *   delete         — the file is gone from disk, and no endpoint recreates it.
 */
export const useRunBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.backups.run(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
    meta: { successMessage: 'Backup completed' },
  });
};

export const useRestoreBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmText }: { id: string; confirmText: string }) =>
      api.backups.restore(id, confirmText),
    onSuccess: () => {
      qc.invalidateQueries();
    },
    meta: { successMessage: 'Database restored successfully' },
  });
};

/**
 * Validate an external dump. Nothing is restored — this only reports what the
 * archive contains, so the user confirms against its contents rather than a
 * filename. No cache is invalidated because no state changed.
 */
export const useUploadDump = () => {
  return useMutation({
    mutationFn: (file: File) => api.backups.uploadDump(file),
  });
};

export const useRestoreUpload = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ uploadId, confirmText }: { uploadId: string; confirmText: string }) =>
      api.backups.restoreUpload(uploadId, confirmText),
    onSuccess: () => {
      // Every table was just replaced, so nothing cached survives.
      qc.invalidateQueries();
    },
    meta: { successMessage: 'Database restored successfully' },
  });
};

export const useDeleteBackup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.backups.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backups'] });
    },
    meta: { successMessage: 'Backup deleted' },
  });
};
