import { z } from 'zod';

export const PauseSourceSchema = z
  .object({
    duration: z.number().int().positive().optional(),
    unit: z.enum(['days', 'weeks', 'months', 'years']).optional(),
    indefinite: z.boolean().optional(),
  })
  .refine((d) => d.indefinite === true || (d.duration != null && d.unit != null), {
    message: 'Provide either indefinite=true or both duration and unit',
  });

export const ResumeSourceSchema = z
  .object({
    immediately: z.boolean().optional(),
    resumeDate: z.coerce.date().optional(),
  })
  .refine((d) => d.immediately === true || d.resumeDate != null, {
    message: 'Provide either immediately=true or a resumeDate',
  });
