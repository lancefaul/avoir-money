import type { PayScheduleType } from '../types/index.js';

export const DEFAULT_SCHEDULE_TYPE: PayScheduleType = 'BIWEEKLY';

/**
 * Anchor date for the default biweekly schedule.
 * This is a known pay date from the spreadsheet (2026-03-20).
 * The period generator steps ±14 days from this anchor to produce all periods.
 */
export const DEFAULT_ANCHOR_DATE = new Date('2026-03-20T00:00:00.000Z');

/** Default horizon: generate periods 12 months ahead from today. */
export const DEFAULT_GENERATE_MONTHS_AHEAD = 12;

/** Default backfill: generate periods from the start of the current calendar year. */
export const DEFAULT_GENERATE_FROM_YEAR_START = true;
