import {
  type useForm,
  type UseFormRegister,
  type UseFormWatch,
  type UseFormSetValue,
  type FieldErrors,
} from 'react-hook-form';
import { type UseMutationResult } from '@tanstack/react-query';
import {
  type Transaction as CoreTransaction,
  type CreatePurchaseInput,
  type UpdatePurchasePaymentsInput,
} from '@budget-tracker/core';

/** One funding leg pre-loaded into the re-split editor. */
export interface ResplitLeg {
  accountId: string;
  amountCents: number;
}
import { type FormValues } from './transactionFormSchema.js';
import { type Account, type StockHolding, type Category } from './types.js';

export interface UseTransactionFormOptions {
  accounts: Account[];
  categories: Category[];
  stockHoldings: StockHolding[];
  pricesData: Record<string, number | null> | undefined;
  lastAccountId?: string;
  createTx: UseMutationResult<unknown, Error, unknown, unknown>;
  updateTx: UseMutationResult<unknown, Error, { id: string; body: unknown }, unknown>;
  deleteTx: UseMutationResult<unknown, Error, string, unknown>;
  /** Multi-account splits route here instead of createTx (payment-split, ADR-030). */
  createPurchase: UseMutationResult<unknown, Error, CreatePurchaseInput, unknown>;
  /** Re-splitting an existing group's payment legs (PUT /purchases/:id/payments). */
  updatePurchasePayments: UseMutationResult<
    unknown,
    Error,
    { groupId: string; body: UpdatePurchasePaymentsInput },
    unknown
  >;
  bitcoinTransferMutation: UseMutationResult<unknown, Error, unknown, unknown>;
  stockTransferMutation: UseMutationResult<unknown, Error, unknown, unknown>;
}

export interface UseTransactionFormReturn {
  // React Hook Form
  register: UseFormRegister<FormValues>;
  handleSubmit: ReturnType<typeof useForm<FormValues>>['handleSubmit'];
  watch: UseFormWatch<FormValues>;
  setValue: UseFormSetValue<FormValues>;
  errors: FieldErrors<FormValues>;

  // Form visibility state
  showForm: boolean;
  editing: CoreTransaction | null;

  // Watched values
  txType: FormValues['type'];
  watchAccountId: string | undefined;
  watchAssetType: FormValues['assetType'];
  watchBitcoinUnit: FormValues['bitcoinUnit'];
  watchPaymentMethod: FormValues['paymentMethod'];
  watchBtcQuantity: string | undefined;
  watchBtcUnitPrice: string | undefined;
  watchBtcUnit: FormValues['btcUnit'];
  watchTransferType: FormValues['transferType'];
  watchBtcTransferFee: string | undefined;
  watchBtcTransferFeeUnit: FormValues['btcTransferFeeUnit'];
  watchStockHoldingId: string | undefined;
  watchStockFeeAmount: string | undefined;
  watchBtcEntryMode: FormValues['btcEntryMode'];
  watchBtcUsdAmount: string | undefined;

  // Computed values
  btcUsdEquivalent: number | null;
  showPaymentToggle: boolean;
  isBitcoinPayment: boolean;
  isTransfer: boolean;
  isBtcTransfer: boolean;
  isStockTransfer: boolean;
  isUsdTransfer: boolean;
  hideAmountField: boolean;
  selectedStockHolding: StockHolding | undefined;
  selectedStockFromCustodianName: string;
  btcTransferFeeNum: number;
  stockFeeNum: number;
  selectedAccount: Account | undefined;

  // Multi-account funding (payment-split, ADR-030). `fundingMode` is the explicit
  // Single/Multiple toggle; `fundingAccountIds` the account selection; `legAmounts`
  // each account's typed portion (cents) in Multiple mode; `rewardsAmounts` the
  // rewards applied per card (funded from its hidden rewards account). In Multiple
  // mode the total is the sum of the legs plus rewards.
  fundingMode: 'single' | 'multiple';
  fundingAccountIds: string[];
  legAmounts: Record<string, number>;
  rewardsAmounts: Record<string, number>;
  isSplit: boolean;
  /** Why the create funding can't be submitted yet, or null when it's valid. */
  fundingError: string | null;
  /** Switch between Single and Multiple funding. */
  switchFundingMode: (mode: 'single' | 'multiple') => void;
  setFundingAccounts: (ids: string[]) => void;
  setLegAmount: (accountId: string, cents: number) => void;
  /** Set a card's rewards applied (cents), clamped to its rewards balance. */
  setRewardsAmount: (cardId: string, cents: number) => void;
  /** The rewards child account for a card, or undefined if it has none. */
  rewardsAccountFor: (cardId: string) => Account | undefined;
  /** Spendable cents for a finite account, or null for a credit card (no cap). */
  availableCents: (accountId: string) => number | null;

  // Re-split mode (editing an existing group's legs, total fixed).
  /** True while the drawer is editing a purchase group's payment split. */
  isResplit: boolean;
  /** The group's fixed total in cents — the legs must sum to it. */
  resplitTotalCents: number;
  /** Why the re-split can't be saved yet, or null when it's valid. */
  resplitError: string | null;

  // Trade error state
  tradeError: string;

  // Copy & Change state
  isCopyAndChange: boolean;

  // Actions
  openCreate: (defaultType?: FormValues['type']) => void;
  openEdit: (tx: CoreTransaction) => void;
  openDuplicate: (tx: CoreTransaction) => void;
  /** Open the drawer to re-split an existing group, pre-loaded with its legs. */
  openResplit: (anchor: CoreTransaction, legs: ResplitLeg[]) => void;
  closeForm: () => void;
  onSubmit: (values: FormValues) => void;
  /** Save the re-split (PUT the new legs); no-op if invalid. */
  submitResplit: () => void;
}
