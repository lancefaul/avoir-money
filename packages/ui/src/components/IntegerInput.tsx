import { useState, useCallback, useRef, useId } from 'react';
import * as inp from './inputs.css.js';
import { vars } from '../theme/contract.css.js';

export interface IntegerInputProps {
  /** The integer value. */
  value?: number;
  onChange?: (value: number) => void;
  placeholder?: string;
  /** Minimum allowed value (inclusive). Defaults to 0. */
  min?: number;
  /** Maximum allowed value (inclusive). Defaults to 999,999,999. */
  max?: number;
  /** Optional prefix shown inside the input (e.g. unit label). */
  prefix?: string;
  /** Optional suffix shown inside the input (e.g. "kWh"). */
  suffix?: string;
  /** When true, the input displays the value but does not accept user input. */
  readOnly?: boolean;
  disabled?: boolean;
  error?: boolean;
  /** HTML id attribute forwarded to the underlying input element. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id if not provided. */
  name?: string;
  /** Accessible label for the input when no visible label is associated. */
  'aria-label'?: string;
}

function formatInteger(n: number): string {
  return n.toLocaleString('en-US');
}

export function IntegerInput({
  value = 0,
  onChange,
  placeholder = '0',
  min: _min = 0,
  max = 999_999_999,
  prefix,
  suffix,
  readOnly = false,
  disabled = false,
  error = false,
  id,
  name,
  'aria-label': ariaLabel,
}: IntegerInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const [internalValue, setInternalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = value !== undefined ? value : internalValue;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
      if (e.key === 'Enter') return;
      e.preventDefault();

      if (e.key === 'Backspace') {
        const next = Math.floor(current / 10);
        setInternalValue(next);
        onChange?.(next);
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        const digit = parseInt(e.key, 10);
        const next = current * 10 + digit;
        if (next > max) return;
        setInternalValue(next);
        onChange?.(next);
      }
    },
    [current, onChange, max],
  );

  const display = current === 0 && placeholder ? '' : formatInteger(current);

  const paddingStyle: React.CSSProperties = {
    fontVariantNumeric: 'tabular-nums',
    ...(prefix ? { paddingLeft: vars.space['7'] } : {}),
    ...(suffix ? { paddingRight: vars.space['9'] } : {}),
    ...(readOnly ? { opacity: 0.7, cursor: 'default' } : {}),
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
        inputMode="numeric"
        value={display}
        placeholder={placeholder}
        onKeyDown={readOnly || disabled ? undefined : handleKeyDown}
        onChange={() => {}}
        readOnly={readOnly}
        disabled={disabled}
        tabIndex={readOnly ? -1 : undefined}
        aria-label={ariaLabel || undefined}
        style={paddingStyle}
      />
      {suffix && <span className={inp.inputSuffix}>{suffix}</span>}
    </div>
  );
}
