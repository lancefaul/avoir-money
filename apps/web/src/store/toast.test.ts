import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from './toast.js';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('starts with an empty toasts array', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('addToast creates a toast with correct fields', () => {
    const mockId = '00000000-0000-0000-0000-000000000001';
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(
      mockId as `${string}-${string}-${string}-${string}-${string}`,
    );

    useToastStore.getState().addToast('success', 'Item saved');

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      id: mockId,
      severity: 'success',
      title: 'Item saved',
    });
  });

  it('addToast appends multiple toasts', () => {
    useToastStore.getState().addToast('error', 'Failed');
    useToastStore.getState().addToast('info', 'Note');

    expect(useToastStore.getState().toasts).toHaveLength(2);
    expect(useToastStore.getState().toasts[0]!.severity).toBe('error');
    expect(useToastStore.getState().toasts[1]!.severity).toBe('info');
  });

  it('removeToast removes a toast by ID', () => {
    useToastStore.getState().addToast('warning', 'Watch out');
    const id = useToastStore.getState().toasts[0]!.id;

    useToastStore.getState().removeToast(id);

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast only removes the matching toast', () => {
    useToastStore.getState().addToast('success', 'First');
    useToastStore.getState().addToast('error', 'Second');
    const toasts = useToastStore.getState().toasts;

    useToastStore.getState().removeToast(toasts[0]!.id);

    const remaining = useToastStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.title).toBe('Second');
  });

  it('removeToast with non-existent ID does nothing', () => {
    useToastStore.getState().addToast('info', 'Stays');

    useToastStore.getState().removeToast('non-existent-id');

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('addToast supports optional description and onUndo', () => {
    const undoFn = vi.fn();
    useToastStore.getState().addToast('success', 'Deleted', {
      description: 'Transaction removed',
      onUndo: undoFn,
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      severity: 'success',
      title: 'Deleted',
      description: 'Transaction removed',
    });
    expect(toasts[0]!.onUndo).toBe(undoFn);
  });
});
