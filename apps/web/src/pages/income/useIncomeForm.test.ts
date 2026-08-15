import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createWrapper } from '../../test/wrapper.js';
import { useIncomeForm, type UseIncomeFormOptions } from './useIncomeForm.js';
import type { IncomeRecord, Category } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMutation(overrides?: Partial<UseIncomeFormOptions['create']>) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    variables: undefined,
    context: undefined,
    status: 'idle' as const,
    failureCount: 0,
    failureReason: null,
    reset: vi.fn(),
    submittedAt: 0,
    ...overrides,
  } as unknown as UseIncomeFormOptions['create'];
}

function makeUpdateMutation(overrides?: Partial<UseIncomeFormOptions['update']>) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    variables: undefined,
    context: undefined,
    status: 'idle' as const,
    failureCount: 0,
    failureReason: null,
    reset: vi.fn(),
    submittedAt: 0,
    ...overrides,
  } as unknown as UseIncomeFormOptions['update'];
}

const categories: Category[] = [
  { id: 'cat-income', name: 'Income', isSystem: true },
  { id: 'cat-other', name: 'Other' },
];

const baseRecord: IncomeRecord = {
  id: 'inc-1',
  name: 'Paycheck',
  amount: 5000,
  frequency: 'MONTHLY',
  budgetId: 'cat-income',
  accountId: 'acc-1',
  amountSchedule: null,
  startDate: '2026-01-01',
  endDate: null,
  note: 'Primary income',
  pausedUntil: null,
  archivedAt: null,
  managementUrl: 'https://employer.com',
};

