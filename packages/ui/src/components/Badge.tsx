import { forwardRef, type ReactNode, type CSSProperties, type HTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import * as b from './badges.css.js';

/* ─── Badge (semantic label) ─── */

export type BadgeVariant = 'positive' | 'negative' | 'warning' | 'info' | 'neutral' | 'brand';
export type BadgeSize = 'sm' | 'md' | 'lg' | 'xl';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Custom background color (overrides variant) */
  background?: string;
  /** Render as icon-only (removes horizontal padding) */
  iconOnly?: boolean;
  /**
   * Allow the badge to shrink within its container and truncate its label
   * with an ellipsis inside the pill (instead of overflowing the parent).
   */
  truncate?: boolean;
  /**
   * Renders a trailing chevron and makes the badge a keyboard-focusable,
   * button-like affordance — use when the badge triggers a dropdown (e.g. as
   * Select's `trigger`). The parent trigger injects the click/aria wiring, so
   * spread props (onClick, aria-*) land on the badge's root.
   */
  chevron?: boolean;
  /**
   * Accessible name for icon-only badges. Lucide icons render aria-hidden, so
   * without this an iconOnly badge is invisible to assistive tech. When set,
   * the badge announces as role="img" with this label.
   */
  'aria-label'?: string;
}

const variantMap: Record<BadgeVariant, string> = {
  positive: b.badgePositive,
  negative: b.badgeNegative,
  warning: b.badgeWarning,
  info: b.badgeInfo,
  neutral: b.badgeNeutral,
  brand: b.badgeBrand,
};

const sizeMap: Record<BadgeSize, string> = {
  sm: b.badgeSm,
  md: '',
  lg: b.badgeLg,
  xl: b.badgeXl,
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    children,
    variant = 'neutral',
    size = 'md',
    background,
    iconOnly,
    truncate,
    chevron,
    'aria-label': ariaLabel,
    className,
    style,
    ...rest
  },
  ref,
) {
  const classes = [
    b.badge,
    variantMap[variant],
    sizeMap[size],
    iconOnly ? b.badgeIconOnly : '',
    truncate ? b.badgeTruncate : '',
    chevron ? b.badgeInteractive : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const mergedStyle: CSSProperties | undefined = background ? { ...style, background } : style;

  return (
    <span
      ref={ref}
      className={classes}
      style={mergedStyle}
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : {})}
      {...(chevron ? { tabIndex: 0, role: 'button' as const } : {})}
      {...rest}
    >
      {truncate ? <span className={b.badgeLabel}>{children}</span> : children}
      {chevron && <ChevronDown size={12} className={b.badgeChevron} aria-hidden />}
    </span>
  );
});

/* ─── BadgeCount (numeric indicator) ─── */

export type BadgeCountColor = 'neutral' | 'brand' | 'danger';
export type BadgeCountSize = 'xs' | 'sm' | 'md' | 'lg';

export interface BadgeCountProps {
  children: ReactNode;
  color?: BadgeCountColor;
  size?: BadgeCountSize;
  className?: string;
  style?: CSSProperties;
}

const countColorMap: Record<BadgeCountColor, string> = {
  neutral: b.badgeCountNeutral,
  brand: b.badgeCountBrand,
  danger: b.badgeCountDanger,
};

const countSizeMap: Record<BadgeCountSize, string> = {
  xs: b.badgeCountXs,
  sm: b.badgeCountSm,
  md: '',
  lg: b.badgeCountLg,
};

export function BadgeCount({
  children,
  color = 'neutral',
  size = 'md',
  className,
  style,
}: BadgeCountProps) {
  const classes = [b.badgeCount, countColorMap[color], countSizeMap[size], className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} style={style}>
      {children}
    </span>
  );
}
