import { z } from 'zod';

export const HistoryEntrySchema = z.object({
  id: z.string(),
  entryType: z.enum(['TRADE', 'TRANSFER', 'PAYMENT']),
  date: z.coerce.date(),
  description: z.string(),
  assetType: z.enum(['STOCK', 'BITCOIN']),
  ticker: z.string().nullable(),
  quantity: z.number(),
  direction: z.enum(['BUY', 'SELL']).nullable(),
  fromName: z.string().nullable(),
  toName: z.string().nullable(),
  /** Where the entry happened: account name for trades, wallet name for payments.
   *  Null for transfers — they carry fromName/toName instead. */
  custodianName: z.string().nullable().optional(),
  amount: z.number().nullable(),
  costBasisAllocated: z.number().nullable().optional(),
  feeAmount: z.number().nullable(),
  incomeType: z.enum(['Payment', 'Rewards']).nullable().optional(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryResponseSchema = z.object({
  entries: z.array(HistoryEntrySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

export const HistoryQuerySchema = z.object({
  type: z.enum(['TRADE', 'TRANSFER', 'PAYMENT']).optional(),
  assetType: z.enum(['STOCK', 'BITCOIN']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
