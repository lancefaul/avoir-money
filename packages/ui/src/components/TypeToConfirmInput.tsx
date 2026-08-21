import { useId } from 'react';
import * as inp from './inputs.css.js';
import { vars } from '../theme/contract.css.js';

export interface TypeToConfirmInputProps {
  /** The exact word the user must type to confirm (e.g. "DELETE", "RESTORE"). */
  confirmWord: string;
  /** Current input value — controlled. */
  value: string;
  /** Called when the input value changes. */
  onChange: (value: string) => void;
  /** HTML id attribute. Auto-generated if not provided. */
  id?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
}

export function TypeToConfirmInput({
  confirmWord,
  value,
  onChange,
  id,
  disabled = false,
}: TypeToConfirmInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className={inp.field}>
      <label htmlFor={inputId} className={inp.fieldLabel}>
        Type{' '}
        <span
          style={{
            fontWeight: vars.font.semibold,
            color: vars.color.danger400,
            letterSpacing: vars.font.trackingWide,
          }}
        >
          {confirmWord}
        </span>{' '}
        to confirm
      </label>
      <input
        id={inputId}
        type="text"
        className={inp.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={confirmWord}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
