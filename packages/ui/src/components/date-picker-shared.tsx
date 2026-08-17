/**
 * Internal shared helpers + calendar sub-components for DatePicker /
 * DateRangePicker. Split from DatePicker.tsx; not exported from the package index.
 */
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import * as dp from './datepicker.css.js';

/* ─── Helpers ─── */

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function stripTime(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
export function sameDay(a: Date | null, b: Date | null): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
/**
 * Separator for every numeric date the pickers display, parse, or mask.
 *
 * Defined once because it appeared hardcoded in five places, which is how the
 * pickers drifted to `MM/DD/YYYY` while the rest of the app renders numeric
 * dates as `MM-dd-yyyy` via `formatDateNumeric`. Changing it here changes the
 * display, the placeholder, and the typing mask together.
 */
export const DATE_SEP = '-';

/** The mask shown as placeholder text, derived so it cannot disagree with DATE_SEP. */
export const DATE_MASK = ['MM', 'DD', 'YYYY'].join(DATE_SEP);

export function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return [mm, dd, d.getFullYear()].join(DATE_SEP);
}
export function fmtShort(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return [mm, dd, d.getFullYear()].join(DATE_SEP);
}
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/* ─── The value contract ─── */

/**
 * Convert a stored date string into the Date the pickers require.
 *
 * **The pickers work entirely in local time.** Every getter and constructor in
 * this module and in `DatePicker.tsx` is local (`getDate`, `new Date(y, m, d)`),
 * so `value` must be a Date at **local midnight** of the intended calendar day.
 *
 * This matters because the app stores dates at **UTC midnight**. Handing a
 * stored value straight to the picker is the bug this function exists to
 * prevent: `new Date('2026-07-20')` and `new Date('2026-07-20T00:00:00Z')` both
 * produce UTC midnight, whose local `getDate()` is the **19th** anywhere west
 * of Greenwich. The picker then displays a date one day earlier than the one
 * on file, silently and on every screen.
 *
 * Accepts `'YYYY-MM-DD'` or a full ISO timestamp; anything after `T` is
 * discarded, so the UTC calendar day is taken as authoritative. Deliberately
 * takes a **string, never a Date** — a Date carries no indication of which
 * convention produced it, so a `Date`-accepting version could not tell a stored
 * UTC-midnight value from a local one built by `new Date()`, and would have to
 * guess. Consumers already holding a local Date do not need this.
 *
 * Pairs with `fromPickerDate`. Use both, or neither.
 */
