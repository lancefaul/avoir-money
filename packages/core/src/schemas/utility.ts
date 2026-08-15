import { z } from 'zod';

// Flexible JSON object for gas breakdown, water components, etc.
const JsonDetails = z.record(z.string(), z.unknown());

// ─── New Enums ───

export const ServiceTypeSchema = z.enum([
  'ELECTRIC',
  'GAS',
  'WATER',
  'GARBAGE',
  'SEWAGE',
  'INTERNET',
  'CELLULAR',
]);

export const MeteringSchema = z.enum(['METERED', 'UNMETERED']);

// ─── Utility Provider Schemas ───

export const UtilityProviderSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  /**
   * The kinds of service this provider supplies, distinct and sorted.
   *
   * Carried on the provider so a list can show what each one IS without a
   * request per row — services are nested under a provider, so there is no
   * unscoped way to fetch them. It replaced a hardcoded match on provider
   * NAMES, which only worked for names someone had already special-cased and
   * disclosed which providers those were.
   *
   * Defaulted rather than required: a provider with no services yet is normal,
   * and an older server that does not send the field should not fail parsing.
   */
  serviceTypes: z.array(ServiceTypeSchema).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateUtilityProviderSchema = z.object({
  name: z.string().min(1).max(100),
});

export const UpdateUtilityProviderSchema = z.object({
  name: z.string().min(1).max(100),
});

// ─── Utility Provider Response Schemas ───

export const UtilityProviderResponseSchema = UtilityProviderSchema;
export const UtilityProviderListResponseSchema = z.array(UtilityProviderSchema);

// ─── Utility Service Schemas ───

export const UtilityServiceSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  serviceType: ServiceTypeSchema,
  metering: MeteringSchema,
  expenseId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const CreateUtilityServiceSchema = z.object({
  serviceType: ServiceTypeSchema,
  metering: MeteringSchema,
});

export const UpdateUtilityServiceSchema = z.object({
  metering: MeteringSchema,
});

// ─── Utility Service Response Schemas ───

export const UtilityServiceResponseSchema = UtilityServiceSchema;
export const UtilityServiceListResponseSchema = z.array(UtilityServiceSchema);

// ─── Utility Reading Schemas ───

export const UtilityReadingSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  billDate: z.coerce.date(),
  dueDate: z.coerce.date().nullable(),
  usage: z.number().nonnegative().nullable(),
  cost: z.number().nonnegative(),
  unitCost: z.number().nonnegative().nullable(),
  convenienceFee: z.number().nonnegative().nullable(),
  convenienceFeeType: z.string().nullable(),
  otherFees: z.number().nonnegative().nullable(),
  details: JsonDetails.nullable(),
  createdAt: z.coerce.date(),
});

export const CreateUtilityReadingSchema = z.object({
  serviceId: z.string(),
  billDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  usage: z.number().nonnegative().optional(),
  cost: z.number().nonnegative(),
  unitCost: z.number().nonnegative().optional(),
  convenienceFee: z.number().nonnegative().optional(),
  convenienceFeeType: z.enum(['dollar', 'percent']).optional(),
  otherFees: z.number().nonnegative().optional(),
  details: JsonDetails.optional(),
});

export const UpdateUtilityReadingSchema = CreateUtilityReadingSchema.partial();

export const ListUtilitiesQuerySchema = z.object({
  serviceId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

// ─── Response Schemas ───

export const UtilityReadingResponseSchema = UtilityReadingSchema;
export const UtilityReadingListResponseSchema = z.array(UtilityReadingSchema);
