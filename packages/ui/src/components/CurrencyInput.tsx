import { useState, useCallback, useRef, useId } from 'react';
import * as inp from './inputs.css.js';
import { vars } from '../theme/contract.css.js';

interface CurrencyInputProps {
  /** Value in smallest units (e.g. cents when decimals=2, hundred-thousandths when decimals=8) */
  value?: number;
  onChange?: (smallestUnits: number) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  /** Number of decimal places. Defaults to 2 (cents). */
  decimals?: number;
  /**
   * Permit negative values.
   *
   * Off by default: most money fields in this app are magnitudes whose sign is
   * carried by the transaction type, and letting those go negative would invert
   * a charge. Turn it on for figures that are genuinely signed — a credit card's
   * balance is negative in this ledger, so a statement's ending balance cannot
   * be entered without it.
   *
   * With this on, `-` typed into an empty field toggles the sign; typed after a
   * value it still begins a subtraction, so the calculator behaviour survives.
   */
  allowNegative?: boolean;
  /** When true, the input displays the value but does not accept user input. */
  readOnly?: boolean;
  /** HTML id attribute forwarded to the underlying input element. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id if not provided. */
  name?: string;
  /** Accessible label for the input when no visible label is associated. */
  'aria-label'?: string;
}

function formatUnits(units: number, decimals: number): string {
  const abs = Math.abs(units);
  const divisor = Math.pow(10, decimals);
  const whole = Math.floor(abs / divisor);
  const remainder = abs % divisor;
  const wholeStr = whole.toLocaleString('en-US');
  const fractionStr = remainder.toString().padStart(decimals, '0');
  // The sign lives in the text rather than the prefix span so the input's own
  // value is unambiguous to a screen reader reading it back.
  const sign = units < 0 ? '-' : '';
  return `${sign}${wholeStr}.${fractionStr}`;
}

type Operator = '+' | '-' | '*' | '/';
const OPERATORS = new Set(['+', '-', '*', '/']);

interface ExprSegment {
  units: number;
  operator: Operator;
}

function evaluateExpr(segments: ExprSegment[], currentUnits: number, decimals: number): number {
  const divisor = Math.pow(10, decimals);
  const values: number[] = segments.map((s) => s.units / divisor);
  values.push(currentUnits / divisor);
  const ops: Operator[] = segments.map((s) => s.operator);

  // Respect operator precedence: first pass handles * and /
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === '*' || ops[i] === '/') {
      const result =
        ops[i] === '*'
          ? values[i]! * values[i + 1]!
          : values[i + 1] !== 0
            ? values[i]! / values[i + 1]!
            : 0;
      values.splice(i, 2, result);
      ops.splice(i, 1);
    } else {
      i++;
    }
  }

  // Second pass handles + and -
  let result = values[0]!;
  for (let j = 0; j < ops.length; j++) {
    result = ops[j] === '+' ? result + values[j + 1]! : result - values[j + 1]!;
  }

  return Math.round(result * divisor);
}

export function CurrencyInput({
  value = 0,
  onChange,
  placeholder,
  prefix = '$',
  suffix,
  decimals = 2,
  allowNegative = false,
  readOnly = false,
  id,
  name,
  'aria-label': ariaLabel,
}: CurrencyInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const [internalUnits, setInternalUnits] = useState(value);
  const [segments, setSegments] = useState<ExprSegment[]>([]);
  const units = value !== undefined ? value : internalUnits;
  const inputRef = useRef<HTMLInputElement>(null);

  // Digits accumulate on the magnitude, so the sign has to be held apart:
  // `units * 10 + digit` turns -16 into -153, not -165. Seeded from an incoming
  // negative value so a field rendered with one keeps typing negative.
  const [negativeState, setNegative] = useState(false);
  const negative = units !== 0 ? units < 0 : negativeState;
  const signed = useCallback(
    (magnitude: number) => (allowNegative && negative ? -magnitude : magnitude),
    [allowNegative, negative],
  );

  const isExprMode = segments.length > 0;

  const resolve = useCallback(() => {
    if (!isExprMode) return;
    const result = evaluateExpr(segments, units, decimals);
    const finalUnits = allowNegative ? result : Math.max(0, result);
    setSegments([]);
    setInternalUnits(finalUnits);
    onChange?.(finalUnits);
  }, [segments, units, decimals, isExprMode, onChange, allowNegative]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab') {
        if (isExprMode) resolve();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isExprMode) resolve();
        return;
      }
      e.preventDefault();

      // A leading '-' sets the sign; anywhere else it still starts a subtraction.
      if (e.key === '-' && allowNegative && units === 0 && segments.length === 0) {
        setNegative((n) => !n);
        return;
      }

      if (OPERATORS.has(e.key)) {
        setSegments((prev) => [...prev, { units, operator: e.key as Operator }]);
        setInternalUnits(0);
        onChange?.(0);
        return;
      }

      if (e.key === 'Backspace') {
        if (units === 0 && segments.length === 0 && negative) {
          setNegative(false);
          return;
        }
        if (units === 0 && segments.length > 0) {
          const prev = [...segments];
          const last = prev.pop()!;
          setSegments(prev);
          setInternalUnits(last.units);
          onChange?.(last.units);
        } else {
          const next = signed(Math.floor(Math.abs(units) / 10));
          setInternalUnits(next);
          onChange?.(next);
        }
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        const digit = parseInt(e.key, 10);
        const nextMagnitude = Math.abs(units) * 10 + digit;
        if (nextMagnitude > 99999999999) return;
        const next = signed(nextMagnitude);
        setInternalUnits(next);
        onChange?.(next);
      }
    },
    [units, onChange, segments, isExprMode, resolve, allowNegative, negative, signed],
  );

  const handleBlur = useCallback(() => {
    if (isExprMode) resolve();
  }, [isExprMode, resolve]);

  const defaultPlaceholder = `0.${'0'.repeat(decimals)}`;

  let display: string;
  if (isExprMode) {
    const parts = segments.map((s) => `${formatUnits(s.units, decimals)} ${s.operator} `);
    display = parts.join('') + formatUnits(units, decimals);
  } else {
    display = units === 0 && placeholder ? '' : formatUnits(units, decimals);
  }

  const hasSuffix = !!suffix;
  const paddingStyle: React.CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    ...(prefix ? { paddingLeft: vars.space['7'] } : {}),
    ...(hasSuffix ? { paddingRight: vars.space['9'] } : {}),
    ...(readOnly ? { opacity: 0.7, cursor: 'default' } : {}),
  };

  return (
    <div className={inp.inputWrap}>
      {prefix && <span className={inp.inputPrefix}>{prefix}</span>}
      <input
        ref={inputRef}
        id={inputId}
        name={inputName}
        className={inp.input}
        type="text"
        inputMode="numeric"
        value={display}
        placeholder={placeholder ?? defaultPlaceholder}
        onKeyDown={readOnly ? undefined : handleKeyDown}
        onBlur={readOnly ? undefined : handleBlur}
        onChange={() => {}}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        aria-label={ariaLabel || undefined}
        style={paddingStyle}
      />
      {suffix && <span className={inp.inputSuffix}>{suffix}</span>}
    </div>
  );
}
