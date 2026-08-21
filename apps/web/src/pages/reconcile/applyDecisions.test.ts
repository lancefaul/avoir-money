/**
 * Tests for the reconciler's one write path.
 *
 * Every property here is a real past bug or a state this feature exists to
 * prevent: the ordering that lets the re-match see a corrected world, the
 * fail-stops-batch rule that keeps a half-applied residual from masquerading as
 * a real discrepancy, the resume-skip that stops a retry writing a committed
 * change twice, and the ignore pass that marks every row (not just the first)
 * and dismisses the key for the sitting.
 *
 * No component and no react-query: `applyDecisions` takes the mutations as plain
 * async functions, so the batch logic is exercised directly.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyDecisions, type ApplyDeps } from './applyDecisions.js';
import {
  appendIgnoredNote,
  isIgnoredNote,
  type AppliedResult,
  type StagedAction,
} from './types.js';

// ─── Fixtures ───

const create = (over: Partial<Extract<StagedAction, { kind: 'create' }>> = {}): StagedAction => ({
  kind: 'create',
  statementRowId: 'sr',
  name: 'Coffee',
  amount: 4.5,
  date: '2026-05-08',
  txType: 'EXPENSE',
  budgetId: null,
  ...over,
});
const correct = (over: Partial<Extract<StagedAction, { kind: 'correct' }>> = {}): StagedAction => ({
  kind: 'correct',
  transactionId: 'tx-c',
  amount: 5,
  was: 4,
  label: 'correct',
  ...over,
});
const del = (over: Partial<Extract<StagedAction, { kind: 'delete' }>> = {}): StagedAction => ({
  kind: 'delete',
  transactionId: 'tx-d',
  label: 'delete',
  ...over,
});
const ignore = (over: Partial<Extract<StagedAction, { kind: 'ignore' }>> = {}): StagedAction => ({
  kind: 'ignore',
  label: 'ignore',
  transactions: [{ id: 'tx-i', note: null }],
  ...over,
});
const pair = (over: Partial<Extract<StagedAction, { kind: 'pair' }>> = {}): StagedAction => ({
  kind: 'pair',
  label: 'pair',
  pairs: [{ statementRowId: 'sr-p', transactionIds: ['tx-p'] }],
  ...over,
});
const merge = (over: Partial<Extract<StagedAction, { kind: 'merge' }>> = {}): StagedAction => ({
  kind: 'merge',
  statementRowId: 'sr-m',
  name: 'Ticketmaster',
  parts: [
    { transactionId: 'tx-m1', name: 'A', amount: 10, recurringLink: false, scheduledMatch: false },
    { transactionId: 'tx-m2', name: 'B', amount: 20, recurringLink: false, scheduledMatch: false },
  ],
  label: 'merge',
  ...over,
});

/** A deps object whose mutations record the order they were called in, plus the
 *  outcomes / dismissals / success count the callbacks received. */
function harness(overrides?: Partial<ApplyDeps>) {
  const calls: string[] = [];
  const updateArgs: { id: string; body: unknown }[] = [];
  const outcomes = new Map<string, AppliedResult>();
  const dismissed: string[] = [];
  const rec = { success: null as number | null };
  const deps: ApplyDeps = {
    accountId: 'acc-1',
    sessionId: 'sess-1',
    createTx: vi.fn(async (b: unknown) => {
      calls.push('createTx');
      return b;
    }),
    updateTx: vi.fn(async (a: { id: string; body: unknown }) => {
      calls.push('updateTx');
      updateArgs.push(a);
      return a;
    }),
    deleteTx: vi.fn(async (id: string) => {
      calls.push('deleteTx');
      return id;
    }),
    createMatch: vi.fn(async (b: { statementRowId: string; transactionId: string }) => {
      calls.push('createMatch');
      return b;
    }),
    runMatch: vi.fn(async (id: string) => {
      calls.push('runMatch');
      return id;
    }),
    runMerge: vi.fn(
      async (b: { statementRowId: string; transactionIds: string[]; name: string }) => {
        calls.push('runMerge');
        return b;
      },
    ),
    onOutcome: (key, result) => outcomes.set(key, result),
    onDismiss: (key) => dismissed.push(key),
    onSuccess: (n) => {
      rec.success = n;
    },
    ...overrides,
  };
  return { deps, calls, updateArgs, outcomes, dismissed, rec };
}

