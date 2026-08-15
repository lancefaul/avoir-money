import { useState } from 'react';
import { Pencil, IdCard, ExternalLink, MoreVertical, ShieldOff, Lock } from 'lucide-react';
import type { InsurancePolicyWithBalance } from '@budget-tracker/core';
import TransactionList from './TransactionList.js';
import CostSummaryCard from './CostSummaryCard.js';
import CoverageProgressCard from './CoverageProgressCard.js';
import SecondaryInsuranceModal from './SecondaryInsuranceModal.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import { formatCurrency } from '../../lib/utils.js';
import {
  badgeStyles,
  DisplayHeading,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Modal,
  vars,
} from '@budget-tracker/ui';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * Below this width the summary section's two columns (limit cards left, cost
 * summary right) stack into one. Matches the width where the subnav tabs
 * collapse to horizontal.
 */
const STACK_SUMMARY_BREAKPOINT = below.lg;

export function getInsurerName(policy: InsurancePolicyWithBalance): string {
  const meta = policy.metadata as Record<string, unknown> | undefined;
  return (meta?.insurer as string) || policy.employer;
}

export default function ActivePolicySection({
  policy,
  onEdit,
  onToggleOverride,
  onEndCoverage,
  onClose,
  summary,
}: {
  policy: InsurancePolicyWithBalance;
  onEdit: () => void;
  onToggleOverride: (
    p: InsurancePolicyWithBalance,
    field: 'deductibleOverride' | 'oopmOverride',
    date?: string,
  ) => void;
  onEndCoverage: () => void;
  onClose: () => void;
  summary?: { healthcareBudgetSpent: number; medicineBudgetSpent: number };
}) {
  const { balance } = policy;
  const meta = policy.metadata as Record<string, unknown> | undefined;
  const metaStr = (key: string): string | undefined => {
    const v = meta?.[key];
    return typeof v === 'string' ? v : undefined;
  };

  // Secondary insurance modal state
  const [pendingOverride, setPendingOverride] = useState<
    'deductibleOverride' | 'oopmOverride' | null
  >(null);

  // Virtual insurance card modal
  const [showCard, setShowCard] = useState(false);

  // End coverage / close confirmation
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  function handleOverrideClick(field: 'deductibleOverride' | 'oopmOverride') {
    const turningOn = !policy[field];
    if (turningOn) {
      setPendingOverride(field);
    } else {
      onToggleOverride(policy, field);
    }
  }

  function handleModalConfirm(date: string) {
    if (pendingOverride) {
      onToggleOverride(policy, pendingOverride, date);
    }
    setPendingOverride(null);
  }

  const isClosed = policy.status === 'CLOSED';
  const stack = useIsNarrow(STACK_SUMMARY_BREAKPOINT);
  const hasLimits = balance.deductibleLimit != null || balance.oopmLimit != null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
        <DisplayHeading
          size="lg"
          as="h2"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: vars.space['3'],
          }}
        >
          {getInsurerName(policy)}
          {policy.status !== 'ACTIVE' && (
            <span
              className={`${badgeStyles.badge} ${policy.status === 'ENDED' ? badgeStyles.badgeWarning : badgeStyles.badgeNeutral}`}
            >
              {policy.status === 'ENDED' ? 'Coverage Ended' : 'Closed'}
            </span>
          )}
        </DisplayHeading>
        <IconButton
          icon={<IdCard size={14} />}
          tooltip="View virtual insurance card"
          size="sm"
          variant="trueGhost"
          onClick={() => setShowCard(true)}
        />
        {metaStr('managementUrl') && (
          <IconButton
            icon={<ExternalLink size={14} />}
            tooltip="Manage policy"
            size="sm"
            variant="trueGhost"
            onClick={() => window.open(metaStr('managementUrl')!, '_blank', 'noopener,noreferrer')}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={<MoreVertical size={14} />}
              tooltip="Policy actions"
              size="sm"
              variant="trueGhost"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!isClosed && (
              <DropdownMenuItem icon={<Pencil size={14} />} onSelect={onEdit}>
                Edit Policy
              </DropdownMenuItem>
            )}
            {policy.status === 'ACTIVE' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<ShieldOff size={14} />}
                  variant="danger"
                  onSelect={() => setShowEndConfirm(true)}
                >
                  End Coverage
                </DropdownMenuItem>
              </>
            )}
            {policy.status === 'ENDED' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={<Lock size={14} />}
                  variant="danger"
                  onSelect={() => setShowCloseConfirm(true)}
                >
                  Close Policy
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Summary section — deductible and coinsurance coverage cards side by side;
          cost summary fallback for policies without limits */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: stack || !hasLimits ? '1fr' : '1fr 1fr',
          gap: vars.space['4'],
          alignItems: 'start',
        }}
      >
        {balance.deductibleLimit != null && (
          <CoverageProgressCard
            balance={balance}
            kind="deductible"
            onMarkPaidBySecondary={
              isClosed ? undefined : () => handleOverrideClick('deductibleOverride')
            }
          />
        )}
        {balance.oopmLimit != null && (
          <CoverageProgressCard
            balance={balance}
            kind="coinsurance"
            onMarkPaidBySecondary={isClosed ? undefined : () => handleOverrideClick('oopmOverride')}
          />
        )}
        {!hasLimits && (
          <CostSummaryCard
            costsPaid={balance.deductibleSpent ?? 0}
            costsCovered={0}
            totalPaid={
              policy.premium +
              (balance.deductibleSpent ?? 0) +
              (summary?.healthcareBudgetSpent ?? 0) +
              (summary?.medicineBudgetSpent ?? 0)
            }
          />
        )}
      </div>

      {/* Virtual Insurance Card Modal */}
      <Modal
        open={showCard}
        onClose={() => setShowCard(false)}
        title="Insurance Card"
        closeButton="x"
      >
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            columnGap: vars.space['4'],
            rowGap: vars.space['2'],
            fontSize: vars.font.base,
            fontWeight: vars.font.medium,
          }}
        >
          <dt style={{ color: vars.color.textTertiary }}>Employer</dt>
          <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{policy.employer}</dd>
          {metaStr('insurer') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Insurer</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('insurer')}</dd>
            </>
          )}
          {metaStr('groupName') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Group Name</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('groupName')}</dd>
            </>
          )}
          {metaStr('policyId') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Policy ID</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('policyId')}</dd>
            </>
          )}
          {metaStr('groupNumber') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Group #</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('groupNumber')}</dd>
            </>
          )}
          {metaStr('healthPlan') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Health Plan</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('healthPlan')}</dd>
            </>
          )}
          {metaStr('effectiveDate') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Effective Date</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>
                {metaStr('effectiveDate')}
              </dd>
            </>
          )}
          {metaStr('rxBin') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Rx BIN</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('rxBin')}</dd>
            </>
          )}
          {metaStr('rxPcn') && (
            <>
              <dt style={{ color: vars.color.textTertiary }}>Rx PCN</dt>
              <dd style={{ color: vars.color.textPrimary, margin: 0 }}>{metaStr('rxPcn')}</dd>
            </>
          )}
          <dt style={{ color: vars.color.textTertiary }}>Premiums</dt>
          <dd style={{ color: vars.color.textPrimary, margin: 0 }}>
            {formatCurrency(policy.premium)}
          </dd>
        </dl>
      </Modal>

      {/* Transaction History */}
      <hr
        style={{
          border: 'none',
          borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
          margin: 0,
          marginTop: vars.space['4'],
        }}
      />
      <DisplayHeading size="md" as="h3" style={{ marginTop: vars.space['1'] }}>
        Transaction History
      </DisplayHeading>
      <TransactionList policyId={policy.id} />

      {/* Secondary Insurance Date Modal */}
      <SecondaryInsuranceModal
        open={pendingOverride !== null}
        onClose={() => setPendingOverride(null)}
        onConfirm={handleModalConfirm}
        label={pendingOverride === 'deductibleOverride' ? 'Deductible' : 'Out-of-Pocket Max'}
      />

      {/* End Coverage Confirmation */}
      <ConfirmDialog
        open={showEndConfirm}
        title="End Coverage?"
        message="This marks the policy as no longer providing active coverage. The budget category will remain selectable for any outstanding claims."
        confirmLabel="End Coverage"
        cancelLabel="Cancel"
        confirmColor="blue"
        onConfirm={() => {
          setShowEndConfirm(false);
          onEndCoverage();
        }}
        onCancel={() => setShowEndConfirm(false)}
      />

      {/* Close Policy Confirmation */}
      <ConfirmDialog
        open={showCloseConfirm}
        title="Close Policy?"
        message="Closing this policy will make its budget category no longer selectable for new transactions. This cannot be undone."
        confirmLabel="Close Policy"
        cancelLabel="Cancel"
        confirmColor="red"
        onConfirm={() => {
          setShowCloseConfirm(false);
          onClose();
        }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </div>
  );
}
