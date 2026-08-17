import type React from 'react';
import * as p from './progress.css.js';
import { vars } from '../theme/contract.css.js';

export type ProgressVariant = 'default' | 'success' | 'warning' | 'danger' | 'brand';
export type ProgressSize = 'sm' | 'md' | 'lg';

export interface ProgressBarProps {
  value: number;
  variant?: ProgressVariant;
  size?: ProgressSize;
  label?: string;
  valueLabel?: string;
  helper?: string;
  autoColor?: boolean;
  striped?: boolean;
  ariaLabel?: string;
  /** Any color token key from vars.color (e.g. 'info400', 'brand600'). Overrides variant. */
  color?: string;
}

const variantMap: Record<ProgressVariant, string> = {
  default: p.fillDefault,
  success: p.fillSuccess,
  warning: p.fillWarning,
  danger: p.fillDanger,
  brand: p.fillBrand,
};

const variantColorMap: Record<ProgressVariant, string> = {
  default: vars.color.accent600,
  success: vars.color.success400,
  warning: vars.color.warning400,
  danger: vars.color.danger400,
  brand: vars.color.brand600,
};

const sizeMap: Record<ProgressSize, string> = {
  sm: p.trackSm,
  md: p.trackMd,
  lg: p.trackLg,
};

export function autoVariant(value: number): ProgressVariant {
  if (value >= 100) return 'danger';
  if (value >= 80) return 'warning';
  if (value >= 50) return 'default';
  return 'success';
}

export function ProgressBar({
  value,
  variant = 'default',
  size = 'md',
  label,
  valueLabel,
  helper,
  autoColor = false,
  striped = false,
  ariaLabel,
  color,
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), 100);
  const resolved = autoColor ? autoVariant(clamped) : variant;

  // If a custom color token is provided, use inline style instead of variant class
  const useCustomColor = !!color;
  const resolvedColor = color
    ? ((vars.color as Record<string, string>)[color] ?? color)
    : variantColorMap[resolved];
  const fillCls = useCustomColor
    ? `${p.fill}${striped ? ` ${p.fillStriped}` : ''}`
    : `${p.fill} ${variantMap[resolved]}${striped ? ` ${p.fillStriped}` : ''}`;
  const fillStyle: React.CSSProperties = useCustomColor
    ? {
        width: `${clamped}%`,
        background: striped
          ? `repeating-linear-gradient(45deg, transparent, transparent 0.375rem, rgba(255,255,255,0.2) 0.375rem, rgba(255,255,255,0.2) 0.75rem), ${resolvedColor}`
          : resolvedColor,
      }
    : { width: `${clamped}%` };

  return (
    <div className={p.wrapper}>
      {(label || valueLabel) && (
        <div className={p.header}>
          {label && <span className={p.label}>{label}</span>}
          {valueLabel && <span className={p.valueText}>{valueLabel}</span>}
        </div>
      )}
      <div
        className={`${p.track} ${sizeMap[size]}`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? label}
      >
        <div className={fillCls} style={fillStyle} />
      </div>
      {helper && <span className={p.helperText}>{helper}</span>}
    </div>
  );
}

/* ── Segmented (multi-section) ── */

export interface ProgressSegment {
  value: number;
  variant?: ProgressVariant;
  color?: string;
  striped?: boolean;
}

export interface SegmentedProgressProps {
  segments: ProgressSegment[];
  size?: ProgressSize;
  label?: string;
  valueLabel?: string;
  helper?: string;
  ariaLabel?: string;
}

export function SegmentedProgress({
  segments,
  size = 'md',
  label,
  valueLabel,
  helper,
  ariaLabel,
}: SegmentedProgressProps) {
  const visibleSegments = segments.filter((seg) => seg.value > 0);
  const totalValue = visibleSegments.reduce(
    (sum, seg) => sum + Math.min(Math.max(seg.value, 0), 100),
    0,
  );
  return (
    <div className={p.wrapper}>
      {(label || valueLabel) && (
        <div className={p.header}>
          {label && <span className={p.label}>{label}</span>}
          {valueLabel && <span className={p.valueText}>{valueLabel}</span>}
        </div>
      )}
      <div
        className={`${p.segmentedTrack} ${sizeMap[size]}`}
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuenow={Math.round(totalValue)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {visibleSegments.map((seg, i) => {
          const variant = seg.variant ?? 'default';
          const color = seg.color ?? variantColorMap[variant];
          const stripedBg = seg.striped
            ? `repeating-linear-gradient(45deg, transparent, transparent 0.375rem, rgba(255,255,255,0.2) 0.375rem, rgba(255,255,255,0.2) 0.75rem), ${color}`
            : color;
          return (
            <div
              key={i}
              className={p.fill}
              style={{
                width: `${Math.min(Math.max(seg.value, 0), 100)}%`,
                borderRadius: 0,
                background: stripedBg,
              }}
            />
          );
        })}
      </div>
      {helper && <span className={p.helperText}>{helper}</span>}
    </div>
  );
}