export function toPickerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const datePart = value.split('T')[0];
  const parts = datePart?.split('-').map(Number);
  if (!parts || parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

/**
 * Convert a picker Date back into the `'YYYY-MM-DD'` the API expects.
 *
 * Reads local getters because that is what the picker produces. Note this is
 * NOT `d.toISOString().slice(0, 10)`, the idiom it replaces: `toISOString`
 * converts to UTC first, so a local-midnight date east of Greenwich serialises
 * to the **previous** day. That idiom happens to work in the Americas and fails
 * silently anywhere else.
 */
export function fromPickerDate(d: Date | null): string {
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/* ─── Masked date input logic ─── */

/** Clamp digits into a valid MM-DD-YYYY mask as the user types. */
export function maskDateDigits(raw: string): string {
  const d = raw.replace(/[^\d]/g, '').slice(0, 8);
  if (d.length === 0) return '';

  // Clamp month: first digit > 1 → prefix with 0
  let mm = d.slice(0, Math.min(d.length, 2));
  if (mm.length === 1 && parseInt(mm, 10) > 1) {
    mm = '0' + mm;
  }
  if (mm.length === 2) {
    const m = parseInt(mm, 10);
    if (m < 1) mm = '01';
    else if (m > 12) mm = '12';
  }

  if (d.length <= 2) return mm.slice(0, d.length);

  // Clamp day: first digit > 3 → prefix with 0
  const dayDigits = d.slice(2, Math.min(d.length, 4));
  let dd = dayDigits;
  if (dd.length === 1 && parseInt(dd, 10) > 3) {
    dd = '0' + dd;
  }
  if (dd.length === 2) {
    const dv = parseInt(dd, 10);
    if (dv < 1) dd = '01';
    else if (dv > 31) dd = '31';
  }

  if (d.length <= 4) return mm + DATE_SEP + dd.slice(0, d.length - 2);

  const yyyy = d.slice(4);
  return mm + DATE_SEP + dd + DATE_SEP + yyyy;
}

export function parseMasked(raw: string): Date | null {
  // Accept either separator on input. The mask emits DATE_SEP, but a user who
  // types slashes out of habit should not be silently rejected — and a value
  // stored before the separator changed must still parse.
  const parts = raw.split(/[-/]/);
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (!mm || !dd || !yyyy || yyyy.length !== 4) return null;
  const m = parseInt(mm, 10);
  const d = parseInt(dd, 10);
  const y = parseInt(yyyy, 10);
  if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  const maxD = daysInMonth(y, m - 1);
  if (d > maxD) return null;
  return stripTime(new Date(y, m - 1, d));
}

export function formatMasked(d: Date | null): string {
  if (!d) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return [mm, dd, d.getFullYear()].join(DATE_SEP);
}

export function formatRangeMasked(start: Date | null, end: Date | null): string {
  const s = formatMasked(start);
  const e = formatMasked(end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `${s} – `;
  return '';
}

/** Mask a raw string into "MM-DD-YYYY – MM-DD-YYYY" format, capping each date at 8 digits. */
export function applyRangeMask(raw: string): string {
  // Strip everything except digits, slashes, and the en-dash separator
  const cleaned = raw.replace(/[^\d/–]/g, '');
  const sepIdx = cleaned.indexOf('–');
  let left: string;
  let right: string;
  if (sepIdx !== -1) {
    left = cleaned.slice(0, sepIdx).replace(/[– ]/g, '').trim();
    right = cleaned
      .slice(sepIdx + 1)
      .replace(/[– ]/g, '')
      .trim();
  } else {
    const digits = cleaned.replace(/\//g, '');
    if (digits.length <= 8) {
      left = cleaned;
      right = '';
    } else {
      left = digits.slice(0, 8);
      right = digits.slice(8);
    }
  }

  const l = maskDateDigits(left);
  const r = maskDateDigits(right);

  if (!l && !r) return '';
  if (l.length === 10 || r || sepIdx !== -1) {
    return r ? `${l} – ${r}` : `${l} – `;
  }
  return l;
}

export function parseRangeMasked(raw: string): { start: Date | null; end: Date | null } {
  const sepIdx = raw.indexOf('–');
  if (sepIdx === -1) return { start: parseMasked(raw.trim()), end: null };
  const left = raw.slice(0, sepIdx).trim();
  const right = raw.slice(sepIdx + 1).trim();
  return { start: parseMasked(left), end: parseMasked(right) };
}

/* ─── Portal target ─── */

export function getPortalTarget(): HTMLElement {
  return document.getElementById('tooltip-portal') ?? document.body;
}

/* ═══════════════════════════════════════
   DayCell
   ═══════════════════════════════════════ */

interface DayCellProps {
  date: Date;
  today: Date;
  outside?: boolean;
  disableOutside?: boolean;
  isSelected?: (d: Date) => boolean;
  getDayClass?: (d: Date) => string;
  onClick: (d: Date) => void;
  onHover?: (d: Date) => void;
  onLeave?: () => void;
  isFocused: boolean;
}

export function DayCell({
  date,
  today,
  outside,
  disableOutside,
  isSelected,
  getDayClass,
  onClick,
  onHover,
  onLeave,
  isFocused,
}: DayCellProps) {
  const isDisabled = outside && disableOutside;
  const cls = [
    dp.dpDay,
    outside ? dp.dpDayOutside : '',
    sameDay(date, today) ? dp.dpDayToday : '',
    isSelected?.(date) ? dp.dpDaySelected : '',
    getDayClass?.(date) ?? '',
    isFocused ? dp.dpDayKeyboardFocus : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      disabled={isDisabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDisabled) onClick(date);
      }}
      onMouseEnter={() => {
        if (!isDisabled) onHover?.(date);
      }}
      onMouseLeave={() => onLeave?.()}
      tabIndex={-1}
    >
      {date.getDate()}
    </button>
  );
}

/* ═══════════════════════════════════════
   CalendarMonth — renders a single month grid
   ═══════════════════════════════════════ */

interface CalendarMonthProps {
  year: number;
  month: number;
  today: Date;
  isSelected?: (d: Date) => boolean;
  getDayClass?: (d: Date) => string;
  onDayClick: (d: Date) => void;
  onDayHover?: (d: Date) => void;
  onDayLeave?: () => void;
  focusDay?: Date | null;
  disableOutside?: boolean;
}

export function CalendarMonth({
  year,
  month,
  today,
  isSelected,
  getDayClass,
  onDayClick,
  onDayHover,
  onDayLeave,
  focusDay,
  disableOutside,
}: CalendarMonthProps) {
  const firstDow = new Date(year, month, 1).getDay();
  const dim = daysInMonth(year, month);
  const cells: ReactNode[] = [];

  for (let i = 0; i < firstDow; i++) {
    const d = new Date(year, month, -(firstDow - 1 - i));
    cells.push(
      <DayCell
        key={`prev-${d.getTime()}`}
        date={d}
        outside
        disableOutside={disableOutside}
        today={today}
        isSelected={isSelected}
        getDayClass={getDayClass}
        onClick={onDayClick}
        onHover={onDayHover}
        onLeave={onDayLeave}
        isFocused={focusDay ? sameDay(d, focusDay) : false}
      />,
    );
  }
  for (let d = 1; d <= dim; d++) {
    const date = new Date(year, month, d);
    cells.push(
      <DayCell
        key={d}
        date={date}
        today={today}
        isSelected={isSelected}
        getDayClass={getDayClass}
        onClick={onDayClick}
        onHover={onDayHover}
        onLeave={onDayLeave}
        isFocused={focusDay ? sameDay(date, focusDay) : false}
      />,
    );
  }
  const total = cells.length;
  const fill = total <= 35 ? 35 - total : 42 - total;
  for (let j = 1; j <= fill; j++) {
    const d = new Date(year, month + 1, j);
    cells.push(
      <DayCell
        key={`next-${j}`}
        date={d}
        outside
        disableOutside={disableOutside}
        today={today}
        isSelected={isSelected}
        getDayClass={getDayClass}
        onClick={onDayClick}
        onHover={onDayHover}
        onLeave={onDayLeave}
        isFocused={focusDay ? sameDay(d, focusDay) : false}
      />,
    );
  }

  return (
    <>
      <div className={dp.dpDow}>
        {DOW.map((d) => (
          <div key={d} className={dp.dpDowCell}>
            {d}
          </div>
        ))}
      </div>
      <div className={dp.dpGrid}>{cells}</div>
    </>
  );
}

/* ═══════════════════════════════════════
   usePopoverPosition
   ═══════════════════════════════════════ */

export function usePopoverPosition(
  triggerRef: React.RefObject<HTMLElement | null>,
  popoverRef: React.RefObject<HTMLElement | null>,
  isOpen: boolean,
) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!triggerRef.current || !popoverRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const pw = popoverRef.current.offsetWidth;
    const ph = popoverRef.current.offsetHeight;
    const pad = 8;
    const gap = 4;

    let top = r.bottom + gap;
    if (top + ph > window.innerHeight - pad) {
      top = Math.max(pad, r.top - gap - ph);
    }
    let left = r.left;
    if (left + pw > window.innerWidth - pad) left = window.innerWidth - pw - pad;
    if (left < pad) left = pad;

    setPos({ top, left });
  }, [triggerRef, popoverRef]);

  useEffect(() => {
    if (!isOpen) return;
    updatePos();
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, updatePos]);

  return pos;
}

/* ═══════════════════════════════════════
   DatePicker — Single date
   ═══════════════════════════════════════ */