const noneApplied = new Map<string, AppliedResult>();

// ─── Tests ───

describe('applyDecisions — ordering', () => {
  it('runs ledger writes first, then the re-match, then the pairings', async () => {
    const staged = new Map<string, StagedAction>([
      ['k-pair', pair()],
      ['k-create', create()],
      ['k-correct', correct()],
    ]);
    const { deps, calls } = harness();
    await applyDecisions(staged, noneApplied, deps);

    const lastLedger = Math.max(calls.indexOf('createTx'), calls.indexOf('updateTx'));
    const iRun = calls.indexOf('runMatch');
    const iMatch = calls.indexOf('createMatch');
    expect(lastLedger).toBeGreaterThanOrEqual(0);
    expect(lastLedger).toBeLessThan(iRun); // ledger before re-match
    expect(iRun).toBeLessThan(iMatch); // re-match before pairings
  });

  it('does not re-match when there is no session', async () => {
    const { deps } = harness({ sessionId: null });
    await applyDecisions(new Map([['k', create()]]), noneApplied, deps);
    expect(deps.runMatch).not.toHaveBeenCalled();
  });
});

describe('applyDecisions — merge', () => {
  it('runs the merge in the ledger pass (before the re-match) with the right body, recorded ok', async () => {
    const staged = new Map<string, StagedAction>([
      ['k-merge', merge({ statementRowId: 'row-1', name: 'Merged' })],
    ]);
    const { deps, calls, outcomes } = harness();
    await applyDecisions(staged, noneApplied, deps);

    expect(deps.runMerge).toHaveBeenCalledWith({
      statementRowId: 'row-1',
      transactionIds: ['tx-m1', 'tx-m2'],
      name: 'Merged',
    });
    // A merge writes ledger rows, so it runs before the re-match re-derives pairings.
    expect(calls.indexOf('runMerge')).toBeLessThan(calls.indexOf('runMatch'));
    expect(outcomes.get('k-merge')).toEqual({ ok: true });
  });

  it('a failed merge stops the batch — no re-match, no success toast', async () => {
    const staged = new Map<string, StagedAction>([['k-merge', merge()]]);
    const { deps, outcomes, rec } = harness({
      runMerge: vi.fn(async () => {
        throw new Error('merge 500');
      }),
    });
    await applyDecisions(staged, noneApplied, deps);
    expect(outcomes.get('k-merge')).toEqual({ ok: false, error: 'merge 500' });
    expect(deps.runMatch).not.toHaveBeenCalled();
    expect(rec.success).toBeNull();
  });
});

describe('applyDecisions — outcomes & success', () => {
  it('records each decision ok and calls onSuccess with the number applied', async () => {
    const staged = new Map<string, StagedAction>([
      ['k1', create()],
      ['k2', del()],
    ]);
    const { deps, outcomes, rec } = harness();
    await applyDecisions(staged, noneApplied, deps);
    expect(outcomes.get('k1')).toEqual({ ok: true });
    expect(outcomes.get('k2')).toEqual({ ok: true });
    expect(rec.success).toBe(2);
  });
});

describe('applyDecisions — fail stops the batch', () => {
  it('records the failure, and runs no re-match, no pairings, no success toast', async () => {
    const staged = new Map<string, StagedAction>([
      ['k-create', create()],
      ['k-pair', pair()],
    ]);
    const { deps, outcomes, rec } = harness({
      createTx: vi.fn(async () => {
        throw new Error('server 500');
      }),
    });
    await applyDecisions(staged, noneApplied, deps);

    // The try/catch records the failure instead of throwing (the Failed section
    // is reachable), and the run stops.
    expect(outcomes.get('k-create')).toEqual({ ok: false, error: 'server 500' });
    expect(deps.runMatch).not.toHaveBeenCalled();
    expect(deps.createMatch).not.toHaveBeenCalled();
    expect(rec.success).toBeNull();
  });

  it('a non-Error rejection is still captured as a string', async () => {
    const { deps, outcomes } = harness({
      updateTx: vi.fn(async () => {
        throw 'plain string failure';
      }),
    });
    await applyDecisions(new Map([['k', correct()]]), noneApplied, deps);
    expect(outcomes.get('k')).toEqual({ ok: false, error: 'plain string failure' });
  });
});

