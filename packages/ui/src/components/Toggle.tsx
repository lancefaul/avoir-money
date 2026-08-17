import { useId } from 'react';
import * as fc from './form-controls.css.js';

export interface ToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  helper?: string;
  disabled?: boolean;
  labelPosition?: 'left' | 'right';
  /** HTML id attribute forwarded to the switch button element. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id if not provided. */
  name?: string;
}

export function Toggle({
  checked = false,
  onChange,
  label,
  helper,
  disabled = false,
  labelPosition = 'left',
  id,
  name,
}: ToggleProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const trackClasses = [
    fc.toggleTrack,
    checked ? fc.toggleTrackOn : '',
    disabled && checked ? fc.toggleTrackDisabledOn : '',
    disabled && !checked ? fc.toggleTrackDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const thumbClasses = [
    fc.toggleThumb,
    checked ? fc.toggleThumbOn : '',
    disabled ? fc.toggleThumbDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const rowClasses = [fc.toggleRow, disabled ? fc.disabledRow : ''].filter(Boolean).join(' ');

  const labelContent =
    label || helper ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: labelPosition === 'left' ? 1 : undefined,
        }}
      >
        {label && (
          <span className={`${fc.controlLabel} ${disabled ? fc.controlDisabledLabel : ''}`}>
            {label}
          </span>
        )}
        {helper && <span className={fc.controlHelper}>{helper}</span>}
      </div>
    ) : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      if (!disabled) onChange?.(!checked);
    }
  };

  return (
    <label className={rowClasses}>
      {labelPosition === 'left' && labelContent}
      <button
        type="button"
        role="switch"
        id={inputId}
        name={inputName}
        aria-checked={checked}
        disabled={disabled}
        className={trackClasses}
        onClick={() => onChange?.(!checked)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <span className={thumbClasses} />
      </button>
      {labelPosition === 'right' && labelContent}
    </label>
  );
}
