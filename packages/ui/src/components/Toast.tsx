import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import {
  Check,
  OctagonX,
  TriangleAlert,
  Info,
  BellRing,
  X,
  ChevronDown,
  ChevronUp,
  Undo2,
} from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as s from './toast.css.js';

/* ═══════════════════════════════════════
   Types
   ═══════════════════════════════════════ */

export type ToastSeverity = 'success' | 'error' | 'warning' | 'info';

export type ToastVariant = 'default' | 'filled' | 'notification';

export type ToastPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'top-right'
  | 'top-left'
  | 'top-center';

export interface ToastData {
  id: string;
  severity: ToastSeverity;
  /** ReactNode rather than string so a message can carry an inline icon. */
  title: ReactNode;
  description?: string;
  /** Custom icon element. Falls back to the default severity/variant icon when omitted. */
  icon?: ReactNode;
  /**
   * Visual variant.
   * - `default` — white card, severity color on icon + progress bar only
   * - `filled` — lightest semantic background color per severity
   * - `notification` — dark card with white text for system-level notifications
   * @default 'default'
   */
  variant?: ToastVariant;
  /**
   * Drop the shadow. For a toast rendered *in* the page rather than floating
   * over it — shadow is elevation, and an inline notice has none.
   * @default false
   */
  flat?: boolean;
  /**
   * Fill the container instead of the fixed 22rem stack width. Pairs with
   * `flat` for inline use; the fixed width only exists to align a corner stack.
   * @default false
   */
  fullWidth?: boolean;
  onUndo?: () => void;
  autoDismiss?: boolean;
  duration?: number;
  /** Custom action buttons rendered in the actions slot. Overrides default undo/expand/dismiss buttons when provided. */
  customActions?: ReactNode;
}

export interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
  isFront?: boolean;
  enterFrom?: 'bottom' | 'top';
}

export interface ToastContainerProps {
  toasts: ToastData[];
  position?: ToastPosition;
  onDismiss: (id: string) => void;
}

/* ═══════════════════════════════════════
   Constants
   ═══════════════════════════════════════ */

const DEFAULT_DURATION = 5000;
const EXIT_DURATION = 150;
const STACK_OFFSET_PX = 8;
const MAX_BEHIND = 2;

const SEVERITY_ICONS: Record<ToastSeverity, ReactNode> = {
  success: <Check size={18} />,
  error: <OctagonX size={18} />,
  warning: <TriangleAlert size={18} />,
  info: <Info size={18} />,
};

const NOTIFICATION_ICON: ReactNode = <BellRing size={18} />;

function defaultAutoDismiss(severity: ToastSeverity): boolean {
  return severity === 'success' || severity === 'info';
}

type ColorKey = ToastSeverity | 'notification';

function resolveColorKey(severity: ToastSeverity, variant: ToastVariant): ColorKey {
  return variant === 'notification' ? 'notification' : severity;
}

function resolveDefaultIcon(severity: ToastSeverity, variant: ToastVariant): ReactNode {
  return variant === 'notification' ? NOTIFICATION_ICON : SEVERITY_ICONS[severity];
}

function resolveVariantCls(severity: ToastSeverity, variant: ToastVariant): string {
  if (variant === 'filled') return s.toastFilled[severity];
  if (variant === 'notification') return s.toastNotification;
  return '';
}

/* ═══════════════════════════════════════
   Toast (single card)
   ═══════════════════════════════════════ */

