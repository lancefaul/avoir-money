/**
 * The undo foundation.
 *
 * Worth testing carefully because every reversible mutation will rest on it,
 * and because its failure modes are quiet: an undo that reports success while
 * having done nothing leaves the user believing a record was restored. That is
 * strictly worse than no undo, since it is offered at the moment someone is
 * relieved to see it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { captureBefore, beforeOf, capturedBefore, runUndo, type UndoableMeta } from './undo.js';
import { useToastStore } from '../store/toast.js';

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('captureBefore', () => {
  it('reads the record the user was looking at', () => {
    const client = qc();
    client.setQueryData(['descriptions', ''], [{ id: 'a', name: 'Coffee' }]);
    expect(captureBefore(client, ['descriptions', ''], 'a')).toEqual({ id: 'a', name: 'Coffee' });
  });

  it('returns undefined rather than guessing when the list is not cached', () => {
    // A caller that gets undefined must not offer an undo: restoring a record
    // you never read means writing a guess over real data.
    expect(captureBefore(qc(), ['descriptions', ''], 'a')).toBeUndefined();
  });

  it('returns undefined when the id is not in the list', () => {
    const client = qc();
    client.setQueryData(['descriptions', ''], [{ id: 'b', name: 'Tea' }]);
    expect(captureBefore(client, ['descriptions', ''], 'a')).toBeUndefined();
  });

  it('finds the record whichever filtered view the user was on', () => {
    // Lists are cached per filter, so ['expenses', {archived:'true'}] and
    // ['expenses', undefined] are separate entries. An exact-key lookup would
    // return undefined for everyone browsing a filter, which reads as "not
    // undoable" rather than as the bug it is.
    const client = qc();
    client.setQueryData(['expenses', undefined], [{ id: 'a', name: 'Rent' }]);
    client.setQueryData(['expenses', { archived: 'true' }], [{ id: 'z', name: 'Old gym' }]);
    expect(captureBefore(client, ['expenses'], 'z')).toEqual({ id: 'z', name: 'Old gym' });
  });

  it('ignores cached entries that are not lists', () => {
    const client = qc();
    client.setQueryData(['expenses', 'summary'], { total: 12 });
    client.setQueryData(['expenses', undefined], [{ id: 'a', name: 'Rent' }]);
    expect(captureBefore(client, ['expenses'], 'a')).toEqual({ id: 'a', name: 'Rent' });
  });
});

describe('capturedBefore', () => {
  // The guard that keeps an update's Undo button from appearing when there is
  // nothing to restore. Without it the button shows and then apologises, which
  // the module exists to prevent.
  it('is false when onMutate captured nothing', () => {
    expect(capturedBefore(null, null, { before: undefined })).toBe(false);
    expect(capturedBefore(null, null, undefined)).toBe(false);
  });

  it('is true when a record was captured', () => {
    expect(capturedBefore(null, null, { before: { id: 'a' } })).toBe(true);
  });

  it('reads the captured record back', () => {
    expect(beforeOf<{ id: string }>({ before: { id: 'a' } })).toEqual({ id: 'a' });
    expect(beforeOf(undefined)).toBeUndefined();
  });
});

describe('runUndo', () => {
  const meta = (over: Partial<UndoableMeta> = {}): UndoableMeta => ({
    successMessage: 'Renamed',
    undo: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('runs the inverse with what the mutation produced', async () => {
    const m = meta();
    await runUndo(qc(), 'toast-1', m, { id: 'x' }, { id: 'x', name: 'New' }, { before: 'old' });
    expect(m.undo).toHaveBeenCalledWith({ id: 'x' }, { id: 'x', name: 'New' }, { before: 'old' });
  });

  it('dismisses the toast that offered it', async () => {
    // "Description renamed · Undo" left on screen after the rename has been
    // undone invites a second click on an action that already happened.
    useToastStore.setState({
      toasts: [{ id: 'toast-1', severity: 'success', title: 'Renamed' }],
    });
    await runUndo(qc(), 'toast-1', meta(), null, null, null);
    const ids = useToastStore.getState().toasts.map((t) => t.id);
    expect(ids).not.toContain('toast-1');
  });

  it('says it is undone', async () => {
    await runUndo(qc(), 'toast-1', meta({ undoneMessage: 'Rename undone' }), null, null, null);
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain('Rename undone');
  });

  it('reports a failed undo instead of claiming success', async () => {
    // The quiet failure this exists to prevent. If the inverse throws, the
    // record is still changed — saying "Undone" would be a lie told at the
    // moment it is most likely to be believed.
    const m = meta({ undo: vi.fn().mockRejectedValue(new Error('409 Conflict')) });
    await runUndo(qc(), 'toast-1', m, null, null, null);

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.severity === 'error')).toBe(true);
    expect(toasts.some((t) => t.title === 'Undone')).toBe(false);
  });

  it('leaves the original toast up when the undo fails', async () => {
    // It is still true: the action happened, and reversing it did not.
    useToastStore.setState({
      toasts: [{ id: 'toast-1', severity: 'success', title: 'Renamed' }],
    });
    await runUndo(
      qc(),
      'toast-1',
      meta({ undo: vi.fn().mockRejectedValue(new Error('nope')) }),
      null,
      null,
      null,
    );
    expect(useToastStore.getState().toasts.map((t) => t.id)).toContain('toast-1');
  });

  it('refreshes everything, not only what the action touched', async () => {
    // An inverse reaches further than the action did — restoring a transaction
    // moves balances, schedules and budget rollups.
    const client = qc();
    const spy = vi.spyOn(client, 'invalidateQueries');
    await runUndo(client, 'toast-1', meta(), null, null, null);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]?.[0]).toBeUndefined();
  });
});
