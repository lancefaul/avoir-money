import { useState, useId } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateAccountSchema } from '@budget-tracker/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Select,
  CurrencyInput,
  Toggle,
  ButtonGroup,
  buttonStyles,
  inputStyles,
} from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import { api } from '../../lib/api.js';
import { formatCurrency } from '../../lib/utils.js';
import FieldError from '../../components/FieldError.js';
import * as dr from '../transactions/transaction-form.css.js';
import * as s from './accounts-page.css.js';

/** Minimal shape of the account being edited — structurally satisfied by the page's Account. */
export interface EditingAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  openingBalance: number;
  hasRewards: boolean;
  earnsInterest?: boolean;
  interestRate?: number;
  interestRateType?: string;
  brand?: string | null;
}

interface FormValues {
  name: string;
  type: string;
  balance: number;
  /**
   * Only used when editing. On create the Starting Balance field writes to
   * `balance`, which the API mirrors into openingBalance — there are no
   * transactions yet, so the two are the same number by definition.
   */
  openingBalance: number;
  hasRewards: boolean;
  earnsInterest: boolean;
  interestRate: number;
  interestRateType: string;
}

/**
 * The card designs the app ships. A catalogue the user picks from — NOT
 * something inferred from the account's name, which is what this replaced.
 *
 * Adding an entry means adding a layout in `AccountCard`; it says nothing about
 * who holds what.
 */
const BRAND_OPTIONS: SelectOption[] = [
  { value: '', label: 'None — use the default for this type' },
  { value: 'PRIME_VISA', label: 'Prime Visa' },
  { value: 'X_MONEY', label: 'X' },
  { value: 'CASH_APP', label: 'Cash Wallet' },
  { value: 'COMMUNITY_FIRST', label: 'Community First' },
  { value: 'FIDELITY', label: 'Fidelity' },
  { value: 'AMAZON_GIFT', label: 'Amazon gift card' },
  { value: 'APPLE_GIFT', label: 'Apple gift card' },
  { value: 'COSTCO_GIFT', label: 'Costco gift card' },
];

