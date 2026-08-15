import { useState, useCallback } from 'react';
import {
  Toast,
  ToastContainer,
  type ToastData,
  type ToastPosition,
  type ToastSeverity,
  type ToastVariant,
  ButtonGroup,
  buttonStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';

let nextId = 1;

const severities: ToastSeverity[] = ['success', 'error', 'warning', 'info'];

const sampleToasts: Record<ToastSeverity, { title: string; description: string }> = {
  success: { title: 'Changes saved', description: 'Your changes have been saved successfully.' },
  error: {
    title: 'Upload failed',
    description: 'The file exceeded the 10MB size limit. Please try a smaller file.',
  },
  warning: {
    title: 'Unsaved changes',
    description: 'You have unsaved changes that will be lost if you navigate away.',
  },
  info: {
    title: 'New version available',
    description: 'A new version of the app is available. Refresh to update.',
  },
};

export default function ToastPage() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [position, setPosition] = useState<ToastPosition>('bottom-right');
  const [variant, setVariant] = useState<ToastVariant>('default');

  const addToast = useCallback(
    (severity: ToastSeverity, opts?: Partial<ToastData>) => {
      const sample = sampleToasts[severity];
      const id = `toast-${nextId++}`;
      setToasts((prev) => [
        ...prev,
        {
          id,
          severity,
          title: sample.title,
          description: sample.description,
          variant,
          ...opts,
        },
      ]);
    },
    [variant],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => setToasts([]), []);

  const baseMd = `${buttonStyles.btnBase} ${buttonStyles.btnMd}`;

  return (
    <>
      {/* ── Position selector ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Position</div>
        <ButtonGroup
          size="md"
          options={[
            { value: 'bottom-right', label: 'Bottom Right' },
            { value: 'bottom-left', label: 'Bottom Left' },
            { value: 'bottom-center', label: 'Bottom Center' },
            { value: 'top-right', label: 'Top Right' },
            { value: 'top-left', label: 'Top Left' },
            { value: 'top-center', label: 'Top Center' },
          ]}
          value={position}
          onChange={(v) => setPosition(v as ToastPosition)}
          ariaLabel="Toast position"
        />
      </div>

      {/* ── Variant selector ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Variant</div>
        <ButtonGroup
          size="md"
          options={[
            { value: 'default', label: 'Default' },
            { value: 'filled', label: 'Filled' },
            { value: 'notification', label: 'Notification' },
          ]}
          value={variant}
          onChange={(v) => setVariant(v as ToastVariant)}
          ariaLabel="Toast variant"
        />
      </div>

      {/* ── Trigger buttons ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Add toasts</div>
        <div className={s.row}>
          {severities.map((sev) => (
            <button
              key={sev}
              type="button"
              className={`${baseMd} ${buttonStyles.btnSecondary}`}
              onClick={() => addToast(sev)}
            >
              {sev.charAt(0).toUpperCase() + sev.slice(1)}
            </button>
          ))}
          <button
            type="button"
            className={`${baseMd} ${buttonStyles.btnSecondary}`}
            onClick={() =>
              addToast('success', {
                title: 'Transaction deleted',
                description: 'The transaction has been removed.',
                onUndo: () => removeToast(`toast-${nextId - 1}`),
              })
            }
          >
            With Undo
          </button>
          <button
            type="button"
            className={`${baseMd} ${buttonStyles.btnSecondary}`}
            onClick={() =>
              addToast('info', {
                title: 'System update',
                description:
                  'A new version is being deployed. You may experience brief interruptions.',
                variant: 'notification',
              })
            }
          >
            Notification
          </button>
          <button
            type="button"
            className={`${baseMd} ${buttonStyles.btnTrueGhostDanger}`}
            onClick={clearAll}
          >
            Clear all
          </button>
        </div>
      </div>

      {/* ── Static examples: Default ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Default variant</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['4'],
            maxWidth: '22rem',
          }}
        >
          {severities.map((sev) => (
            <Toast
              key={`default-${sev}`}
              id={`default-${sev}`}
              severity={sev}
              title={sampleToasts[sev].title}
              description={sampleToasts[sev].description}
              onDismiss={() => {}}
              isFront={false}
              autoDismiss={false}
            />
          ))}
        </div>
      </div>

      {/* ── Static examples: Inline (flat + fullWidth) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Inline — flat + fullWidth</div>
        <p className={s.ann}>
          A toast rendered <em>in</em> the page rather than floating over it. <code>flat</code>{' '}
          drops the shadow, because shadow is elevation and an inline notice has none;{' '}
          <code>fullWidth</code> replaces the fixed 22rem stack width, which only exists to align a
          corner stack. Pair them with{' '}
          <code>
            customActions={'{'}&lt;&gt;&lt;/&gt;{'}'}
          </code>{' '}
          when the condition — not the reader — should decide when the message goes away.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['4'] }}>
          {severities.map((sev) => (
            <Toast
              key={`inline-${sev}`}
              id={`inline-${sev}`}
              severity={sev}
              variant="filled"
              flat
              fullWidth
              title={sampleToasts[sev].title}
              onDismiss={() => {}}
              isFront={false}
              autoDismiss={false}
              customActions={<></>}
            />
          ))}
        </div>
      </div>

      {/* ── Static examples: Filled ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Filled variant</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['4'],
            maxWidth: '22rem',
          }}
        >
          {severities.map((sev) => (
            <Toast
              key={`filled-${sev}`}
              id={`filled-${sev}`}
              severity={sev}
              variant="filled"
              title={sampleToasts[sev].title}
              description={sampleToasts[sev].description}
              onDismiss={() => {}}
              isFront={false}
              autoDismiss={false}
            />
          ))}
        </div>
      </div>

      {/* ── Static examples: Notification ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Notification variant</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['4'],
            maxWidth: '22rem',
          }}
        >
          <Toast
            id="notification-1"
            severity="info"
            variant="notification"
            title="System update"
            description="A new version is being deployed. You may experience brief interruptions."
            onDismiss={() => {}}
            isFront={false}
            autoDismiss={false}
          />
          <Toast
            id="notification-2"
            severity="info"
            variant="notification"
            title="Maintenance scheduled"
            description="Scheduled maintenance on Saturday at 2:00 AM EST."
            onUndo={() => {}}
            onDismiss={() => {}}
            isFront={false}
            autoDismiss={false}
          />
        </div>
      </div>

      {/* ── Live toast container ── */}
      <ToastContainer toasts={toasts} position={position} onDismiss={removeToast} />
    </>
  );
}
