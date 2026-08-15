import { z } from 'zod';
import { InvestmentTypeSchema } from './enums.js';

// Types that require a custodian (vs a wallet for BITCOIN)
const CUSTODIAN_TYPES = ['STOCK'] as const;

// ─── Investment Holding ───

export const InvestmentHoldingSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  ticker: z.string().max(20).nullable(),
  type: InvestmentTypeSchema,
  quantity: z.number().nonnegative(),
  costBasis: z.number().nonnegative().nullable(),
  custodianId: z.string().nullable(),
  walletId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateInvestmentHoldingSchema = z
  .object({
    name: z.string().min(1).max(200),
    ticker: z.string().max(20).optional(),
    type: InvestmentTypeSchema,
    quantity: z.number().nonnegative(),
    costBasis: z.number().nonnegative().optional(),
    custodianId: z.string().optional(),
    walletId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const isCustodianType = (CUSTODIAN_TYPES as readonly string[]).includes(data.type);
    if (isCustodianType) {
      if (!data.custodianId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'custodianId is required for stock holdings',
          path: ['custodianId'],
        });
      }
      if (data.walletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'walletId must not be set for stock holdings',
          path: ['walletId'],
        });
      }
    } else if (data.type === 'BITCOIN') {
      if (!data.walletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'walletId is required for bitcoin holdings',
          path: ['walletId'],
        });
      }
      if (data.custodianId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'custodianId must not be set for bitcoin holdings',
          path: ['custodianId'],
        });
      }
    }
  });

export const UpdateInvestmentHoldingSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    ticker: z.string().max(20).optional(),
    type: InvestmentTypeSchema.optional(),
    quantity: z.number().nonnegative().optional(),
    costBasis: z.number().nonnegative().optional(),
    custodianId: z.string().optional(),
    walletId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Only validate type-FK pairing when type is present alongside FK fields
    if (data.type) {
      const isCustodianType = (CUSTODIAN_TYPES as readonly string[]).includes(data.type);
      if (isCustodianType) {
        if (data.walletId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'walletId must not be set for stock holdings',
            path: ['walletId'],
          });
        }
      } else if (data.type === 'BITCOIN') {
        if (data.custodianId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'custodianId must not be set for bitcoin holdings',
            path: ['custodianId'],
          });
        }
      }
    }
  });

// ─── Investment Snapshot ───

export const InvestmentSnapshotSchema = z.object({
  id: z.string(),
  holdingId: z.string(),
  date: z.coerce.date(),
  quantity: z.number().nonnegative(),
  value: z.number().nonnegative().nullable(),
  createdAt: z.coerce.date(),
});

export const CreateInvestmentSnapshotSchema = z.object({
  date: z.coerce.date(),
  quantity: z.number().nonnegative(),
  value: z.number().nonnegative().optional(),
});

// ─── Holding with latest snapshot (for list endpoint) ───

export const InvestmentHoldingWithSnapshotSchema = InvestmentHoldingSchema.extend({
  custodianName: z.string().nullable(),
  walletName: z.string().nullable(),
  latestSnapshot: InvestmentSnapshotSchema.nullable(),
});

// ─── Response Schemas ───

export const InvestmentHoldingResponseSchema = InvestmentHoldingSchema;
export const InvestmentHoldingListResponseSchema = z.array(InvestmentHoldingWithSnapshotSchema);
export const InvestmentSnapshotResponseSchema = InvestmentSnapshotSchema;

/**
 * Live prices, plus what could not be priced.
 *
 * `stale` exists so the UI can say a figure is not live rather than implying it
 * is. The value shown for a stale holding comes from its last snapshot, which
 * keeps portfolio totals meaningful — dropping unpriced stocks to zero would
 * change what the headline number means depending on whether a key is set.
 */
export const PriceResponseSchema = z.object({
  prices: z.record(z.string(), z.number().nullable()),
  stale: z.array(z.string()),
  stocksEnabled: z.boolean(),
  /**
   * Why the stale ones are stale, grouped by service and reason.
   *
   * `stale` says WHICH symbols have no live price, which is enough to avoid
   * implying a stale figure is current — and not enough to act on. A refused
   * key and a rate limit produce an identical list, and only one of them is the
   * user's to fix. That gap is what turned a doubled API key into an hour of
   * "No live price for TCKB, TCKR.WS, TCKC" while the backend held a 401.
   *
   * `.default([])` rather than `.optional()`: a consumer that forgets to check
   * gets an empty list and renders nothing, instead of a `TypeError` on a
   * response from a backend that predates this field.
   */
  problems: z
    .array(
      z.object({
        /** Which key to go and fix. */
        service: z.enum(['finnhub', 'coingecko']),
        reason: z.enum(['rejected', 'rate-limited', 'unavailable', 'no-quote']),
        symbols: z.array(z.string()),
      }),
    )
    .default([]),
});
export type PriceResponse = z.infer<typeof PriceResponseSchema>;
