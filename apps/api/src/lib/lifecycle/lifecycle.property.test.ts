import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { HookRegistry } from './hook-registry.js';
import { TransactionLifecycleManager } from './manager.js';
import type { HookContext, HookDefinition, LifecycleEvent, TransactionRecord } from './types.js';

// ─── Generators ───

const lifecycleEventArb: fc.Arbitrary<LifecycleEvent> = fc.constantFrom(
  'created',
  'updated',
  'deleted',
);

const lifecycleEventsArb: fc.Arbitrary<LifecycleEvent[]> = fc.subarray(
  ['created', 'updated', 'deleted'] as LifecycleEvent[],
  { minLength: 1 },
);

const transactionRecordArb: fc.Arbitrary<TransactionRecord> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('INCOME', 'EXPENSE', 'TRADE', 'TRANSFER'),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  amount: fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }),
  createdAt: fc.date({
    min: new Date('2000-01-01'),
    max: new Date('2030-12-31'),
    noInvalidDate: true,
  }),
  accountId: fc.string({ minLength: 1, maxLength: 20 }),
  toAccountId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
  expenseId: fc.option(fc.uuid(), { nil: null }),
  incomeId: fc.option(fc.uuid(), { nil: null }),
  budgetId: fc.option(fc.uuid(), { nil: null }),
});

const hookContextArb: fc.Arbitrary<HookContext> = transactionRecordArb.map((tx) => ({ tx }));

const updatedHookContextArb: fc.Arbitrary<HookContext> = fc
  .tuple(transactionRecordArb, transactionRecordArb)
  .map(([tx, oldTx]) => ({ tx, oldTx }));

const hookNameArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

const priorityArb = fc.integer({ min: 0, max: 1000 });

// ─── Property 1: Registration round-trip ───

