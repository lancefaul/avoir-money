import { useRef, useState } from 'react';
import { Upload, FileCheck2, AlertCircle } from 'lucide-react';
import { buttonStyles, vars } from '@budget-tracker/ui';
import type { DumpPreview } from '@budget-tracker/core';
import { useUploadDump } from '../../hooks/useBackups.js';
import { formatBytes } from '../../lib/utils.js';

interface RestoreUploadPanelProps {
  /** Set once a file validates; cleared when the selection is replaced. */
  preview: DumpPreview | null;
  onPreview: (preview: DumpPreview | null, filename: string) => void;
}

/**
 * Choose and validate an external dump file.
 *
 * Uploading is not restoring. This step only reports what the archive contains,
 * which is the point of splitting it out: the confirmation that follows is made
 * against the dump's own header and table list rather than against a filename
 * the user is trusting from memory. A file that fails validation never becomes
 * selectable, so the destructive step is unreachable for anything the server
 * has refused.
 */
export default function RestoreUploadPanel({ preview, onPreview }: RestoreUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadDump();

  function choose(file: File) {
    setFilename(file.name);
    setError(null);
    onPreview(null, file.name);
    upload.mutate(file, {
      onSuccess: (result) => onPreview(result, file.name),
      // Shown inline rather than only as a toast: the reason a dump was refused
      // is the whole content of this step, and it has to stay on screen while
      // the user picks a different file.
      onError: (err) => setError(err instanceof Error ? err.message : 'That file was refused.'),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
      <p style={{ fontSize: vars.font.sm, color: vars.color.textSecondary, margin: 0 }}>
        Select a <code>.dump</code> file created by this app — from cloud storage, another machine,
        or a <code>pg_dump</code> taken by hand. It is checked before anything can be restored.
      </p>

      <div>
        <button
          type="button"
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          <Upload size={14} />
          {upload.isPending ? 'Checking…' : filename ? 'Choose a different file' : 'Choose a file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dump"
          aria-label="Dump file to restore"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) choose(file);
            // Cleared so re-picking the same file fires change again.
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            display: 'flex',
            gap: vars.space['2'],
            padding: `${vars.space['2']} ${vars.space['3']}`,
            borderRadius: vars.radius.sm,
            background: vars.color.danger50,
            border: `${vars.border.hairline} solid ${vars.color.danger200}`,
            fontSize: vars.font.sm,
            color: vars.color.danger700,
            lineHeight: '1.4',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <div
          role="status"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['1'],
            padding: `${vars.space['3']} ${vars.space['3']}`,
            borderRadius: vars.radius.sm,
            background: vars.color.success50,
            border: `${vars.border.hairline} solid ${vars.color.success200}`,
            fontSize: vars.font.sm,
            color: vars.color.success700,
            lineHeight: '1.5',
          }}
        >
          <span style={{ display: 'flex', gap: vars.space['2'], color: vars.color.success700 }}>
            <FileCheck2 size={16} style={{ flexShrink: 0 }} />
            <strong>{filename}</strong>
          </span>
          <span style={{ color: vars.color.textSecondary }}>
            {preview.tableCount} tables · {formatBytes(preview.sizeBytes)}
          </span>
          {preview.archiveCreatedAt && (
            <span style={{ color: vars.color.textSecondary }}>
              Taken {preview.archiveCreatedAt}
            </span>
          )}
          {preview.sourceDatabase && (
            <span style={{ color: vars.color.textSecondary }}>
              From database {preview.sourceDatabase}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