const ACCOUNT_TYPE_OPTIONS: SelectOption[] = [
  { value: 'Checking', label: 'Checking' },
  { value: 'Savings', label: 'Savings' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Gift Card', label: 'Gift Card' },
  { value: 'Cash', label: 'Cash' },
  { value: 'HSA', label: 'Health Savings Account (HSA)' },
];

const DEFAULT_VALUES: FormValues = {
  name: '',
  type: 'Checking',
  balance: 0,
  openingBalance: 0,
  hasRewards: false,
  earnsInterest: false,
  interestRate: 0,
  interestRateType: 'APY',
};

interface AccountFormModalProps {
  open: boolean;
  editing: EditingAccount | null;
  onClose: () => void;
}

export default function AccountFormModal({ open, editing, onClose }: AccountFormModalProps) {
  const fid = useId();
  const qc = useQueryClient();
  const [interestRateCents, setInterestRateCents] = useState(0);
  const [prevOpen, setPrevOpen] = useState(false);
  const [prevEditing, setPrevEditing] = useState<EditingAccount | null>(null);
  /*
   * Held outside the validated form values, like `interestRateCents`.
   * `CreateAccountSchema` types `brand` as an enum-or-null, and a Select's
   * "none" option is the empty string — putting it in the resolver's shape made
   * every submit fail validation SILENTLY: no error shown, no request sent.
   * Mapped to null at submit instead.
   */
  const [brand, setBrand] = useState('');

  const createAcct = useMutation({
    mutationFn: (body: unknown) => api.accounts.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
  const updateAcct = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => api.accounts.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(CreateAccountSchema),
    mode: 'onBlur',
    defaultValues: DEFAULT_VALUES,
  });

  // Populate the form when the modal opens or the edit target changes.
  if (open && (!prevOpen || editing !== prevEditing)) {
    setPrevOpen(true);
    setPrevEditing(editing);
    if (editing) {
      reset({
        name: editing.name,
        type: editing.type,
        balance: editing.balance,
        openingBalance: editing.openingBalance,
        hasRewards: editing.hasRewards,
        earnsInterest: editing.earnsInterest ?? false,
        interestRate: editing.interestRate ?? 0,
        interestRateType: editing.interestRateType ?? 'APY',
      });
      setInterestRateCents(Math.round((editing.interestRate ?? 0) * 100));
      setBrand(editing.brand ?? '');
    } else {
      reset(DEFAULT_VALUES);
      setInterestRateCents(0);
      setBrand('');
    }
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const watchType = watch('type');
  const watchBalance = watch('balance');
  const watchOpeningBalance = watch('openingBalance');
  const watchHasRewards = watch('hasRewards');
  const watchEarnsInterest = watch('earnsInterest');
  const watchInterestRateType = watch('interestRateType');

  /**
   * What saving will do to the current balance, or null when nothing moves.
   *
   * The ledger invariant is openingBalance + SUM(transactions) == balance. Editing
   * the opening does not touch any transaction, so the sum is fixed and the balance
   * has to absorb the whole delta. Showing it here is the point of the field: the
   * figure moves either way, and the only real choice is whether you see it first.
   */
  const openingShift = (() => {
    if (!editing) return null;
    const next = watchOpeningBalance ?? 0;
    const delta = Math.round((next - editing.openingBalance) * 100) / 100;
    if (Math.abs(delta) < 0.005) return null;
    return {
      from: editing.balance,
      to: Math.round((editing.balance + delta) * 100) / 100,
    };
  })();

  function close() {
    reset(DEFAULT_VALUES);
    onClose();
  }

  function onSubmit(values: FormValues) {
    const hasRewards = values.type === 'Credit Card' ? values.hasRewards : false;
    const interestEligible = ['Checking', 'Savings', 'HSA'].includes(values.type);
    const earnsInterest = interestEligible ? values.earnsInterest : false;
    const interestRate = earnsInterest ? values.interestRate : 0;
    const interestRateType = earnsInterest ? values.interestRateType : 'APY';
    if (editing) {
      const body = {
        name: values.name,
        type: values.type,
        // The API compares this against the stored opening and only recalculates
        // when it actually moved, so submitting it on every save is a no-op edit.
        openingBalance: values.openingBalance,
        hasRewards,
        earnsInterest,
        interestRate,
        interestRateType,
        brand: brand === '' ? null : brand,
      };
      updateAcct.mutate({ id: editing.id, body }, { onSuccess: close });
    } else {
      const body = {
        ...values,
        balance: Number(values.balance),
        hasRewards,
        earnsInterest,
        interestRate,
        interestRateType,
      };
      createAcct.mutate(body, { onSuccess: close });
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={editing ? 'Edit Account' : 'Add Account'}
      closeButton="none"
      footer={
        <div className={dr.transferRow}>
          <button
            type="button"
            onClick={handleSubmit(onSubmit)}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            {editing ? 'Save' : 'Add'}
          </button>
          <button
            type="button"
            onClick={close}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className={inputStyles.formStack}>
        {/* Name */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-name`} className={inputStyles.fieldLabel}>
            Name
          </label>
          <input
            id={`${fid}-name`}
            {...register('name')}
            className={`${inputStyles.input} ${errors.name ? inputStyles.inputError : ''}`}
          />
          <FieldError error={errors.name} />
        </div>

        {/* Type */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-type`} className={inputStyles.fieldLabel}>
            Type
          </label>
          <Select
            id={`${fid}-type`}
            options={ACCOUNT_TYPE_OPTIONS}
            value={watchType}
            onChange={(v) => setValue('type', v, { shouldValidate: true })}
            placeholder="Select type"
          />
          <FieldError error={errors.type} />
        </div>

        {/* Card art — optional, and the only way to get a branded face. It used
            to be inferred from the account name, which meant the app's list of
            designs was really a list of one person's accounts. */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-brand`} className={inputStyles.fieldLabel}>
            Card design
          </label>
          <Select
            id={`${fid}-brand`}
            options={BRAND_OPTIONS}
            value={brand}
            onChange={setBrand}
            placeholder="None"
          />
        </div>

        {/* Starting Balance — the pre-tracking figure. On create it seeds both
            balance and openingBalance; on edit it moves openingBalance, which
            shifts the current balance by the same amount. */}
        <div className={inputStyles.field}>
          <label htmlFor={`${fid}-starting-balance`} className={inputStyles.fieldLabel}>
            Starting Balance
          </label>
          <CurrencyInput
            id={`${fid}-starting-balance`}
            // A starting balance is signed. Debt is negative in this ledger, so
            // every credit card that carried a balance before tracking began has
            // a negative opening — the Prime Visa's is what the whole
            // openingBalance column exists for. Without this the input silently
            // clamped to zero, so the one account type that most needs the field
            // could not use it, and the sign was lost with no error shown.
            allowNegative
            value={Math.round((editing ? (watchOpeningBalance ?? 0) : (watchBalance ?? 0)) * 100)}
            onChange={(cents) =>
              setValue(editing ? 'openingBalance' : 'balance', cents / 100, {
                shouldValidate: true,
              })
            }
          />
          <FieldError error={editing ? errors.openingBalance : errors.balance} />
          {editing && (
            <p className={inputStyles.fieldHelper}>
              The balance this account carried before its first tracked transaction.
            </p>
          )}
          {openingShift !== null && (
            <div className={s.openingConsequence} role="status">
              <span>Current balance will change:</span>
              <span className={s.openingConsequenceValues}>
                {formatCurrency(openingShift.from)}
                <span className={s.openingConsequenceArrow}>→</span>
                {formatCurrency(openingShift.to)}
              </span>
            </div>
          )}
        </div>

        {/* Has Rewards toggle — only for Credit Card */}
        {watchType === 'Credit Card' && (
          <div className={inputStyles.field}>
            <label className={inputStyles.fieldLabel}>Rewards</label>
            <Toggle
              checked={watchHasRewards}
              onChange={(v) => setValue('hasRewards', v)}
              label="This card has rewards"
            />
          </div>
        )}

        {/* Interest section — only for Checking, Savings, HSA */}
        {['Checking', 'Savings', 'HSA'].includes(watchType) && (
          <>
            <div className={inputStyles.field}>
              <label className={inputStyles.fieldLabel}>Interest</label>
              <Toggle
                checked={watchEarnsInterest}
                onChange={(v) => setValue('earnsInterest', v)}
                label="This account earns interest"
              />
            </div>

            {watchEarnsInterest && (
              <>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-rate-type`} className={inputStyles.fieldLabel}>
                    Rate Type
                  </label>
                  <ButtonGroup
                    id={`${fid}-rate-type`}
                    size="sm"
                    options={[
                      { value: 'APY', label: 'APY' },
                      { value: 'APR', label: 'APR' },
                    ]}
                    value={watchInterestRateType}
                    onChange={(v) => setValue('interestRateType', v)}
                    ariaLabel="Interest rate type"
                  />
                </div>
                <div className={inputStyles.field}>
                  <label htmlFor={`${fid}-interest-rate`} className={inputStyles.fieldLabel}>
                    Interest Rate
                  </label>
                  <CurrencyInput
                    id={`${fid}-interest-rate`}
                    value={interestRateCents}
                    onChange={(v) => {
                      setInterestRateCents(v);
                      setValue('interestRate', v / 100);
                    }}
                    prefix=""
                    suffix="%"
                  />
                </div>
              </>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}
