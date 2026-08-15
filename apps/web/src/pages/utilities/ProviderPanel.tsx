import { useState, useId } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { buttonStyles, IconButton, Modal, DisplayHeading, inputStyles } from '@budget-tracker/ui';
import type { UseMutationResult } from '@tanstack/react-query';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import type { Provider } from './types.js';

interface Props {
  providers: Provider[];
  isLoading: boolean;
  selectedProvider: Provider | undefined;
  createProvider: UseMutationResult<unknown, Error, { name: string }>;
  updateProvider: UseMutationResult<unknown, Error, { id: string; body: { name: string } }>;
  deleteProvider: UseMutationResult<unknown, Error, string>;
  showAddModal: boolean;
  onShowAddModalChange: (open: boolean) => void;
  onAddService: () => void;
}

export default function ProviderPanel({
  providers,
  isLoading,
  selectedProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  showAddModal,
  onShowAddModalChange,
  onAddService,
}: Props) {
  const fid = useId();
  const [newName, setNewName] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Provider | null>(null);

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createProvider.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setNewName('');
          onShowAddModalChange(false);
        },
      },
    );
  }

  function openEdit() {
    if (!selectedProvider) return;
    setEditName(selectedProvider.name);
    setShowEditModal(true);
  }

  function handleEdit() {
    if (!selectedProvider) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === selectedProvider.name) {
      setShowEditModal(false);
      return;
    }
    updateProvider.mutate(
      { id: selectedProvider.id, body: { name: trimmed } },
      {
        onSuccess: () => setShowEditModal(false),
        onError: () => setShowEditModal(false),
      },
    );
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteProvider.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: () => setDeleteTarget(null),
    });
  }

  if (isLoading) {
    return <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>;
  }

  if (providers.length === 0) {
    return (
      <>
        <Modal
          open={showAddModal}
          onClose={() => {
            onShowAddModalChange(false);
            setNewName('');
          }}
          title="Add Provider"
          closeButton="none"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim() || createProvider.isPending}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  onShowAddModalChange(false);
                  setNewName('');
                }}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
              >
                Cancel
              </button>
            </div>
          }
        >
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-provider-name`} className={inputStyles.fieldLabel}>
              Provider Name
            </label>
            <input
              id={`${fid}-provider-name`}
              className={inputStyles.input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="e.g. Metro Power, AT&T"
              maxLength={100}
              autoFocus
            />
          </div>
        </Modal>
      </>
    );
  }

  return (
    <>
      {/* Provider heading row */}
      {selectedProvider && (
        <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
          <DisplayHeading size="lg" as="h3" style={{ flex: 1 }}>
            {selectedProvider.name}
          </DisplayHeading>
          <IconButton
            icon={<Plus size={14} />}
            tooltip="Add service"
            size="sm"
            variant="trueGhost"
            onClick={onAddService}
          />
          <IconButton
            icon={<Pencil size={14} />}
            tooltip="Edit provider"
            size="sm"
            variant="trueGhost"
            onClick={() => openEdit()}
          />
          <IconButton
            icon={<Trash2 size={14} />}
            tooltip="Delete provider"
            size="sm"
            variant="trueGhostDanger"
            onClick={() => setDeleteTarget(selectedProvider)}
          />
        </div>
      )}

      {/* Add Provider Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          onShowAddModalChange(false);
          setNewName('');
        }}
        title="Add Provider"
        closeButton="none"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!newName.trim() || createProvider.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                onShowAddModalChange(false);
                setNewName('');
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-provider-name-1`} className={inputStyles.fieldLabel}>
            Provider Name
          </label>
          <input
            id={`${fid}-provider-name-1`}
            className={inputStyles.input}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
            placeholder="e.g. Metro Power, AT&T"
            maxLength={100}
            autoFocus
          />
        </div>
      </Modal>

      {/* Edit Provider Modal */}
      <Modal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Provider"
        closeButton="none"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
            <button
              type="button"
              onClick={handleEdit}
              disabled={!editName.trim() || updateProvider.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-provider-name-2`} className={inputStyles.fieldLabel}>
            Provider Name
          </label>
          <input
            id={`${fid}-provider-name-2`}
            className={inputStyles.input}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEdit();
            }}
            placeholder="e.g. Metro Power, AT&T"
            maxLength={100}
            autoFocus
          />
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Provider"
        message={deleteTarget ? `Delete "${deleteTarget.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
