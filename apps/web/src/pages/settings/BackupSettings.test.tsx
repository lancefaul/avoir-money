/**
 * A backup whose file is gone must be visibly unusable.
 *
 * `status` records how the run went and nothing re-checked the file afterwards,
 * so a COMPLETED row whose dump had been lost still rendered with a green check
 * and a live Restore button. The failure only appeared after opening a
 * destructive confirm dialog and committing to it. The screen now says so on
 * the row and refuses the action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';

const mockUseBackups = vi.fn();

vi.mock('../../hooks/useBackups.js', () => ({
  useBackupConfig: () => ({ data: undefined, isLoading: false }),
  useBackups: () => mockUseBackups(),
  useUpdateBackupConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useRunBackup: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreBackup: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreUpload: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadDump: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBackup: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../lib/api.js', () => ({ api: {} }));

import BackupSettings from './BackupSettings.js';

const backup = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  filename: 'budget_tracker_backup_20260731_223925.dump',
  filepath: '/backups/budget_tracker_backup_20260731_223925.dump',
  sizeBytes: 386157,
  status: 'COMPLETED' as const,
  error: null,
  completedAt: new Date('2026-07-31T22:39:25Z'),
  createdAt: new Date('2026-07-31T22:39:25Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BackupSettings — a backup whose file is gone', () => {
  it('says so on the row', () => {
    mockUseBackups.mockReturnValue({ data: [backup({ available: false })], isLoading: false });
    render(<BackupSettings />, { wrapper: createWrapper() });

    expect(screen.getByText(/file no longer on disk/i)).toBeInTheDocument();
  });

  it('disables restore and download', () => {
    mockUseBackups.mockReturnValue({ data: [backup({ available: false })], isLoading: false });
    render(<BackupSettings />, { wrapper: createWrapper() });

    // Delete stays enabled on purpose — clearing a dead record is exactly what
    // the user should still be able to do.
    expect(screen.getByRole('button', { name: /restore/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /delete/i })).toBeEnabled();
  });
});

describe('BackupSettings — a usable backup', () => {
  it('leaves restore and download available and says nothing about the file', () => {
    mockUseBackups.mockReturnValue({ data: [backup({ available: true })], isLoading: false });
    render(<BackupSettings />, { wrapper: createWrapper() });

    expect(screen.queryByText(/file no longer on disk/i)).toBeNull();
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
  });

  it('treats an absent `available` as usable, not missing', () => {
    // The field is optional so an older response still parses. Absent means
    // unknown, and refusing to restore on unknown would break a working setup.
    mockUseBackups.mockReturnValue({ data: [backup()], isLoading: false });
    render(<BackupSettings />, { wrapper: createWrapper() });

    expect(screen.queryByText(/file no longer on disk/i)).toBeNull();
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled();
  });
});
