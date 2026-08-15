import { AlertTriangle } from 'lucide-react';
import { buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { shouldShowEscrowReminder } from '@budget-tracker/core';
import { useEscrowHistory, type EscrowRecord } from '../../hooks/useApi.js';
import { formatDate } from '../../lib/utils.js';

interface EscrowReminderBannerProps {
  debtName: string;
  debtId: string;
  onUpdate?: () => void;
}

export default function EscrowReminderBanner({
  debtName,
  debtId,
  onUpdate,
}: EscrowReminderBannerProps) {
  const { data } = useEscrowHistory(debtId);
  const records = (data ?? []) as EscrowRecord[];

  if (records.length === 0) return null;

  const showReminder = shouldShowEscrowReminder(records, new Date());
  if (!showReminder) return null;

  // Most recent record by periodStartDate descending (API returns DESC order)
  const mostRecent = records[0]!;

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['3'],
        borderRadius: vars.radius.lg,
        border: `${vars.border.thin} solid ${vars.color.warning200}`,
        background: vars.color.warning50,
        padding: `${vars.space['3']} ${vars.space['4']}`,
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0, color: vars.color.warning400 }} />
      <p
        style={{
          flex: 1,
          fontSize: vars.font.base,
          color: vars.color.textPrimary,
          margin: 0,
        }}
      >
        <span style={{ fontWeight: vars.font.medium }}>{debtName}</span> escrow period ended{' '}
        {formatDate(mostRecent.periodEndDate)}. Review and update your escrow payment.
      </p>
      {onUpdate && (
        <button
          type="button"
          onClick={onUpdate}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
          style={{ flexShrink: 0 }}
        >
          Update Escrow
        </button>
      )}
    </div>
  );
}
