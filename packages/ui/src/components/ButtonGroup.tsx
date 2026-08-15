import { useCallback, useRef, useState, useEffect } from 'react';
import * as bg from './button-group.css.js';
import { RadioGroup } from './RadioGroup.js';

export interface ButtonGroupProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  /** HTML id attribute forwarded to the radiogroup element. */
  id?: string;
  /** When true, the group is non-interactive and visually muted. */
  disabled?: boolean;
}

export function ButtonGroup({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  id,
  disabled = false,
}: ButtonGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Width the segments need at their min-content floor, recorded on overflow. */
  const naturalWidthRef = useRef(0);
  const [overflowed, setOverflowed] = useState(false);

  /**
   * Segments are `flex: 1` but cannot shrink: a flex item's default
   * `min-width: auto` resolves to min-content, and `white-space: nowrap` makes
   * that the whole label. So once the labels no longer fit, the group overflows
   * its container and the trailing options become unreachable by pointer.
   *
   * Rather than guess a breakpoint (a 2-option toggle fits at any width; a
   * 5-option group can overflow inside a narrow column at any viewport), each
   * instance measures itself and degrades to a vertical RadioGroup only when it
   * genuinely does not fit.
   *
   * Switching back needs the width the pill *would* need, which cannot be
   * measured once it is unmounted — so it is recorded at the moment of
   * overflow and compared against the wrapper from then on.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return undefined;

    const measure = () => {
      const group = groupRef.current;
      if (group) {
        const natural = group.scrollWidth;
        // 1px tolerance: sub-pixel layout can report a hairline overflow.
        if (natural > group.clientWidth + 1) {
          naturalWidthRef.current = natural;
          setOverflowed(true);
        }
      } else if (naturalWidthRef.current > 0 && wrap.clientWidth >= naturalWidthRef.current) {
        setOverflowed(false);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [overflowed, options]);

  const sizeClass = size === 'sm' ? bg.btnGroupSm : bg.btnGroupMd;
  const segSizeClass = size === 'sm' ? bg.btnGroupSegmentSm : bg.btnGroupSegmentMd;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = options.findIndex((o) => o.value === value);
      let next = idx;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        next = idx < options.length - 1 ? idx + 1 : 0;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        next = idx > 0 ? idx - 1 : options.length - 1;
      } else {
        return;
      }

      onChange(options[next]!.value);
      const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[next]?.focus();
    },
    [options, value, onChange],
  );

  if (overflowed) {
    return (
      <div ref={wrapRef}>
        <RadioGroup
          options={options}
          value={value}
          onChange={onChange}
          disabled={disabled}
          id={id}
          ariaLabel={ariaLabel}
        />
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <div
        ref={groupRef}
        id={id}
        className={`${bg.btnGroup} ${sizeClass}`}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={disabled ? undefined : handleKeyDown}
        style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          const cls = [bg.btnGroupSegment, segSizeClass, isActive ? bg.btnGroupSegmentActive : '']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              className={cls}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
