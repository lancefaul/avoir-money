import { z } from 'zod';

export const CustodianSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  managementUrl: z.string().url().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateCustodianSchema = z.object({
  name: z.string().min(1).max(100),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

export const UpdateCustodianSchema = CreateCustodianSchema.partial();

// ─── Response Schemas ───

export const CustodianResponseSchema = CustodianSchema;
export const CustodianListResponseSchema = z.array(CustodianSchema);
