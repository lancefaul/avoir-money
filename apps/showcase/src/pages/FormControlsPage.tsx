import { useState } from 'react';
import { Info } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import { Checkbox, RadioGroup, Toggle, formControlStyles as fc } from '@budget-tracker/ui';

export default function FormControlsPage() {
  /* ── Checkbox states ── */
  const [cb1, setCb1] = useState(false);
  const [cb2, setCb2] = useState(true);
  const [cbIndet, setCbIndet] = useState(false);

  /* ── Checkbox group ── */
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifSms, setNotifSms] = useState(false);
  const [notifPush, setNotifPush] = useState(true);
  const [notifDigest, setNotifDigest] = useState(false);

  /* ── Radio states ── */
  const [radioState, setRadioState] = useState<string | undefined>(undefined);
  const [radioSelected, setRadioSelected] = useState('monthly');

  /* ── Radio group ── */
  const [payFreq, setPayFreq] = useState('biweekly');

  /* ── Toggle states ── */
  const [toggleOff, setToggleOff] = useState(false);
  const [toggleOn, setToggleOn] = useState(true);

  /* ── Toggle label placement ── */
  const [toggleLeft, setToggleLeft] = useState(true);
  const [toggleRight, setToggleRight] = useState(false);

  /* ── Mixed form ── */
  const [mixedRadio, setMixedRadio] = useState('monthly');
  const [mixedIncome, setMixedIncome] = useState(true);
  const [mixedExpenses, setMixedExpenses] = useState(true);
  const [mixedTransfers, setMixedTransfers] = useState(false);
  const [mixedInvestments, setMixedInvestments] = useState(false);
  const [mixedRound, setMixedRound] = useState(false);
  const [mixedCents, setMixedCents] = useState(true);

  const statesGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(13.75rem, 1fr))',
    gap: vars.space['4'],
  };

  return (
    <>
      {/* ── 1. Checkbox states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Checkboxes – states</div>
        <div style={statesGrid}>
          <div>
            <Checkbox label="Enable notifications" checked={cb1} onChange={setCb1} />
            <span className={s.ann}>default</span>
          </div>
          <div>
            <Checkbox label="Enable notifications" checked={cb2} onChange={setCb2} />
            <span className={s.ann}>checked</span>
          </div>
          <div>
            <Checkbox label="Select all" indeterminate checked={cbIndet} onChange={setCbIndet} />
            <span className={s.ann}>indeterminate</span>
          </div>
          <div>
            <Checkbox label="Premium feature" disabled />
            <span className={s.ann}>disabled</span>
          </div>
          <div>
            <Checkbox label="Terms accepted" checked disabled />
            <span className={s.ann}>disabled + checked</span>
          </div>
          <div>
            <Checkbox
              label="Auto-pay"
              helper="Automatically pay bills on due date"
              checked={cb1}
              onChange={setCb1}
            />
            <span className={s.ann}>with helper</span>
          </div>
        </div>
      </div>

      {/* ── 2. Checkbox group ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Checkbox group</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: vars.space['8'] }}>
          <div>
            <div className={fc.groupLabel}>Notification preferences</div>
            <div className={fc.groupWrapper}>
              <Checkbox label="Email notifications" checked={notifEmail} onChange={setNotifEmail} />
              <Checkbox label="SMS alerts" checked={notifSms} onChange={setNotifSms} />
              <Checkbox label="Push notifications" checked={notifPush} onChange={setNotifPush} />
              <Checkbox label="Weekly digest" checked={notifDigest} onChange={setNotifDigest} />
            </div>
          </div>
          <div>
            <div className={fc.groupLabel}>Required selections</div>
            <div className={`${fc.groupWrapper} ${fc.groupError}`}>
              <Checkbox label="Option A" />
              <Checkbox label="Option B" />
              <Checkbox label="Option C" />
            </div>
            <div className={fc.groupErrorMessage}>
              <Info size={12} /> Select at least one option
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Radio buttons – states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Radio buttons – states</div>
        <div style={statesGrid}>
          <div>
            <RadioGroup
              name="radio-default"
              options={[{ value: 'monthly', label: 'Monthly' }]}
              value={radioState}
              onChange={setRadioState}
            />
            <span className={s.ann}>default</span>
          </div>
          <div>
            <RadioGroup
              name="radio-selected"
              options={[{ value: 'monthly', label: 'Monthly' }]}
              value={radioSelected}
              onChange={setRadioSelected}
            />
            <span className={s.ann}>selected</span>
          </div>
          <div>
            <RadioGroup
              name="radio-disabled"
              options={[{ value: 'custom', label: 'Custom', disabled: true }]}
            />
            <span className={s.ann}>disabled</span>
          </div>
          <div>
            <RadioGroup
              name="radio-disabled-selected"
              options={[{ value: 'annual', label: 'Annual', disabled: true }]}
              value="annual"
            />
            <span className={s.ann}>disabled + selected</span>
          </div>
          <div>
            <RadioGroup
              name="radio-helper"
              options={[
                { value: 'biweekly', label: 'Biweekly', helper: 'Every two weeks on Friday' },
              ]}
              value="biweekly"
            />
            <span className={s.ann}>with helper</span>
          </div>
        </div>
      </div>

      {/* ── 4. Radio group ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Radio group</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: vars.space['8'] }}>
          <div>
            <div className={fc.groupLabel}>Payment frequency</div>
            <RadioGroup
              name="pay-freq"
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'biweekly', label: 'Biweekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'annual', label: 'Annual' },
              ]}
              value={payFreq}
              onChange={setPayFreq}
            />
          </div>
          <div>
            <div className={fc.groupLabel}>Account type</div>
            <div className={fc.groupError}>
              <RadioGroup
                name="account-type-error"
                options={[
                  { value: 'checking', label: 'Checking' },
                  { value: 'savings', label: 'Savings' },
                  { value: 'credit', label: 'Credit card' },
                ]}
              />
            </div>
            <div className={fc.groupErrorMessage}>
              <Info size={12} /> Please select an account type
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Toggle states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Toggle switch – states</div>
        <div style={statesGrid}>
          <div>
            <Toggle label="Dark mode" checked={toggleOff} onChange={setToggleOff} />
            <span className={s.ann}>off</span>
          </div>
          <div>
            <Toggle label="Auto-save" checked={toggleOn} onChange={setToggleOn} />
            <span className={s.ann}>on</span>
          </div>
          <div>
            <Toggle label="Beta features" disabled />
            <span className={s.ann}>disabled off</span>
          </div>
          <div>
            <Toggle label="Required setting" checked disabled />
            <span className={s.ann}>disabled on</span>
          </div>
        </div>
      </div>

      {/* ── 6. Toggle label placement ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Toggle switch – label placement</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['4'],
            maxWidth: '25rem',
          }}
        >
          <div>
            <Toggle
              label="Enable auto-categorization"
              labelPosition="left"
              checked={toggleLeft}
              onChange={setToggleLeft}
            />
            <span className={s.ann}>label left (default)</span>
          </div>
          <div>
            <Toggle
              label="Show hidden accounts"
              labelPosition="right"
              checked={toggleRight}
              onChange={setToggleRight}
            />
            <span className={s.ann}>label right</span>
          </div>
        </div>
      </div>

      {/* ── 7. Mixed form example ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Mixed form example</div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: vars.space['8'],
            maxWidth: '25rem',
          }}
        >
          <div>
            <div className={fc.groupLabel}>Budget period</div>
            <RadioGroup
              name="mixed-period"
              options={[
                { value: 'weekly', label: 'Weekly' },
                { value: 'biweekly', label: 'Biweekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              value={mixedRadio}
              onChange={setMixedRadio}
            />
          </div>
          <div>
            <div className={fc.groupLabel}>Include in reports</div>
            <div className={fc.groupWrapper}>
              <Checkbox label="Income" checked={mixedIncome} onChange={setMixedIncome} />
              <Checkbox label="Expenses" checked={mixedExpenses} onChange={setMixedExpenses} />
              <Checkbox label="Transfers" checked={mixedTransfers} onChange={setMixedTransfers} />
              <Checkbox
                label="Investments"
                checked={mixedInvestments}
                onChange={setMixedInvestments}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['3'] }}>
            <Toggle label="Auto-round transactions" checked={mixedRound} onChange={setMixedRound} />
            <Toggle label="Show cents" checked={mixedCents} onChange={setMixedCents} />
          </div>
        </div>
      </div>

      {/* ── Standalone variants ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Standalone (no label)</div>
        <div className={s.card}>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo} style={{ display: 'flex', gap: vars.space['3'] }}>
              <Checkbox standalone checked={false} onChange={() => {}} />
              <Checkbox standalone checked={true} onChange={() => {}} />
              <Checkbox standalone indeterminate onChange={() => {}} />
              <Checkbox standalone disabled />
            </div>
            <span className={s.patternLabel}>Checkbox standalone</span>
            <span className={s.sizeSpec}>32×32 container · no label · centered checkbox</span>
          </div>
          <div className={s.sizeRow}>
            <div className={s.sizeDemo} style={{ display: 'flex', gap: vars.space['3'] }}>
              <RadioGroup
                standalone
                name="standalone-radio"
                options={[
                  { value: 'a', label: '' },
                  { value: 'b', label: '' },
                  { value: 'c', label: '', disabled: true },
                ]}
                value="b"
                onChange={() => {}}
              />
            </div>
            <span className={s.patternLabel}>Radio standalone</span>
            <span className={s.sizeSpec}>32×32 container · no label · centered radio</span>
          </div>
        </div>
      </div>
    </>
  );
}
