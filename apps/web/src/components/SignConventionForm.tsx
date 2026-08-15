import { useState, useEffect } from 'react';
import {
  SignConventionConfigSchema,
  DEFAULT_SIGN_CONVENTION_CONFIG,
  type SignConventionConfig,
} from '@budget-tracker/core';
import { ButtonGroup, buttonStyles, inputStyles } from '@budget-tracker/ui';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { api } from '../lib/api.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

// ─── Option metadata per transaction type ────────────────────────────────────

const SIGN_OPTIONS = [
  { value: 'positive', label: 'Positive (+)' },
  { value: 'negative', label: 'Negative (−)' },
];

const SIGN_OPTIONS_NEG_FIRST = [
  { value: 'negative', label: 'Negative (−)' },
  { value: 'positive', label: 'Positive (+)' },
];

// ─── Validation error type ───────────────────────────────────────────────────

interface FieldError {
  field: string;
  message: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

/** Below this width the two-column question grids stack into one column. */
const STACK_FIELDS_BREAKPOINT = below.md;

interface SignConventionFormProps {
  hideSave?: boolean;
  onConfigChange?: (config: SignConventionConfig) => void;
}

export default function SignConventionForm({
  hideSave,
  onConfigChange,
}: SignConventionFormProps = {}) {
  const stackFields = useIsNarrow(STACK_FIELDS_BREAKPOINT);
  const [config, setConfig] = useState<SignConventionConfig>(DEFAULT_SIGN_CONVENTION_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [, setErrors] = useState<FieldError[]>([]);
  const [successMsg, setSuccessMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.signConventions
      .get()
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          onConfigChange?.(data);
        }
      })
      .catch((err) => {
        console.warn('[SignConventionForm] Failed to load config, using defaults', err);
        // Surface it: the user is editing defaults, not their saved config, and
        // must know before saving over whatever is actually on disk.
        if (!cancelled) {
          setLoadError(
            'Could not load your saved sign conventions — showing defaults. Saving will overwrite the stored configuration.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 4000);
    return () => clearTimeout(t);
  }, [successMsg]);

  async function handleSave() {
    setErrors([]);
    setSaveError('');
    setSuccessMsg('');

    const result = SignConventionConfigSchema.safeParse(config);
    if (!result.success) {
      setErrors(result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
      return;
    }

    setSaving(true);
    try {
      const saved = await api.signConventions.save(result.data);
      setConfig(saved);
      setSuccessMsg('Sign conventions saved successfully.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  }

  // Note: the onConfigChange callback is dispatched OUTSIDE the setState updater.
  // Calling it inside a functional updater would double-fire it under React
  // Strict Mode (updaters are intentionally invoked twice to surface impurity).
  function updateExpense(field: 'positiveMeaning' | 'negativeMeaning', value: string) {
    const next = { ...config, expense: { ...config.expense, [field]: value } };
    setConfig(next);
    onConfigChange?.(next);
  }
  function updateTransfer(value: string) {
    const next = { ...config, transfer: { positiveMeaning: value as 'withdrawal' | 'deposit' } };
    setConfig(next);
    onConfigChange?.(next);
  }
  function updateTrade(value: string) {
    const next = { ...config, trade: { positiveMeaning: value as 'buy' | 'sell' } };
    setConfig(next);
    onConfigChange?.(next);
  }

  if (loading) {
    return (
      <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>
        Loading sign conventions…
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['6'] }}>
      {successMsg && (
        <div
          style={{
            borderRadius: vars.radius.lg,
            border: `${vars.border.thin} solid ${vars.color.success200}`,
            background: vars.color.success50,
            padding: `${vars.space['3']} ${vars.space['4']}`,
            fontSize: vars.font.sm,
            color: vars.color.success700,
          }}
        >
          {successMsg}
        </div>
      )}
      {loadError && (
        <div
          role="alert"
          style={{
            borderRadius: vars.radius.lg,
            border: `${vars.border.thin} solid ${vars.color.warning300}`,
            background: vars.color.warning50,
            padding: `${vars.space['3']} ${vars.space['4']}`,
            fontSize: vars.font.sm,
            color: vars.color.warning700,
          }}
        >
          {loadError}
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          style={{
            borderRadius: vars.radius.lg,
            border: `${vars.border.thin} solid ${vars.color.danger300}`,
            background: vars.color.danger50,
            padding: `${vars.space['3']} ${vars.space['4']}`,
            fontSize: vars.font.sm,
            color: vars.color.danger400,
          }}
        >
          {saveError}
        </div>
      )}

      <Section title="Expense transactions" card={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
            gap: vars.space['4'],
          }}
        >
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Spending</label>
            <ButtonGroup
              options={SIGN_OPTIONS}
              value={config.expense.positiveMeaning === 'money_out' ? 'positive' : 'negative'}
              onChange={(v) => {
                if (v === 'positive') {
                  updateExpense('positiveMeaning', 'money_out');
                  updateExpense('negativeMeaning', 'refund');
                } else {
                  updateExpense('positiveMeaning', 'money_in');
                  updateExpense('negativeMeaning', 'spending');
                }
              }}
            />
          </div>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Refunds</label>
            <ButtonGroup
              options={SIGN_OPTIONS_NEG_FIRST}
              value={config.expense.positiveMeaning === 'money_out' ? 'negative' : 'positive'}
              onChange={(v) => {
                if (v === 'negative') {
                  updateExpense('positiveMeaning', 'money_out');
                  updateExpense('negativeMeaning', 'refund');
                } else {
                  updateExpense('positiveMeaning', 'money_in');
                  updateExpense('negativeMeaning', 'spending');
                }
              }}
            />
          </div>
        </div>
      </Section>

      <Section title="Transfer transactions" card={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
            gap: vars.space['4'],
          }}
        >
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Withdrawals</label>
            <ButtonGroup
              options={SIGN_OPTIONS}
              value={config.transfer.positiveMeaning === 'withdrawal' ? 'positive' : 'negative'}
              onChange={(v) => updateTransfer(v === 'positive' ? 'withdrawal' : 'deposit')}
            />
          </div>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Deposits</label>
            <ButtonGroup
              options={SIGN_OPTIONS_NEG_FIRST}
              value={config.transfer.positiveMeaning === 'withdrawal' ? 'negative' : 'positive'}
              onChange={(v) => updateTransfer(v === 'negative' ? 'withdrawal' : 'deposit')}
            />
          </div>
        </div>
      </Section>

      <Section title="Trade transactions" card={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
            gap: vars.space['4'],
          }}
        >
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Buys</label>
            <ButtonGroup
              options={SIGN_OPTIONS}
              value={config.trade.positiveMeaning === 'buy' ? 'positive' : 'negative'}
              onChange={(v) => updateTrade(v === 'positive' ? 'buy' : 'sell')}
            />
          </div>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Sells</label>
            <ButtonGroup
              options={SIGN_OPTIONS_NEG_FIRST}
              value={config.trade.positiveMeaning === 'buy' ? 'negative' : 'positive'}
              onChange={(v) => updateTrade(v === 'negative' ? 'buy' : 'sell')}
            />
          </div>
        </div>
      </Section>

      <Section title="Income transactions" card={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
            gap: vars.space['4'],
          }}
        >
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Income</label>
            <ButtonGroup options={SIGN_OPTIONS} value="positive" onChange={() => {}} disabled />
          </div>
        </div>
      </Section>

      <Section title="Refund transactions" card={false}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackFields ? '1fr' : '1fr 1fr',
            gap: vars.space['4'],
          }}
        >
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Refunds</label>
            <ButtonGroup options={SIGN_OPTIONS} value="positive" onChange={() => {}} disabled />
          </div>
        </div>
      </Section>

      {!hideSave && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          style={{ alignSelf: 'flex-start', opacity: saving ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : 'Save conventions'}
        </button>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({
  title,
  children,
  card = true,
}: {
  title: string;
  children: React.ReactNode;
  card?: boolean;
}) {
  const content = (
    <>
      <h3
        style={{
          fontSize: vars.font.sm,
          fontWeight: vars.font.semibold,
          fontFamily: vars.font.label,
          textTransform: 'uppercase',
          letterSpacing: vars.font.trackingLabel,
          color: vars.color.textSecondary,
          margin: 0,
          marginBottom: vars.space['3'],
        }}
      >
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
        {children}
      </div>
    </>
  );

  if (!card)
    return (
      <div
        style={{
          borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
          paddingTop: vars.space['5'],
        }}
      >
        {content}
      </div>
    );

  return (
    <div
      style={{
        borderRadius: vars.radius.xl,
        border: `${vars.border.thin} solid ${vars.color.border}`,
        background: vars.color.neutral0,
        padding: vars.space['5'],
        boxShadow: vars.shadow.sm,
      }}
    >
      {content}
    </div>
  );
}
