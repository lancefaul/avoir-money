import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { buttonStyles as btn } from '@budget-tracker/ui';

export function Spinner({
  size = 14,
  color = vars.color.textOnBrand,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <div
      className={btn.spinner}
      style={{ width: size, height: size, borderTopColor: color, borderLeftColor: color }}
    />
  );
}

/* ── State machine helpers ── */

type ButtonState = 'idle' | 'loading' | 'success' | 'failure';

export function DemoButton({
  variant,
  size,
  outcome,
  children,
  loadingDelay = 1500,
  resultDelay = 1200,
}: {
  variant: string;
  size: string;
  outcome: 'success' | 'failure';
  children: React.ReactNode;
  loadingDelay?: number;
  resultDelay?: number;
}) {
  const [state, setState] = useState<ButtonState>('idle');

  const handleClick = () => {
    if (state !== 'idle') return;
    setState('loading');
    setTimeout(() => {
      setState(outcome);
      setTimeout(() => setState('idle'), resultDelay);
    }, loadingDelay);
  };

  const variantClass =
    state === 'success' ? btn.btnSuccess : state === 'failure' ? btn.btnFailure : variant;

  const isLoading = state === 'loading';

  return (
    <button
      type="button"
      className={`${btn.btnBase} ${size} ${variantClass}`}
      onClick={handleClick}
      disabled={state !== 'idle'}
      style={{ position: 'relative', opacity: state === 'loading' ? 0.85 : 1 }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: vars.space['2'],
          opacity: state === 'idle' ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
      >
        {children}
      </span>
      {state !== 'idle' && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
            transition: 'opacity 150ms ease',
          }}
        >
          {isLoading ? (
            <Spinner
              size={14}
              color={
                variant === btn.btnPrimary
                  ? vars.color.textOnBrand
                  : variant === btn.btnDanger
                    ? vars.color.neutral0
                    : vars.color.textPrimary
              }
            />
          ) : state === 'success' ? (
            <Check size={14} />
          ) : (
            <X size={14} />
          )}
        </span>
      )}
    </button>
  );
}

export function DemoIconButton({
  variant,
  size,
  outcome,
  icon: Icon,
  iconSize = 14,
  loadingDelay = 1500,
  resultDelay = 1200,
}: {
  variant: string;
  size: string;
  outcome: 'success' | 'failure';
  icon: LucideIcon;
  iconSize?: number;
  loadingDelay?: number;
  resultDelay?: number;
}) {
  const [state, setState] = useState<ButtonState>('idle');

  const handleClick = () => {
    if (state !== 'idle') return;
    setState('loading');
    setTimeout(() => {
      setState(outcome);
      setTimeout(() => setState('idle'), resultDelay);
    }, loadingDelay);
  };

  const variantClass =
    state === 'success' ? btn.btnSuccess : state === 'failure' ? btn.btnFailure : variant;

  const isLoading = state === 'loading';
  const spinnerColor =
    variant === btn.btnPrimary
      ? vars.color.textOnBrand
      : variant === btn.btnDanger
        ? vars.color.neutral0
        : vars.color.textPrimary;

  return (
    <button
      type="button"
      className={`${btn.btnBase} ${size} ${variantClass}`}
      onClick={handleClick}
      disabled={state !== 'idle'}
      style={{ position: 'relative', opacity: state === 'loading' ? 0.85 : 1 }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: state === 'idle' ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
      >
        <Icon size={iconSize} />
      </span>
      {state !== 'idle' && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
            transition: 'opacity 150ms ease',
          }}
        >
          {isLoading ? (
            <Spinner size={iconSize} color={spinnerColor} />
          ) : state === 'success' ? (
            <Check size={iconSize} />
          ) : (
            <X size={iconSize} />
          )}
        </span>
      )}
    </button>
  );
}

export function InstantIconButton({
  variant,
  size,
  outcome,
  icon: Icon,
  iconSize = 14,
  resultDelay = 1200,
}: {
  variant: string;
  size: string;
  outcome: 'success' | 'failure';
  icon: LucideIcon;
  iconSize?: number;
  resultDelay?: number;
}) {
  const [state, setState] = useState<'idle' | 'success' | 'failure'>('idle');

  const handleClick = () => {
    if (state !== 'idle') return;
    setState(outcome);
    setTimeout(() => setState('idle'), resultDelay);
  };

  const variantClass = variant; // always keep original variant

  return (
    <button
      type="button"
      className={`${btn.btnBase} ${size} ${variantClass}`}
      onClick={handleClick}
      style={{ position: 'relative' }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: state === 'idle' ? 1 : 0,
          transition: 'opacity 150ms ease',
        }}
      >
        <Icon size={iconSize} />
      </span>
      {state !== 'idle' && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
            transition: 'opacity 150ms ease',
          }}
        >
          {state === 'success' ? (
            <Check size={iconSize} style={{ color: vars.color.success400 }} />
          ) : (
            <X size={iconSize} style={{ color: vars.color.danger400 }} />
          )}
        </span>
      )}
    </button>
  );
}
