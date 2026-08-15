import { useRef } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import {
  CurrencyInput,
  DatePicker,
  IconButton,
  Tooltip,
  inputStyles,
  toPickerDate,
  fromPickerDate,
} from '@budget-tracker/ui';
import * as s from './reconcile-page.css.js';

interface SetupStepProps {
  /** The chosen file, held here until Analyze reads it. */
  file: File | null;
  onFileChange: (file: File | null) => void;
  statementEndingBalance: number;
  onStatementEndingBalanceChange: (value: number) => void;
  /** The cutoff — the date the entered balance is measured at. ISO 'YYYY-MM-DD'. */
  cutoffDate: string;
  onCutoffDateChange: (value: string) => void;
}

/**
 * Step 1 — choose the statement and enter the anchor.
 *
 * Nothing is sent anywhere from this step. Picking a file only holds it; the
 * session, the import, and the matching all happen when Analyze is pressed.
 * That keeps the step recoverable — swapping the file or fixing the balance
 * before analysing leaves no half-built session behind — and means the user is
 * never told "imported" for work they have not asked for yet.
 *
 * The statement's own span (its first and last posted dates) belongs to step 2:
 * it is a *result* of parsing the file. The cutoff below is a different thing —
 * a fact the user states, not one derived from the file — which is why it lives
 * here and defaults to today.
 */
export default function SetupStep({
  file,
  onFileChange,
  statementEndingBalance,
  onStatementEndingBalanceChange,
  cutoffDate,
  onCutoffDateChange,
}: SetupStepProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className={s.setupCard}>
      <div className={inputStyles.field}>
        <label className={inputStyles.fieldLabel} htmlFor="statement-file">
          Statement CSV
        </label>

        {file ? (
          <div className={s.fileCard}>
            <FileText size={18} aria-hidden className={s.fileIcon} />
            <span className={s.fileNameWrap}>
              <Tooltip content={file.name} truncate>
                <span className={s.fileName}>{file.name}</span>
              </Tooltip>
            </span>
            <IconButton
              icon={<X size={14} />}
              tooltip="Remove file"
              size="sm"
              variant="trueGhost"
              onClick={() => {
                onFileChange(null);
                // Clearing the input lets the same file be chosen again; without
                // this, re-picking it fires no change event.
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className={s.dropZone}
            onClick={() => fileRef.current?.click()}
            aria-describedby="statement-file-help"
          >
            <Upload size={24} aria-hidden />
            <span>Choose a statement export</span>
          </button>
        )}

        <input
          id="statement-file"
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className={s.hiddenInput}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <p id="statement-file-help" className={inputStyles.fieldHelper}>
          Your bank’s CSV export for one statement period.
        </p>
      </div>

      <div className={inputStyles.field}>
        <label className={inputStyles.fieldLabel} htmlFor="ending-balance">
          Ending balance from the bank
        </label>
        <CurrencyInput
          id="ending-balance"
          value={Math.round(statementEndingBalance * 100)}
          onChange={(cents) => onStatementEndingBalanceChange(cents / 100)}
          allowNegative
        />
        <p className={inputStyles.fieldHelper}>
          The balance you are checking against. A credit card you owe money on is negative here —
          type “-” first. Everything is measured against this figure, as of the cutoff below.
        </p>
      </div>

      <div className={inputStyles.field}>
        <label className={inputStyles.fieldLabel} htmlFor="cutoff-date">
          Balance as of
        </label>
        <DatePicker
          id="cutoff-date"
          value={toPickerDate(cutoffDate)}
          onChange={(d) => {
            // A cleared date is meaningless here — keep the last value rather
            // than send an empty cutoff that would make the residual undefined.
            const next = fromPickerDate(d);
            if (next) onCutoffDateChange(next);
          }}
        />
        <p className={inputStyles.fieldHelper}>
          The moment the balance above was read. Defaults to today, which compares the bank against
          your account right now. Set it to a statement’s closing date to reconcile that closed
          statement instead. Anything dated after this is left out of the comparison.
        </p>
      </div>
    </div>
  );
}
