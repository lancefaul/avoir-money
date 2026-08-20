import { Sensitive } from '@budget-tracker/ui';
import { useId, Fragment } from 'react';
import { Info } from 'lucide-react';
import {
  ButtonGroup,
  Select,
  type SelectOption,
  CurrencyInput,
  inputStyles,
} from '@budget-tracker/ui';
import type { UseTransactionFormReturn } from './useTransactionForm.js';
import type { Account } from './types.js';
import { formatCurrency } from '../../lib/utils.js';
import * as dr from './transaction-form.css.js';

interface FundingFieldsProps {
  form: UseTransactionFormReturn;
  accountOptions: SelectOption[];
  accounts: Account[];
  /**
   * 'create' shows the Single/Multiple toggle and (in Single mode) the Amount
   * field. 'resplit' edits an existing group's legs against a fixed total (no
   * toggle, no Amount — the total is shown in the drawer header).
   */
  variant?: 'create' | 'resplit';
}

const MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'multiple', label: 'Multiple' },
];

/**
 * The funding block on the transaction drawer (payment-split, ADR-030).
 *
 * Single mode: one account pays the Amount. Multiple mode: pick several accounts
 * and type each account's portion — the total is their sum. A rewards-enabled
 * credit card also shows an optional "Rewards Points Used" field, funded from the
 * card's hidden rewards account.
 *
 * A finite account (anything but a credit card) can't be overdrawn — its amount is
 * clamped to the balance and an "Available" hint shows the cap. DS components only.
 */
export default function FundingFields({
  form,
  accountOptions,
  accounts,
  variant = 'create',
}: FundingFieldsProps) {
  const fid = useId();
  const {
    watch,
    setValue,
    errors,
    fundingMode,
    fundingAccountIds,
    legAmounts,
    rewardsAmounts,
    switchFundingMode,
    setFundingAccounts,
    setLegAmount,
    setRewardsAmount,
    rewardsAccountFor,
    availableCents,
  } = form;

  const isResplit = variant === 'resplit';
  const isMulti = isResplit || fundingMode === 'multiple';

  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const availableHint = (id: string): string | null => {
    const cap = availableCents(id);
    return cap == null ? null : `Available: ${formatCurrency(cap / 100)}`;
  };

  const amountStr = watch('amount');
  const amountCents = amountStr ? Math.round(parseFloat(amountStr) * 100) || 0 : 0;
  const singleId = fundingAccountIds[0] ?? '';

  // Optional rewards field for a card that has a rewards account (ADR-030). The
  // rewards account itself is never shown or picked — it rides with the card.
  const rewardsField = (cardId: string) => {
    const rw = rewardsAccountFor(cardId);
    if (!rw) return null;
    const balCents = Math.max(0, Math.round((rw.balance ?? 0) * 100));
    return (
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-rw-${cardId}`} className={inputStyles.fieldLabel}>
          Rewards Points Used
        </label>
        <CurrencyInput
          id={`${fid}-rw-${cardId}`}
          value={rewardsAmounts[cardId] ?? 0}
          onChange={(cents) => setRewardsAmount(cardId, cents)}
          placeholder="0.00"
        />
        <span className={dr.helperText}>
          Available: <Sensitive label="amount">{formatCurrency(balCents / 100)}</Sensitive>
        </span>
      </div>
    );
  };

  return (
    <>
      {/* Single / Multiple toggle — create flow only */}
      {!isResplit && (
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-mode`} className={inputStyles.fieldLabel}>
            Number of Payment Methods
          </label>
          <ButtonGroup
            id={`${fid}-mode`}
            options={MODE_OPTIONS}
            value={fundingMode}
            onChange={(v) => switchFundingMode(v as 'single' | 'multiple')}
            ariaLabel="Number of payment methods"
          />
        </div>
      )}

      {/* Account selector — single Select or multi-select */}
      <div className={inputStyles.field}>
        <label htmlFor={`${fid}-accounts`} className={inputStyles.fieldLabel}>
          {isMulti ? 'Payment Methods (Accounts)' : 'Payment Method (Account)'}{' '}
          <span className={inputStyles.fieldRequired}>*</span>
        </label>
        {isMulti ? (
          <Select
            id={`${fid}-accounts`}
            multi
            chipSize="lg"
            searchable
            options={accountOptions}
            value={fundingAccountIds}
            onChange={setFundingAccounts}
            placeholder="Select accounts…"
            error={!!errors.accountId}
          />
        ) : (
          <Select
            id={`${fid}-accounts`}
            searchable
            options={accountOptions}
            value={singleId}
            onChange={(v) => setFundingAccounts([v])}
            placeholder="Select account…"
            error={!!errors.accountId}
          />
        )}
        {errors.accountId?.message && !isMulti && (
          <div className={inputStyles.fieldError}>
            <Info size={12} /> {errors.accountId.message}
          </div>
        )}
      </div>

      {/* Amount — Single mode only. Multiple mode's total is the sum of the legs;
          re-split's total is fixed and shown in the drawer header. */}
      {!isMulti && (
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-amount`} className={inputStyles.fieldLabel}>
            Amount <span className={inputStyles.fieldRequired}>*</span>
          </label>
          <CurrencyInput
            id={`${fid}-amount`}
            value={amountCents}
            onChange={(cents) => {
              const cap = singleId ? availableCents(singleId) : null;
              const clamped = cap == null ? cents : Math.min(cents, cap);
              setValue('amount', (clamped / 100).toFixed(2));
            }}
            placeholder="0.00"
          />
          {errors.amount?.message && (
            <div className={inputStyles.fieldError}>
              <Info size={12} /> {errors.amount.message}
            </div>
          )}
          {singleId && availableHint(singleId) && (
            <span className={dr.helperText}>{availableHint(singleId)}</span>
          )}
        </div>
      )}

      {/* Single mode: optional rewards for a rewards-enabled card */}
      {!isMulti && singleId && rewardsField(singleId)}

      {/* Multiple mode (and re-split): one amount field per account, typed, labelled
          by account. The total is their sum. A rewards card also shows its optional
          rewards field. */}
      {isMulti &&
        fundingAccountIds.map((id) => (
          <Fragment key={id}>
            <div className={inputStyles.field}>
              <label htmlFor={`${fid}-amt-${id}`} className={inputStyles.fieldLabel}>
                {nameById.get(id) ?? '—'}
              </label>
              <CurrencyInput
                id={`${fid}-amt-${id}`}
                value={legAmounts[id] ?? 0}
                onChange={(cents) => setLegAmount(id, cents)}
                placeholder="0.00"
              />
              {availableHint(id) && <span className={dr.helperText}>{availableHint(id)}</span>}
            </div>
            {rewardsField(id)}
          </Fragment>
        ))}
    </>
  );
}
