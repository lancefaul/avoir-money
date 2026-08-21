/**
 * The REAL observer, imported rather than replicated.
 *
 * `hooks/__tests__/mutation-cache-toast.test.tsx` hand-copies an `onSuccess`
 * into its own cache, so it can only test the copy. This file builds the cache
 * the app builds, which is the only way a rule lost from the observer can fail
 * a test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createMutationCache } from './mutation-observer.js';
import { useToastStore } from '../store/toast.js';
import { ApiError } from './api/request.js';
import type { UndoableMeta } from './undo.js';

function app() {
  const client: QueryClient = new QueryClient({
    mutationCache: createMutationCache(() => client),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return client;
}

/** Run a mutation through the real cache and hand back the toast it produced. */
async function run(
  client: QueryClient,
  meta: UndoableMeta,
  fn: () => Promise<unknown> = () => Promise.resolve({ id: 'new-id' }),
  onMutate?: () => unknown,
) {
  await client
    .getMutationCache()
    .build(client, { mutationFn: fn, meta: meta as Record<string, unknown>, onMutate })
    .execute(undefined)
    .catch(() => undefined);
  return useToastStore.getState().toasts.at(-1);
}

beforeEach(() => useToastStore.setState({ toasts: [] }));

describe('success toasts', () => {
  it('announces what happened', async () => {
    const t = await run(app(), { successMessage: 'Expense created' });
    expect(t?.title).toBe('Expense created');
    expect(t?.severity).toBe('success');
  });

  it('stays quiet when the mutation asked to be silent', async () => {
    await run(app(), { silent: true, successMessage: 'nope' });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('the undo button', () => {
  it('is absent when the mutation declares no inverse', async () => {
    // Most mutations, today. The absence is the honest signal.
    const t = await run(app(), { successMessage: 'Expense deleted' });
    expect(t?.onUndo).toBeUndefined();
  });

  it('is offered when the mutation declares one', async () => {
    const t = await run(app(), { successMessage: 'Expense created', undo: vi.fn() });
    expect(t?.onUndo).toBeTypeOf('function');
  });

  it('is WITHHELD when this run cannot be reversed', async () => {
    // The rule this file exists to pin. An update is only reversible if
    // onMutate managed to read the record first; when it did not, the button
    // must not appear. Inlined in App.tsx this was unreachable by any test,
    // and dropping it would have shown a button that apologises on click.
    const t = await run(app(), {
      successMessage: 'Expense updated',
      undo: vi.fn(),
      canUndo: () => false,
    });
    expect(t?.onUndo).toBeUndefined();
  });

  it('asks canUndo about the run that just happened', async () => {
    const canUndo = vi.fn().mockReturnValue(true);
    await run(
      app(),
      { successMessage: 'Expense updated', undo: vi.fn(), canUndo },
      undefined,
      () => ({
        before: { id: 'a', name: 'old' },
      }),
    );
    expect(canUndo).toHaveBeenCalledWith({ id: 'new-id' }, undefined, {
      before: { id: 'a', name: 'old' },
    });
  });

  it('reverses with what that mutation produced, not the latest one', async () => {
    // Two mutations, then undo the first. A lookup at click time would reverse
    // the wrong one; the closure captured at success time reverses the right one.
    const client = app();
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);

    await run(client, { successMessage: 'One', undo: first }, () => Promise.resolve({ id: 'a' }));
    const firstToast = useToastStore.getState().toasts.at(-1);
    await run(client, { successMessage: 'Two', undo: second }, () => Promise.resolve({ id: 'b' }));

    await firstToast?.onUndo?.();
    expect(first).toHaveBeenCalledWith({ id: 'a' }, undefined, undefined);
    expect(second).not.toHaveBeenCalled();
  });
});

describe('error toasts', () => {
  it('reports the failure', async () => {
    const t = await run(app(), { successMessage: 'x' }, () => Promise.reject(new Error('Boom')));
    expect(t?.severity).toBe('error');
    expect(t?.title).toBe('Boom');
  });

  it('softens a 404 on a record that was regenerated underneath the client', async () => {
    const t = await run(
      app(),
      { notFoundMessage: 'That item was refreshed. Please try again.' },
      () => Promise.reject(new ApiError('Not found', undefined, 404)),
    );
    expect(t?.severity).toBe('info');
    expect(t?.title).toBe('That item was refreshed. Please try again.');
  });

  it('does not soften a 404 when the mutation offered no friendlier line', async () => {
    const t = await run(app(), {}, () => Promise.reject(new ApiError('Not found', undefined, 404)));
    expect(t?.severity).toBe('error');
  });
});
