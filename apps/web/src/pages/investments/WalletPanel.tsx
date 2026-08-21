import { Sensitive } from '@budget-tracker/ui';
import { useState, useId } from 'react';
import { Pencil, Trash2, ExternalLink, MoreVertical, Vault } from 'lucide-react';
import {
  buttonStyles,
  IconButton,
  badgeStyles,
  linkStyles,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Modal,
  inputStyles,
  ButtonGroup,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { formatCurrency } from '../../lib/utils.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import * as iv from './investments-table.css.js';
import EmptyState from '../../components/EmptyState.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';

/**
 * Below this width the wallet name and custody-type columns merge into one: the
 * custody type is stacked under the name and its own column is dropped.
 *
 * The <col>, the body <td>, and the tfoot "Total" colSpan switch together — column
 * count, cell count and colSpan must always agree, or cells shift into the wrong
 * columns (see ERRORS.md).
 */
const MERGE_CUSTODY_BREAKPOINT = below.md;
import * as tl from '../transactions/transaction-list.css.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

interface NamedEntity {
  id: string;
  name: string;
  managementUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
interface WalletEntity extends NamedEntity {
  custodyType: 'CUSTODIAL' | 'NON_CUSTODIAL';
  storageType: 'HOT' | 'COLD' | null;
}

// Minimal mutation interface — only what the panel actually uses
interface MutateOnly<TError = Error, TVariables = unknown> {
  mutate: (
    data: TVariables,
    options?: { onSuccess?: () => void; onError?: (err: TError) => void },
  ) => void;
  isPending: boolean;
}

interface WalletPanelProps {
  wallets: WalletEntity[];
  walletValue: (walletId: string) => number;
  createWallet: MutateOnly<Error, unknown>;
  updateWallet: MutateOnly<Error, { id: string; body: unknown }>;
  deleteWallet: MutateOnly<Error, string>;
  showModal: boolean;
  setShowModal: (show: boolean) => void;
  /** When true, only render the modal — skip the list content. Used for header-level "Add" buttons. */
  modalOnly?: boolean;
}

export default function WalletPanel({
  wallets,
  walletValue,
  createWallet,
  updateWallet,
  deleteWallet,
  showModal,
  setShowModal,
  modalOnly,
}: WalletPanelProps) {
  const fid = useId();
  const mergeCustody = useIsNarrow(MERGE_CUSTODY_BREAKPOINT);
  const [editingWallet, setEditingWallet] = useState<WalletEntity | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WalletEntity | null>(null);
  const [walletName, setWalletName] = useState('');
  const [walletUrl, setWalletUrl] = useState('');
  const [walletCustodyType, setWalletCustodyType] = useState<'CUSTODIAL' | 'NON_CUSTODIAL'>(
    'NON_CUSTODIAL',
  );
  const [walletStorageType, setWalletStorageType] = useState<'HOT' | 'COLD' | ''>('');
  const [walletError, setWalletError] = useState('');
  const [prevShowModal, setPrevShowModal] = useState(showModal);

  // Reset form when modal opens for new wallet (inline state adjustment — no useEffect)
  if (showModal && !prevShowModal && !editingWallet) {
    setPrevShowModal(true);
    setWalletName('');
    setWalletUrl('');
    setWalletCustodyType('NON_CUSTODIAL');
    setWalletStorageType('');
    setWalletError('');
  } else if (showModal && !prevShowModal) {
    setPrevShowModal(true);
  } else if (!showModal && prevShowModal) {
    setPrevShowModal(false);
  }

  function openEditWallet(w: WalletEntity) {
    setEditingWallet(w);
    setWalletName(w.name);
    setWalletUrl(w.managementUrl ?? '');
    setWalletCustodyType(w.custodyType);
    setWalletStorageType(w.storageType ?? '');
    setWalletError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingWallet(null);
  }

  function saveWallet() {
    const trimmed = walletName.trim();
    if (!trimmed) {
      setWalletError('Name is required');
      return;
    }
    setWalletError('');
    const urlRaw = walletUrl.trim();
    const managementUrl = urlRaw || undefined;
    const body: Record<string, unknown> = {
      name: trimmed,
      custodyType: walletCustodyType,
      managementUrl,
    };
    if (walletCustodyType === 'CUSTODIAL') {
      if (!walletStorageType) {
        setWalletError('Storage type is required for custodial wallets');
        return;
      }
      body.storageType = walletStorageType;
    }
    if (editingWallet) {
      updateWallet.mutate(
        { id: editingWallet.id, body },
        {
          onSuccess: () => closeModal(),
          onError: (err) => setWalletError(err.message),
        },
      );
    } else {
      createWallet.mutate(body, {
        onSuccess: () => closeModal(),
        onError: (err) => setWalletError(err.message),
      });
    }
  }

  function handleDeleteWallet(w: WalletEntity) {
    setDeleteTarget(w);
  }

  return (
    <>
      {!modalOnly && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {walletError && (
            <p
              style={{
                color: vars.color.danger400,
                fontSize: vars.font.sm,
              }}
            >
              {walletError}
            </p>
          )}

          {wallets.length === 0 ? (
            <EmptyState
              icon={<Vault size={32} />}
              message="No wallets yet — add one to track your Bitcoin storage"
            />
          ) : (
            <div className={tl.card}>
              <table className={tl.table} aria-label="Bitcoin wallets">
                {/* Narrow: name absorbs the custody column (30% + 18%). */}
                <colgroup>
                  <col style={{ width: mergeCustody ? '44%' : '30%' }} />
                  {!mergeCustody && <col style={{ width: '18%' }} />}
                  <col style={{ width: mergeCustody ? '18%' : '14%' }} />
                  <col style={{ width: mergeCustody ? '26%' : '20%' }} />
                  <col style={{ width: mergeCustody ? '12%' : '8%' }} />
                </colgroup>
                <tbody>
                  {wallets.map((w) => (
                    <tr key={w.id} className={tl.row} style={{ height: '2.5rem' }}>
                      {/* Col 1: Wallet name + external link. Narrow: custody stacks under it. */}
                      <td className={tl.cell} style={{ paddingLeft: vars.space['3'] }}>
                        {w.managementUrl ? (
                          <a
                            href={w.managementUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={linkStyles.linkExternal}
                          >
                            <Sensitive label="wallet name">{w.name}</Sensitive>{' '}
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className={tl.nameCell}>
                            <Sensitive label="wallet name">{w.name}</Sensitive>
                          </span>
                        )}
                        {mergeCustody && (
                          <span className={iv.subline}>
                            {w.custodyType === 'CUSTODIAL' ? 'Custodial' : 'Non-Custodial'}
                          </span>
                        )}
                      </td>
                      {/* Col 2: Custody type — merged into col 1 when narrow */}
                      {!mergeCustody && (
                        <td className={`${tl.cell} ${tl.secondaryCell}`}>
                          {w.custodyType === 'CUSTODIAL' ? 'Custodial' : 'Non-Custodial'}
                        </td>
                      )}
                      {/* Col 3: Storage type badge */}
                      <td className={tl.cell}>
                        <span className={`${badgeStyles.badge} ${badgeStyles.badgeNeutral}`}>
                          {w.storageType === 'COLD' ? '❄️ Cold' : '🔥 Hot'}
                        </span>
                      </td>
                      {/* Col 4: Total holdings value */}
                      <td className={`${tl.cell} ${tl.amountCell}`}>
                        <Sensitive label="amount">{formatCurrency(walletValue(w.id))}</Sensitive>
                      </td>
                      {/* Col 5: Overflow menu */}
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
                                onSelect={() => openEditWallet(w)}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                icon={<Trash2 size={13} />}
                                variant="danger"
                                onSelect={() => handleDeleteWallet(w)}
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
                <tfoot>
                  <tr
                    style={{
                      borderTop: `${vars.border.thin} solid ${vars.color.border}`,
                      height: '2.5rem',
                    }}
                  >
                    <td
                      className={tl.cell}
                      /* Spans name(+custody) and the storage badge — one fewer when merged. */
                      colSpan={mergeCustody ? 2 : 3}
                      style={{
                        paddingLeft: vars.space['3'],
                        fontWeight: vars.font.semibold,
                        color: vars.color.textPrimary,
                      }}
                    >
                      Total
                    </td>
                    <td
                      className={`${tl.cell} ${tl.amountCell}`}
                      style={{ fontWeight: vars.font.semibold }}
                    >
                      <Sensitive label="amount">
                        <Sensitive label="amount">
                          {formatCurrency(wallets.reduce((sum, w) => sum + walletValue(w.id), 0))}
                        </Sensitive>
                      </Sensitive>
                    </td>
                    <td className={tl.cell} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) {
            deleteWallet.mutate(deleteTarget.id, {
              onError: (err) => setWalletError(err.message),
            });
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
        title="Delete wallet"
        message="Are you sure you want to delete this wallet? This cannot be undone."
        confirmLabel="Delete"
        confirmColor="red"
      />

      {/* Wallet modal */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editingWallet ? 'Edit Wallet' : 'Add Wallet'}
        closeButton="none"
        footer={
          <>
            <button
              type="button"
              onClick={saveWallet}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              {editingWallet ? 'Save' : 'Add'}
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
            <label htmlFor={`${fid}-custody-type`} className={inputStyles.fieldLabel}>
              Custody Type
            </label>
            <ButtonGroup
              id={`${fid}-custody-type`}
              options={[
                { value: 'NON_CUSTODIAL', label: 'Non-Custodial' },
                { value: 'CUSTODIAL', label: 'Custodial' },
              ]}
              value={walletCustodyType}
              onChange={(v) => {
                setWalletCustodyType(v as 'CUSTODIAL' | 'NON_CUSTODIAL');
                if (v === 'NON_CUSTODIAL') setWalletStorageType('');
              }}
            />
          </div>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
              Name
            </label>
            <input
              id={`${fid}-name`}
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
              maxLength={100}
              className={inputStyles.input}
              autoFocus
            />
          </div>
          {walletCustodyType === 'CUSTODIAL' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-storage-type`} className={inputStyles.fieldLabel}>
                Storage Type
              </label>
              <ButtonGroup
                id={`${fid}-storage-type`}
                options={[
                  { value: 'HOT', label: '🔥 Hot' },
                  { value: 'COLD', label: '❄️ Cold' },
                ]}
                value={walletStorageType}
                onChange={(v) => setWalletStorageType(v as 'HOT' | 'COLD' | '')}
              />
            </div>
          )}
          {walletCustodyType === 'NON_CUSTODIAL' && (
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-management-url-optio`} className={inputStyles.fieldLabel}>
                Management URL{' '}
                <span style={{ color: vars.color.textTertiary, fontWeight: 'normal' }}>
                  (optional)
                </span>
              </label>
              <input
                id={`${fid}-management-url-optio`}
                value={walletUrl}
                onChange={(e) => setWalletUrl(e.target.value)}
                placeholder="example.com/manage"
                className={inputStyles.input}
              />
            </div>
          )}
          {walletError && (
            <p style={{ color: vars.color.danger400, fontSize: vars.font.sm }}>{walletError}</p>
          )}
        </div>
      </Modal>
    </>
  );
}
