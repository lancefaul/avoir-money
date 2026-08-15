import { useState, useId, useEffect } from 'react';
import { RotateCcw, Trash2, Check, X, Clock, Download, DatabaseBackup } from 'lucide-react';
import {
  Toggle,
  Select,
  ButtonGroup,
  Modal,
  Dialog,
  TypeToConfirmInput,
  inputStyles,
  buttonStyles,
  badgeStyles,
  IconButton,
  DisplayHeading,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  modalBodyFlush,
  contentHeader,
  contentScroll,
} from '../../components/settings-modal.css.js';
import {
  useBackupConfig,
  useBackups,
  useUpdateBackupConfig,
  useRunBackup,
  useRestoreBackup,
  useRestoreUpload,
  useDeleteBackup,
} from '../../hooks/useBackups.js';
import { api } from '../../lib/api.js';
import { formatBytes } from '../../lib/utils.js';
import EmptyState from '../../components/EmptyState.js';
import RestoreUploadPanel from './RestoreUploadPanel.js';
import type { Backup, DumpPreview } from '@budget-tracker/core';

const FREQUENCY_OPTIONS = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
];

const RETENTION_OPTIONS = [
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '7', label: '7' },
  { value: '10', label: '10' },
  { value: '14', label: '14' },
  { value: '30', label: '30' },
];

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

type RestoreTarget =
  | { kind: 'recorded'; backup: Backup }
  | { kind: 'upload'; preview: DumpPreview; filename: string };

export interface BackupActions {
  openBackup: () => void;
  openRestore: () => void;
}

interface BackupSettingsProps {
  onActions?: (actions: BackupActions) => void;
}