describe('Feature: transaction-lifecycle-hooks, Property 1: Registration round-trip', () => {
  /**
   * Validates: Requirements 1.2, 1.4
   *
   * For any valid hook definition with a name, a non-empty set of lifecycle events,
   * and an optional condition/executor, registering it in the HookRegistry and then
   * querying getHooksForEvent for each of its registered events should include that
   * hook in the results.
   */
  it('registered hooks appear in getHooksForEvent for each of their events', () => {
    fc.assert(
      fc.property(
        hookNameArb,
        lifecycleEventsArb,
        fc.option(priorityArb, { nil: undefined }),
        (name, events, priority) => {
          const registry = new HookRegistry();
          const hook: HookDefinition = {
            name,
            events,
            priority,
            execute: async () => {},
          };

          registry.register(hook);

          for (const event of events) {
            const hooks = registry.getHooksForEvent(event);
            expect(hooks.some((h) => h.name === name)).toBe(true);
          }

          // Should NOT appear for events it wasn't registered for
          const allEvents: LifecycleEvent[] = ['created', 'updated', 'deleted'];
          const unregisteredEvents = allEvents.filter((e) => !events.includes(e));
          for (const event of unregisteredEvents) {
            const hooks = registry.getHooksForEvent(event);
            expect(hooks.some((h) => h.name === name)).toBe(false);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 2: Duplicate name rejection ───

describe('Feature: transaction-lifecycle-hooks, Property 2: Duplicate name rejection', () => {
  /**
   * Validates: Requirements 1.3
   *
   * For any hook name, registering a hook with that name once should succeed,
   * and registering a second hook with the same name should throw a descriptive error,
   * leaving the registry unchanged.
   */
  it('second registration with the same name throws, registry unchanged', () => {
    fc.assert(
      fc.property(hookNameArb, lifecycleEventsArb, lifecycleEventsArb, (name, events1, events2) => {
        const registry = new HookRegistry();
        const hook1: HookDefinition = { name, events: events1, execute: async () => {} };
        const hook2: HookDefinition = { name, events: events2, execute: async () => {} };

        // First registration succeeds
        registry.register(hook1);

        // Snapshot the state before the duplicate attempt
        const allEvents: LifecycleEvent[] = ['created', 'updated', 'deleted'];
        const before = allEvents.map((e) => registry.getHooksForEvent(e).length);

        // Second registration throws
        expect(() => registry.register(hook2)).toThrow(name);

        // Registry unchanged after failed registration
        const after = allEvents.map((e) => registry.getHooksForEvent(e).length);
        expect(after).toEqual(before);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 3: Dispatch executes exactly matching hooks ───

describe('Feature: transaction-lifecycle-hooks, Property 3: Dispatch executes exactly matching hooks', () => {
  /**
   * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 4.1, 4.2
   *
   * For any set of registered hooks with various conditions and for any lifecycle event
   * and transaction, dispatching that event should execute exactly those hooks that are
   * (a) registered for that event and (b) whose condition returns true (or have no condition).
   * For updated events, each executed hook should receive both the old and new transaction records.
   */
  it('only hooks matching event + condition are executed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            events: lifecycleEventsArb,
            conditionResult: fc.option(fc.boolean(), { nil: undefined }),
            priority: fc.option(priorityArb, { nil: undefined }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        lifecycleEventArb,
        transactionRecordArb,
        async (hookSpecs, dispatchEvent, tx) => {
          const registry = new HookRegistry();
          const manager = new TransactionLifecycleManager(registry);
          const executedNames: string[] = [];

          hookSpecs.forEach((spec, i) => {
            const name = `hook-${i}`;
            registry.register({
              name,
              events: spec.events,
              priority: spec.priority,
              condition:
                spec.conditionResult !== undefined ? () => spec.conditionResult! : undefined,
              execute: async () => {
                executedNames.push(name);
              },
            });
          });

          const ctx: HookContext = { tx };
          await manager.dispatch(dispatchEvent, ctx);

          const expectedNames = hookSpecs
            .map((spec, i) => ({ spec, name: `hook-${i}` }))
            .filter(({ spec }) => {
              if (!spec.events.includes(dispatchEvent)) return false;
              if (spec.conditionResult !== undefined) return spec.conditionResult;
              return true;
            })
            .map(({ name }) => name);

          expect(executedNames).toEqual(expect.arrayContaining(expectedNames));
          expect(executedNames.length).toBe(expectedNames.length);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('updated events pass both tx and oldTx to executed hooks', async () => {
    await fc.assert(
      fc.asyncProperty(updatedHookContextArb, async (ctx) => {
        const registry = new HookRegistry();
        const manager = new TransactionLifecycleManager(registry);
        let receivedCtx: HookContext | undefined;

        registry.register({
          name: 'capture-hook',
          events: ['updated'],
          execute: async (hookCtx) => {
            receivedCtx = hookCtx;
          },
        });

        await manager.dispatch('updated', ctx);

        expect(receivedCtx).toBeDefined();
        expect(receivedCtx!.tx).toBe(ctx.tx);
        expect(receivedCtx!.oldTx).toBe(ctx.oldTx);
      }),
      { numRuns: 20 },
    );
  });
});

// ─── Property 4: Error propagation ───

describe('Feature: transaction-lifecycle-hooks, Property 4: Error propagation', () => {
  /**
   * Validates: Requirements 2.4
   *
   * For any hook that throws an error during execution, the TransactionLifecycleManager's
   * dispatch call should propagate that error to the caller without suppression.
   */
  it('hook errors propagate through dispatch', async () => {
    await fc.assert(
      fc.asyncProperty(
        lifecycleEventArb,
        hookContextArb,
        fc.string({ minLength: 1, maxLength: 100 }),
        async (event, ctx, errorMessage) => {
          const registry = new HookRegistry();
          const manager = new TransactionLifecycleManager(registry);

          registry.register({
            name: 'failing-hook',
            events: [event],
            execute: async () => {
              throw new Error(errorMessage);
            },
          });

          await expect(manager.dispatch(event, ctx)).rejects.toThrow(errorMessage);
        },
      ),
      { numRuns: 20 },
    );
  });
});

// ─── Property 5: Priority-ordered execution ───

describe('Feature: transaction-lifecycle-hooks, Property 5: Priority-ordered execution', () => {
  /**
   * Validates: Requirements 5.2, 5.3
   *
   * For any set of hooks registered with various priorities, dispatching an event should
   * execute matching hooks in ascending priority order. When two hooks share the same
   * priority, they should execute in registration order.
   */
  it('hooks execute in ascending priority, registration order as tiebreaker', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(priorityArb, { minLength: 2, maxLength: 15 }),
        lifecycleEventArb,
        hookContextArb,
        async (priorities, event, ctx) => {
          const registry = new HookRegistry();
          const manager = new TransactionLifecycleManager(registry);
          const executionOrder: number[] = [];

          priorities.forEach((priority, i) => {
            registry.register({
              name: `hook-${i}`,
              events: [event],
              priority,
              execute: async () => {
                executionOrder.push(i);
              },
            });
          });

          await manager.dispatch(event, ctx);

          // Build expected order: sort by priority ascending, then by registration index
          const expected = priorities
            .map((p, i) => ({ priority: p, index: i }))
            .sort((a, b) => {
              if (a.priority !== b.priority) return a.priority - b.priority;
              return a.index - b.index;
            })
            .map(({ index }) => index);

          expect(executionOrder).toEqual(expected);
        },
      ),
      { numRuns: 20 },
    );
  });
});
