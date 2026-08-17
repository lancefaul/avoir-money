import { useState, useId } from 'react';
import { X } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import {
  inputStyles as inp,
  chipStyles as ch,
  selectStyles as sel,
  CurrencyInput,
  BitcoinInput,
  IntegerInput,
  DecimalInput,
} from '@budget-tracker/ui';
import InputsBaseSections from './InputsBaseSections.js';

export default function InputsPage() {
  const fid = useId();
  const [currencyVal, setCurrencyVal] = useState(0);
  const [btcVal, setBtcVal] = useState(0);
  const [intVal, setIntVal] = useState(0);
  const [intDayVal, setIntDayVal] = useState(15);
  const [decVal, setDecVal] = useState(0);
  const [intYearVal, setIntYearVal] = useState(2026);

  const statesGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(13.75rem, 1fr))',
    gap: vars.space['4'],
  };

  return (
    <>
      <InputsBaseSections />

      {/* ── 5. Chips ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Chips</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['5'],
            maxWidth: '25rem',
          }}
        >
          <div className={inp.field}>
            <label htmlFor={`${fid}-standalone-chips`} className={inp.fieldLabel}>
              Standalone chips
            </label>
            <div id={`${fid}-standalone-chips`} className={ch.chipGroup}>
              <span className={ch.chip}>
                Essential
                <button type="button" className={ch.chipX} aria-label="Remove Essential">
                  <X size={10} />
                </button>
              </span>
              <span className={ch.chip}>
                Recurring
                <button type="button" className={ch.chipX} aria-label="Remove Recurring">
                  <X size={10} />
                </button>
              </span>
              <span className={ch.chip}>
                Tax Deductible
                <button type="button" className={ch.chipX} aria-label="Remove Tax Deductible">
                  <X size={10} />
                </button>
              </span>
            </div>
            <span className={s.ann}>pill shape · remove button</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-chips-inside-input`} className={inp.fieldLabel}>
              Chips inside input
            </label>
            <div
              id={`${fid}-chips-inside-input`}
              className={`${sel.csTrigger} ${sel.csTriggerMulti}`}
            >
              <span className={ch.chip}>
                Stock
                <button type="button" className={ch.chipX} aria-label="Remove Stock">
                  <X size={10} />
                </button>
              </span>
              <span className={ch.chip}>
                ETF
                <button type="button" className={ch.chipX} aria-label="Remove ETF">
                  <X size={10} />
                </button>
              </span>
            </div>
            <span className={s.ann}>inside multi-select trigger</span>
          </div>
        </div>
      </div>

      {/* ── 6. Currency input ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Currency input – right-fill formatter</div>
        <div style={{ maxWidth: '17.5rem' }}>
          <div className={inp.field}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-amount`} className={inp.fieldLabel}>
                Amount
              </label>
              <div className={inp.fieldHelper}>
                Type digits → fills from right. Internal: {currencyVal} cents = $
                {(currencyVal / 100).toFixed(2)}
              </div>
            </div>
            <CurrencyInput id={`${fid}-amount`} value={currencyVal} onChange={setCurrencyVal} />
          </div>
        </div>
      </div>

      {/* ── 7. Integer input ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Integer input – comma-formatted whole numbers</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-int-usage`} className={inp.fieldLabel}>
                Usage
              </label>
              <div className={inp.fieldHelper}>
                Type digits → appends. Value: {intVal.toLocaleString('en-US')}
              </div>
            </div>
            <IntegerInput
              id={`${fid}-int-usage`}
              value={intVal}
              onChange={setIntVal}
              suffix="kWh"
              placeholder="0"
            />
            <span className={s.ann}>with suffix</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-int-day`} className={inp.fieldLabel}>
              Pay Day (1–31)
            </label>
            <IntegerInput
              id={`${fid}-int-day`}
              value={intDayVal}
              onChange={setIntDayVal}
              min={1}
              max={31}
              placeholder="1"
            />
            <span className={s.ann}>min/max constrained</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-int-year`} className={inp.fieldLabel}>
              Year
            </label>
            <IntegerInput
              id={`${fid}-int-year`}
              value={intYearVal}
              onChange={setIntYearVal}
              min={2000}
              max={2100}
              placeholder="2026"
            />
            <span className={s.ann}>year range</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-int-disabled`} className={inp.fieldLabel}>
              Duration
            </label>
            <IntegerInput id={`${fid}-int-disabled`} value={30} disabled placeholder="0" />
            <span className={s.ann}>disabled</span>
          </div>
        </div>
      </div>

      {/* ── Decimal input ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Decimal input</div>
        <div style={{ maxWidth: '20rem' }}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-dec-quantity`} className={inp.fieldLabel}>
              Quantity
            </label>
            <DecimalInput
              id={`${fid}-dec-quantity`}
              value={decVal}
              onChange={setDecVal}
              precision={5}
              max={100}
              placeholder="0.00000"
            />
            <span className={s.ann}>precision=5, max=100, value: {decVal}</span>
          </div>
        </div>
      </div>

      {/* ── 8. Bitcoin input ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Bitcoin input – BTC / sats toggle</div>
        <div style={{ maxWidth: '20rem' }}>
          <div className={inp.field}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-bitcoin-amount`} className={inp.fieldLabel}>
                Bitcoin amount
              </label>
              <div className={inp.fieldHelper}>
                Internal: {btcVal} sats = {(btcVal / 100_000_000).toFixed(8)} BTC
              </div>
            </div>
            <BitcoinInput id={`${fid}-bitcoin-amount`} value={btcVal} onChange={setBtcVal} />
          </div>
        </div>
      </div>
    </>
  );
}
