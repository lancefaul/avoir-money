import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './IconButton.js';
import * as btn from './buttons.css.js';
import * as dp from './datepicker.css.js';
import {
  MONTHS,
  DATE_MASK,
  stripTime,
  sameDay,
  fmtDate,
  maskDateDigits,
  parseMasked,
  formatMasked,
  getPortalTarget,
  CalendarMonth,
  usePopoverPosition,
} from './date-picker-shared.js';

// The range picker lives in its own module; re-exported so the package index
// (and consumers) keep a single import surface.
export { DateRangePicker } from './DateRangePicker.js';
export type { DateRange, DateRangePickerProps } from './DateRangePicker.js';

export interface DatePickerProps {
  /**
   * A Date at **local midnight** of the intended day.
   *
   * The picker reads this with local getters, and the app stores dates at UTC
   * midnight — so passing a stored value directly displays the **previous**
   * day. Convert with `toPickerDate(storedString)`; pair it with
   * `fromPickerDate` in `onChange`.
   */
  value?: Date | null;
  /** Receives a local-midnight Date. Serialise with `fromPickerDate`, not `toISOString`. */
  onChange?: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  /** HTML id attribute forwarded to the trigger element. */
  id?: string;
}

export function DatePicker({
  value = null,
  onChange,
  placeholder = DATE_MASK,
  disabled = false,
  error = false,
  id,
}: DatePickerProps) {
  const today = stripTime(new Date());
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Close-animation timer, tracked so it's cancelled on unmount / before reschedule —
  // otherwise a pending setPhase() fires after teardown (window is not defined). See
  // ERRORS.md "window is not defined". mountedRef guards the RAF, which isn't cleared.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => {
    // Must be set on every setup, not just at useRef init. Strict Mode runs
    // setup → cleanup → setup, so a ref that is only ever set false in cleanup
    // stays false on a component that is still mounted — and the double-rAF
    // below then skips setPhase('open') forever, leaving the popover rendered
    // at opacity 0. That reads as "the date picker doesn't open anymore".
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(closeTimerRef.current);
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
    };
  }, []);
  const autoId = useId();
  const inputId = id ?? autoId;
  const dialogId = useId();

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed');
  const [viewYear, setViewYear] = useState(value?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(value?.getMonth() ?? today.getMonth());
  const [focusDay, setFocusDay] = useState<Date | null>(null);
  const [inputText, setInputText] = useState(() => formatMasked(value));
  const [isTyping, setIsTyping] = useState(false);

  const pos = usePopoverPosition(triggerRef, popoverRef, phase === 'opening' || phase === 'open');

  useEffect(() => {
    if (!isTyping) setInputText(formatMasked(value));
  }, [value, isTyping]);

  const open = useCallback(() => {
    if (disabled) return;
    if (value) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
    }
    setIsOpen(true);
    setPhase('opening');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        if (mountedRef.current) setPhase('open');
      });
    });
  }, [disabled, value]);

  const close = useCallback(() => {
    setIsOpen(false);
    setPhase('closing');
    setFocusDay(null);
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

  const selectDate = useCallback(
    (d: Date) => {
      const date = stripTime(d);
      onChange?.(date);
      setInputText(formatMasked(date));
      setIsTyping(false);
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => close(), 120);
    },
    [onChange, close],
  );

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }, [viewMonth, viewYear]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }, [viewMonth, viewYear]);

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
      if (!isOpen) return;

      const base = focusDay ?? value ?? new Date(viewYear, viewMonth, 1);
      const next = new Date(base);

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          next.setDate(next.getDate() - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          next.setDate(next.getDate() + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          next.setDate(next.getDate() - 7);
          break;
        case 'ArrowDown':
          e.preventDefault();
          next.setDate(next.getDate() + 7);
          break;
        case 'Enter':
          e.preventDefault();
          if (focusDay) selectDate(focusDay);
          return;
        default:
          return;
      }

      const fd = stripTime(next);
      setFocusDay(fd);
      if (fd.getMonth() !== viewMonth || fd.getFullYear() !== viewYear) {
        setViewMonth(fd.getMonth());
        setViewYear(fd.getFullYear());
      }
    },
    [isOpen, focusDay, value, viewYear, viewMonth, open, close, selectDate],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const cleaned = maskDateDigits(e.target.value);
      setInputText(cleaned);
      setIsTyping(true);
      const parsed = parseMasked(cleaned);
      if (parsed) {
        onChange?.(parsed);
        setViewYear(parsed.getFullYear());
        setViewMonth(parsed.getMonth());
      }
    },
    [onChange],
  );

  const handleInputBlur = useCallback(() => {
    setIsTyping(false);
    setInputText(formatMasked(value));
  }, [value]);

  const isSelected = useCallback((d: Date) => !!value && sameDay(d, value), [value]);

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
        id={inputId}
        className={triggerCls}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={dialogId}
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
            name={inputId}
            className={dp.dpMaskedInput}
            value={inputText}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (['ArrowUp', 'ArrowDown', 'Escape', 'Enter'].includes(e.key)) {
                handleKeyDown(e);
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder || 'Date input'}
            autoFocus={isOpen}
          />
        ) : (
          <span className={`${dp.dpValue} ${!value ? dp.dpPlaceholder : ''}`}>
            {value ? fmtDate(value) : placeholder}
          </span>
        )}
      </div>

      {phase !== 'closed' &&
        createPortal(
          <div
            ref={popoverRef}
            id={dialogId}
            role="dialog"
            className={`${dp.dpPopover} ${
              phase === 'open'
                ? dp.dpPopoverOpen
                : phase === 'closing'
                  ? dp.dpPopoverClosing
                  : dp.dpPopoverOpening
            }`}
            style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className={dp.dpHeader}>
              <IconButton
                icon={<ChevronLeft size={14} />}
                tooltip="Previous month"
                size="sm"
                onClick={prevMonth}
              />
              <span className={dp.dpMonthLabel}>
                {MONTHS[viewMonth]} {viewYear}
              </span>
              <IconButton
                icon={<ChevronRight size={14} />}
                tooltip="Next month"
                size="sm"
                onClick={nextMonth}
              />
            </div>
            <CalendarMonth
              year={viewYear}
              month={viewMonth}
              today={today}
              isSelected={isSelected}
              onDayClick={selectDate}
              focusDay={focusDay}
            />
            <div className={dp.dpFooter}>
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhost}`}
                onClick={() => selectDate(new Date(today))}
              >
                Today
              </button>
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhost}`}
                onClick={() => setViewYear((y) => y + 1)}
              >
                Next Year
              </button>
              <button
                type="button"
                className={`${btn.btnBase} ${btn.btnSm} ${btn.btnTrueGhostDanger}`}
                onClick={() => {
                  onChange?.(null);
                  setInputText('');
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

/* ═══════════════════════════════════════
   DateRangePicker — Two-month range
   ═══════════════════════════════════════ */
