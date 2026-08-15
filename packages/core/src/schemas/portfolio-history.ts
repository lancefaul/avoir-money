import { z } from 'zod';

export const PortfolioHistoryEntrySchema = z.object({
  date: z.coerce.date(),
  totalValue: z.number(),
});

export type PortfolioHistoryEntry = z.infer<typeof PortfolioHistoryEntrySchema>;

export const PortfolioHistoryResponseSchema = z.object({
  entries: z.array(PortfolioHistoryEntrySchema),
});

export type PortfolioHistoryResponse = z.infer<typeof PortfolioHistoryResponseSchema>;

export const PortfolioHistoryQuerySchema = z.object({
  period: z.enum(['1W', '1M', '3M', '6M', '1Y', 'ALL']).default('ALL'),
});

export type PortfolioHistoryQuery = z.infer<typeof PortfolioHistoryQuerySchema>;
