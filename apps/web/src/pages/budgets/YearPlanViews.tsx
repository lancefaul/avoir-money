import { Sparkles, Copy, Check, Archive } from 'lucide-react';
import { Badge, buttonStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { YearPlanResponse } from '@budget-tracker/core';

interface NoPlanViewProps {
  currentYear: number;
  hasPreviousPlan: boolean;
  previousYear: number;
  onStartFresh: () => void;
  onCarryForward: () => void;
  isMutating: boolean;
}

export function NoPlanView({
  currentYear,
  hasPreviousPlan,
  previousYear,
  onStartFresh,
  onCarryForward,
  isMutating,
}: NoPlanViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      <p
        style={{
          fontSize: vars.font.base,
          color: vars.color.textPrimary,
          margin: 0,
        }}
      >
        Choose how to set up your {currentYear} budget plan.
      </p>

      {/* Option cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: hasPreviousPlan ? '1fr 1fr' : '1fr',
          gap: vars.space['3'],
        }}
      >
        {/* Start Fresh card */}
        <button
          type="button"
          onClick={onStartFresh}
          disabled={isMutating}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: vars.space['3'],
            padding: `${vars.space['6']} ${vars.space['4']}`,
            borderRadius: vars.radius.lg,
            border: `${vars.border.thin} solid ${vars.color.border}`,
            background: vars.color.neutral0,
            cursor: isMutating ? 'not-allowed' : 'pointer',
            opacity: isMutating ? 0.5 : 1,
            textAlign: 'center',
            transition: `border-color ${vars.duration.fast} ${vars.easing.default}, background ${vars.duration.fast} ${vars.easing.default}`,
          }}
          onMouseEnter={(e) => {
            if (!isMutating) {
              e.currentTarget.style.borderColor = vars.color.brand400;
              e.currentTarget.style.background = vars.color.brand50;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = vars.color.border;
            e.currentTarget.style.background = vars.color.neutral0;
          }}
        >
          <div
            style={{
              width: '2.5rem',
              height: '2.5rem',
              borderRadius: vars.radius.md,
              background: vars.color.brand50,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: vars.color.brand600,
            }}
          >
            <Sparkles size={20} />
          </div>
          <div>
            <p
              style={{
                fontSize: vars.font.base,
                fontWeight: vars.font.semibold,
                color: vars.color.textPrimary,
                margin: 0,
              }}
            >
              Start Fresh
            </p>
            <p
              style={{
                fontSize: vars.font.sm,
                color: vars.color.textTertiary,
                margin: 0,
                marginTop: vars.space['1'],
              }}
            >
              Empty plan — build your budgets from scratch
            </p>
          </div>
        </button>

        {/* Carry Forward card */}
        {hasPreviousPlan && (
          <button
            type="button"
            onClick={onCarryForward}
            disabled={isMutating}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: vars.space['3'],
              padding: `${vars.space['6']} ${vars.space['4']}`,
              borderRadius: vars.radius.lg,
              border: `${vars.border.thin} solid ${vars.color.border}`,
              background: vars.color.neutral0,
              cursor: isMutating ? 'not-allowed' : 'pointer',
              opacity: isMutating ? 0.5 : 1,
              textAlign: 'center',
              transition: `border-color ${vars.duration.fast} ${vars.easing.default}, background ${vars.duration.fast} ${vars.easing.default}`,
            }}
            onMouseEnter={(e) => {
              if (!isMutating) {
                e.currentTarget.style.borderColor = vars.color.brand400;
                e.currentTarget.style.background = vars.color.brand50;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = vars.color.border;
              e.currentTarget.style.background = vars.color.neutral0;
            }}
          >
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: vars.radius.md,
                background: vars.color.neutral100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: vars.color.textSecondary,
              }}
            >
              <Copy size={20} />
            </div>
            <div>
              <p
                style={{
                  fontSize: vars.font.base,
                  fontWeight: vars.font.semibold,
                  color: vars.color.textPrimary,
                  margin: 0,
                }}
              >
                Carry Forward
              </p>
              <p
                style={{
                  fontSize: vars.font.sm,
                  color: vars.color.textTertiary,
                  margin: 0,
                  marginTop: vars.space['1'],
                }}
              >
                Copy budgets from {previousYear} as a starting point
              </p>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Draft Plan View ───

