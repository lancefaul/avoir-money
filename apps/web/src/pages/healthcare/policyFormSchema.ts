import { z } from 'zod';
import type { InsurancePolicyWithBalance, PolicyType } from '@budget-tracker/core';

export type CreateFormValues = {
  type: PolicyType;
  year: number;
  employer: string;
  premium: number;
  deductibleLimit: number | null;
  oopmLimit: number | null;
  metadata: {
    insurer: string;
    policyId?: string;
    groupName?: string;
    groupNumber?: string;
    healthPlan?: string;
    effectiveDate?: string;
    rxBin?: string;
    rxPcn?: string;
    managementUrl?: string;
  };
};

export const currentYear = new Date().getFullYear();

const urlOrEmpty = z.string().max(500).or(z.literal('')).optional();

const MetadataFormSchema = z.object({
  insurer: z.string().min(1).max(200),
  policyId: z.string().max(100).optional(),
  groupName: z.string().max(200).optional(),
  groupNumber: z.string().max(100).optional(),
  healthPlan: z.string().max(200).optional(),
  effectiveDate: z.string().max(20).optional(),
  rxBin: z.string().max(50).optional(),
  rxPcn: z.string().max(50).optional(),
  managementUrl: urlOrEmpty,
});

export const CreateFormSchema = z.object({
  type: z.enum(['MEDICAL', 'DENTAL', 'VISION']),
  year: z.number().int().min(2000).max(2100),
  employer: z.string().min(1).max(100),
  premium: z.number().nonnegative(),
  deductibleLimit: z.number().nonnegative().nullable().optional(),
  oopmLimit: z.number().nonnegative().nullable().optional(),
  metadata: MetadataFormSchema,
});

export const defaultMetadata = {
  insurer: '',
  policyId: '',
  groupName: '',
  groupNumber: '',
  healthPlan: '',
  effectiveDate: '',
  rxBin: '',
  rxPcn: '',
  managementUrl: '',
};

export const TYPE_OPTIONS = [
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'DENTAL', label: 'Dental' },
  { value: 'VISION', label: 'Vision' },
];

export function extractMetadata(policy: InsurancePolicyWithBalance): CreateFormValues['metadata'] {
  const meta = policy.metadata as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') return { ...defaultMetadata };
  return {
    insurer: (meta.insurer as string) ?? '',
    policyId: (meta.policyId as string) ?? '',
    groupName: (meta.groupName as string) ?? '',
    groupNumber: (meta.groupNumber as string) ?? '',
    healthPlan: (meta.healthPlan as string) ?? '',
    effectiveDate: (meta.effectiveDate as string) ?? '',
    rxBin: (meta.rxBin as string) ?? '',
    rxPcn: (meta.rxPcn as string) ?? '',
    managementUrl: (meta.managementUrl as string) ?? '',
  };
}

export function buildMetadataPayload(
  values: CreateFormValues,
  policyType: PolicyType | undefined,
  fallbackType: PolicyType,
) {
  const type = values.type ?? policyType ?? fallbackType;
  const m = values.metadata;
  if (type === 'MEDICAL') {
    return {
      insurer: m.insurer,
      policyId: m.policyId || '',
      groupNumber: m.groupNumber || '',
      healthPlan: m.healthPlan || undefined,
      rxBin: m.rxBin || undefined,
      rxPcn: m.rxPcn || undefined,
      managementUrl: m.managementUrl || undefined,
    };
  }
  if (type === 'DENTAL') {
    return {
      insurer: m.insurer,
      policyId: m.policyId || undefined,
      groupName: m.groupName || undefined,
      groupNumber: m.groupNumber || undefined,
      effectiveDate: m.effectiveDate || undefined,
      managementUrl: m.managementUrl || undefined,
    };
  }
  return {
    insurer: m.insurer,
    policyId: m.policyId || undefined,
    managementUrl: m.managementUrl || undefined,
  };
}
