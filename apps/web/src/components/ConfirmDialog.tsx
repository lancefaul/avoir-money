import { Dialog, type DialogVariant } from '@budget-tracker/ui';

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmColor?: 'green' | 'red' | 'blue';
}

const variantMap: Record<string, DialogVariant> = {
  green: 'positive',
  red: 'negative',
  blue: 'neutral',
};

export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmColor = 'blue',
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      title={title}
      message={message}
      variant={variantMap[confirmColor] ?? 'neutral'}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
    />
  );
}
