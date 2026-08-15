import { useState, useId } from 'react';
import { Info } from 'lucide-react';
import * as s from '../showcase.css.js';
import { inputStyles as inp, Select, Badge, type SelectOption } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';

const assetTypes: SelectOption[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'etf', label: 'ETF' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'mutual-fund', label: 'Mutual Fund' },
  { value: 'bond', label: 'Bond' },
  { value: 'real-estate', label: 'Real Estate' },
];

const frequencies: SelectOption[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
];

const custodians: SelectOption[] = [
  { value: 'betterment', label: 'Betterment' },
  { value: 'cash-app', label: 'Cash Wallet' },
  { value: 'charles-schwab', label: 'Charles Schwab' },
  { value: 'custodian-a', label: 'Custodian A' },
  { value: 'etrade', label: 'E*TRADE' },
  { value: 'fidelity', label: 'Fidelity' },
  { value: 'ibkr', label: 'Interactive Brokers' },
  { value: 'robinhood', label: 'Robinhood' },
  { value: 'td-ameritrade', label: 'TD Ameritrade' },
  { value: 'vanguard', label: 'Vanguard' },
];

const linkedAccounts: SelectOption[] = [
  { value: 'chase-checking', label: 'Chase Checking', group: 'Checking & Savings' },
  { value: 'ally-savings', label: 'Ally Savings', group: 'Checking & Savings' },
  { value: 'cash-app-balance', label: 'Cash Wallet Balance', group: 'Checking & Savings' },
  { value: 'amex-gold', label: 'Amex Gold', group: 'Credit Cards' },
  { value: 'chase-sapphire', label: 'Chase Sapphire', group: 'Credit Cards' },
  { value: 'fidelity-401k', label: 'Fidelity 401(k)', group: 'Investment' },
  { value: 'vanguard-ira', label: 'Vanguard IRA', group: 'Investment' },
  { value: 'robinhood-brokerage', label: 'Robinhood Brokerage', group: 'Investment' },
];

const tags: SelectOption[] = [
  { value: 'essential', label: 'Essential' },
  { value: 'discretionary', label: 'Discretionary' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'one-time', label: 'One-time' },
  { value: 'tax-deductible', label: 'Tax Deductible' },
  { value: 'business', label: 'Business' },
  { value: 'personal', label: 'Personal' },
  { value: 'subscription', label: 'Subscription' },
];

export default function SelectPage() {
  const fid = useId();
  const [assetType, setAssetType] = useState<string>('');
  const [freq, setFreq] = useState<string>('monthly');
  const [custodian, setCustodian] = useState<string>('');
  const [linked, setLinked] = useState<string>('');
  const [triggerFreq, setTriggerFreq] = useState<string>('monthly');
  const [selectedTags, setSelectedTags] = useState<string[]>(['essential', 'recurring']);

  const statesGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(13.75rem, 1fr))',
    gap: vars.space['5'],
  };

  return (
    <>
      {/* ── 1. Trigger states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Trigger states</div>
        <div style={statesGrid}>
          <div>
            <Select options={assetTypes} placeholder="Select asset type…" />
            <span className={s.ann}>default · placeholder</span>
          </div>
          <div>
            <Select options={assetTypes} value="stock" onChange={() => {}} />
            <span className={s.ann}>selected value</span>
          </div>
          <div>
            <Select options={assetTypes} disabled placeholder="Fidelity" />
            <span className={s.ann}>disabled</span>
          </div>
          <div>
            <Select options={assetTypes} error placeholder="Select asset type…" />
            <div className={inp.fieldError} style={{ marginTop: '0.3125rem' }}>
              <Info size={12} /> This field is required
            </div>
            <span className={s.ann}>error state</span>
          </div>
        </div>
      </div>

      {/* ── 2. Default select ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Default select – no search</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-asset-type`} className={inp.fieldLabel}>
              Asset type
            </label>
            <Select
              id={`${fid}-asset-type`}
              options={assetTypes}
              value={assetType}
              onChange={setAssetType}
              placeholder="Select asset type…"
            />
            <span className={s.ann}>6 options · ↑↓ Enter Esc</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-frequency`} className={inp.fieldLabel}>
              Frequency
            </label>
            <Select id={`${fid}-frequency`} options={frequencies} value={freq} onChange={setFreq} />
            <span className={s.ann}>pre-selected value</span>
          </div>
        </div>
      </div>

      {/* ── 3. Searchable select ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Searchable select</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-custodian`} className={inp.fieldLabel}>
              Custodian
            </label>
            <Select
              id={`${fid}-custodian`}
              options={custodians}
              value={custodian}
              onChange={setCustodian}
              searchable
              searchPlaceholder="Search custodians…"
              placeholder="Select custodian…"
            />
            <span className={s.ann}>10 options · type to filter</span>
          </div>
        </div>
      </div>

      {/* ── 4. Grouped options ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Grouped options</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-linked-account`} className={inp.fieldLabel}>
              Linked account
            </label>
            <Select
              id={`${fid}-linked-account`}
              options={linkedAccounts}
              value={linked}
              onChange={setLinked}
              searchable
              searchPlaceholder="Search accounts…"
              placeholder="Link to an account…"
            />
            <span className={s.ann}>3 groups · searchable</span>
          </div>
        </div>
      </div>

      {/* ── 5. Multi-select with chips ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Multi-select with chips</div>
        <div style={{ maxWidth: '22.5rem' }}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-tags`} className={inp.fieldLabel}>
              Tags
            </label>
            <Select
              id={`${fid}-tags`}
              multi
              options={tags}
              value={selectedTags}
              onChange={setSelectedTags}
              searchable
              searchPlaceholder="Search tags…"
              placeholder="Select tags…"
            />
            <div className={inp.fieldHelper}>Select all / clear footer · chip removal</div>
          </div>
        </div>
      </div>

      {/* ── 6. Multi-select with large chips ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Multi-select with large chips</div>
        <div style={{ maxWidth: '22.5rem' }}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-tags-lg`} className={inp.fieldLabel}>
              Tags
            </label>
            <Select
              id={`${fid}-tags-lg`}
              multi
              chipSize="lg"
              options={tags}
              value={selectedTags}
              onChange={setSelectedTags}
              searchable
              searchPlaceholder="Search tags…"
              placeholder="Select tags…"
            />
            <div className={inp.fieldHelper}>
              chipSize="lg" · default text size, trigger height unchanged for a single row
            </div>
          </div>
        </div>
      </div>

      {/* ── 7. Custom trigger (Badge with chevron) ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Custom trigger — Badge with chevron</div>
        <div className={s.row}>
          <Select
            searchable
            menuWidth="16rem"
            options={frequencies}
            value={triggerFreq}
            onChange={setTriggerFreq}
            searchPlaceholder="Search…"
            aria-label="Change frequency"
            trigger={
              <Badge chevron variant="brand" truncate>
                {frequencies.find((o) => o.value === triggerFreq)?.label ?? 'Pick…'}
              </Badge>
            }
          />
        </div>
        <div className={inp.fieldHelper}>
          the `trigger` prop swaps the default combobox box for a chevron Badge (as used by the
          transaction list's quick budget switch). Pair it with `menuWidth` — the panel matches its
          trigger by default, which leaves the options cramped behind a Badge sized to its label.
        </div>
      </div>
    </>
  );
}
