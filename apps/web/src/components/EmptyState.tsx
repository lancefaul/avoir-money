import { vars } from '@budget-tracker/ui/theme/contract.css.js';

interface Props {
  message: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export default function EmptyState({ message, action, icon }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: vars.radius.xl,
        border: `${vars.border.thin} dashed ${vars.color.borderStrong}`,
        background: vars.color.neutral50,
        padding: `${vars.space['16']} ${vars.space['6']}`,
        textAlign: 'center',
      }}
    >
      {icon && (
        <div style={{ marginBottom: vars.space['3'], color: vars.color.textTertiary }}>{icon}</div>
      )}
      <p
        style={{
          fontSize: vars.font.base,
          color: vars.color.textPrimary,
          margin: 0,
        }}
      >
        {message}
      </p>
      {action && <div style={{ marginTop: vars.space['4'] }}>{action}</div>}
    </div>
  );
}
