import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal, spinnerStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { modalBodyFlush } from '../../components/settings-modal.css.js';
import {
  useYearPlans,
  useCreatePlan,
  useConfirmPlan,
  useCarryForward,
} from '../../hooks/useBudgets.js';
import { NoPlanView, DraftPlanView, PlanStatusView } from './YearPlanViews.js';

interface YearPlanModalProps {
  open: boolean;
  onClose: () => void;
}

export default function YearPlanModal({ open, onClose }: YearPlanModalProps) {
  const currentYear = new Date().getFullYear();
  const { data: plans, isLoading, isError } = useYearPlans();

  const createPlan = useCreatePlan();
  const confirmPlan = useConfirmPlan();
  const carryForward = useCarryForward();

  const currentPlan = useMemo(
    () => plans?.find((p) => p.year === currentYear),
    [plans, currentYear],
  );

  const previousPlan = useMemo(
    () => plans?.find((p) => p.year === currentYear - 1),
    [plans, currentYear],
  );

  const canConfirm = useMemo(() => {
    if (!currentPlan || currentPlan.status !== 'DRAFT') return false;
    const jan1 = new Date(currentPlan.year, 0, 1);
    return new Date() >= jan1;
  }, [currentPlan]);

  const handleStartFresh = () => {
    createPlan.mutate({ year: currentYear }, { onSuccess: () => onClose() });
  };

  const handleCarryForward = () => {
    createPlan.mutate(
      { year: currentYear },
      {
        onSuccess: (newPlan) => {
          if (previousPlan) {
            carryForward.mutate(
              { id: newPlan.id, body: { sourceYear: currentYear - 1 } },
              { onSuccess: () => onClose() },
            );
          } else {
            onClose();
          }
        },
      },
    );
  };

  const handleConfirm = () => {
    if (currentPlan) confirmPlan.mutate(currentPlan.id);
  };

  const isMutating = createPlan.isPending || confirmPlan.isPending || carryForward.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${currentYear} Year Plan`}
      closeButton="x"
      bodyClassName={modalBodyFlush}
    >
      {isLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: `${vars.space['12']} 0`,
          }}
        >
          <Loader2
            size={20}
            className={spinnerStyles.spinIcon}
            style={{ color: vars.color.textTertiary }}
          />
        </div>
      )}

      {isError && (
        <p
          style={{
            textAlign: 'center',
            fontSize: vars.font.sm,
            color: vars.color.danger400,
            padding: `${vars.space['8']} 0`,
          }}
        >
          Failed to load year plans. Please try again.
        </p>
      )}

      {!isLoading && !isError && !currentPlan && (
        <NoPlanView
          currentYear={currentYear}
          hasPreviousPlan={!!previousPlan}
          previousYear={currentYear - 1}
          onStartFresh={handleStartFresh}
          onCarryForward={handleCarryForward}
          isMutating={isMutating}
        />
      )}

      {!isLoading && !isError && currentPlan?.status === 'DRAFT' && (
        <DraftPlanView
          plan={currentPlan}
          canConfirm={canConfirm}
          isMutating={isMutating}
          isPending={confirmPlan.isPending}
          onConfirm={handleConfirm}
        />
      )}

      {!isLoading && !isError && currentPlan?.status === 'ACTIVE' && (
        <PlanStatusView plan={currentPlan} status="ACTIVE" />
      )}

      {!isLoading && !isError && currentPlan?.status === 'ARCHIVED' && (
        <PlanStatusView plan={currentPlan} status="ARCHIVED" />
      )}
    </Modal>
  );
}
