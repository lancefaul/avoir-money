import { useRef, useCallback, useId } from 'react';
import * as fc from './form-controls.css.js';

export interface RadioOption {
  value: string;
  label: string;
  helper?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  /** HTML id attribute prefix — individual radios get `${id}-${option.value}`. */
  id?: string;
  /** Render each option as a 32×32 standalone radio with no label. */
  standalone?: boolean;
  /** Accessible name for the group, when no visible label is associated. */
  ariaLabel?: string;
}

export function RadioGroup({
  options,
  value,
  onChange,
  name,
  disabled = false,
  id,
  standalone = false,
  ariaLabel,
}: RadioGroupProps) {
  const autoId = useId();
  const groupId = id ?? autoId;
  const groupName = name ?? groupId;
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const enabledOptions = options.filter((o) => !o.disabled && !disabled);
      if (enabledOptions.length === 0) return;

      const currentIdx = enabledOptions.findIndex((o) => o.value === value);
      let nextIdx = currentIdx;

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        nextIdx = (currentIdx + 1) % enabledOptions.length;
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIdx = (currentIdx - 1 + enabledOptions.length) % enabledOptions.length;
      } else {
        return;
      }

      const next = enabledOptions[nextIdx];
      if (!next) return;
      onChange?.(next.value);

      // Focus the corresponding input
      const inputs = groupRef.current?.querySelectorAll('input[type="radio"]');
      if (inputs) {
        const realIdx = options.findIndex((o) => o.value === next.value);
        (inputs[realIdx] as HTMLElement)?.focus();
      }
    },
    [options, value, onChange, disabled],
  );

  return (
    <div
      ref={groupRef}
      className={fc.groupWrapper}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const isDisabled = option.disabled || disabled;

        const circleClasses = [
          fc.radioCircle,
          isSelected ? fc.radioCircleSelected : '',
          isDisabled ? fc.radioCircleDisabled : '',
        ]
          .filter(Boolean)
          .join(' ');

        const rowClasses = [
          standalone ? fc.standaloneWrap : fc.radioRow,
          isDisabled ? (standalone ? fc.standaloneDisabled : fc.disabledRow) : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <label key={option.value} className={rowClasses}>
            <input
              type="radio"
              className={fc.hiddenInput}
              id={`${groupId}-${option.value}`}
              name={groupName}
              value={option.value}
              checked={isSelected}
              disabled={isDisabled}
              tabIndex={
                isSelected || (!value && option === options.find((o) => !o.disabled && !disabled))
                  ? 0
                  : -1
              }
              onChange={() => onChange?.(option.value)}
              aria-checked={isSelected}
            />
            <div className={circleClasses}>
              {isSelected && (
                <span className={`${fc.radioDot} ${isDisabled ? fc.radioDotDisabled : ''}`} />
              )}
            </div>
            {!standalone && (option.label || option.helper) && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {option.label && (
                  <span
                    className={`${fc.controlLabel} ${isDisabled ? fc.controlDisabledLabel : ''}`}
                  >
                    {option.label}
                  </span>
                )}
                {option.helper && <span className={fc.controlHelper}>{option.helper}</span>}
              </div>
            )}
          </label>
        );
      })}
    </div>
  );
}
