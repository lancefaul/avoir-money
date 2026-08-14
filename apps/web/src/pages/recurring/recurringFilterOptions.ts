import type { SelectOption } from '@budget-tracker/ui';
import type { Category, Account } from '../expenses/types.js';

/** Filter dropdown option lists for the Recurring page — extracted from Recurring.tsx. */
export function buildRecurringFilterOptions(
  categories: Category[],
  accounts: Account[],
  budgetSearch: string,
  accountSearch: string,
) {
  const typeOptions: SelectOption[] = [
    { value: 'expense', label: 'Expense' },
    { value: 'income', label: 'Income' },
  ];
  const budgetOptions: SelectOption[] = categories.map((c) => ({
    value: c.id,
    label: `${c.icon ?? ''} ${c.name}`.trim(),
  }));
  const accountOptions: SelectOption[] = accounts.map((a) => ({ value: a.id, label: a.name }));

  const filteredBudgetOptions = budgetSearch
    ? budgetOptions.filter((o) => o.label.toLowerCase().includes(budgetSearch.toLowerCase()))
    : budgetOptions;
  const filteredAccountOptions = accountSearch
    ? accountOptions.filter((o) => o.label.toLowerCase().includes(accountSearch.toLowerCase()))
    : accountOptions;
  return {
    typeOptions,
    budgetOptions,
    accountOptions,
    filteredBudgetOptions,
    filteredAccountOptions,
  };
}
