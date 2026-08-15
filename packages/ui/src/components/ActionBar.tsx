import { vars } from '../theme/contract.css.js';

export interface ActionBarProps {
  children: React.ReactNode;
  /** Additional className on the wrapper. */
  className?: string;
  /** Additional inline styles. */
  style?: React.CSSProperties;
}

/**
 * Bottom-pinned action toolbar with border-top separator.
 * Used at the bottom of panels, settings tabs, and modals for primary actions.
 */
export function ActionBar({ children, className, style }: ActionBarProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: vars.space['3'],
        padding: `${vars.space['4']} ${vars.space['6']}`,
        borderTop: `${vars.border.hairline} solid ${vars.color.border}`,
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
