import { Sensitive } from '@budget-tracker/ui';
import { useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Modal, buttonStyles, inputStyles, ResizableTextarea } from '@budget-tracker/ui';
import { formatCurrency } from '../../lib/utils.js';
import * as s from './reconcile-page.css.js';
import type { Residual } from './types.js';

interface CloseSessionModalProps {
  open: boolean;
  onClose: () => void;
  residual: Residual;
  onFinish: () => void;
  onAdjust: (reason: string) => void;
  /** Correct the account's starting balance to absorb the residual. */
  onCorrectOpening: (newOpeningBalance: number) => void;
  isBusy: boolean;
}

/**
 * Step 3.
 *
 * When the residual is zero this is a plain confirmation. When it is not, the
 * only way through is an explicit, reasoned adjustment that lands in the ledger
 * as a real transaction. There is deliberately no "close anyway" — a period that
 * does not balance either gets balanced or gets a visible artifact explaining
 * why not.
 */
export default function CloseSessionModal({
  open,
  onClose,
  residual,
  onFinish,
  onAdjust,
  onCorrectOpening,
  isBusy,
}: CloseSessionModalProps) {
  const [reason, setReason] = useState('');
  const [showOpeningFix, setShowOpeningFix] = useState(false);
  const balanced = residual.isBalanced;
  const reasonValid = reason.trim().length > 0;

  // residual = anchor − (opening + sum), so the opening that zeroes it is the
  // current opening plus the residual.
  const correctedOpening = Math.round((residual.openingBalance + residual.residual) * 100) / 100;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={balanced ? 'Finish reconciliation' : 'This period does not balance'}
      footer={
        <div className={inputStyles.formStack}>
          {balanced ? (
            <button
              type="button"
              onClick={onFinish}
              disabled={isBusy}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Finish
            </button>
          ) : showOpeningFix ? (
            <button
              type="button"
              onClick={() => onCorrectOpening(correctedOpening)}
              disabled={isBusy}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Set starting balance to{' '}
              <Sensitive label="amount">{formatCurrency(correctedOpening)}</Sensitive>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAdjust(reason.trim())}
              disabled={isBusy || !reasonValid}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              Record adjustment and finish
            </button>
          )}
          {!balanced && (
            <button
              type="button"
              onClick={() => setShowOpeningFix(!showOpeningFix)}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              {showOpeningFix ? 'Back' : 'The starting balance was wrong'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            {balanced ? 'Cancel' : 'Keep working'}
          </button>
        </div>
      }
    >
      <div className={s.closeBody}>
        <div className={s.closeSummary}>
          <div className={s.closeRow}>
            <span>Bank says</span>
            <span>
              <Sensitive label="amount">
                {formatCurrency(residual.statementEndingBalance)}
              </Sensitive>
            </span>
          </div>
          <div className={s.closeRow}>
            <span>App says</span>
            <span>
              <Sensitive label="amount">{formatCurrency(residual.expectedBalance)}</Sensitive>
            </span>
          </div>
          <div className={s.closeRow}>
            <strong>Difference</strong>
            <strong>
              <Sensitive label="amount">{formatCurrency(residual.residual)}</Sensitive>
            </strong>
          </div>
        </div>

        {balanced ? (
          <p className={inputStyles.fieldHelper}>
            Every row is accounted for. Finishing marks the matched transactions as reconciled.
          </p>
        ) : (
          <>
            <div className={s.closeWarning}>
              <span>
                <AlertTriangle size={14} aria-hidden />{' '}
                <Sensitive label="amount">{formatCurrency(Math.abs(residual.residual))}</Sensitive>{' '}
                is unexplained.
              </span>
              <span>
                Going back to fix it is almost always the right move. If you genuinely cannot
                identify the difference, recording an adjustment will create a real transaction for
                that amount so it stays visible in your ledger — it will not be hidden in your
                starting balance.
              </span>
            </div>

            {showOpeningFix ? (
              <div className={s.openingPreview}>
                <span className={s.periodRange}>
                  Starting balance{' '}
                  <Sensitive label="amount">{formatCurrency(residual.openingBalance)}</Sensitive>
                  <ArrowRight size={14} aria-label="becomes" />
                  <strong>
                    <Sensitive label="amount">{formatCurrency(correctedOpening)}</Sensitive>
                  </strong>
                </span>
                <span>
                  This is the right move when you have just corrected a transaction the starting
                  balance was quietly offsetting — the opening was absorbing the error, and fixing
                  one without the other leaves the account wrong either way.
                </span>
                <span>
                  It is the wrong move if you cannot say what the difference is. Changing the
                  opening shifts the running balance on every transaction in this account, and an
                  unexplained amount buried there is exactly what stays invisible for months.
                </span>
              </div>
            ) : (
              <div className={inputStyles.field}>
                <label className={inputStyles.fieldLabel} htmlFor="adjustment-reason">
                  Why can’t this be explained?
                </label>
                <ResizableTextarea
                  id="adjustment-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Bank fee I can’t identify on the statement"
                />
                <p className={inputStyles.fieldHelper}>
                  Required. This is stored on the adjustment so you can tell later what it was for.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