describe('applyDecisions — resume skip', () => {
  it('skips a decision already recorded ok, so a retry never writes it twice', async () => {
    const staged = new Map<string, StagedAction>([
      ['done', create()],
      ['todo', correct()],
    ]);
    const already = new Map<string, AppliedResult>([['done', { ok: true }]]);
    const { deps, rec } = harness();
    await applyDecisions(staged, already, deps);

    expect(deps.createTx).not.toHaveBeenCalled(); // 'done' skipped
    expect(deps.updateTx).toHaveBeenCalledTimes(1); // only 'todo'
    expect(rec.success).toBe(1); // count is not-already-applied entries
  });

  it('re-attempts a decision previously recorded as failed (only ok is skipped)', async () => {
    const already = new Map<string, AppliedResult>([['retry', { ok: false, error: 'boom' }]]);
    const { deps } = harness();
    await applyDecisions(new Map([['retry', correct()]]), already, deps);
    expect(deps.updateTx).toHaveBeenCalledTimes(1);
  });
});

describe('applyDecisions — ignore', () => {
  it('marks each un-marked row once, skips already-marked rows, and dismisses the key', async () => {
    const marked = appendIgnoredNote(null, '2026-05-01');
    expect(isIgnoredNote(marked)).toBe(true); // precondition: the helper marks it

    const staged = new Map<string, StagedAction>([
      [
        'k-ignore',
        ignore({
          transactions: [
            { id: 'fresh', note: null },
            { id: 'already', note: marked },
          ],
        }),
      ],
    ]);
    const { deps, updateArgs, dismissed } = harness();
    await applyDecisions(staged, noneApplied, deps);

    // Only the un-marked row is written, and it comes back carrying the marker.
    expect(updateArgs).toHaveLength(1);
    expect(updateArgs[0]!.id).toBe('fresh');
    const body = updateArgs[0]!.body as { note?: string | null };
    expect(isIgnoredNote(body.note)).toBe(true);
    // Dismissed for the sitting regardless.
    expect(dismissed).toEqual(['k-ignore']);
  });

  it('dismisses an ignore with no transactions (period-scoped only) and still re-matches', async () => {
    const staged = new Map<string, StagedAction>([['k', ignore({ transactions: undefined })]]);
    const { deps, dismissed } = harness();
    await applyDecisions(staged, noneApplied, deps);
    expect(deps.updateTx).not.toHaveBeenCalled();
    expect(dismissed).toEqual(['k']);
    expect(deps.runMatch).toHaveBeenCalledTimes(1);
  });
});

describe('applyDecisions — writes the right bodies', () => {
  it('create sends accountId + a UTC-midnight date and omits budgetId when null', async () => {
    const bodies: unknown[] = [];
    const { deps } = harness({
      createTx: vi.fn(async (b: unknown) => {
        bodies.push(b);
        return b;
      }),
    });
    await applyDecisions(
      new Map([['k', create({ date: '2026-05-08', budgetId: null })]]),
      noneApplied,
      deps,
    );
    expect(bodies[0]).toMatchObject({
      type: 'EXPENSE',
      name: 'Coffee',
      amount: 4.5,
      accountId: 'acc-1',
      date: '2026-05-08T00:00:00.000Z',
    });
    expect(bodies[0]).not.toHaveProperty('budgetId');
  });

  it('create includes budgetId when one was chosen', async () => {
    const bodies: unknown[] = [];
    const { deps } = harness({
      createTx: vi.fn(async (b: unknown) => {
        bodies.push(b);
        return b;
      }),
    });
    await applyDecisions(new Map([['k', create({ budgetId: 'b1' })]]), noneApplied, deps);
    expect(bodies[0]).toMatchObject({ budgetId: 'b1' });
  });

  it('creates one match per (statementRow, transaction), after the re-match', async () => {
    const staged = new Map<string, StagedAction>([
      ['k', pair({ pairs: [{ statementRowId: 'sr1', transactionIds: ['t1', 't2'] }] })],
    ]);
    const { deps, calls } = harness();
    await applyDecisions(staged, noneApplied, deps);
    expect(deps.createMatch).toHaveBeenCalledTimes(2);
    expect(deps.createMatch).toHaveBeenCalledWith({ statementRowId: 'sr1', transactionId: 't1' });
    expect(deps.createMatch).toHaveBeenCalledWith({ statementRowId: 'sr1', transactionId: 't2' });
    expect(calls.indexOf('runMatch')).toBeLessThan(calls.indexOf('createMatch'));
  });
});