interface DraftPlanViewProps {
  plan: YearPlanResponse;
  canConfirm: boolean;
  isMutating: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

export function DraftPlanView({
  plan,
  canConfirm,
  isMutating,
  isPending,
  onConfirm,
}: DraftPlanViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      {/* Status header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['3'],
          padding: `${vars.space['3']} ${vars.space['4']}`,
          borderRadius: vars.radius.md,
          background: vars.color.warning50,
          border: `${vars.border.thin} solid ${vars.color.warning200}`,
        }}
      >
        <Sparkles size={18} style={{ color: vars.color.warning400, flexShrink: 0 }} />
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textPrimary,
            margin: 0,
            flex: 1,
          }}
        >
          Your plan is in draft. Confirm it to start tracking budgets.
        </p>
        <Badge variant="warning" size="sm">
          Draft
        </Badge>
      </div>

      {/* Meta info */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: vars.space['4'],
        }}
      >
        <div>
          <p
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              margin: 0,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
            }}
          >
            Created
          </p>
          <p
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textPrimary,
              margin: 0,
              marginTop: vars.space['1'],
            }}
          >
            {new Date(plan.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              margin: 0,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
            }}
          >
            Last Updated
          </p>
          <p
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textPrimary,
              margin: 0,
              marginTop: vars.space['1'],
            }}
          >
            {new Date(plan.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Confirm action */}
      <div
        style={{
          borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
          paddingTop: vars.space['4'],
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['3'],
        }}
      >
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm || isMutating}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          style={{ opacity: !canConfirm || isMutating ? 0.5 : 1 }}
        >
          <Check size={15} />
          {isPending ? 'Confirming…' : 'Confirm Plan'}
        </button>
        {!canConfirm && (
          <p
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              margin: 0,
            }}
          >
            Available Jan 1, {plan.year}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Active / Archived Plan View ───

interface PlanStatusViewProps {
  plan: YearPlanResponse;
  status: 'ACTIVE' | 'ARCHIVED';
}

const STATUS_CONFIG = {
  ACTIVE: {
    icon: <Check size={18} />,
    iconColor: vars.color.success700,
    bgColor: vars.color.success50,
    borderColor: vars.color.success200,
    badgeVariant: 'positive' as const,
    label: 'Active',
    message: 'Your budget plan is active and tracking spending.',
  },
  ARCHIVED: {
    icon: <Archive size={18} />,
    iconColor: vars.color.textTertiary,
    bgColor: vars.color.neutral100,
    borderColor: vars.color.border,
    badgeVariant: 'neutral' as const,
    label: 'Archived',
    message: 'This plan has been archived.',
  },
};

export function PlanStatusView({ plan, status }: PlanStatusViewProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
      {/* Status banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: vars.space['3'],
          padding: `${vars.space['3']} ${vars.space['4']}`,
          borderRadius: vars.radius.md,
          background: config.bgColor,
          border: `${vars.border.thin} solid ${config.borderColor}`,
        }}
      >
        <span style={{ color: config.iconColor, flexShrink: 0 }}>{config.icon}</span>
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textPrimary,
            margin: 0,
            flex: 1,
          }}
        >
          {config.message}
        </p>
        <Badge variant={config.badgeVariant} size="sm">
          {config.label}
        </Badge>
      </div>

      {/* Meta info */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: vars.space['4'],
        }}
      >
        <div>
          <p
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              margin: 0,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
            }}
          >
            Created
          </p>
          <p
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textPrimary,
              margin: 0,
              marginTop: vars.space['1'],
            }}
          >
            {new Date(plan.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p
            style={{
              fontSize: vars.font.xs,
              color: vars.color.textTertiary,
              margin: 0,
              fontFamily: vars.font.label,
              textTransform: 'uppercase',
              letterSpacing: vars.font.trackingLabel,
            }}
          >
            Last Updated
          </p>
          <p
            style={{
              fontSize: vars.font.base,
              fontWeight: vars.font.medium,
              color: vars.color.textPrimary,
              margin: 0,
              marginTop: vars.space['1'],
            }}
          >
            {new Date(plan.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
