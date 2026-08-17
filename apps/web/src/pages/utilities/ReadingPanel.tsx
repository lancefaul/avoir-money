import { useState } from 'react';
import { Plus, Trash2, Link2, Unlink, ParkingMeter } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { buttonStyles, IconButton, Modal, Toggle } from '@budget-tracker/ui';
import type { UseMutationResult } from '@tanstack/react-query';
import EmptyState from '../../components/EmptyState.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { formatDate } from '../../lib/utils.js';
import type { Reading, Service, Expense } from './types.js';
import { toDateString, formatServiceType } from './types.js';
import ReadingFormModal from './ReadingFormModal.js';
import ReadingTable from './ReadingTable.js';
import * as s from '../dashboard/payPeriodCard.css.js';

const ReadingFormSchema = z.object({
  billDate: z.string().min(1, 'Bill date is required'),
  dueDate: z.string().optional(),
});

type FormValues = z.infer<typeof ReadingFormSchema>;

interface Props {
  service: Service | undefined;
  readings: Reading[];
  isLoading: boolean;
  expenses: Expense[];
  createReading: UseMutationResult<unknown, Error, unknown>;
  updateReading: UseMutationResult<unknown, Error, { id: string; body: unknown }>;
  deleteReading: UseMutationResult<unknown, Error, string>;
  onDeleteService: (svc: Service) => void;
  onLinkService: (svc: Service) => void;
  onUnlinkService: (svc: Service) => void;
  updateService: UseMutationResult<unknown, Error, { id: string; body: { metering: string } }>;
}

