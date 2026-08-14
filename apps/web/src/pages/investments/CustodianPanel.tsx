import { useState, useId } from 'react';
import { Pencil, Trash2, ExternalLink, MoreVertical, Building2 } from 'lucide-react';
import {
  buttonStyles,
  IconButton,
  Modal,
  inputStyles,
  linkStyles,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import EmptyState from '../../components/EmptyState.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import * as tl from '../transactions/transaction-list.css.js';

interface NamedEntity {
  id: string;
  name: string;
  managementUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Minimal mutation interface — only what the panel actually uses
interface MutateOnly<TError = Error, TVariables = unknown> {
  mutate: (
    data: TVariables,
    options?: { onSuccess?: () => void; onError?: (err: TError) => void },
  ) => void;
  isPending: boolean;
}

interface CustodianPanelProps {
  custodians: NamedEntity[];
  custodianValue: (custodianId: string) => number;
  createCustodian: MutateOnly<Error, unknown>;
  updateCustodian: MutateOnly<
    Error,
    { id: string; body: { name: string; managementUrl?: string } }
  >;
  deleteCustodian: MutateOnly<Error, string>;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  /** When true, only render the modal — skip the list content. Used for header-level "Add" buttons. */
  modalOnly?: boolean;
}

export default function CustodianPanel({
  custodians,
  custodianValue,
  createCustodian,
  updateCustodian,
  deleteCustodian,
  showModal,
  setShowModal,
  modalOnly,
}: CustodianPanelProps) {
  const fid = useId();
  const [editingCustodian, setEditingCustodian] = useState<NamedEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NamedEntity | null>(null);
  const [custodianName, setCustodianName] = useState('');
  const [custodianUrl, setCustodianUrl] = useState('');
  const [custodianError, setCustodianError] = useState('');
  const [prevShowModal, setPrevShowModal] = useState(showModal);

  // Reset form when modal opens for new custodian (inline state adjustment — no useEffect)
  if (showModal && !prevShowModal && !editingCustodian) {
    setPrevShowModal(true);
    setCustodianName('');
    setCustodianUrl('');
    setCustodianError('');
  } else if (showModal && !prevShowModal) {
    setPrevShowModal(true);
  } else if (!showModal && prevShowModal) {
    setPrevShowModal(false);
  }

  function openEditCustodian(c: NamedEntity) {
    setEditingCustodian(c);
    setCustodianName(c.name);
    setCustodianUrl(c.managementUrl ?? '');
    setCustodianError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingCustodian(null);
  }

  function saveCustodian() {
    const trimmed = custodianName.trim();
    if (!trimmed) {
      setCustodianError('Name is required');
      return;
    }
    setCustodianError('');
    const urlRaw = custodianUrl.trim();
    const managementUrl = urlRaw || undefined;
    if (editingCustodian) {
      updateCustodian.mutate(
        { id: editingCustodian.id, body: { name: trimmed, managementUrl } },
        {
          onSuccess: () => closeModal(),
          onError: (err) => setCustodianError(err.message),
        },
      );
    } else {
      createCustodian.mutate(
        { name: trimmed, managementUrl },
        {
          onSuccess: () => closeModal(),
          onError: (err) => setCustodianError(err.message),
        },
      );
    }
  }

  function handleDeleteCustodian(c: NamedEntity) {
    setCustodianError('');
    deleteCustodian.mutate(c.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: (err) => setCustodianError(err.message),
    });
  }

  return (
    <>
      {!modalOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {custodianError && (
            <p
              style={{
                color: vars.color.danger400,
                fontSize: vars.font.sm,
              }}
            >
              {custodianError}
            </p>
          )}

          {custodians.length === 0 ? (
            <EmptyState
              icon={<Building2 size={32} />}
              message="No custodians yet — add one to track where your investments are held"
            />
          ) : (
            <div className={tl.card}>
              <table className={tl.table} aria-label="Custodians">
                <colgroup>
                  <col style={{ width: '50%' }} />
                  <col style={{ width: '30%' }} />
                  <col style={{ width: '20%' }} />
                </colgroup>
                <tbody>
                  {custodians.map((c) => (
                    <tr key={c.id} className={tl.row} style={{ height: '2.5rem' }}>
                      <td className={tl.cell} style={{ paddingLeft: vars.space['3'] }}>
                        {c.managementUrl ? (
                          <a
                            href={c.managementUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={linkStyles.linkExternal}
                          >
                            {c.name} <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className={tl.nameCell}>{c.name}</span>
                        )}
                      </td>
                      <td className={`${tl.cell} ${tl.amountCell}`}>
                        {formatCurrency(custodianValue(c.id))}
                      </td>
                      <td className={`${tl.cell} ${tl.actionsCell}`}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                icon={<MoreVertical size={14} />}
                                tooltip="Actions"
                                size="sm"
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                icon={<Pencil size={13} />}
                                onSelect={() => openEditCustodian(c)}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                icon={<Trash2 size={13} />}
                                variant="danger"
                                onSelect={() => setDeleteTarget(c)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Custodian name modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editingCustodian ? 'Edit Custodian' : 'Add Custodian'}
        closeButton="none"
        footer={
          <>
            <button
              type="button"
              onClick={saveCustodian}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {editingCustodian ? 'Save' : 'Add'}
            </button>
            <button
              type="button"
              onClick={closeModal}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </>
        }
      >
        <div className={inputStyles.formStack}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
              Name
            </label>
            <input
              id={`${fid}-name`}
              value={custodianName}
              onChange={(e) => setCustodianName(e.target.value)}
              maxLength={100}
              className={inputStyles.input}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCustodian();
              }}
            />
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-management-url-optio`} className={inputStyles.fieldLabel}>
              Management URL{' '}
              <span style={{ color: vars.color.textTertiary, fontWeight: 'normal' }}>
                (optional)
              </span>
            </label>
            <input
              id={`${fid}-management-url-optio`}
              value={custodianUrl}
              onChange={(e) => setCustodianUrl(e.target.value)}
              placeholder="example.com/manage"
              className={inputStyles.input}
            />
          </div>
          {custodianError && (
            <p style={{ color: vars.color.danger400, fontSize: vars.font.sm }}>{custodianError}</p>
          )}
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) handleDeleteCustodian(deleteTarget);
        }}
        onCancel={() => setDeleteTarget(null)}
        title="Delete custodian"
        message="Are you sure you want to delete this custodian? This cannot be undone."
        confirmLabel="Delete"
        confirmColor="red"
      />
    </>
  );
}
