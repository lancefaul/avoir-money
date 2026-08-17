import { z } from 'zod';
import { AccountTypeSchema } from './enums.js';

export const InterestRateTypeSchema = z.enum(['APY', 'APR']);

/**
 * The card ART an account can render with.
 *
 * A catalogue the user picks from, NOT something inferred from the account
 * name. The layouts used to be selected by matching the name —
 * `name.includes('amazon')` and seven more — which made this list a list of one
 * person's accounts rather than a set of supported designs.
 *
 * Adding a design means adding a value here and a layout in the web app; it
 * does not mean anyone holds that account.
 */
export const AccountBrandSchema = z.enum([
  'PRIME_VISA',
  'X_MONEY',
  'CASH_APP',
  'COMMUNITY_FIRST',
  'FIDELITY',
  'AMAZON_GIFT',
  'APPLE_GIFT',
  'COSTCO_GIFT',
]);

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  type: AccountTypeSchema,
  balance: z.number(),
  /** Balance carried before the first tracked transaction (the "Starting Balance"). */
  openingBalance: z.number(),
  archived: z.boolean(),
  hasRewards: z.boolean(),
  /** Set on a rewards account: the id of its parent card. Null on ordinary accounts. */
  parentAccountId: z.string().nullable(),
  earnsInterest: z.boolean(),
  interestRate: z.number().min(0).max(100),
  interestRateType: InterestRateTypeSchema,
  /** Card art, or null for the generic layout for this account's type. */
  brand: AccountBrandSchema.nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateAccountSchema = z.object({
  name: z.string().min(1).max(100),
  type: AccountTypeSchema,
  /** On create this is the "Starting Balance"; it seeds `openingBalance` too. */
  balance: z.number().default(0),
  openingBalance: z.number().optional(),
  hasRewards: z.boolean().optional(),
  earnsInterest: z.boolean().optional(),
  interestRate: z.number().min(0).max(100).optional(),
  interestRateType: InterestRateTypeSchema.optional(),
  brand: AccountBrandSchema.nullable().optional(),
});

export const UpdateAccountSchema = CreateAccountSchema.partial();

/**
 * Body for creating a Rewards account nested under a card
 * (`POST /accounts/:id/rewards-account`). A rewards account is an ordinary
 * ledger account (type "Rewards") whose `parentAccountId` is the card it belongs
 * to — earning is an INCOME row on it, redeeming is a payment leg funded from it.
 */
export const CreateRewardsAccountSchema = z.object({
  /** Defaults to `${parent.name} Rewards` when omitted. */
  name: z.string().min(1).max(100).optional(),
  /** Starting rewards balance to carry forward; seeds both openingBalance and balance. */
  openingBalance: z.number().nonnegative().optional(),
});

// ─── Response Schemas ───

export const AccountResponseSchema = AccountSchema;
export const AccountListResponseSchema = z.array(AccountSchema);
