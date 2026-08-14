import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';
import { useExpenseForm, type UseExpenseFormOptions } from './useExpenseForm.js';
import type { ExpenseRecord } from './types.js';

function createMockOptions(overrides?: Partial<UseExpenseFormOptions>): UseExpenseFormOptions {
  return {
    categories: [{ id: 'cat1', name: 'Housing', icon: null }],
    accounts: [{ id: 'acc1', name: 'Checking' }],
    debts: [{ id: 'debt1', name: 'Mortgage' }],
    create: {
      mutate: vi.fn((_body, opts) => opts?.onSuccess?.()),
      isPending: false,
    } as unknown as UseExpenseFormOptions['create'],
    update: {
      mutate: vi.fn((_vars, opts) => opts?.onSuccess?.()),
      isPending: false,
    } as unknown as UseExpenseFormOptions['update'],
    ...overrides,
  };
}

function makeExpenseRecord(overrides?: Partial<ExpenseRecord>): ExpenseRecord {
  return {
    id: 'exp1',
    name: 'Rent',
    amount: 1500,
    frequency: 'MONTHLY',
    budgetId: 'cat1',
    accountId: 'acc1',
    isAutomatic: true,
    skipWeekend: true,
    dueDay: 1,
    dueWeekday: null,
    dueOrdinal: null,
    amountSchedule: null,
    startDate: '2026-01-01',
    endDate: null,
    note: 'Monthly rent',
    pausedUntil: null,
    linkedDebtId: null,
    archivedAt: null,
    managementUrl: null,
    ...overrides,
  };
}