export function Toast({
  id,
  severity,
  title,
  description,
  icon,
  variant = 'default',
  flat = false,
  fullWidth = false,
  onUndo,
  autoDismiss,
  duration = DEFAULT_DURATION,
  customActions,
  onDismiss,
  isFront = true,
  enterFrom = 'bottom',
}: ToastProps) {
  const shouldAutoDismiss = autoDismiss ?? defaultAutoDismiss(severity);
  const [expanded, setExpanded] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(100);

  const startTimeRef = useRef(0);
  const remainingRef = useRef(duration);
  const rafRef = useRef<number>(0);
  const _isNotification = variant === 'notification';

  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    dismissTimerRef.current = setTimeout(() => onDismiss(id), EXIT_DURATION);
  }, [id, onDismiss]);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startTimeRef.current;
    const remaining = Math.max(0, remainingRef.current - elapsed);
    const pct = (remaining / duration) * 100;
    setProgress(pct);
    if (remaining <= 0) {
      handleDismiss();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [duration, handleDismiss]);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pauseTimer = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
  }, []);

  useEffect(() => {
    if (!shouldAutoDismiss || !isFront) return;
    if (paused) {
      pauseTimer();
    } else {
      startTimer();
    }
    return () => {
      const id = rafRef.current;
      cancelAnimationFrame(id);
    };
  }, [shouldAutoDismiss, isFront, paused, startTimer, pauseTimer]);

  // Clean up the exit-animation timer on unmount
  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  // Reset progress when duration changes (inline state adjustment — no useEffect)
  const [prevDuration, setPrevDuration] = useState(duration);
  if (duration !== prevDuration) {
    setPrevDuration(duration);
    remainingRef.current = duration;
    setProgress(100);
  }

  const handleProgressClick = () => {
    if (shouldAutoDismiss) setPaused((p) => !p);
  };

  const secondsLeft = Math.ceil((progress / 100) * (duration / 1000));
  const colorKey = resolveColorKey(severity, variant);
  const btnVariant = 'trueGhost' as const;

  const enterCls = enterFrom === 'top' ? s.toastEnterTop : s.toastEnterBottom;
  const toastCls = [
    s.toast,
    resolveVariantCls(severity, variant),
    flat ? s.toastFlat : null,
    fullWidth ? s.toastFullWidth : null,
    exiting ? s.toastExit : enterCls,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={toastCls}
      role={severity === 'error' || severity === 'warning' ? 'alert' : 'status'}
      onMouseEnter={() => {
        if (shouldAutoDismiss) setPaused(true);
      }}
      onMouseLeave={() => {
        if (shouldAutoDismiss) setPaused(false);
      }}
    >
      <div className={s.header}>
        <span className={`${s.icon} ${s.iconColor[colorKey]}`}>
          {icon ?? resolveDefaultIcon(severity, variant)}
        </span>
        <span className={s.title}>{title}</span>
        <div className={`${s.actions}${customActions ? ` ${s.actionsCustom}` : ''}`}>
          {customActions ?? (
            <>
              {onUndo && (
                <IconButton
                  icon={<Undo2 size={14} />}
                  tooltip="Undo"
                  size="sm"
                  variant={btnVariant}
                  onClick={onUndo}
                />
              )}
              {description && (
                <IconButton
                  icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  tooltip={expanded ? 'Collapse' : 'Expand'}
                  size="sm"
                  variant={btnVariant}
                  onClick={() => setExpanded((e) => !e)}
                />
              )}
              <IconButton
                icon={<X size={14} />}
                tooltip="Dismiss"
                size="sm"
                variant={btnVariant}
                onClick={handleDismiss}
              />
            </>
          )}
        </div>
      </div>

      {description && (
        <div className={`${s.body} ${expanded ? s.bodyExpanded : s.bodyCollapsed}`}>
          <p className={s.description}>{description}</p>
          {shouldAutoDismiss && expanded && (
            <p className={s.countdown}>
              This message will close in <span className={s.countdownBold}>{secondsLeft}</span>{' '}
              second{secondsLeft !== 1 ? 's' : ''}.{' '}
              <span className={s.countdownAction} onClick={handleProgressClick}>
                Click to {paused ? 'resume' : 'stop'}.
              </span>
            </p>
          )}
        </div>
      )}

      {shouldAutoDismiss && (
        <div
          className={s.progressTrack}
          onClick={handleProgressClick}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Auto-dismiss in ${secondsLeft} seconds`}
        >
          <div
            className={`${s.progressBar} ${s.progressColor[colorKey]}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   ToastContainer (positioning + stacking)
   ═══════════════════════════════════════ */

export function ToastContainer({
  toasts,
  position = 'bottom-right',
  onDismiss,
}: ToastContainerProps) {
  if (toasts.length === 0) return null;

  const isTop = position.startsWith('top');
  const enterFrom = isTop ? 'top' : 'bottom';
  const frontToast = toasts[0]!;
  const behindToasts = toasts.slice(1, 1 + MAX_BEHIND);

  return (
    <div className={`${s.container} ${s.containerPosition[position]}`} aria-live="polite">
      <div className={s.stackWrapper}>
        {behindToasts.map((toast, i) => {
          const offsetPx = (i + 1) * STACK_OFFSET_PX;
          const stackCls = i === 0 ? s.stackedFirst : s.stackedSecond;
          const behindVariant = toast.variant ?? 'default';
          const behindColorKey = resolveColorKey(toast.severity, behindVariant);

          return (
            <div
              key={toast.id}
              className={`${s.stackedToast} ${stackCls}`}
              style={{ [isTop ? 'top' : 'bottom']: `${offsetPx}px`, zIndex: -(i + 1) }}
              aria-hidden="true"
            >
              <div
                className={[s.toast, resolveVariantCls(toast.severity, behindVariant)]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={s.header}>
                  <span className={`${s.icon} ${s.iconColor[behindColorKey]}`}>
                    {toast.icon ?? resolveDefaultIcon(toast.severity, behindVariant)}
                  </span>
                  <span className={s.title}>{toast.title}</span>
                </div>
              </div>
            </div>
          );
        })}

        <Toast
          key={frontToast.id}
          {...frontToast}
          onDismiss={onDismiss}
          isFront
          enterFrom={enterFrom}
        />
      </div>
    </div>
  );
}
