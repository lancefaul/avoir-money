import { ToastContainer as DSToastContainer } from '@budget-tracker/ui';
import { useToastStore } from '../store/toast.js';

export default function ToastContainer() {
  const toasts = useToastStore((st) => st.toasts);
  const removeToast = useToastStore((st) => st.removeToast);

  return <DSToastContainer toasts={toasts} position="bottom-right" onDismiss={removeToast} />;
}
