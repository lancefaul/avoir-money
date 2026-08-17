import { useRef, useEffect, useId } from 'react';
import { Check, Minus } from 'lucide-react';
import * as fc from './form-controls.css.js';

export interface CheckboxProps {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  helper?: string;
  disabled?: boolean;
  /** Render as a 32×32 standalone checkbox with no label. */
  standalone?: boolean;
  /** HTML id attribute forwarded to the underlying input element. */
  id?: string;
  /** HTML name attribute forwarded to the underlying input element. */
  name?: string;
  /** Accessible label for standalone checkboxes without visible text. */
  'aria-label'?: string;
}

export function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  helper,
  disabled = false,
  standalone = false,
  id,
  name,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const boxClasses = [
    fc.checkboxBox,
    checked && !indeterminate ? fc.checkboxBoxChecked : '',
    indeterminate ? fc.checkboxBoxIndeterminate : '',
    disabled ? fc.checkboxBoxDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rowClasses = [
    standalone ? fc.standaloneWrap : fc.checkboxRow,
    disabled ? (standalone ? fc.standaloneDisabled : fc.disabledRow) : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={rowClasses}>
      <input
        ref={inputRef}
        type="checkbox"
        id={inputId}
        name={inputName}
        className={fc.hiddenInput}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={ariaLabel}
      />
      <div className={boxClasses}>
        {(checked || indeterminate) && (
          <span className={fc.checkboxIcon}>
            {indeterminate ? (
              <Minus size={10} strokeWidth={3} />
            ) : (
              <Check size={12} strokeWidth={3} />
            )}
          </span>
        )}
      </div>
      {!standalone && (label || helper) && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {label && (
            <span className={`${fc.controlLabel} ${disabled ? fc.controlDisabledLabel : ''}`}>
              {label}
            </span>
          )}
          {helper && <span className={fc.controlHelper}>{helper}</span>}
        </div>
      )}
    </label>
  );
}
