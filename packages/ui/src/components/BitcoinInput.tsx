import { useState, useCallback, useId } from 'react';
import * as inp from './inputs.css.js';
import { vars } from '../theme/contract.css.js';
import { ButtonGroup } from './ButtonGroup.js';

interface BitcoinInputProps {
  value?: number; // always stored as sats internally
  onChange?: (sats: number) => void;
  /** HTML id attribute forwarded to the underlying input element. */
  id?: string;
  /** HTML name attribute. Defaults to the resolved id if not provided. */
  name?: string;
  /** Accessible label for the input when no visible label is associated. */
  'aria-label'?: string;
}

const SATS_PER_BTC = 100_000_000;

function formatBtcFromSats(sats: number): string {
  const btc = Math.floor(sats);
  const whole = Math.floor(btc / SATS_PER_BTC);
  const frac = btc % SATS_PER_BTC;
  const wholeStr = whole.toLocaleString('en-US');
  const fracStr = frac.toString().padStart(8, '0');
  return `${wholeStr}.${fracStr}`;
}

function formatSatsDisplay(sats: number): string {
  return Math.floor(sats).toLocaleString('en-US');
}

export function BitcoinInput({
  value = 0,
  onChange,
  id,
  name,
  'aria-label': ariaLabel,
}: BitcoinInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const inputName = name ?? inputId;
  const [internalSats, setInternalSats] = useState(value);
  const [mode, setMode] = useState<'BTC' | 'sats'>('BTC');
  const sats = value !== undefined ? value : internalSats;

  const update = useCallback(
    (next: number) => {
      setInternalSats(next);
      onChange?.(next);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
      e.preventDefault();

      if (e.key === 'Backspace') {
        update(Math.floor(sats / 10));
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        const digit = parseInt(e.key, 10);
        const next = sats * 10 + digit;
        if (next > 21_000_000 * SATS_PER_BTC) return;
        update(next);
      }
    },
    [sats, update],
  );

  const display = mode === 'BTC' ? formatBtcFromSats(sats) : formatSatsDisplay(sats);

  return (
    <div className={inp.inputWrap}>
      <span className={inp.inputPrefix} style={{ fontSize: vars.font.xs }}>
        ₿
      </span>
      <input
        id={inputId}
        name={inputName}
        className={inp.input}
        type="text"
        inputMode="numeric"
        value={sats === 0 ? '' : display}
        placeholder={mode === 'BTC' ? '0.00000000' : '0'}
        onKeyDown={handleKeyDown}
        onChange={() => {}}
        aria-label={ariaLabel || undefined}
        style={{
          paddingLeft: vars.space['7'],
          paddingRight: '4.5rem',
          fontVariantNumeric: 'tabular-nums',
        }}
      />
      <div className={inp.inputActionSlot}>
        <ButtonGroup
          size="sm"
          options={[
            { value: 'BTC', label: 'BTC' },
            { value: 'sats', label: 'sats' },
          ]}
          value={mode}
          onChange={(v) => setMode(v as 'BTC' | 'sats')}
          ariaLabel="Bitcoin unit"
        />
      </div>
    </div>
  );
}
