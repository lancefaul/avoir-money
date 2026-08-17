import { z } from 'zod';
import { CustodyTypeSchema, StorageTypeSchema } from './enums.js';

export const WalletSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  managementUrl: z.string().url().nullable(),
  custodyType: CustodyTypeSchema,
  storageType: StorageTypeSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const BaseCreateWalletSchema = z.object({
  name: z.string().min(1).max(100),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  custodyType: CustodyTypeSchema.optional().default('NON_CUSTODIAL'),
  storageType: StorageTypeSchema.optional(),
});

export const CreateWalletSchema = BaseCreateWalletSchema.superRefine((data, ctx) => {
  if (data.custodyType === 'CUSTODIAL' && data.storageType === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'storageType is required for custodial wallets',
      path: ['storageType'],
    });
  }
  if (data.custodyType === 'NON_CUSTODIAL' && data.storageType !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'storageType must not be set for non-custodial wallets',
      path: ['storageType'],
    });
  }
});

const BaseUpdateWalletSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  managementUrl: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  custodyType: CustodyTypeSchema.optional(),
  storageType: StorageTypeSchema.optional(),
});

export const UpdateWalletSchema = BaseUpdateWalletSchema.superRefine((data, ctx) => {
  if (data.custodyType === undefined) return;

  if (data.custodyType === 'CUSTODIAL' && data.storageType === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'storageType is required for custodial wallets',
      path: ['storageType'],
    });
  }
  if (data.custodyType === 'NON_CUSTODIAL' && data.storageType !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'storageType must not be set for non-custodial wallets',
      path: ['storageType'],
    });
  }
});

// ─── Response Schemas ───

export const WalletResponseSchema = WalletSchema;
export const WalletListResponseSchema = z.array(WalletSchema);