export default function ReadingPanel({
  service,
  readings,
  isLoading,
  expenses,
  createReading,
  updateReading,
  deleteReading,
  onDeleteService,
  onLinkService,
  onUnlinkService,
  updateService,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Reading | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Reading | null>(null);
  const [feeType, setFeeType] = useState('dollar');
  const [showMeteringModal, setShowMeteringModal] = useState(false);
  const [meteringValue, setMeteringValue] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [costCents, setCostCents] = useState(0);
  const [usageValue, setUsageValue] = useState('');
  const [showConvFee, setShowConvFee] = useState(false);
  const [convFeeValue, setConvFeeValue] = useState(0);
  const [showOtherFees, setShowOtherFees] = useState(false);
  const [otherFeesCents, setOtherFeesCents] = useState(0);

  const isMetered = service?.metering === 'METERED';

  const form = useForm<FormValues>({
    resolver: zodResolver(ReadingFormSchema),
    mode: 'onBlur',
  });
  const { reset, setValue } = form;

  if (!service) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
        <h3
          style={{
            fontSize: vars.font.lg,
            fontWeight: vars.font.semibold,
            color: vars.color.textPrimary,
          }}
        >
          Readings
        </h3>
        <EmptyState message="Select a service to view readings" />
      </div>
    );
  }

  const linkedExpense = service.expenseId ? expenses.find((e) => e.id === service.expenseId) : null;

  function openCreate() {
    setEditing(null);
    reset({});
    setFeeType('dollar');
    setCostCents(0);
    setUsageValue('');
    setShowConvFee(false);
    setConvFeeValue(0);
    setShowOtherFees(false);
    setOtherFeesCents(0);
    setShowForm(true);
  }

  function openEdit(r: Reading) {
    setEditing(r);
    setValue('billDate', toDateString(r.billDate));
    setValue('dueDate', r.dueDate ? toDateString(r.dueDate) : '');
    setCostCents(Math.round(r.cost * 100));
    setUsageValue(r.usage != null ? String(r.usage) : '');
    const hasConvFee = r.convenienceFee != null && r.convenienceFee > 0;
    setShowConvFee(hasConvFee);
    setFeeType(r.convenienceFeeType ?? 'dollar');
    if (hasConvFee) {
      setConvFeeValue(
        r.convenienceFeeType === 'percent'
          ? Math.round((r.convenienceFee ?? 0) * 100)
          : Math.round((r.convenienceFee ?? 0) * 100),
      );
    } else {
      setConvFeeValue(0);
    }
    const hasOtherFees = r.otherFees != null && r.otherFees > 0;
    setShowOtherFees(hasOtherFees);
    setOtherFeesCents(hasOtherFees ? Math.round((r.otherFees ?? 0) * 100) : 0);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    reset();
  }

  function onSubmit(values: FormValues) {
    const cost = costCents / 100;
    const body: Record<string, unknown> = {
      serviceId: service!.id,
      billDate: new Date(values.billDate + 'T00:00:00Z').toISOString(),
      cost,
    };
    if (values.dueDate) {
      body.dueDate = new Date(values.dueDate + 'T00:00:00Z').toISOString();
    }
    const usage = usageValue ? parseInt(usageValue, 10) : undefined;
    if (isMetered && usage) {
      body.usage = usage;
      body.unitCost = cost / usage;
    }
    if (showConvFee && convFeeValue > 0) {
      body.convenienceFee = convFeeValue / 100;
      body.convenienceFeeType = feeType;
    }
    if (showOtherFees && otherFeesCents > 0) {
      body.otherFees = otherFeesCents / 100;
    }

    if (editing) {
      updateReading.mutate({ id: editing.id, body }, { onSuccess: closeForm });
    } else {
      createReading.mutate(body, { onSuccess: closeForm });
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteReading.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
      onError: () => setDeleteTarget(null),
    });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : readings.length === 0 ? (
        <EmptyState
          message="No readings for this service"
          action={
            <button
              type="button"
              onClick={openCreate}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={14} /> Add Reading
            </button>
          }
        />
      ) : (
        <>
          {/* Dashboard-style billing card */}
          <div className={s.card}>
            <div
              className={s.cardHeader}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div className={s.cardTitle}>{formatServiceType(service.serviceType)} Bills</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['1'] }}>
                <IconButton
                  icon={<Plus size={14} />}
                  tooltip="Add reading"
                  size="sm"
                  variant="trueGhost"
                  onClick={openCreate}
                />
                <IconButton
                  icon={<ParkingMeter size={14} />}
                  tooltip="Metering"
                  size="sm"
                  variant="trueGhost"
                  onClick={() => {
                    setMeteringValue(service.metering === 'METERED');
                    setShowMeteringModal(true);
                  }}
                />
                {linkedExpense ? (
                  <IconButton
                    icon={<Unlink size={14} />}
                    tooltip={`Unlink ${linkedExpense.name}`}
                    size="sm"
                    variant="trueGhostDanger"
                    onClick={() => setConfirmUnlink(true)}
                  />
                ) : (
                  <IconButton
                    icon={<Link2 size={14} />}
                    tooltip="Link to expense"
                    size="sm"
                    variant="trueGhost"
                    onClick={() => onLinkService(service)}
                  />
                )}
                <IconButton
                  icon={<Trash2 size={14} />}
                  tooltip="Delete service"
                  size="sm"
                  variant="trueGhostDanger"
                  onClick={() => onDeleteService(service)}
                />
              </div>
            </div>

            <ReadingTable
              readings={readings}
              isMetered={isMetered}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
            />
          </div>
        </>
      )}

      {/* Add/Edit Reading Modal */}
      <ReadingFormModal
        open={showForm}
        onClose={closeForm}
        editing={editing}
        service={service}
        form={form}
        onSubmit={onSubmit}
        isMetered={isMetered}
        costCents={costCents}
        setCostCents={setCostCents}
        usageValue={usageValue}
        setUsageValue={setUsageValue}
        showConvFee={showConvFee}
        setShowConvFee={setShowConvFee}
        feeType={feeType}
        setFeeType={setFeeType}
        convFeeValue={convFeeValue}
        setConvFeeValue={setConvFeeValue}
        showOtherFees={showOtherFees}
        setShowOtherFees={setShowOtherFees}
        otherFeesCents={otherFeesCents}
        setOtherFeesCents={setOtherFeesCents}
      />

      {/* Metering Modal */}
      <Modal
        open={showMeteringModal}
        onClose={() => setShowMeteringModal(false)}
        title="Metering"
        closeButton="none"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: vars.space['2'] }}>
            <button
              type="button"
              onClick={() => {
                if (!service) return;
                const next = meteringValue ? 'METERED' : 'UNMETERED';
                if (next !== service.metering) {
                  updateService.mutate(
                    { id: service.id, body: { metering: next } },
                    {
                      onSuccess: () => setShowMeteringModal(false),
                    },
                  );
                } else {
                  setShowMeteringModal(false);
                }
              }}
              disabled={updateService.isPending}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowMeteringModal(false)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              Cancel
            </button>
          </div>
        }
      >
        <Toggle
          label="This is a metered service"
          checked={meteringValue}
          onChange={setMeteringValue}
        />
      </Modal>

      {/* Unlink Confirmation */}
      <ConfirmDialog
        open={confirmUnlink}
        title="Unlink Expense"
        message={
          linkedExpense
            ? `Unlink "${linkedExpense.name}" from ${formatServiceType(service.serviceType)}? New readings will no longer update the expense amount.`
            : ''
        }
        confirmLabel="Unlink"
        confirmColor="red"
        onConfirm={() => {
          onUnlinkService(service);
          setConfirmUnlink(false);
        }}
        onCancel={() => setConfirmUnlink(false)}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Reading"
        message={
          deleteTarget
            ? `Delete reading from ${formatDate(deleteTarget.billDate)}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        confirmColor="red"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
