import { Check, Circle } from 'lucide-react';
import * as s from './step-indicator.css.js';

export type StepStatus = 'completed' | 'active' | 'pending';

export interface StepItem {
  /** Step label (e.g. "Step 1") */
  label: string;
  /** Optional description below the label */
  description?: string;
}

export interface StepIndicatorProps {
  /** Array of step definitions. */
  steps: StepItem[];
  /** Zero-based index of the currently active step. Steps before this are marked completed. */
  currentStep: number;
  /** Accessible label for the step indicator group. */
  ariaLabel?: string;
}

function getStatus(index: number, currentStep: number): StepStatus {
  if (index < currentStep) return 'completed';
  if (index === currentStep) return 'active';
  return 'pending';
}

const iconClassMap: Record<StepStatus, string> = {
  completed: s.iconCompleted,
  active: s.iconActive,
  pending: s.iconPending,
};

export function StepIndicator({ steps, currentStep, ariaLabel }: StepIndicatorProps) {
  return (
    <div className={s.wrapper} role="group" aria-label={ariaLabel ?? 'Progress steps'}>
      {steps.map((step, i) => {
        const status = getStatus(i, currentStep);
        const isLast = i === steps.length - 1;

        return (
          <div key={i} className={s.step} aria-current={status === 'active' ? 'step' : undefined}>
            {/* Connector line (between icons) */}
            {!isLast && (
              <div
                className={`${s.connector} ${
                  i < currentStep ? s.connectorCompleted : s.connectorPending
                }`}
              />
            )}

            {/* Icon */}
            <div className={`${s.iconBase} ${iconClassMap[status]}`}>
              {status === 'completed' ? (
                <Check size={16} strokeWidth={2.5} />
              ) : (
                <Circle size={12} strokeWidth={0} fill="currentColor" />
              )}
            </div>

            {/* Label + description */}
            <div className={s.labelWrap}>
              <span className={`${s.label} ${status === 'pending' ? s.labelPending : ''}`}>
                {step.label}
              </span>
              {step.description && (
                <span
                  className={`${s.description} ${status === 'pending' ? s.descriptionPending : ''}`}
                >
                  {step.description}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
