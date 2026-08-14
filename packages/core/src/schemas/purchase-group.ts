import { z } from 'zod';
import { sumCurrency } from '../utils/currency.js';

const MAX_AMOUNT = 999_999_999;

/** One funding leg: an account pays a portion of a purchase. */
export const PurchasePaymentSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().finite().positive().max(MAX_AMOUNT),
});
export type PurchasePayment = z.infer<typeof PurchasePaymentSchema>;

/**
 * Create a purchase paid from one or more accounts (payment-split, ADR-030).
 *
 * The payment legs must sum to `amount`. One payment is the ordinary
 * single-transaction path; two or more become a **purchase group** — a
 * balance-neutral Anchor carrying the budget, plus one balance-visible leg per
 * account. Redeeming rewards is itself a leg funded from the card's rewards
 * account (rewards-as-child-account), so there is no purchase-level rewards
 * figure — the old `rewardsApplied` discount was retired in that phase.
 *
 * The account never touches the budget: this shape carries a single `budgetId`
 * for the Anchor, and budget-split is layered on the Anchor afterwards via the
 * existing children route — never onto a payment leg.
 */
export const CreatePurchaseSchema = z
  .object({
    name: z.string().min(1).max(200),
    date: z.coerce.date(),
    /** Sticker total; the payment legs must sum to it. */
    amount: z.number().finite().nonnegative().max(MAX_AMOUNT),
    budgetId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    payments: z.array(PurchasePaymentSchema).min(1),
  })
  .superRefine((data, ctx) => {
    // The legs cover the full purchase amount.
    const paid = sumCurrency(data.payments.map((p) => p.amount));
    if (paid !== data.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `payment legs must sum to the amount ${data.amount.toFixed(2)} (got ${paid.toFixed(2)})`,
        path: ['payments'],
      });
    }
    // One leg per account: two legs on the same account is a single payment.
    const accountIds = data.payments.map((p) => p.accountId);
    if (new Set(accountIds).size !== accountIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'each account may fund a purchase only once — combine same-account legs into one',
        path: ['payments'],
      });
    }
  });

export type CreatePurchaseInput = z.infer<typeof CreatePurchaseSchema>;

/**
 * Replace the payment legs of an existing group. The Anchor — and therefore the
 * purchase's budget — is untouched, so re-splitting the payment never changes
 * what the purchase was for (Requirement 3.3). Still ≥ 2 legs: collapsing a
 * group to a single payment is a delete-then-create, not an edit. The legs must
 * sum to the Anchor's net amount, checked in the route against the stored Anchor.
 */
export const UpdatePurchasePaymentsSchema = z
  .object({
    payments: z.array(PurchasePaymentSchema).min(2),
  })
  .superRefine((data, ctx) => {
    const accountIds = data.payments.map((p) => p.accountId);
    if (new Set(accountIds).size !== accountIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'each account may fund a purchase only once — combine same-account legs into one',
        path: ['payments'],
      });
    }
  });
export type UpdatePurchasePaymentsInput = z.infer<typeof UpdatePurchasePaymentsSchema>;

/**
 * Result of creating a purchase. `purchaseGroupId` is null for the ordinary
 * single-account path; for a group it is the shared key, and `transactionIds`
 * is the Anchor followed by each leg.
 */
export const CreatePurchaseResultSchema = z.object({
  purchaseGroupId: z.string().nullable(),
  transactionIds: z.array(z.string()),
});
export type CreatePurchaseResult = z.infer<typeof CreatePurchaseResultSchema>;

/**
 * Whether this purchase should be written as a multi-account group (an Anchor
 * plus one leg per account) rather than the ordinary single transaction.
 */
export function isPurchaseGroup(input: { payments: readonly unknown[] }): boolean {
  return input.payments.length > 1;
}
