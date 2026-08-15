import ConfirmDialog from '../../components/ConfirmDialog.js';
import type { RecurringItem } from './types.js';

interface RecurringConfirmDialogsProps {
  deleteTarget: RecurringItem | null;
  archiveTarget: RecurringItem | null;
  onConfirmDelete: (item: RecurringItem) => void;
  onCancelDelete: () => void;
  onConfirmArchive: (item: RecurringItem) => void;
  onCancelArchive: () => void;
}

/** Delete + archive confirmation dialogs for recurring items — extracted from Recurring.tsx. */
export default function RecurringConfirmDialogs({
  deleteTarget,
  archiveTarget,
  onConfirmDelete,
  onCancelDelete,
  onConfirmArchive,
  onCancelArchive,
}: RecurringConfirmDialogsProps) {
  return (
    <>
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.type === 'income' ? 'Delete Income' : 'Delete Expense'}
        message={
          deleteTarget
            ? `Are you sure you want to delete ${deleteTarget.name}? This is unrecoverable. All transactions associated with this ${deleteTarget.type} will also be removed.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmColor="red"
        onConfirm={() => {
          if (deleteTarget) onConfirmDelete(deleteTarget);
        }}
        onCancel={onCancelDelete}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title={archiveTarget?.type === 'income' ? 'Archive Income' : 'Archive Expense'}
        message={
          archiveTarget
            ? `Are you sure you want to archive ${archiveTarget.name}? It will stop generating scheduled transactions. You can restore it later.`
            : ''
        }
        confirmLabel="Archive"
        cancelLabel="Cancel"
        confirmColor="blue"
        onConfirm={() => {
          if (archiveTarget) onConfirmArchive(archiveTarget);
        }}
        onCancel={onCancelArchive}
      />
    </>
  );
}
