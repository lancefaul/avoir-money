import { useState, useId } from 'react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import {
  DatePicker,
  DateRangePicker,
  type DateRange,
  inputStyles as inp,
} from '@budget-tracker/ui';

export default function DatePickerPage() {
  const fid = useId();
  const [single1, setSingle1] = useState<Date | null>(null);
  const [single2, setSingle2] = useState<Date | null>(new Date(2026, 3, 18));
  const [singleError, setSingleError] = useState<Date | null>(null);
  const [range1, setRange1] = useState<DateRange>({ start: null, end: null });
  const [range2, setRange2] = useState<DateRange>({
    start: new Date(2026, 3, 1),
    end: new Date(2026, 3, 30),
  });

  const statesGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
    gap: vars.space['5'],
  };

  return (
    <>
      {/* ── 1. Trigger states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Trigger states</div>
        <div style={statesGrid}>
          <div>
            <DatePicker />
            <span className={s.ann}>default · no value</span>
          </div>
          <div>
            <DatePicker value={single2} onChange={setSingle2} />
            <span className={s.ann}>date selected</span>
          </div>
          <div>
            <DateRangePicker value={range2} onChange={setRange2} />
            <span className={s.ann}>range selected</span>
          </div>
          <div>
            <DatePicker disabled />
            <span className={s.ann}>disabled</span>
          </div>
          <div>
            <DatePicker error value={singleError} onChange={setSingleError} />
            <span className={s.ann}>error</span>
          </div>
        </div>
      </div>

      {/* ── 2. Single date picker ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Single date picker</div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: vars.space['10'],
            alignItems: 'flex-start',
          }}
        >
          <div className={inp.field} style={{ width: '14rem' }}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-bill-date`} className={inp.fieldLabel}>
                Bill date <span className={inp.fieldRequired}>*</span>
              </label>
            </div>
            <DatePicker id={`${fid}-bill-date`} value={single1} onChange={setSingle1} />
            <span className={s.ann}>←→↑↓ navigate · Enter select · Esc close · type to search</span>
          </div>
        </div>
      </div>

      {/* ── 3. Date range picker ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Date range picker</div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: vars.space['10'],
            alignItems: 'flex-start',
          }}
        >
          <div className={inp.field} style={{ minWidth: '14rem' }}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-transaction-date-ran`} className={inp.fieldLabel}>
                Transaction date range
              </label>
            </div>
            <DateRangePicker
              id={`${fid}-transaction-date-ran`}
              value={range1}
              onChange={setRange1}
            />
            <span className={s.ann}>
              two-month view · click start then end · hover previews range
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
