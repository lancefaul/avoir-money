import { makeDate, today } from './dates.js';

const SENTINEL = makeDate(9999, 11, 31); // 9999-12-31 UTC

export function computePausedUntil(input: {
  duration?: number;
  unit?: string;
  indefinite?: boolean;
}): Date {
  if (input.indefinite) return SENTINEL;
  const now = today();
  const d = new Date(now);
  const duration = input.duration!;
  switch (input.unit) {
    case 'days':
      d.setUTCDate(d.getUTCDate() + duration);
      break;
    case 'weeks':
      d.setUTCDate(d.getUTCDate() + duration * 7);
      break;
    case 'months':
      d.setUTCMonth(d.getUTCMonth() + duration);
      break;
    case 'years':
      d.setUTCFullYear(d.getUTCFullYear() + duration);
      break;
  }
  return makeDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function isPaused(pausedUntil: Date | null, now: Date): boolean {
  return pausedUntil != null && pausedUntil > now;
}

export { SENTINEL };
