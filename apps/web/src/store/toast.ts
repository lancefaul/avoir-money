import { create } from 'zustand';
import type { ToastSeverity, ToastData } from '@budget-tracker/ui';

export type { ToastSeverity, ToastData };

export interface ToastState {
  toasts: ToastData[];
  addToast: (
    severity: ToastSeverity,
    message: string,
    opts?: Partial<
      Pick<ToastData, 'description' | 'icon' | 'variant' | 'onUndo' | 'autoDismiss' | 'duration'>
    >,
    /**
     * Returns the new toast's id.
     *
     * Needed for undo: once the inverse has run, the toast offering it is
     * stale — leaving "Budget deleted · Undo" on screen after the delete has
     * been undone invites a second click on an action that already happened.
     * The caller cannot dismiss what it cannot name, and the id is minted in
     * here.
     */
  ) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (severity, message, opts) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, severity, title: message, ...opts }],
    }));
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
