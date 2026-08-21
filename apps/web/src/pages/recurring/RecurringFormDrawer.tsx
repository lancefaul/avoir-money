import { Modal, ButtonGroup, buttonStyles, inputStyles } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import type { Category, Account } from '../expenses/types.js';
import type { DebtRecord } from '../../hooks/useApi.js';
import type { UseExpenseFormReturn } from '../expenses/useExpenseForm.js';
import type { UseIncomeFormReturn } from '../income/useIncomeForm.js';
import ExpenseForm from '../expenses/ExpenseForm.js';
import IncomeForm from '../income/IncomeForm.js';

interface RecurringFormDrawerProps {
  open: boolean;
  onClose: () => void;
  newRecurringType: 'expense' | 'income';
  setNewRecurringType: (t: 'expense' | 'income') => void;
  expenseForm: UseExpenseFormReturn;
  incomeForm: UseIncomeFormReturn;
  categories: Category[];
  accounts: Account[];
  debts: DebtRecord[];
  expensePending: boolean;
  incomePending: boolean;
}

/** Single create/edit drawer for recurring expenses and income — extracted from Recurring.tsx. */
export default function RecurringFormDrawer({
  open,
  onClose,
  newRecurringType,
  setNewRecurringType,
  expenseForm,
  incomeForm,
  categories,
  accounts,
  debts,
  expensePending,
  incomePending,
}: RecurringFormDrawerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        expenseForm.editing ? 'Edit Expense' : incomeForm.editing ? 'Edit Income' : 'Add Recurring'
      }
      variant="drawer"
      closeButton="none"
      footer={
        <>
          <button
            type="submit"
            form={newRecurringType === 'expense' ? 'expense-drawer-form' : 'income-drawer-form'}
            disabled={expensePending || incomePending}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {expenseForm.editing || incomeForm.editing ? 'Save' : 'Add'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </>
      }
    >
      {!expenseForm.editing && !incomeForm.editing && (
        <div className={inputStyles.formStack} style={{ marginBottom: vars.space['6'] }}>
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Type</label>
            <ButtonGroup
              options={[
                { value: 'expense', label: 'Expense' },
                { value: 'income', label: 'Income' },
              ]}
              value={newRecurringType}
              onChange={(v) => {
                const t = v as 'expense' | 'income';
                setNewRecurringType(t);
                if (t === 'expense') {
                  incomeForm.closeForm();
                  expenseForm.openCreate();
                } else {
                  expenseForm.closeForm();
                  incomeForm.openCreate();
                }
              }}
            />
          </div>
        </div>
      )}
      {newRecurringType === 'expense' && (
        <ExpenseForm
          form={expenseForm}
          categories={categories}
          accounts={accounts}
          debts={debts}
          isPending={expensePending}
          bare
        />
      )}
      {newRecurringType === 'income' && (
        <IncomeForm form={incomeForm} accounts={accounts} isPending={incomePending} bare />
      )}
    </Modal>
  );
}
