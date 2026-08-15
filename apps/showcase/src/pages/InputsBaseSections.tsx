import { useState, useRef, useId } from 'react';
import { Info, Search, ArrowRight, Eye, EyeOff, Copy, Check, X, ExternalLink } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import * as s from '../showcase.css.js';
import {
  inputStyles as inp,
  buttonStyles as btn,
  CurrencyInput,
  ResizableTextarea,
} from '@budget-tracker/ui';

/** Sections 1–4 of the Inputs showcase (base states, prefix/suffix, inline
    actions, textarea) — extracted from InputsPage.tsx. */
export default function InputsBaseSections() {
  const fid = useId();
  const [pwVisible, setPwVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [costBasisVal, setCostBasisVal] = useState(0);
  const [statementBalanceVal, setStatementBalanceVal] = useState(-165077);
  const [convFeeVal, setConvFeeVal] = useState(0);
  const [aprVal, setAprVal] = useState(0);
  const [sharesVal, setSharesVal] = useState(0);
  const [searchVal, setSearchVal] = useState('Walmart');
  const [filterVal, setFilterVal] = useState('Amazon');
  const [noteEmpty, setNoteEmpty] = useState('');
  const [noteFilled, setNoteFilled] = useState('Refinanced in June 2024 from 6.9% to 5.9%.');
  const searchRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const statesGrid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(13.75rem, 1fr))',
    gap: vars.space['4'],
  };

  return (
    <>
      {/* ── 1. Base input states ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Base input – states</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-ticker`} className={inp.fieldLabel}>
              Ticker
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-ticker`}
                className={inp.input}
                type="text"
                placeholder="e.g. AAPL"
              />
            </div>
            <span className={s.ann}>default</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-ticker-1`} className={inp.fieldLabel}>
              Ticker
            </label>
            <div className={inp.inputWrap}>
              <input id={`${fid}-ticker-1`} className={inp.input} type="text" defaultValue="AAPL" />
            </div>
            <span className={s.ann}>filled / hover</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-ticker-2`} className={inp.fieldLabel}>
              Ticker <span className={inp.fieldRequired}>*</span>
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-ticker-2`}
                className={`${inp.input} ${inp.inputError}`}
                type="text"
                defaultValue="AAPL123"
              />
            </div>
            <div className={inp.fieldError}>
              <Info size={12} /> Enter a valid ticker symbol
            </div>
            <span className={s.ann}>error</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-linked-account`} className={inp.fieldLabel}>
              Linked account
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-linked-account`}
                className={inp.input}
                type="text"
                defaultValue="Cash Wallet"
                disabled
              />
            </div>
            <span className={s.ann}>disabled</span>
          </div>
          <div className={inp.field}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-note`} className={inp.fieldLabel}>
                Note
              </label>
              <div className={inp.fieldHelper}>Visible only to you.</div>
            </div>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-note`}
                className={inp.input}
                type="text"
                placeholder="Add a note…"
              />
            </div>
            <span className={s.ann}>with helper text</span>
          </div>
        </div>
      </div>

      {/* ── 2. Prefix & suffix ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Prefix &amp; suffix adornments</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-cost-basis`} className={inp.fieldLabel}>
              Cost basis
            </label>
            <CurrencyInput
              id={`${fid}-cost-basis`}
              value={costBasisVal}
              onChange={setCostBasisVal}
              placeholder="0.00"
            />
            <span className={s.ann}>$ prefix</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-statement-balance`} className={inp.fieldLabel}>
              Statement balance
            </label>
            <CurrencyInput
              id={`${fid}-statement-balance`}
              value={statementBalanceVal}
              onChange={setStatementBalanceVal}
              placeholder="0.00"
              allowNegative
            />
            <span className={s.ann}>allowNegative · type “-” first</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-apr`} className={inp.fieldLabel}>
              APR
            </label>
            <CurrencyInput
              id={`${fid}-apr`}
              value={aprVal}
              onChange={setAprVal}
              placeholder="0.00"
              prefix=""
              suffix="%"
            />
            <span className={s.ann}>% suffix · right-fill</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-conv-fee`} className={inp.fieldLabel}>
              Conv. fee
            </label>
            <CurrencyInput
              id={`${fid}-conv-fee`}
              value={convFeeVal}
              onChange={setConvFeeVal}
              placeholder="0.00"
            />
            <span className={s.ann}>$ prefix + currency suffix</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-shares`} className={inp.fieldLabel}>
              Shares
            </label>
            <CurrencyInput
              id={`${fid}-shares`}
              value={sharesVal}
              onChange={setSharesVal}
              prefix=""
              decimals={8}
            />
            <span className={s.ann}>8 decimal places · no prefix</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-calculated-total`} className={inp.fieldLabel}>
              Calculated total
            </label>
            <CurrencyInput
              id={`${fid}-calculated-total`}
              value={4500}
              readOnly
              placeholder="0.00"
            />
            <span className={s.ann}>readOnly · non-interactive</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-management-url`} className={inp.fieldLabel}>
              Management URL
            </label>
            <div className={inp.inputWrap}>
              <span className={inp.inputPrefix}>https://</span>
              <input
                id={`${fid}-management-url`}
                className={inp.input}
                type="text"
                placeholder="login.example.com/…"
                style={{ paddingLeft: vars.space['11'] }}
              />
            </div>
            <span className={s.ann}>text prefix</span>
          </div>
        </div>
      </div>

      {/* ── 3. Inline action buttons ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Inline action buttons</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <label htmlFor={`${fid}-search`} className={inp.fieldLabel}>
              Search
            </label>
            <div className={inp.inputWrap}>
              <span className={inp.inputIconLeft}>
                <Search size={14} />
              </span>
              <input
                id={`${fid}-search`}
                ref={searchRef}
                className={inp.input}
                type="text"
                value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)}
                placeholder="Search…"
                style={{
                  paddingLeft: vars.space['9'],
                  paddingRight: searchVal ? '2.375rem' : vars.space['3'],
                }}
              />
              {searchVal && (
                <div className={inp.inputActionSlot}>
                  <button
                    type="button"
                    className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhost}`}
                    title="Clear"
                    aria-label="Clear"
                    onClick={() => {
                      setSearchVal('');
                      searchRef.current?.focus();
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
            <span className={s.ann}>search + clear ×</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-ticker-lookup`} className={inp.fieldLabel}>
              Ticker lookup
            </label>
            <div className={inp.inputWrap}>
              <span className={inp.inputIconLeft}>
                <Search size={14} />
              </span>
              <input
                id={`${fid}-ticker-lookup`}
                className={inp.input}
                type="text"
                placeholder="e.g. AAPL"
                style={{ paddingLeft: vars.space['9'], paddingRight: '2.375rem' }}
              />
              <div className={inp.inputActionSlot}>
                <button
                  type="button"
                  className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhostBrand}`}
                  title="Look up"
                  aria-label="Look up"
                >
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
            <span className={s.ann}>search + submit →</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-password`} className={inp.fieldLabel}>
              Password
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-password`}
                className={inp.input}
                type={pwVisible ? 'text' : 'password'}
                defaultValue="mysecretpassword"
                style={{ paddingRight: vars.space['10'] }}
              />
              <div className={inp.inputActionSlot}>
                <button
                  type="button"
                  className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhost}`}
                  title="Toggle"
                  aria-label="Toggle password visibility"
                  onClick={() => setPwVisible((v) => !v)}
                >
                  {pwVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <span className={s.ann}>password show / hide</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-api-key`} className={inp.fieldLabel}>
              API key
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-api-key`}
                className={inp.input}
                type="text"
                defaultValue="sk-live-a8f2c9d1e4b7"
                readOnly
                style={{ paddingRight: vars.space['10'] }}
              />
              <div className={inp.inputActionSlot}>
                <button
                  type="button"
                  className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhost}`}
                  title="Copy"
                  aria-label="Copy"
                  onClick={async () => {
                    const text = 'sk-live-a8f2c9d1e4b7';
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch {
                      const ta = document.createElement('textarea');
                      ta.value = text;
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? (
                    <Check size={13} style={{ color: vars.color.success400 }} />
                  ) : (
                    <Copy size={13} />
                  )}
                </button>
              </div>
            </div>
            <span className={s.ann}>copy to clipboard</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-filter-transactions`} className={inp.fieldLabel}>
              Filter transactions
            </label>
            <div className={inp.inputWrap}>
              <input
                id={`${fid}-filter-transactions`}
                ref={filterRef}
                className={inp.input}
                type="text"
                value={filterVal}
                onChange={(e) => setFilterVal(e.target.value)}
                style={{ paddingRight: filterVal ? vars.space['16'] : vars.space['10'] }}
              />
              <div className={inp.inputActions}>
                {filterVal && (
                  <button
                    type="button"
                    className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhost}`}
                    title="Clear"
                    aria-label="Clear"
                    onClick={() => {
                      setFilterVal('');
                      filterRef.current?.focus();
                    }}
                  >
                    <X size={11} />
                  </button>
                )}
                <button
                  type="button"
                  className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhostBrand}`}
                  title="Apply"
                  aria-label="Apply"
                >
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
            <span className={s.ann}>multiple actions</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-url`} className={inp.fieldLabel}>
              URL
            </label>
            <div className={inp.inputWrap}>
              <span className={inp.inputPrefix}>https://</span>
              <input
                id={`${fid}-url`}
                className={inp.input}
                type="text"
                defaultValue="login.example.com/autoloan"
                style={{ paddingLeft: vars.space['11'], paddingRight: vars.space['10'] }}
              />
              <div className={inp.inputActionSlot}>
                <button
                  type="button"
                  className={`${btn.btnBase} ${btn.btnIconSm} ${btn.btnTrueGhost}`}
                  title="Open"
                  aria-label="Open URL"
                  onClick={() => window.open('https://login.example.com/autoloan', '_blank')}
                >
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>
            <span className={s.ann}>prefix + open action</span>
          </div>
        </div>
      </div>

      {/* ── 4. Textarea ── */}
      <div className={s.section}>
        <div className={s.sectionLabel}>Textarea</div>
        <div style={statesGrid}>
          <div className={inp.field}>
            <div className={inp.fieldLabelGroup}>
              <label htmlFor={`${fid}-note-17`} className={inp.fieldLabel}>
                Note
              </label>
              <div className={inp.fieldHelper}>Max 500 characters.</div>
            </div>
            <ResizableTextarea
              id={`${fid}-note-17`}
              placeholder="Add a note about this debt…"
              value={noteEmpty}
              onChange={(e) => setNoteEmpty(e.target.value.slice(0, 500))}
            />
            <div className={inp.fieldHelper} style={{ textAlign: 'right' }}>
              {noteEmpty.length} / 500
            </div>
            <span className={s.ann}>default</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-note-18`} className={inp.fieldLabel}>
              Note
            </label>
            <ResizableTextarea
              id={`${fid}-note-18`}
              value={noteFilled}
              onChange={(e) => setNoteFilled(e.target.value.slice(0, 500))}
            />
            <div className={inp.fieldHelper} style={{ textAlign: 'right' }}>
              {noteFilled.length} / 500
            </div>
            <span className={s.ann}>filled</span>
          </div>
          <div className={inp.field}>
            <label htmlFor={`${fid}-note-19`} className={inp.fieldLabel}>
              Note
            </label>
            <ResizableTextarea
              id={`${fid}-note-19`}
              resizable={false}
              placeholder="Fixed height — no resize handle…"
            />
            <span className={s.ann}>resizable=false</span>
          </div>
        </div>
      </div>
    </>
  );
}
