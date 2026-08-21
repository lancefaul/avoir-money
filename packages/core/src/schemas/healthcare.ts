import { z } from 'zod';

// ─── Policy Type Enum ───

export const PolicyTypeSchema = z.enum(['MEDICAL', 'DENTAL', 'VISION']);

// ─── Policy Status Enum ───

export const PolicyStatusSchema = z.enum(['ACTIVE', 'ENDED', 'CLOSED']);

// ─── Type-Discriminated Metadata Schemas ───

export const MedicalMetadataSchema = z.object({
  insurer: z.string().min(1).max(200),
  policyId: z.string().min(1).max(100),
  groupNumber: z.string().min(1).max(100),
  healthPlan: z.string().max(200).optional(),
  rxBin: z.string().max(50).optional(),
  rxPcn: z.string().max(50).optional(),
  managementUrl: z.string().url().max(500).or(z.literal('')).optional(),
});

export const DentalMetadataSchema = z.object({
  insurer: z.string().min(1).max(200),
  policyId: z.string().max(100).optional(),
  groupName: z.string().max(200).optional(),
  groupNumber: z.string().max(100).optional(),
  effectiveDate: z.string().max(20).optional(),
  managementUrl: z.string().url().max(500).or(z.literal('')).optional(),
});

export const VisionMetadataSchema = z.object({
  insurer: z.string().min(1).max(200),
  policyId: z.string().max(100).optional(),
  managementUrl: z.string().url().max(500).or(z.literal('')).optional(),
});

export const PolicyMetadataSchema = z.union([
  MedicalMetadataSchema.passthrough(),
  DentalMetadataSchema.passthrough(),
  VisionMetadataSchema.passthrough(),
  z.object({}).passthrough(),
]);

// ─── Insurance Policy (full response shape) ───

export const InsurancePolicySchema = z.object({
  id: z.string(),
  type: PolicyTypeSchema,
  year: z.number().int().min(2000).max(2100),
  employer: z.string(),
  premium: z.number().nonnegative(),
  deductibleLimit: z.number().nonnegative().nullable(),
  oopmLimit: z.number().nonnegative().nullable(),
  status: PolicyStatusSchema,
  endedOn: z.coerce.date().nullable(),
  closedOn: z.coerce.date().nullable(),
  deductibleOverride: z.boolean(),
  oopmOverride: z.boolean(),
  metadata: PolicyMetadataSchema,
  budgetId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ─── Create Policy Request ───

/** Base schema without refinements — used by @hono/zod-openapi route definitions */
export const CreateInsurancePolicyBaseSchema = z.object({
  type: z.enum(['MEDICAL', 'DENTAL', 'VISION']),
  year: z.number().int().min(2000).max(2100),
  employer: z.string().min(1).max(100),
  premium: z.number().nonnegative(),
  deductibleLimit: z.number().nonnegative().nullable().optional(),
  oopmLimit: z.number().nonnegative().nullable().optional(),
  metadata: PolicyMetadataSchema,
});

/** Full schema with cross-field refinements — used for standalone validation */
export const CreateInsurancePolicySchema = CreateInsurancePolicyBaseSchema.refine(
  (d) => {
    if (d.type === 'MEDICAL') {
      return d.deductibleLimit != null && d.oopmLimit != null;
    }
    return true;
  },
  {
    message: 'Medical policies require deductible and OOPM limits',
    path: ['deductibleLimit'],
  },
).refine(
  (d) => {
    if (d.deductibleLimit != null && d.oopmLimit != null) {
      return d.oopmLimit >= d.deductibleLimit;
    }
    return true;
  },
  {
    message: 'OOPM limit must be >= deductible limit',
    path: ['oopmLimit'],
  },
);

// ─── Update Policy Request (partial) ───

export const UpdateInsurancePolicySchema = z.object({
  employer: z.string().min(1).max(100).optional(),
  premium: z.number().nonnegative().optional(),
  deductibleLimit: z.number().nonnegative().nullable().optional(),
  oopmLimit: z.number().nonnegative().nullable().optional(),
  metadata: PolicyMetadataSchema.optional(),
});

// ─── Override Toggle Request ───

export const UpdateOverridesSchema = z.object({
  deductibleOverride: z.boolean().optional(),
  oopmOverride: z.boolean().optional(),
});

// ─── Balance Response ───

export const PolicyBalanceSchema = z.object({
  deductibleSpent: z.number().nullable(),
  deductibleRaw: z.number(),
  deductibleLimit: z.number().nullable(),
  oopmSpent: z.number().nullable(),
  oopmRaw: z.number(),
  oopmLimit: z.number().nullable(),
  deductibleOverride: z.boolean(),
  oopmOverride: z.boolean(),
});

// ─── Policy with Balance (frontend response) ───

export const InsurancePolicyWithBalanceSchema = InsurancePolicySchema.extend({
  balance: PolicyBalanceSchema,
});

// ─── Healthcare Transaction List Item ───

export const HealthcareTransactionSchema = z.object({
  id: z.string(),
  date: z.coerce.date(),
  name: z.string(),
  category: z.string(),
  categoryIcon: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  amount: z.number(),
});

// ─── Years List Response ───

export const PolicyYearsSchema = z.array(z.number().int());
