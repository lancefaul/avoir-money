import { useState, useCallback, useId, useRef } from 'react';
import * as inp from './inputs.css.js';
import { vars } from '../theme/contract.css.js';

export interface DecimalInputProps {
  /** The numeric value. */
  value?: number;
  onChange?: (value: number) => void;
  placeholder?: string;
  /** Minimum allowed value (inclusive). Defaults to 0. */
  min?: number;
  /** Maximum allowed value (inclusive). */
  max?: number;
  /** Number of decimal places to allow. @default 5 */
  precision?: number;
  /** Step increment for the input. @default derived from precision */
  step?: number;
  /** Optional prefix shown inside the input. */
  prefix?: string;
  /** Optional suffix shown inside the input. */
  suffix?: string;
  disabled?: boolean;
  error?: boolean;
  /** HTML id attribute forwarded to the underlying input element. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id if not provided. */
  name?: string;
  /** Accessible label for the input when no visible label is associated. */
  'aria-label'?: string;
}

export function DecimalInput({
  value,
  onChange,
  placeholder = '0',
  min = 0,
  max,
  precision = 5,
  step,
  prefix,
  suffix,
  disabled = false,
  error = false,
  id,
  name,
  'aria-label': ariaLabel,
}: DecimalInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayValue, setDisplayValue] = useState(() =>
    value !== undefined && value !== 0 ? String(value) : '',
  );

  const computedStep = step ?? 1 / Math.pow(10, precision);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;

      // Allow empty string (clearing the field)
      if (raw === '') {
        setDisplayValue('');
        onChange?.(0);
        return;
      }

      // Allow intermediate states like "0." or "1.0"
      const decimalPattern = new RegExp(`^-?\\d*\\.?\\d{0,${precision}}$`);
      if (!decimalPattern.test(raw)) return;

      setDisplayValue(raw);

      const num = parseFloat(raw);
      if (isNaN(num)) return;

      // Enforce max
      if (max !== undefined && num > max) {
        const clamped = max;
        setDisplayValue(String(clamped));
        onChange?.(clamped);
        return;
      }

      // Enforce min
      if (num < min) {
        onChange?.(num); // Allow typing — don't clamp during entry
        return;
      }

      onChange?.(num);
    },
    [onChange, min, max, precision],
  );

  // Sync display when value changes externally
  const prevValueRef = useRef(value);
  if (value !== prevValueRef.current) {
    prevValueRef.current = value;
    const newDisplay = value !== undefined && value !== 0 ? String(value) : '';
    if (newDisplay !== displayValue && document.activeElement !== inputRef.current) {
      setDisplayValue(newDisplay);
    }
  }

  const paddingStyle: React.CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    ...(prefix ? { paddingLeft: vars.space['7'] } : {}),
    ...(suffix ? { paddingRight: vars.space['9'] } : {}),
  };

  const inputClasses = [inp.input, error ? inp.inputError : ''].filter(Boolean).join(' ');

  return (
    <div className={inp.inputWrap}>
      {prefix && <span className={inp.inputPrefix}>{prefix}</span>}
      <input
        ref={inputRef}
        id={inputId}
        name={inputName}
        className={inputClasses}
        type="text"
        inputMode="decimal"
        value={displayValue}
        placeholder={placeholder}
        onChange={disabled ? undefined : handleChange}
        disabled={disabled}
        step={computedStep}
        min={min}
        max={max}
        aria-label={ariaLabel || undefined}
        style={paddingStyle}
      />
      {suffix && <span className={inp.inputSuffix}>{suffix}</span>}
    </div>
  );
}
