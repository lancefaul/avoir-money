import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip.js';
import { linkInfo } from './links.css.js';

export interface InfoLinkProps {
  /** The text content to display as the dotted-underline link. */
  children: ReactNode;
  /** Tooltip text — required. Shown on hover/focus to provide additional context. */
  tooltip: string;
  /** Tooltip placement. @default 'top' */
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Additional CSS class name. */
  className?: string;
  /** When true, the trigger wrapper truncates with ellipsis instead of sizing to content. */
  truncate?: boolean;
}

export function InfoLink({
  children,
  tooltip,
  tooltipSide = 'top',
  className,
  truncate,
}: InfoLinkProps) {
  const cls = className ? `${linkInfo} ${className}` : linkInfo;

  return (
    <Tooltip content={tooltip} side={tooltipSide} truncate={truncate}>
      <span
        className={cls}
        tabIndex={0}
        role="note"
        style={
          truncate
            ? {
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }
            : undefined
        }
      >
        {children}
      </span>
    </Tooltip>
  );
}
