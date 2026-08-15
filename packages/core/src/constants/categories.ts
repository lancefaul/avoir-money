import type { CategoryGroup } from '../types/index.js';

type CategorySeed = {
  name: string;
  group: CategoryGroup;
  color: string;
  icon: string;
};

/**
 * Default category seeds — matches the spreadsheet's expense/income structure.
 * These are inserted once at DB seed time; users can then add custom categories.
 */
export const DEFAULT_CATEGORIES: CategorySeed[] = [
  // ─── Income ───
  { name: 'Paycheck', group: 'INCOME', color: '#22c55e', icon: 'banknote' },
  { name: 'ESPP', group: 'INCOME', color: '#16a34a', icon: 'trending-up' },
  { name: 'Tax Return', group: 'INCOME', color: '#15803d', icon: 'receipt' },
  { name: 'Bonus', group: 'INCOME', color: '#166534', icon: 'gift' },
  { name: 'Side Income', group: 'INCOME', color: '#14532d', icon: 'briefcase' },

  // ─── Housing ───
  { name: 'Mortgage', group: 'HOUSING', color: '#3b82f6', icon: 'home' },
  { name: 'Tuition', group: 'HOUSING', color: '#2563eb', icon: 'graduation-cap' },
  { name: 'Gym', group: 'HOUSING', color: '#1d4ed8', icon: 'dumbbell' },

  // ─── Transportation ───
  { name: 'Car Payment', group: 'TRANSPORTATION', color: '#8b5cf6', icon: 'car' },
  { name: 'Car Insurance', group: 'TRANSPORTATION', color: '#7c3aed', icon: 'shield' },
  { name: 'Gas / Fuel', group: 'TRANSPORTATION', color: '#6d28d9', icon: 'fuel' },

  // ─── Insurance ───
  { name: 'Life Insurance', group: 'INSURANCE', color: '#06b6d4', icon: 'heart-pulse' },
  { name: 'Home Insurance', group: 'INSURANCE', color: '#0891b2', icon: 'shield-check' },

  // ─── Utilities ───
  { name: 'Electric', group: 'UTILITIES', color: '#f59e0b', icon: 'zap' },
  { name: 'Gas Utility', group: 'UTILITIES', color: '#d97706', icon: 'flame' },
  { name: 'Water', group: 'UTILITIES', color: '#b45309', icon: 'droplets' },
  { name: 'Internet', group: 'UTILITIES', color: '#92400e', icon: 'wifi' },
  { name: 'Phone', group: 'UTILITIES', color: '#78350f', icon: 'phone' },
  { name: 'Pest Control', group: 'UTILITIES', color: '#451a03', icon: 'bug' },

  // ─── Healthcare ───
  { name: 'Medical Premium', group: 'HEALTHCARE', color: '#ef4444', icon: 'heart' },
  { name: 'Dental Premium', group: 'HEALTHCARE', color: '#dc2626', icon: 'smile' },
  { name: 'Vision Premium', group: 'HEALTHCARE', color: '#b91c1c', icon: 'eye' },
  { name: 'Medical Expense', group: 'HEALTHCARE', color: '#991b1b', icon: 'stethoscope' },

  // ─── Investments ───
  { name: '401(k)', group: 'INVESTMENTS', color: '#10b981', icon: 'piggy-bank' },
  { name: 'Bitcoin (BTC)', group: 'INVESTMENTS', color: '#059669', icon: 'bitcoin' },
  { name: 'Stocks', group: 'INVESTMENTS', color: '#047857', icon: 'chart-line' },

  // ─── Debt ───
  { name: 'Credit Card Payment', group: 'DEBT', color: '#f97316', icon: 'credit-card' },
  { name: 'Student Loan', group: 'DEBT', color: '#ea580c', icon: 'graduation-cap' },

  // ─── Discretionary ───
  { name: 'Groceries', group: 'DISCRETIONARY', color: '#84cc16', icon: 'shopping-cart' },
  { name: 'Dining / Takeout', group: 'DISCRETIONARY', color: '#65a30d', icon: 'utensils' },
  { name: 'Entertainment', group: 'DISCRETIONARY', color: '#4d7c0f', icon: 'tv' },
  { name: 'Clothing', group: 'DISCRETIONARY', color: '#3f6212', icon: 'shirt' },
  { name: 'Personal Care', group: 'DISCRETIONARY', color: '#365314', icon: 'sparkles' },
  { name: 'Amazon / Online', group: 'DISCRETIONARY', color: '#1a2e05', icon: 'package' },
  { name: 'Subscriptions', group: 'DISCRETIONARY', color: '#4ade80', icon: 'repeat' },

  // ─── Giving ───
  { name: 'Tithe', group: 'GIVING', color: '#e879f9', icon: 'church' },
  { name: 'Charitable Giving', group: 'GIVING', color: '#d946ef', icon: 'hand-heart' },

  // ─── Taxes ───
  { name: 'Federal Tax', group: 'TAXES', color: '#64748b', icon: 'landmark' },
  { name: 'State Tax', group: 'TAXES', color: '#475569', icon: 'landmark' },
];
