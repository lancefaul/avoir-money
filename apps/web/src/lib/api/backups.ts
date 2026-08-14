import { request, uploadRequest, downloadRequest, _passthrough } from './request.js';
import {
  BackupConfigSchema,
  BackupListSchema,
  BackupSchema,
  DumpPreviewSchema,
} from '@budget-tracker/core';

export const backupsApi = {
  getConfig: () => request('/backups/config', BackupConfigSchema),

  updateConfig: (body: unknown) =>
    request('/backups/config', BackupConfigSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  run: () =>
    request('/backups/run', BackupSchema, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  list: () => request('/backups', BackupListSchema),

  restore: (id: string, confirmText: string) =>
    request(`/backups/${id}/restore`, _passthrough, {
      method: 'POST',
      body: JSON.stringify({ confirmText }),
    }),

  delete: (id: string) => request(`/backups/${id}`, _passthrough, { method: 'DELETE' }),

  /**
   * Validate an external dump. Restores nothing — it returns what was found in
   * the archive so the confirmation that follows is made against its contents.
   */
  uploadDump: (file: File) => uploadRequest('/backups/upload', DumpPreviewSchema, file),

  restoreUpload: (uploadId: string, confirmText: string) =>
    request(`/backups/upload/${uploadId}/restore`, _passthrough, {
      method: 'POST',
      body: JSON.stringify({ confirmText }),
    }),

  /**
   * Fetch a backup's bytes, encrypted when a passphrase is given.
   *
   * Replaced `downloadUrl`, which built an anchor href with the API key in the
   * query string — the only way a browser navigation can authenticate, and a
   * place secrets should not be. A passphrase could not have gone there at all.
   */
  download: (id: string, passphrase?: string) =>
    downloadRequest(`/backups/${id}/download`, passphrase ? { passphrase } : {}),
};
