import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PauseSourceSchema, ResumeSourceSchema } from '../schemas/pause.js';

/**
 * Feature: recurring-pause, Property 6: Pause/resume input validation
 * Validates: Requirements 6.5, 6.6
 *
 * For any pause request body that provides neither indefinite=true nor both duration and unit,
 * PauseSourceSchema SHALL reject the input. For any resume request body that provides neither
 * immediately=true nor a resumeDate, ResumeSourceSchema SHALL reject the input.
 * Conversely, all valid combinations SHALL be accepted.
 */
describe('Property 6: Pause/resume input validation', () => {
  // --- PauseSourceSchema ---

  it('accepts { indefinite: true }', () => {
    const result = PauseSourceSchema.safeParse({ indefinite: true });
    expect(result.success).toBe(true);
  });

  it('accepts { duration: N, unit: U } for any positive int N and valid unit U', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),
        fc.constantFrom('days', 'weeks', 'months', 'years'),
        (duration, unit) => {
          const result = PauseSourceSchema.safeParse({ duration, unit });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects {} (empty object)', () => {
    const result = PauseSourceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects { duration: N } without unit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 365 }), (duration) => {
        const result = PauseSourceSchema.safeParse({ duration });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects { unit: U } without duration', () => {
    fc.assert(
      fc.property(fc.constantFrom('days', 'weeks', 'months', 'years'), (unit) => {
        const result = PauseSourceSchema.safeParse({ unit });
        expect(result.success).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it('rejects { duration: N, unit: U } when duration is negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -365, max: -1 }),
        fc.constantFrom('days', 'weeks', 'months', 'years'),
        (duration, unit) => {
          const result = PauseSourceSchema.safeParse({ duration, unit });
          expect(result.success).toBe(false);
        },
      ),
      { numRuns: 20 },
    );
  });

  // --- ResumeSourceSchema ---

  it('accepts { immediately: true }', () => {
    const result = ResumeSourceSchema.safeParse({ immediately: true });
    expect(result.success).toBe(true);
  });

  it('accepts { resumeDate: D } for any valid date D', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (resumeDate) => {
          const result = ResumeSourceSchema.safeParse({ resumeDate: resumeDate.toISOString() });
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('rejects {} (empty object)', () => {
    const result = ResumeSourceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects { immediately: false } without resumeDate', () => {
    const result = ResumeSourceSchema.safeParse({ immediately: false });
    expect(result.success).toBe(false);
  });

  it('rejects { immediately: false, resumeDate: undefined }', () => {
    const result = ResumeSourceSchema.safeParse({ immediately: false, resumeDate: undefined });
    expect(result.success).toBe(false);
  });
});
