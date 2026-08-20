import { type ReactNode, type ButtonHTMLAttributes, type Ref } from 'react';
import { Tooltip } from './Tooltip.js';
import * as btn from './buttons.css.js';

type Size = 'sm' | 'md' | 'lg';
type Variant =
  | 'primary'
  | 'secondary'
  | 'trueGhost'
  | 'danger'
  | 'trueGhostDanger'
  | 'trueGhostBrand'
  | 'onDark'
  | 'onDarkDanger';

const sizeClass: Record<Size, string> = {
  sm: btn.btnIconSm,
  md: btn.btnIconMd,
  lg: btn.btnIconLg,
};

const variantClass: Record<Variant, string> = {
  primary: btn.btnPrimary,
  secondary: btn.btnSecondary,
  trueGhost: btn.btnTrueGhost,
  danger: btn.btnDanger,
  trueGhostDanger: btn.btnTrueGhostDanger,
  trueGhostBrand: btn.btnTrueGhostBrand,
  onDark: btn.btnOnDark,
  onDarkDanger: btn.btnOnDarkDanger,
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Icon element to render inside the button. */
  icon: ReactNode;
  /** Tooltip text — required for accessibility. Renders the DS Tooltip on hover/focus. */
  tooltip: string;
  /** Button size. @default 'md' */
  size?: Size;
  /** Visual variant. @default 'trueGhost' */
  variant?: Variant;
  /** Tooltip placement. @default 'top' */
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Ref forwarded to the underlying button element. */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  tooltip,
  size = 'md',
  variant = 'trueGhost',
  tooltipSide = 'top',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  const cls = [btn.btnBase, sizeClass[size], variantClass[variant], className]
    .filter(Boolean)
    .join(' ');

  return (
    <Tooltip content={tooltip} side={tooltipSide}>
      <button ref={ref} type="button" aria-label={tooltip} className={cls} {...rest}>
        {icon}
      </button>
    </Tooltip>
  );
}
