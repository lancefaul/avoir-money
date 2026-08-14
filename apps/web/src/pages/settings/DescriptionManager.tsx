import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Tag } from 'lucide-react';
import {
  IconButton,
  Modal,
  Dialog,
  RadioGroup,
  Checkbox,
  SearchInput,
  BadgeCount,
  DisplayHeading,
  Tooltip,
  inputStyles,
  buttonStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import {
  contentHeader,
  contentBody,
  modalBodyFlush,
  bodyInset,
} from '../../components/settings-modal.css.js';
import { api } from '../../lib/api.js';
import { captureBefore } from '../../lib/undo.js';
import EmptyState from '../../components/EmptyState.js';

export interface DescriptionManagerActions {
  mergeCount: number;
  openMerge: () => void;
}

interface DescriptionManagerProps {
  onActions?: (actions: DescriptionManagerActions) => void;
}

export default function DescriptionManager({ onActions }: DescriptionManagerProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  const { data: descriptions = [], isLoading } = useQuery({
    queryKey: ['descriptions', search],
    queryFn: () => api.descriptions.list(search || undefined),
  });

  /*
   * Rename is undoable; delete and merge below are not, and the difference is
   * the API's, not an oversight.
   *
   * `delete` would undo by `create`, which mints a NEW id — every transaction
   * that referenced the old one stays unlinked. That restores the word and
   * silently loses the associations, which is the one outcome worse than no
   * undo: the user is told it came back. `merge` has no inverse endpoint at
   * all. Neither declares `undo`, so neither shows the button.
   */
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.descriptions.rename(id, name),
    // The old name, read from the cache the user was looking at when they
    // acted. It is gone by the time the toast exists — this is the whole
    // reason undo is not simply a button.
    onMutate: ({ id }: { id: string; name: string }) => ({
      before: captureBefore<{ id: string; name: string }>(qc, ['descriptions', search], id),
    }),
    meta: {
      successMessage: 'Description renamed',
      undoneMessage: 'Rename undone',
      undo: async (_data: unknown, _vars: unknown, context: unknown) => {
        const before = (context as { before?: { id: string; name: string } })?.before;
        // Throws rather than returning quietly. The list is what the user is
        // looking at so it is cached in practice; if it somehow is not, saying
        // so beats writing a guess over a real record.
        if (!before) throw new Error('The previous name is no longer known.');
        await api.descriptions.rename(before.id, before.name);
      },
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['descriptions'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setRenameTarget(null);
      setRenameValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.descriptions.delete(id),
    meta: { successMessage: 'Description deleted' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['descriptions'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: ({ targetId, sourceIds }: { targetId: string; sourceIds: string[] }) =>
      api.descriptions.merge(targetId, sourceIds),
    meta: { successMessage: 'Descriptions merged' },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['descriptions'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setSelected(new Set());
      setMergeOpen(false);
      setMergeTarget(null);
    },
  });

  function openRename(id: string, name: string) {
    setRenameTarget({ id, name });
    setRenameValue(name);
  }

  function commitRename() {
    if (renameTarget && renameValue.trim() && renameValue.trim() !== renameTarget.name) {
      renameMutation.mutate({ id: renameTarget.id, name: renameValue.trim() });
    } else {
      setRenameTarget(null);
      setRenameValue('');
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openMerge() {
    setMergeTarget(null);
    setMergeOpen(true);
  }

  function confirmMerge() {
    if (!mergeTarget) return;
    const sourceIds = [...selected].filter((id) => id !== mergeTarget);
    mergeMutation.mutate({ targetId: mergeTarget, sourceIds });
  }

  useEffect(() => {
    onActions?.({
      mergeCount: selected.size,
      openMerge,
    });
  });

  const selectedDescriptions = descriptions.filter((d) => selected.has(d.id));

  return (
    <>
      {/* Pinned header */}
      <div className={contentHeader}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: vars.space['2'],
          }}
        >
          <DisplayHeading size="sm" as="h1">
            Transaction Descriptions
          </DisplayHeading>
          <BadgeCount>{descriptions.length}</BadgeCount>
        </div>
        <p
          style={{
            fontSize: vars.font.base,
            color: vars.color.textSecondary,
            margin: '0',
          }}
        >
          Select two or more descriptions with the checkboxes to merge them.
        </p>

        {/* Search */}
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search descriptions…"
          aria-label="Search descriptions"
        />
      </div>

      {/* Scrolling list */}
      <div className={contentBody}>
        {isLoading && (
          <p style={{ color: vars.color.textTertiary, fontSize: vars.font.sm }}>Loading…</p>
        )}
        {!isLoading && descriptions.length === 0 && (
          // `contentBody` has no padding on purpose — it holds a full-width
          // table whose rows should reach both edges. An empty state in the
          // same slot inherits that and touches the panel edge.
          <div className={bodyInset}>
            <EmptyState
              icon={<Tag size={32} />}
              message="No descriptions yet — they're created automatically when you add transactions"
            />
          </div>
        )}
        {!isLoading && descriptions.length > 0 && (
          <table
            style={{
              width: '100%',
              fontSize: vars.font.base,
              tableLayout: 'fixed',
              borderCollapse: 'collapse',
            }}
            aria-label="Transaction descriptions"
          >
            {/* One flexible column (description); actions sized to its two buttons (see ERRORS.md) */}
            <colgroup>
              <col />
              <col style={{ width: '7.5rem' }} />
            </colgroup>
            <thead>
              <tr
                style={{
                  background: vars.color.neutral100,
                  height: '2.5rem',
                  borderBottom: `${vars.border.hairline} solid ${vars.color.border}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                }}
              >
                <th
                  style={{
                    padding: `0 ${vars.space['6']}`,
                    paddingLeft: vars.space['6'],
                    textAlign: 'left',
                    fontSize: vars.font.xs,
                    fontWeight: vars.font.semibold,
                    letterSpacing: vars.font.trackingLabel,
                    fontFamily: vars.font.label,
                    textTransform: 'uppercase',
                    color: vars.color.textPrimary,
                  }}
                >
                  Description
                </th>
                <th
                  style={{
                    padding: `0 ${vars.space['6']}`,
                    textAlign: 'right',
                    fontSize: vars.font.xs,
                    fontWeight: vars.font.semibold,
                    letterSpacing: vars.font.trackingLabel,
                    fontFamily: vars.font.label,
                    textTransform: 'uppercase',
                    color: vars.color.textPrimary,
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {descriptions.map((d, i) => (
                <tr
                  key={d.id}
                  style={{
                    height: '2.5rem',
                    background: selected.has(d.id)
                      ? vars.color.surfaceSelected
                      : vars.color.neutral0,
                    borderBottom:
                      i < descriptions.length - 1
                        ? `${vars.border.hairline} solid ${vars.color.border}`
                        : undefined,
                  }}
                >
                  <td
                    style={{
                      padding: `0 ${vars.space['6']}`,
                      paddingLeft: vars.space['6'],
                      color: vars.color.textPrimary,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: vars.space['2'],
                        minWidth: 0,
                      }}
                    >
                      {/* flexShrink 0: a long name must truncate, never crush the checkbox */}
                      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                        <Checkbox
                          standalone
                          checked={selected.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                          aria-label={`Select ${d.name}`}
                        />
                      </span>
                      <Tooltip content={d.name} truncate>
                        <span>{d.name}</span>
                      </Tooltip>
                    </div>
                  </td>
                  <td style={{ padding: `0 ${vars.space['6']}`, textAlign: 'right' }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['1'] }}
                    >
                      <IconButton
                        icon={<Pencil size={14} />}
                        tooltip="Rename"
                        size="sm"
                        variant="trueGhost"
                        onClick={() => openRename(d.id, d.name)}
                      />
                      <IconButton
                        icon={<Trash2 size={14} />}
                        tooltip="Delete"
                        size="sm"
                        variant="trueGhostDanger"
                        onClick={() => setDeleteTarget({ id: d.id, name: d.name })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rename modal */}
      <Modal
        open={renameTarget !== null}
        onClose={() => {
          setRenameTarget(null);
          setRenameValue('');
        }}
        title="Rename Description"
        closeButton="none"
        bodyClassName={modalBodyFlush}
        footer={
          <div style={{ display: 'flex', gap: vars.space['3'] }}>
            <button
              type="button"
              onClick={commitRename}
              disabled={!renameValue.trim() || renameMutation.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {renameMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue('');
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div className={inputStyles.field}>
          <label htmlFor="rename-description" className={inputStyles.fieldLabel}>
            Name
          </label>
          <input
            id="rename-description"
            className={inputStyles.input}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
            }}
            autoFocus
          />
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        title="Delete Description"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? All transactions using this description will have it cleared.`
            : ''
        }
        variant="negative"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        disabled={deleteMutation.isPending}
      />

      {/* Merge modal */}
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Merge Descriptions"
        closeButton="none"
        bodyClassName={modalBodyFlush}
        footer={
          <div style={{ display: 'flex', gap: vars.space['3'] }}>
            <button
              type="button"
              onClick={confirmMerge}
              disabled={!mergeTarget || mergeMutation.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {mergeMutation.isPending ? 'Merging…' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => setMergeOpen(false)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <p
          style={{
            fontSize: vars.font.base,
            color: vars.color.textSecondary,
            marginBottom: vars.space['4'],
          }}
        >
          Choose which description to keep. The others will be merged into it.
        </p>
        <RadioGroup
          options={selectedDescriptions.map((d) => ({ value: d.id, label: d.name }))}
          value={mergeTarget ?? undefined}
          onChange={(v) => setMergeTarget(v)}
          name="merge-target"
        />
      </Modal>
    </>
  );
}
