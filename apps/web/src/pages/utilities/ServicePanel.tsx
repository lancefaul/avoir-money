import { useState, useId } from 'react';
import { Plus } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { buttonStyles, Modal, Select, inputStyles, Toggle } from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import type { UseMutationResult } from '@tanstack/react-query';
import EmptyState from '../../components/EmptyState.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import type { Service, Provider, Expense } from './types.js';
import { formatServiceType, SERVICE_TYPE_OPTIONS } from './types.js';

const serviceButtonBase: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space['2'],
  padding: vars.space['3'],
  borderRadius: vars.radius.md,
  cursor: 'pointer',
  transition: `background ${vars.duration.fast} ${vars.easing.default}`,
  textAlign: 'left',
  width: '100%',
};

interface Props {
  provider: Provider | undefined;
  services: Service[];
  isLoading: boolean;
  selectedServiceId: string | null;
  onSelectService: (id: string) => void;
  expenses: Expense[];
  createService: UseMutationResult<
    unknown,
    Error,
    { providerId: string; body: { serviceType: string; metering: string } }
  >;
  deleteService: UseMutationResult<unknown, Error, string>;
  linkService: UseMutationResult<unknown, Error, { id: string; expenseId: string }>;
  unlinkService: UseMutationResult<unknown, Error, string>;
  showAddModal: boolean;
  onShowAddModalChange: (open: boolean) => void;
  deleteTarget: Service | null;
  onDeleteTargetChange: (svc: Service | null) => void;
  linkingService: Service | null;
  onLinkingServiceChange: (svc: Service | null) => void;
}

export default function ServicePanel({
  provider,
  services,
  isLoading,
  selectedServiceId,
  onSelectService,
  expenses,
  createService,
  deleteService,
  linkService,
  unlinkService: _unlinkService,
  showAddModal,
  onShowAddModalChange,
  deleteTarget,
  onDeleteTargetChange,
  linkingService,
  onLinkingServiceChange,
}: Props) {
  const fid = useId();
  const [newServiceType, setNewServiceType] = useState('');
  const [newMetering, setNewMetering] = useState('METERED');
  const [selectedExpenseId, setSelectedExpenseId] = useState('');

  if (!provider) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.semibold,
            color: vars.color.textPrimary,
          }}
        >
          Services
        </h3>
        <EmptyState message="Select a provider to view services" />
      </div>
    );
  }

  function handleCreateService() {
    if (!newServiceType || !provider) return;
    createService.mutate(
      { providerId: provider.id, body: { serviceType: newServiceType, metering: newMetering } },
      {
        onSuccess: () => {
          onShowAddModalChange(false);
          setNewServiceType('');
          setNewMetering('METERED');
        },
      },
    );
  }

  function confirmDeleteService() {
    if (!deleteTarget) return;
    deleteService.mutate(deleteTarget.id, {
      onSuccess: () => onDeleteTargetChange(null),
      onError: () => onDeleteTargetChange(null),
    });
  }

  function handleLink() {
    if (!linkingService || !selectedExpenseId) return;
    linkService.mutate(
      { id: linkingService.id, expenseId: selectedExpenseId },
      {
        onSuccess: () => {
          onLinkingServiceChange(null);
          setSelectedExpenseId('');
        },
      },
    );
  }

  const expenseOptions: SelectOption[] = expenses.map((e) => ({ value: e.id, label: e.name }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.semibold,
            color: vars.color.textPrimary,
          }}
        >
          {provider.name} – Services
        </h3>
      </div>

      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : services.length === 0 ? (
        <EmptyState
          message="No services for this provider"
          action={
            <button
              type="button"
              onClick={() => onShowAddModalChange(true)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={14} /> Add Service
            </button>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
          {services.map((svc) => {
            const isSelected = selectedServiceId === svc.id;
            return (
              <button
                type="button"
                key={svc.id}
                onClick={() => onSelectService(svc.id)}
                style={{
                  ...serviceButtonBase,
                  background: isSelected ? vars.color.brand50 : vars.color.surfaceRaised,
                  border: isSelected
                    ? `${vars.border.thin} solid ${vars.color.brand200}`
                    : `${vars.border.thin} solid ${vars.color.border}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
                  <span
                    style={{
                      flex: 1,
                      fontSize: vars.font.base,
                      fontWeight: vars.font.medium,
                      color: vars.color.textPrimary,
                    }}
                  >
                    {formatServiceType(svc.serviceType)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Add Service Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          onShowAddModalChange(false);
          setNewServiceType('');
          setNewMetering('METERED');
        }}
        title="Add Service"
        closeButton="none"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
            <button
              type="button"
              onClick={handleCreateService}
              disabled={!newServiceType || createService.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                onShowAddModalChange(false);
                setNewServiceType('');
                setNewMetering('METERED');
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div className={inputStyles.formStack}>
          <div className={inputStyles.field}>
            <label htmlFor={`${fid}-service-type`} className={inputStyles.fieldLabel}>
              Service Type
            </label>
            <Select
              id={`${fid}-service-type`}
              options={SERVICE_TYPE_OPTIONS}
              value={newServiceType}
              onChange={(v) => setNewServiceType(v)}
              placeholder="Select type…"
            />
          </div>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Metered</label>
            <Toggle
              label="This is a metered service"
              checked={newMetering === 'METERED'}
              onChange={(checked) => setNewMetering(checked ? 'METERED' : 'UNMETERED')}
            />
          </div>
        </div>
      </Modal>

      {/* Link Expense Modal */}
      <Modal
        open={linkingService !== null}
        onClose={() => {
          onLinkingServiceChange(null);
          setSelectedExpenseId('');
        }}
        title={`Link ${linkingService ? formatServiceType(linkingService.serviceType) : ''} to Expense`}
        closeButton="none"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
            <button
              type="button"
              onClick={handleLink}
              disabled={!selectedExpenseId || linkService.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Link
            </button>
            <button
              type="button"
              onClick={() => {
                onLinkingServiceChange(null);
                setSelectedExpenseId('');
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-recurring-expense`} className={inputStyles.fieldLabel}>
            Recurring Expense
          </label>
          <Select
            id={`${fid}-recurring-expense`}
            options={expenseOptions}
            value={selectedExpenseId}
            onChange={(v) => setSelectedExpenseId(v)}
            placeholder="Select an expense…"
            searchable
          />
          <p className={inputStyles.fieldHelper}>
            New readings will automatically update the linked transaction amount.
          </p>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Service"
        message={
          deleteTarget
            ? `Delete "${formatServiceType(deleteTarget.serviceType)}" service? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        confirmColor="red"
        onConfirm={confirmDeleteService}
        onCancel={() => onDeleteTargetChange(null)}
      />
    </div>
  );
}
