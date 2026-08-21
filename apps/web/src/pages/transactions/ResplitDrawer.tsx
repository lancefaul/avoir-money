import { Info } from 'lucide-react';
import { Modal, buttonStyles, inputStyles, type SelectOption } from '@budget-tracker/ui';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { Account } from './types.js';
import FundingFields from './FundingFields.js';
import { formatCurrency } from '../../lib/utils.js';

interface ResplitDrawerProps {
  form: UseTransactionFormReturn;
  accounts: Account[];
  isPending: boolean;
}

/**
 * Drawer for re-splitting an existing purchase group's payment legs
 * (payment-split, ADR-030). The endpoint replaces only the legs and leaves the
 * Anchor's budget untouched, so the total is fixed: this reuses the create
 * funding editor (FundingFields) but validates the legs against the fixed total
 * instead of letting them define it. Budget/name/date aren't editable here.
 */
export default function ResplitDrawer({ form, accounts, isPending }: ResplitDrawerProps) {
  const { watch, fundingAccountIds, resplitTotalCents, resplitError, submitResplit, closeForm } =
    form;

  const accountOptions: SelectOption[] = accounts.reduce<SelectOption[]>((acc, a) => {
    // Non-archived accounts are selectable. An archived account that is already a
    // leg of this split is included too (labelled) so its chip shows a name
    // rather than a raw id — a group can legitimately have been split across an
    // account that was later archived.
    // Non-archived accounts are selectable. An archived account that is already a
    // leg of this split is included too (labelled) so its chip shows a name
    // rather than a raw id — a group can legitimately have been split across an
    // account that was later archived.
    if (!a.archived || fundingAccountIds.includes(a.id)) {
      acc.push({ value: a.id, label: a.archived ? `${a.name} (archived)` : a.name });
    }
    return acc;
  }, []);

  const name = watch('name');
  const total = formatCurrency(resplitTotalCents / 100);

  const footer = (
    <>
      <button
        type="submit"
        form="resplit-form"
        disabled={isPending || !!resplitError}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
      >
        Save split · {total}
      </button>
      <button
        type="button"
        onClick={closeForm}
        className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
      >
        Cancel
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={closeForm}
      title="Edit payment split"
      variant="drawer"
      closeButton="none"
      footer={footer}
    >
      <form
        id="resplit-form"
        onSubmit={(e) => {
          e.preventDefault();
          submitResplit();
        }}
      >
        <div className={inputStyles.formStack}>
          <p className={inputStyles.fieldHelper}>
            {name} — total {total}. Change how it's funded; the legs must still sum to {total}. The
            budget is unchanged.
          </p>
          <FundingFields
            form={form}
            accountOptions={accountOptions}
            accounts={accounts}
            variant="resplit"
          />
          {resplitError && (
            <div className={inputStyles.fieldError}>
              <Info size={12} /> {resplitError}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
