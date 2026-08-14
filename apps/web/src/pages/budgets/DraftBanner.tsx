import { useState, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { useConfirmPlan } from '../../hooks/useBudgets.js';

/** Info banner for a DRAFT year plan, with the confirm-plan flow. */
export default function DraftBanner({ year, planId }: { year: number; planId: string }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const confirmPlan = useConfirmPlan();

  const canConfirm = useMemo(() => {
    const jan1 = new Date(year, 0, 1);
    return new Date() >= jan1;
  }, [year]);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['3'],
          padding: `${vars.space['3']} ${vars.space['4']}`,
          borderRadius: vars.radius.lg,
          background: vars.color.info50,
          border: `${vars.border.thin} solid ${vars.color.info200}`,
        }}
      >
        <Sparkles size={18} style={{ color: vars.color.info400, flexShrink: 0 }} />
        <p
          style={{
            flex: 1,
            fontSize: vars.font.base,
            color: vars.color.textPrimary,
            margin: 0,
          }}
        >
          Your {year} plan is in draft — confirm it when you&apos;re ready
        </p>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          disabled={!canConfirm || confirmPlan.isPending}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
          style={{ flexShrink: 0, opacity: !canConfirm || confirmPlan.isPending ? 0.5 : 1 }}
        >
          {confirmPlan.isPending ? 'Confirming…' : 'Confirm Plan'}
        </button>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm Year Plan"
        message={`Are you sure you want to confirm your ${year} budget plan? Once confirmed, it will become active and start tracking your spending.`}
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        confirmColor="green"
        onConfirm={() => {
          confirmPlan.mutate(planId, { onSuccess: () => setShowConfirm(false) });
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </>
  );
}