describe('useExpenseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openCreate / openEdit state management', () => {
    it('starts with showForm=false and editing=null', () => {
      const opts = createMockOptions();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      expect(result.current.showForm).toBe(false);
      expect(result.current.editing).toBeNull();
    });

    it('openCreate sets showForm=true and editing=null', () => {
      const opts = createMockOptions();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openCreate());
      expect(result.current.showForm).toBe(true);
      expect(result.current.editing).toBeNull();
    });

    it('openCreate resets state: isOngoing=true, hasLinkedDebt=false, monthAmounts={}', () => {
      const opts = createMockOptions();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openCreate());
      expect(result.current.isOngoing).toBe(true);
      expect(result.current.hasLinkedDebt).toBe(false);
      expect(result.current.monthAmounts).toEqual({});
    });

    it('openEdit sets showForm=true and editing to the record', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.showForm).toBe(true);
      expect(result.current.editing).toBe(record);
    });

    it('openEdit populates isOngoing=true when endDate is null', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ endDate: null });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.isOngoing).toBe(true);
    });

    it('openEdit populates isOngoing=false when endDate is set', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ endDate: '2027-12-31' });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.isOngoing).toBe(false);
    });

    it('openEdit sets hasLinkedDebt=true when linkedDebtId is present', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ linkedDebtId: 'debt1' });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.hasLinkedDebt).toBe(true);
    });

    it('openEdit sets dueType to weekday when dueWeekday and dueOrdinal are set', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ dueWeekday: 1, dueOrdinal: 2, dueDay: null });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.dueType).toBe('weekday');
    });

    it('openEdit sets dueType to day when dueWeekday/dueOrdinal are null', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ dueWeekday: null, dueOrdinal: null, dueDay: 15 });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.dueType).toBe('day');
    });

    it('closeForm resets showForm and editing', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      act(() => result.current.closeForm());
      expect(result.current.showForm).toBe(false);
      expect(result.current.editing).toBeNull();
    });
  });

  describe('by-month prefill logic', () => {
    it('openEdit populates monthAmounts from amountSchedule', () => {
      const opts = createMockOptions();
      const schedule = { '1': 100, '2': 200, '3': 150 };
      const record = makeExpenseRecord({ amountSchedule: schedule });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.monthAmounts).toEqual(schedule);
    });

    it('openEdit sets amountMode to byMonth when amountSchedule has entries', () => {
      const opts = createMockOptions();
      const schedule = { '1': 100, '2': 200 };
      const record = makeExpenseRecord({ amountSchedule: schedule });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.amountMode).toBe('byMonth');
    });

    it('openEdit sets amountMode to uniform when amountSchedule is null', () => {
      const opts = createMockOptions();
      const record = makeExpenseRecord({ amountSchedule: null });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      expect(result.current.amountMode).toBe('uniform');
    });

    it('prefills all 12 months with uniform amount when switching to byMonth', async () => {
      const opts = createMockOptions();
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });

      // Open create and set an amount
      act(() => result.current.openCreate());
      act(() => {
        result.current.setValue('amount', 500);
        result.current.setValue('amountMode', 'byMonth');
      });

      // The useEffect should prefill monthAmounts
      await waitFor(() => {
        expect(Object.keys(result.current.monthAmounts).length).toBe(12);
      });
      expect(result.current.monthAmounts['1']).toBe(500);
      expect(result.current.monthAmounts['12']).toBe(500);
    });

    it('does not overwrite existing monthAmounts when switching to byMonth', async () => {
      const opts = createMockOptions();
      const schedule = { '1': 100, '2': 200, '3': 300 };
      const record = makeExpenseRecord({ amountSchedule: schedule, amount: 500 });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });

      act(() => result.current.openEdit(record));

      // monthAmounts should remain as the record's schedule, not overwritten
      await waitFor(() => {
        expect(result.current.monthAmounts).toEqual(schedule);
      });
    });
  });

  describe('going-forward edits', () => {
    // Every edit applies going forward: onSubmit calls update.mutate with the
    // full body (never a cascade/archive dialog). The API updates the record in
    // place and regenerates future occurrences; past transactions are untouched.
    function editWith(
      overrides: Partial<Parameters<typeof makeExpenseRecord>[0]>,
      submit: unknown,
    ) {
      const mutateFn = vi.fn((_vars, opts) => opts?.onSuccess?.());
      const opts = createMockOptions({
        update: {
          mutate: mutateFn,
          isPending: false,
        } as unknown as UseExpenseFormOptions['update'],
      });
      const record = makeExpenseRecord(overrides);
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      act(() => result.current.onSubmit(submit as never));
      return mutateFn;
    }

    const base = {
      name: 'Rent',
      amount: 1500,
      frequency: 'MONTHLY',
      budgetId: 'cat1',
      accountId: 'acc1',
      isAutomatic: true,
      skipWeekend: true,
      dueType: 'day' as const,
      dueDay: 1,
      amountMode: 'uniform' as const,
    };

    it('a name change updates in place going forward', () => {
      const mutateFn = editWith({ name: 'Rent' }, { ...base, name: 'Rent Updated' });
      expect(mutateFn).toHaveBeenCalledWith(
        { id: 'exp1', body: expect.objectContaining({ name: 'Rent Updated' }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('an amount change updates in place going forward', () => {
      const mutateFn = editWith({ amount: 1500 }, { ...base, amount: 1600 });
      expect(mutateFn).toHaveBeenCalledWith(
        { id: 'exp1', body: expect.objectContaining({ amount: 1600 }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('an account (payment method) change updates in place going forward', () => {
      const mutateFn = editWith({ accountId: 'acc1' }, { ...base, accountId: 'acc2' });
      expect(mutateFn).toHaveBeenCalledWith(
        { id: 'exp1', body: expect.objectContaining({ accountId: 'acc2' }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('an amountSchedule change updates in place going forward', () => {
      const mutateFn = vi.fn((_vars, opts) => opts?.onSuccess?.());
      const opts = createMockOptions({
        update: {
          mutate: mutateFn,
          isPending: false,
        } as unknown as UseExpenseFormOptions['update'],
      });
      const record = makeExpenseRecord({ amountSchedule: { '1': 100, '2': 200 } });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(record));
      act(() => result.current.setMonthAmounts({ '1': 150, '2': 250 }));
      act(() => result.current.onSubmit({ ...base, amountMode: 'byMonth' } as never));

      expect(mutateFn).toHaveBeenCalledWith(
        { id: 'exp1', body: expect.objectContaining({ amountSchedule: { '1': 150, '2': 250 } }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('calls create.mutate when not editing', () => {
      const mutateFn = vi.fn((_body, opts) => opts?.onSuccess?.());
      const opts = createMockOptions({
        create: {
          mutate: mutateFn,
          isPending: false,
        } as unknown as UseExpenseFormOptions['create'],
      });
      const { result } = renderHook(() => useExpenseForm(opts), { wrapper: createWrapper() });

      act(() => result.current.openCreate());
      act(() => {
        result.current.onSubmit({
          name: 'Internet',
          amount: 80,
          frequency: 'MONTHLY',
          budgetId: 'cat1',
          accountId: '',
          isAutomatic: false,
          skipWeekend: true,
          dueType: 'day',
          dueDay: 15,
          amountMode: 'uniform',
        });
      });

      expect(mutateFn).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Internet', amount: 80 }),
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });
});
