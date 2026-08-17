import { Bell } from 'lucide-react';
import { Modal } from '@budget-tracker/ui';
import { useUIStore } from '../store/ui.js';
import EmptyState from './EmptyState.js';

export default function NotificationsDrawer() {
  const open = useUIStore((s) => s.notificationsOpen);
  const close = useUIStore((s) => s.closeNotifications);

  return (
    <Modal open={open} onClose={close} title="Notifications" variant="drawer" closeButton="x">
      <EmptyState icon={<Bell size={32} />} message="No notifications yet" />
    </Modal>
  );
}
