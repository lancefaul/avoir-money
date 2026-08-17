/**
 * The DatePicker value contract.
 *
 * The pickers work in local time; the app stores UTC midnight. Every one of
 * these assertions is about that seam, which produced a silent one-day display
 * error on every screen that fed a stored date straight to a picker.
 *
 * These tests are only meaningful in a timezone with a non-zero offset. The
 * repo runs in America/Chicago (UTC-5/-6) and `vitest.config.ts` does not pin
 * TZ, so a check guards the assertions that depend on an offset — otherwise
 * this file would quietly pass for the wrong reason under TZ=UTC in CI.
 */
import { toPickerDate, fromPickerDate } from './date-picker-shared.js';

const HAS_OFFSET = new Date(2026, 6, 20).getTimezoneOffset() !== 0;

describe('toPickerDate', () => {
  it('returns local midnight of the stored calendar day', () => {
    const d = toPickerDate('2026-07-20')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('takes the UTC calendar day from a full ISO timestamp', () => {
    // How the API serialises a date: UTC midnight. The intended day is the 20th.
    expect(toPickerDate('2026-07-20T00:00:00.000Z')!.getDate()).toBe(20);
  });

  /*
   * The regression this contract exists for.
   *
   * `new Date(stored)` parses as UTC, and the picker then reads it with local
   * getters — so west of Greenwich it renders the previous day. This was live
   * in DebtForm (both date fields) and in the reconciler's Correct-date field.
   */
  it.runIf(HAS_OFFSET)('fixes the off-by-one that raw Date parsing produces', () => {
    const stored = '2026-07-20';
    expect(new Date(stored).getDate()).not.toBe(20); // the bug
    expect(toPickerDate(stored)!.getDate()).toBe(20); // the fix
  });

  it('handles month and year boundaries', () => {
    expect(toPickerDate('2026-01-01')!.getMonth()).toBe(0);
    expect(toPickerDate('2026-12-31')!.getDate()).toBe(31);
    expect(toPickerDate('2024-02-29')!.getDate()).toBe(29); // leap day
  });

  it('returns null for absent or malformed input', () => {
    for (const v of [null, undefined, '', 'not-a-date', '2026-07', '2026/07/20', '2026-13-01']) {
      expect(toPickerDate(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('fromPickerDate', () => {
  it('serialises a local-midnight Date to its own calendar day', () => {
    expect(fromPickerDate(new Date(2026, 6, 20))).toBe('2026-07-20');
  });

  it('zero-pads month and day', () => {
    expect(fromPickerDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns an empty string for null', () => {
    expect(fromPickerDate(null)).toBe('');
  });

  /*
   * `toISOString().slice(0, 10)` is the idiom this replaces. It converts to UTC
   * first, so a local-midnight date serialises to the previous day anywhere
   * east of Greenwich. It happens to work in the Americas, which is exactly why
   * it spread through the codebase unchallenged.
   */
  it('round-trips through the picker without drifting', () => {
    for (const stored of ['2026-07-20', '2026-01-01', '2026-12-31', '2024-02-29']) {
      expect(fromPickerDate(toPickerDate(stored))).toBe(stored);
    }
  });

  it('round-trips a full ISO timestamp down to its date', () => {
    expect(fromPickerDate(toPickerDate('2026-07-20T00:00:00.000Z'))).toBe('2026-07-20');
  });
});