function defaultOptions(): UseIncomeFormOptions {
  return {
    categories,
    create: makeMutation(),
    update: makeUpdateMutation(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useIncomeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openCreate / openEdit state management', () => {
    it('starts with showForm=false and editing=null', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      expect(result.current.showForm).toBe(false);
      expect(result.current.editing).toBeNull();
    });

    it('openCreate sets showForm=true and editing=null', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openCreate());
      expect(result.current.showForm).toBe(true);
      expect(result.current.editing).toBeNull();
    });

    it('openCreate resets monthAmounts and sets isOngoing=true', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openCreate());
      expect(result.current.monthAmounts).toEqual({});
      expect(result.current.isOngoing).toBe(true);
    });

    it('openEdit sets showForm=true and editing to the record', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit(baseRecord));
      expect(result.current.showForm).toBe(true);
      expect(result.current.editing).toBe(baseRecord);
    });

    it('openEdit sets isOngoing=true when record has no endDate', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit({ ...baseRecord, endDate: null }));
      expect(result.current.isOngoing).toBe(true);
    });

    it('openEdit sets isOngoing=false when record has endDate', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit({ ...baseRecord, endDate: '2027-12-31' }));
      expect(result.current.isOngoing).toBe(false);
    });

    it('openEdit sets amountMode to byMonth when record has amountSchedule', () => {
      const schedule = { '1': 4000, '2': 5000, '3': 4500 };
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit({ ...baseRecord, amountSchedule: schedule }));
      expect(result.current.amountMode).toBe('byMonth');
      expect(result.current.monthAmounts).toEqual(schedule);
    });

    it('openEdit sets amountMode to uniform when record has no amountSchedule', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit({ ...baseRecord, amountSchedule: null }));
      expect(result.current.amountMode).toBe('uniform');
    });

    it('closeForm resets showForm and editing', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });
      act(() => result.current.openEdit(baseRecord));
      expect(result.current.showForm).toBe(true);
      act(() => result.current.closeForm());
      expect(result.current.showForm).toBe(false);
      expect(result.current.editing).toBeNull();
    });
  });

  describe('by-month prefill logic', () => {
    it('prefills all 12 months with uniform amount when switching to byMonth mode', async () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });

      // Open create and set up the form values
      act(() => result.current.openCreate());
      act(() => {
        result.current.setValue('amount', 3000);
        result.current.setValue('frequency', 'MONTHLY');
        result.current.setValue('amountMode', 'byMonth');
      });

      // The effect should prefill monthAmounts
      // Wait for the effect to fire
      await vi.waitFor(() => {
        expect(Object.keys(result.current.monthAmounts).length).toBe(12);
      });

      for (let i = 1; i <= 12; i++) {
        expect(result.current.monthAmounts[String(i)]).toBe(3000);
      }
    });

    it('does not prefill when monthAmounts already has values', () => {
      const schedule = { '1': 4000, '2': 5000 };
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });

      // Open edit with existing schedule
      act(() =>
        result.current.openEdit({ ...baseRecord, amountSchedule: schedule, frequency: 'MONTHLY' }),
      );

      // monthAmounts should remain as the existing schedule, not be overwritten
      expect(result.current.monthAmounts).toEqual(schedule);
    });

    it('does not prefill when amount is 0', () => {
      const { result } = renderHook(() => useIncomeForm(defaultOptions()), {
        wrapper: createWrapper(),
      });

      act(() => result.current.openCreate());
      act(() => {
        result.current.setValue('amount', 0);
        result.current.setValue('frequency', 'MONTHLY');
        result.current.setValue('amountMode', 'byMonth');
      });

      // monthAmounts should remain empty since amount is 0
      expect(result.current.monthAmounts).toEqual({});
    });
  });

  describe('submit behavior', () => {
    // Every edit applies going forward: onSubmit calls update.mutate with the
    // full body. There is no cascade/archive dialog — the API updates the record
    // in place and regenerates future occurrences; past transactions are untouched.
    it('a name change updates in place going forward', () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useIncomeForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(baseRecord));
      act(() => {
        result.current.onSubmit({
          name: 'New Paycheck Name',
          amount: baseRecord.amount,
          frequency: baseRecord.frequency,
          accountId: baseRecord.accountId ?? '',
          amountMode: 'uniform',
          startDate: '2026-01-01',
          endDate: '',
          note: 'Primary income',
          managementUrl: 'https://employer.com',
        });
      });

      expect(opts.update.mutate).toHaveBeenCalledWith(
        { id: 'inc-1', body: expect.objectContaining({ name: 'New Paycheck Name' }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('an amount change updates in place going forward', () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useIncomeForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(baseRecord));
      act(() => {
        result.current.onSubmit({
          name: baseRecord.name,
          amount: 6000,
          frequency: baseRecord.frequency,
          accountId: baseRecord.accountId ?? '',
          amountMode: 'uniform',
          startDate: '2026-01-01',
          endDate: '',
          note: 'Primary income',
          managementUrl: 'https://employer.com',
        });
      });

      expect(opts.update.mutate).toHaveBeenCalledWith(
        { id: 'inc-1', body: expect.objectContaining({ amount: 6000 }) },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('an amountSchedule change updates in place going forward', () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useIncomeForm(opts), { wrapper: createWrapper() });
      act(() => result.current.openEdit(baseRecord));
      act(() => {
        result.current.setMonthAmounts({ '1': 4000, '2': 5000 });
        result.current.setValue('amountMode', 'byMonth');
      });
      act(() => {
        result.current.onSubmit({
          name: baseRecord.name,
          amount: baseRecord.amount,
          frequency: baseRecord.frequency,
          accountId: baseRecord.accountId ?? '',
          amountMode: 'byMonth',
          startDate: '2026-01-01',
          endDate: '',
          note: 'Primary income',
          managementUrl: 'https://employer.com',
        });
      });

      expect(opts.update.mutate).toHaveBeenCalledWith(
        {
          id: 'inc-1',
          body: expect.objectContaining({ amountSchedule: { '1': 4000, '2': 5000 } }),
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });

    it('calls create.mutate for new records', () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useIncomeForm(opts), {
        wrapper: createWrapper(),
      });

      act(() => result.current.openCreate());

      act(() => {
        result.current.onSubmit({
          name: 'Side Gig',
          amount: 1000,
          frequency: 'MONTHLY',
          accountId: 'acc-1',
          amountMode: 'uniform',
          startDate: '2026-06-01',
          endDate: '',
          note: '',
          managementUrl: '',
        });
      });

      expect(opts.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Side Gig',
          amount: 1000,
          frequency: 'MONTHLY',
          budgetId: 'cat-income',
        }),
        expect.any(Object),
      );
    });

    it('uses first category id as budgetId when Income category not found', () => {
      const opts: UseIncomeFormOptions = {
        categories: [{ id: 'cat-misc', name: 'Misc' }],
        create: makeMutation(),
        update: makeUpdateMutation(),
      };
      const { result } = renderHook(() => useIncomeForm(opts), {
        wrapper: createWrapper(),
      });

      act(() => result.current.openCreate());

      act(() => {
        result.current.onSubmit({
          name: 'Freelance',
          amount: 2000,
          frequency: 'MONTHLY',
          accountId: '',
          amountMode: 'uniform',
          startDate: '',
          endDate: '',
          note: '',
          managementUrl: '',
        });
      });

      expect(opts.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ budgetId: 'cat-misc' }),
        expect.any(Object),
      );
    });

    it('includes amountSchedule as null when mode is uniform', () => {
      const opts = defaultOptions();
      const { result } = renderHook(() => useIncomeForm(opts), {
        wrapper: createWrapper(),
      });

      act(() => result.current.openCreate());

      act(() => {
        result.current.onSubmit({
          name: 'Salary',
          amount: 4000,
          frequency: 'MONTHLY',
          accountId: '',
          amountMode: 'uniform',
          startDate: '',
          endDate: '',
          note: '',
          managementUrl: '',
        });
      });

      expect(opts.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({ amountSchedule: null }),
        expect.any(Object),
      );
    });
  });
});
