import { describe, it, expect } from 'vitest';
import { CreateExpenseSchema, UpdateExpenseSchema } from './expense.js';
import { CreateIncomeSchema, UpdateIncomeSchema } from './income.js';

describe('Ongoing date handling — empty string endDate', () => {
  const baseExpense = {
    name: 'Rent',
    amount: 1200,
    frequency: 'MONTHLY',
    budgetId: 'cat-1',
    isAutomatic: false,
  };

  const baseIncome = {
    name: 'Salary',
    amount: 5000,
    frequency: 'BIWEEKLY',
    budgetId: 'cat-1',
  };

  describe('CreateExpenseSchema', () => {
    it('accepts missing endDate (ongoing)', () => {
      const result = CreateExpenseSchema.safeParse(baseExpense);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });

    it('accepts empty string endDate as undefined (ongoing)', () => {
      const result = CreateExpenseSchema.safeParse({ ...baseExpense, endDate: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });

    it('accepts null endDate as null (explicit clear for updates)', () => {
      const result = CreateExpenseSchema.safeParse({ ...baseExpense, endDate: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeNull();
    });

    it('accepts valid date string endDate', () => {
      const result = CreateExpenseSchema.safeParse({ ...baseExpense, endDate: '2027-12-31' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeInstanceOf(Date);
    });

    it('accepts empty string startDate as undefined', () => {
      const result = CreateExpenseSchema.safeParse({ ...baseExpense, startDate: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.startDate).toBeUndefined();
    });
  });

  describe('UpdateExpenseSchema', () => {
    it('accepts empty string endDate as undefined', () => {
      const result = UpdateExpenseSchema.safeParse({ endDate: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });

    it('accepts valid date endDate', () => {
      const result = UpdateExpenseSchema.safeParse({ endDate: '2027-06-15' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeInstanceOf(Date);
    });
  });

  describe('CreateIncomeSchema', () => {
    it('accepts missing endDate (ongoing)', () => {
      const result = CreateIncomeSchema.safeParse(baseIncome);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });

    it('accepts empty string endDate as undefined (ongoing)', () => {
      const result = CreateIncomeSchema.safeParse({ ...baseIncome, endDate: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });

    it('accepts null endDate as null (explicit clear for updates)', () => {
      const result = CreateIncomeSchema.safeParse({ ...baseIncome, endDate: null });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeNull();
    });

    it('accepts valid date string endDate', () => {
      const result = CreateIncomeSchema.safeParse({ ...baseIncome, endDate: '2027-12-31' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeInstanceOf(Date);
    });
  });

  describe('UpdateIncomeSchema', () => {
    it('accepts empty string endDate as undefined', () => {
      const result = UpdateIncomeSchema.safeParse({ endDate: '' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.endDate).toBeUndefined();
    });
  });
});
