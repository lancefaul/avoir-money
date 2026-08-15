import { z } from 'zod';

export const DescriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const CreateDescriptionSchema = z.object({
  name: z.string().min(1).max(200),
});

export const RenameDescriptionSchema = z.object({
  name: z.string().min(1).max(200),
});

export const MergeDescriptionsSchema = z.object({
  sourceIds: z.array(z.string()).min(1),
  targetId: z.string(),
});