export default function BackupSettings({ onActions }: BackupSettingsProps) {
  const fid = useId();
  const downloadPassId = useId();
  const { data: config, isLoading: configLoading } = useBackupConfig();
  const { data: backups } = useBackups();
  const updateConfig = useUpdateBackupConfig();
  const runBackup = useRunBackup();
  const restoreBackup = useRestoreBackup();
  const restoreUpload = useRestoreUpload();
  const deleteBackup = useDeleteBackup();

  // Restore picker modal state
  const [showRestorePicker, setShowRestorePicker] = useState(false);
  const [downloadTarget, setDownloadTarget] = useState<Backup | null>(null);
  const [downloadPassphrase, setDownloadPassphrase] = useState('');
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [selectedBackupId, setSelectedBackupId] = useState('');

  /*
   * The two ways in: a backup this app recorded, or a dump supplied by hand.
   * Modelled as one target with a kind rather than two nullable states, because
   * two would have to be kept mutually exclusive by hand and the confirm modal
   * would have to guess which one it is about.
   */
  const [restoreMode, setRestoreMode] = useState<'recorded' | 'upload'>('recorded');
  const [uploadPreview, setUploadPreview] = useState<DumpPreview | null>(null);
  const [uploadFilename, setUploadFilename] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<RestoreTarget | null>(null);
  const [restoreInput, setRestoreInput] = useState('');

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Backup | null>(null);

  const isEnabled = config?.enabled ?? false;
  const completedBackups = backups?.filter((b) => b.status === 'COMPLETED') ?? [];

  function handleToggle(enabled: boolean) {
    updateConfig.mutate({ enabled });
  }

  function handleFrequencyChange(value: string | string[]) {
    const freq = Array.isArray(value) ? value[0] : value;
    if (freq) updateConfig.mutate({ frequency: freq as 'DAILY' | 'WEEKLY' });
  }

  function handleRetentionChange(value: string | string[]) {
    const count = Array.isArray(value) ? value[0] : value;
    if (count) updateConfig.mutate({ retentionCount: Number(count) });
  }

  function openRestoreModal(backup: Backup) {
    setRestoreTarget({ kind: 'recorded', backup });
    setRestoreInput('');
  }

  function closeRestoreConfirm() {
    setRestoreTarget(null);
    setRestoreInput('');
  }

  function resetUpload() {
    setUploadPreview(null);
    setUploadFilename('');
  }

  function handleRestore() {
    if (!restoreTarget || restoreInput !== 'RESTORE') return;
    const done = {
      onSuccess: () => {
        closeRestoreConfirm();
        resetUpload();
      },
    };
    if (restoreTarget.kind === 'recorded') {
      restoreBackup.mutate({ id: restoreTarget.backup.id, confirmText: restoreInput }, done);
    } else {
      restoreUpload.mutate(
        { uploadId: restoreTarget.preview.uploadId, confirmText: restoreInput },
        done,
      );
    }
  }

  const restorePending = restoreBackup.isPending || restoreUpload.isPending;

  /**
   * Downloading is the moment a backup LEAVES, so it is the moment to offer
   * encryption (ADR-038). Optional rather than forced: a plain copy is
   * legitimate — inspecting one, or restoring on a machine where the passphrase
   * is not to hand — but the choice is put in front of the person making it
   * rather than defaulted silently.
   */
  async function runDownload(passphrase?: string) {
    setDownloadBusy(true);
    try {
      const { filename, blob } = await api.backups.download(downloadTarget!.id, passphrase);
      // An object URL rather than an href to the endpoint: the bytes are
      // already here, and the old anchor had to put the API key in the query
      // string because a navigation cannot set a header.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDownloadTarget(null);
      setDownloadPassphrase('');
    } finally {
      setDownloadBusy(false);
    }
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    deleteBackup.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  }

  useEffect(() => {
    onActions?.({
      openBackup: () => runBackup.mutate(),
      openRestore: () => {
        setSelectedBackupId(backups?.[0]?.id ?? '');
        setShowRestorePicker(true);
      },
    });
  });

  if (configLoading) {
    return (
      <div>
        <p style={{ color: vars.color.textSecondary, fontSize: vars.font.sm }}>
          Loading backup settings…
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Pinned header — config section */}
      <div className={contentHeader}>
        <DisplayHeading size="sm" as="h1">
          Data Backups
        </DisplayHeading>

        {/* Enable toggle */}
        <div className={inputStyles.field}>
          <label className={inputStyles.fieldLabel}>Automatic backups</label>
          <Toggle
            id={`${fid}-enabled`}
            label="Enable automatic backups"
            checked={isEnabled}
            onChange={handleToggle}
          />
        </div>

        {/* Config fields — only visible when enabled */}
        {isEnabled && (
          <div style={{ display: 'flex', gap: vars.space['4'] }}>
            <div className={inputStyles.field} style={{ flex: 1 }}>
              <label htmlFor={`${fid}-freq`} className={inputStyles.fieldLabel}>
                Frequency
              </label>
              <Select
                id={`${fid}-freq`}
                options={FREQUENCY_OPTIONS}
                value={config?.frequency ?? 'DAILY'}
                onChange={handleFrequencyChange}
                aria-label="Backup frequency"
              />
            </div>
            <div className={inputStyles.field} style={{ flex: 1 }}>
              <label htmlFor={`${fid}-retention`} className={inputStyles.fieldLabel}>
                Number of backups
              </label>
              <Select
                id={`${fid}-retention`}
                options={RETENTION_OPTIONS}
                value={String(config?.retentionCount ?? 7)}
                onChange={handleRetentionChange}
                aria-label="Number of backups to keep"
              />
            </div>
          </div>
        )}
      </div>

      {/* Scrollable backup history */}
      <div className={contentScroll}>
        {backups && backups.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
            <DisplayHeading size="sm" as="h1">
              Backup History
            </DisplayHeading>
            <div
              style={{
                border: `${vars.border.thin} solid ${vars.color.border}`,
                borderRadius: vars.radius.lg,
                overflow: 'hidden',
                background: vars.color.neutral0,
              }}
            >
              {backups.map((backup, i) => (
                <div
                  key={backup.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: vars.space['3'],
                    padding: `${vars.space['3']} ${vars.space['4']}`,
                    borderBottom:
                      i < backups.length - 1
                        ? `${vars.border.hairline} solid ${vars.color.border}`
                        : undefined,
                  }}
                >
                  <span
                    className={`${badgeStyles.badge} ${badgeStyles.badgeXl} ${badgeStyles.badgeIconOnly} ${
                      backup.status === 'COMPLETED'
                        ? badgeStyles.badgePositive
                        : backup.status === 'FAILED'
                          ? badgeStyles.badgeNegative
                          : badgeStyles.badgeWarning
                    }`}
                  >
                    {backup.status === 'COMPLETED' ? (
                      <Check size={16} />
                    ) : backup.status === 'FAILED' ? (
                      <X size={16} />
                    ) : (
                      <Clock size={16} />
                    )}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: vars.font.base,
                        fontWeight: vars.font.medium,
                        color: vars.color.textPrimary,
                      }}
                    >
                      {formatDate(backup.createdAt)}
                    </div>
                    <div
                      style={{
                        fontSize: vars.font.sm,
                        color: vars.color.textTertiary,
                        marginTop: vars.space['0.5'],
                      }}
                    >
                      {formatBytes(backup.sizeBytes)}
                      {/*
                       * `status` says how the run went; it cannot say what
                       * became of the file afterwards. Said on the row so a
                       * backup that cannot be restored is visible before the
                       * user opens a destructive confirm dialog over it.
                       */}
                      {backup.available === false && backup.status === 'COMPLETED' && (
                        <span style={{ color: vars.color.danger400 }}>
                          {' · File no longer on disk'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: vars.space['1'] }}>
                    {backup.status === 'COMPLETED' && (
                      <>
                        {/*
                         * The tooltip is the button's accessible name, so the
                         * reason is appended rather than substituted — a
                         * disabled control still has to say which control it is,
                         * and two buttons reading only "file is missing" would
                         * be indistinguishable to a screen reader.
                         */}
                        <IconButton
                          icon={<Download size={14} />}
                          tooltip={
                            backup.available === false
                              ? 'Download backup — the file is no longer on disk'
                              : 'Download backup'
                          }
                          onClick={() => setDownloadTarget(backup)}
                          disabled={backup.available === false}
                          size="sm"
                        />
                        <IconButton
                          icon={<RotateCcw size={14} />}
                          tooltip={
                            backup.available === false
                              ? 'Restore from this backup — the file is no longer on disk'
                              : 'Restore from this backup'
                          }
                          onClick={() => openRestoreModal(backup)}
                          disabled={backup.available === false}
                          size="sm"
                        />
                      </>
                    )}
                    <IconButton
                      icon={<Trash2 size={14} />}
                      tooltip="Delete backup"
                      onClick={() => setDeleteTarget(backup)}
                      size="sm"
                      variant="trueGhostDanger"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {(!backups || backups.length === 0) && (
          <EmptyState
            icon={<DatabaseBackup size={32} />}
            message="No backups yet — click Backup Now to create your first"
          />
        )}
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Backup"
        message={
          deleteTarget
            ? `Delete the backup from ${formatDate(deleteTarget.createdAt)}? This cannot be undone.`
            : ''
        }
        variant="negative"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        disabled={deleteBackup.isPending}
      />

      {/* Restore picker modal */}
      <Modal
        open={downloadTarget !== null}
        onClose={() => {
          setDownloadTarget(null);
          setDownloadPassphrase('');
        }}
        title="Download backup"
        footer={
          <div style={{ display: 'flex', gap: vars.space['3'] }}>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              disabled={downloadBusy || downloadPassphrase.length === 0}
              onClick={() => void runDownload(downloadPassphrase)}
            >
              {downloadBusy ? 'Preparing…' : 'Encrypt and download'}
            </button>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
              disabled={downloadBusy}
              onClick={() => void runDownload()}
            >
              Download without encryption
            </button>
          </div>
        }
      >
        <div className={inputStyles.formStack}>
          <p style={{ margin: 0, color: vars.color.textSecondary, fontSize: vars.font.base }}>
            This file holds every account, payee and transaction. A passphrase encrypts it in the
            age format, which any age tool can open — so an encrypted backup is still recoverable
            without this app.
          </p>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel} htmlFor={downloadPassId}>
              Passphrase
            </label>
            <input
              id={downloadPassId}
              type="password"
              className={inputStyles.input}
              value={downloadPassphrase}
              autoComplete="new-password"
              onChange={(e) => setDownloadPassphrase(e.target.value)}
              placeholder="Leave blank to download unencrypted"
            />
          </div>
          <p style={{ margin: 0, color: vars.color.textTertiary, fontSize: vars.font.sm }}>
            It is not stored anywhere. Lose it and this copy cannot be opened — which is the point,
            and the reason to keep one unencrypted copy somewhere you trust.
          </p>
        </div>
      </Modal>

      <Modal
        open={showRestorePicker}
        onClose={() => setShowRestorePicker(false)}
        title="Restore from Backup"
        closeButton="none"
        bodyClassName={modalBodyFlush}
        footer={
          restoreMode === 'upload' || completedBackups.length > 0 ? (
            <div style={{ display: 'flex', gap: vars.space['3'] }}>
              <button
                type="button"
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
                onClick={() => {
                  if (restoreMode === 'upload') {
                    if (!uploadPreview) return;
                    setShowRestorePicker(false);
                    setRestoreTarget({
                      kind: 'upload',
                      preview: uploadPreview,
                      filename: uploadFilename,
                    });
                    setRestoreInput('');
                    return;
                  }
                  const selected = backups?.find((b) => b.id === selectedBackupId);
                  if (selected) {
                    setShowRestorePicker(false);
                    openRestoreModal(selected);
                  }
                }}
                // An unvalidated upload can never reach the confirmation step.
                disabled={restoreMode === 'upload' ? !uploadPreview : !selectedBackupId}
              >
                Continue
              </button>
              <button
                type="button"
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                onClick={() => setShowRestorePicker(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex' }}>
              <button
                type="button"
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                onClick={() => setShowRestorePicker(false)}
              >
                Close
              </button>
            </div>
          )
        }
      >
        <div className={inputStyles.field} style={{ marginBottom: vars.space['4'] }}>
          <label className={inputStyles.fieldLabel}>Restore from</label>
          <ButtonGroup
            value={restoreMode}
            onChange={(v) => {
              setRestoreMode(v as 'recorded' | 'upload');
              // Switching away discards a validated upload rather than leaving
              // it armed behind the other tab.
              resetUpload();
            }}
            options={[
              { value: 'recorded', label: 'A recorded backup' },
              { value: 'upload', label: 'A file I have' },
            ]}
          />
        </div>

        {restoreMode === 'upload' ? (
          <RestoreUploadPanel
            preview={uploadPreview}
            onPreview={(preview, filename) => {
              setUploadPreview(preview);
              setUploadFilename(filename);
            }}
          />
        ) : completedBackups.length > 0 ? (
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-restore-select`} className={inputStyles.fieldLabel}>
              Select a backup to restore
            </label>
            <Select
              id={`${fid}-restore-select`}
              options={completedBackups.map((b) => ({
                value: b.id,
                label: `${formatDate(b.createdAt)} (${formatBytes(b.sizeBytes)})`,
              }))}
              value={selectedBackupId}
              onChange={(v) => {
                const val = Array.isArray(v) ? v[0] : v;
                if (val) setSelectedBackupId(val);
              }}
              aria-label="Select backup"
            />
          </div>
        ) : (
          <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary, margin: 0 }}>
            No backups available. Create a backup first using the Backup Now button.
          </p>
        )}
      </Modal>

      {/* Restore confirmation modal */}
      <Modal
        open={restoreTarget !== null}
        onClose={closeRestoreConfirm}
        title="Restore Database"
        closeButton="none"
        bodyClassName={modalBodyFlush}
        footer={
          <div style={{ display: 'flex', gap: vars.space['3'] }}>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
              onClick={handleRestore}
              disabled={restoreInput !== 'RESTORE' || restorePending}
            >
              {restorePending ? 'Restoring…' : 'Restore'}
            </button>
            <button
              type="button"
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
              onClick={closeRestoreConfirm}
            >
              Cancel
            </button>
          </div>
        }
      >
        {restoreTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
            <p style={{ fontSize: vars.font.base, color: vars.color.textPrimary, margin: 0 }}>
              This will replace all current data with{' '}
              {restoreTarget.kind === 'recorded' ? (
                <>
                  the backup from <strong>{formatDate(restoreTarget.backup.createdAt)}</strong>
                </>
              ) : (
                <>
                  <strong>{restoreTarget.filename}</strong> ({restoreTarget.preview.tableCount}{' '}
                  tables
                  {restoreTarget.preview.archiveCreatedAt
                    ? `, taken ${restoreTarget.preview.archiveCreatedAt}`
                    : ''}
                  )
                </>
              )}
              .
            </p>
            <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary, margin: 0 }}>
              A backup of the current database is taken first, so this can be undone.
            </p>
            <TypeToConfirmInput
              confirmWord="RESTORE"
              value={restoreInput}
              onChange={setRestoreInput}
              id={`${fid}-restore-confirm`}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
