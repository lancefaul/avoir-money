import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as btn from './buttons.css.js';
import * as dp from './datepicker.css.js';
import {
  MONTHS,
  stripTime,
  sameDay,
  fmtShort,
  formatRangeMasked,
  applyRangeMask,
  parseRangeMasked,
  getPortalTarget,
  CalendarMonth,
  usePopoverPosition,
} from './date-picker-shared.js';

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  /** HTML id attribute forwarded to the trigger element. */
  id?: string;
}

export function DateRangePicker({
  value = { start: null, end: null },
  onChange,
  placeholder = 'Start date – End date',
  disabled = false,
  error = false,
  id,
}: DateRangePickerProps) {
  const today = stripTime(new Date());
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // See DatePicker above / ERRORS.md — cancel the close-animation timer on unmount
  // and guard the RAF so no setPhase() fires after teardown.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => {
    // Set on every setup — see the identical note in DatePicker.tsx. Strict
    // Mode's setup → cleanup → setup leaves a cleanup-only ref permanently
    // false, which strands the popover at opacity 0.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(closeTimerRef.current);
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  const autoId = useId();
  const rangeInputId = id ?? autoId;
  const rangeDialogId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [leftYear, setLeftYear] = useState(value.start?.getFullYear() ?? today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(value.start?.getMonth() ?? today.getMonth());
  const [rangeStart, setRangeStart] = useState<Date | null>(value.start);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(value.end);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [hint, setHint] = useState(
    value.start && value.end ? 'Click to adjust range' : 'Click a start date',
  );
  const [isTyping, setIsTyping] = useState(false);
  const [inputText, setInputText] = useState(() => formatRangeMasked(value.start, value.end));

  const rightYear = leftMonth === 11 ? leftYear + 1 : leftYear;
  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1;

  const pos = usePopoverPosition(triggerRef, popoverRef, phase === 'opening' || phase === 'open');

  // Sync from external value changes
  useEffect(() => {
    setRangeStart(value.start);
    setRangeEnd(value.end);
    setInputText(formatRangeMasked(value.start, value.end));
    setHint(value.start && value.end ? 'Click to adjust range' : 'Click a start date');
  }, [value.start, value.end]);

  const open = useCallback(() => {
    if (disabled) return;
    setRangeStart(value.start);
    setRangeEnd(value.end);
    setInputText(formatRangeMasked(value.start, value.end));
    setHint(value.start && value.end ? 'Click to adjust range' : 'Click a start date');
    setIsTyping(false);
    if (value.start) {
      setLeftYear(value.start.getFullYear());
      setLeftMonth(value.start.getMonth());
    }
    setIsOpen(true);
    setPhase('opening');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        if (mountedRef.current) setPhase('open');
      });
    });
  }, [disabled, value.start, value.end]);

  const close = useCallback(() => {
    setIsOpen(false);
    setPhase('closing');
    setHoverDate(null);
    setIsTyping(false);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setPhase('closed'), 100);
  }, []);

  useEffect(() => {
    if (phase === 'closed') return;
    function handleMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [phase, close]);

  const pickDate = useCallback(
    (d: Date) => {
      const date = stripTime(d);

      if (rangeStart && rangeEnd) {
        // Existing range — adjust intelligently
        if (sameDay(date, rangeStart) || sameDay(date, rangeEnd)) return;
        if (date < rangeStart) {
          setRangeStart(date);
          onChange?.({ start: date, end: rangeEnd });
          setInputText(formatRangeMasked(date, rangeEnd));
        } else if (date > rangeEnd) {
          setRangeEnd(date);
          onChange?.({ start: rangeStart, end: date });
          setInputText(formatRangeMasked(rangeStart, date));
        } else {
          // Between start and end → adjust end
          setRangeEnd(date);
          onChange?.({ start: rangeStart, end: date });
          setInputText(formatRangeMasked(rangeStart, date));
        }
        setHint('Click to adjust range');
        return;
      }

      if (!rangeStart) {
        setRangeStart(date);
        setRangeEnd(null);
        setHoverDate(null);
        setHint('Click an end date');
      } else {
        let start = rangeStart;
        let end = date;
        if (date < rangeStart) {
          start = date;
          end = rangeStart;
        }
        setRangeStart(start);
        setRangeEnd(end);
        setHoverDate(null);
        setHint('Click to adjust range');
        onChange?.({ start, end });
        setInputText(formatRangeMasked(start, end));
      }
    },
    [rangeStart, rangeEnd, onChange],
  );

  const prevMonth = useCallback(() => {
    if (leftMonth === 0) {
      setLeftMonth(11);
      setLeftYear(leftYear - 1);
    } else {
      setLeftMonth(leftMonth - 1);
    }
  }, [leftMonth, leftYear]);

  const nextMonth = useCallback(() => {
    if (leftMonth === 11) {
      setLeftMonth(0);
      setLeftYear(leftYear + 1);
    } else {
      setLeftMonth(leftMonth + 1);
    }
  }, [leftMonth, leftYear]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        return;
      }
      if (!isOpen && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
        e.preventDefault();
        open();
        return;
      }
    },
    [isOpen, open, close],
  );

  const handleRangeInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const masked = applyRangeMask(e.target.value);
      setInputText(masked);
      setIsTyping(true);
      const { start, end } = parseRangeMasked(masked);
      if (start) {
        setRangeStart(start);
        setLeftYear(start.getFullYear());
        setLeftMonth(start.getMonth());
        setHint(end ? 'Click to adjust range' : 'Click an end date');
      }
      if (start && end) {
        setRangeEnd(end);
        onChange?.({ start, end });
      }
    },
    [onChange],
  );

  const handleRangeInputBlur = useCallback(() => {
    setIsTyping(false);
    setInputText(formatRangeMasked(rangeStart, rangeEnd));
  }, [rangeStart, rangeEnd]);

  const getDayClass = useCallback(
    (d: Date): string => {
      const ts = d.getTime();
      const start = rangeStart;
      const end = rangeEnd;
      const hover = hoverDate;

      if (start && end) {
        if (sameDay(d, start) && sameDay(d, end))
          return `${dp.dpDayRangeStart} ${dp.dpDayRangeStartEnd}`;
        if (sameDay(d, start)) return dp.dpDayRangeStart;
        if (sameDay(d, end)) return dp.dpDayRangeEnd;
        if (ts > start.getTime() && ts < end.getTime()) return dp.dpDayRangeMid;
      } else if (start && !end && hover) {
        const lo = start < hover ? start : hover;
        const hi = start < hover ? hover : start;
        if (sameDay(d, lo) && sameDay(d, hi))
          return `${dp.dpDayRangeStart} ${dp.dpDayRangeStartEnd}`;
        if (sameDay(d, lo)) return dp.dpDayRangeStart;
        if (sameDay(d, hi)) return dp.dpDayRangeEnd;
        if (ts > lo.getTime() && ts < hi.getTime()) return dp.dpDayHoverMid;
      } else if (start && sameDay(d, start)) {
        return `${dp.dpDayRangeStart} ${dp.dpDayRangeStartEnd}`;
      }
      return '';
    },
    [rangeStart, rangeEnd, hoverDate],
  );

  const onDayHover = useCallback(
    (d: Date) => {
      if (!rangeStart || rangeEnd) return;
      setHoverDate(stripTime(d));
    },
    [rangeStart, rangeEnd],
  );

  const onDayLeave = useCallback(() => {
    if (!rangeStart || rangeEnd) return;
    setHoverDate(null);
  }, [rangeStart, rangeEnd]);

  const hasValue = rangeStart && rangeEnd;
  const displayText = hasValue ? `${fmtShort(rangeStart!)} – ${fmtShort(rangeEnd!)}` : placeholder;

  const triggerCls = [
    dp.dpTrigger,
    isOpen ? dp.dpTriggerOpen : '',
    disabled ? dp.dpTriggerDisabled : '',
    error ? dp.dpTriggerError : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={dp.dpWrap}>
      <div
        ref={triggerRef}
        id={rangeInputId}
        className={triggerCls}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={rangeDialogId}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) {
            if (isOpen) {
              close();
            } else {
              open();
            }
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={dp.dpCalIcon}>
          <Calendar size={14} />
        </span>
        {isTyping || isOpen ? (
          <input
            ref={inputRef}
            name={rangeInputId}
            className={dp.dpMaskedInput}
            value={inputText}
            onChange={handleRangeInputChange}
            onBlur={handleRangeInputBlur}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (['Escape', 'Enter'].includes(e.key)) handleKeyDown(e);
            }}
            placeholder={placeholder}
            aria-label={placeholder || 'Date range input'}
            autoFocus={isOpen}
          />
        ) : (
          <span className={`${dp.dpValue} ${!hasValue ? dp.dpPlaceholder : ''}`}>
            {displayText}
          </span>
        )}
      </div>

      {phase !== 'closed' &&
        createPortal(
          <div
            ref={popoverRef}
            id={rangeDialogId}
            role="dialog"
            className={`${dp.dpPopover} ${dp.dpPopoverRange} ${
              phase === 'open'
                ? dp.dpPopoverOpen
                : phase === 'closing'
                  ? dp.dpPopoverClosing
                  : dp.dpPopoverOpening
            }`}
            style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className={dp.dpMonths}>
              <div className={dp.dpMonth}>
                <div className={dp.dpHeader}>
                  <IconButton
                    icon={<ChevronLeft size={14} />}
                    tooltip="Previous month"
                    size="sm"
                    onClick={prevMonth}
                  />
                  <span className={dp.dpMonthLabel}>
                    {MONTHS[leftMonth]} {leftYear}
                  </span>
                  <span className={dp.dpNavHidden} aria-hidden="true" />
                </div>
                <CalendarMonth
                  year={leftYear}
                  month={leftMonth}
                  today={today}
                  getDayClass={getDayClass}
                  onDayClick={pickDate}
                  onDayHover={onDayHover}
                  onDayLeave={onDayLeave}
                  disableOutside
                />
              </div>
              <div className={dp.dpMonthsDivider} />
              <div className={dp.dpMonth}>
                <div className={dp.dpHeader}>
                  <span className={dp.dpNavHidden} aria-hidden="true" />
                  <span className={dp.dpMonthLabel}>
                    {MONTHS[rightMonth]} {rightYear}
                  </span>
                  <IconButton
                    icon={<ChevronRight size={14} />}
                    tooltip="Next month"
                    size="sm"
                    onClick={nextMonth}
                  />
                </div>
                <CalendarMonth
                  year={rightYear}
                  month={rightMonth}
                  today={today}
                  getDayClass={getDayClass}
                  onDayClick={pickDate}
                  onDayHover={onDayHover}
                  onDayLeave={onDayLeave}
                  disableOutside
                />
              </div>
            </div>
            <div className={dp.dpFooter}>
              <span className={dp.dpRangeHint}>{hint}</span>
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhostDanger}`}
                onClick={() => {
                  setRangeStart(null);
                  setRangeEnd(null);
                  setHoverDate(null);
                  setHint('Click a start date');
                  setInputText('');
                  onChange?.({ start: null, end: null });
                  close();
                }}
              >
                Clear
              </button>
            </div>
          </div>,
          getPortalTarget(),
        )}
    </div>
  );
}
