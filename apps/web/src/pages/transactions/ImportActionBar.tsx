import { ArrowLeft, ArrowRight, Redo2, Undo2 } from 'lucide-react';
import { IconButton, buttonStyles } from '@budget-tracker/ui';
import * as s from './import-modal.css.js';
import type { ImportStep, Account } from './importExportShared.js';
import type { ImportResultSummary } from './useImportRunner.js';

interface ImportActionBarProps {
  step: ImportStep;
  importing: boolean;
  result: ImportResultSummary | null;
  importedIds: string[];
  createdEntitiesRef: { current: Array<{ type: 'account' | 'custodian' | 'wallet'; id: string }> };
  undoing: boolean;
  canContinue: boolean;
  iconBack: boolean;
  currentPrompt: unknown;
  rowCount: number;
  onBack: () => void;
  onContinue: () => void;
  onCloseModal: () => void;
  onCancelImport: () => void;
  onUndoImport: () => void;
  onRetry: () => void;
  setLiveAccounts: (a: Account[]) => void;
}

/** Bottom action bar of the import flow — extracted verbatim from TransactionImportExport.tsx. */
export default function ImportActionBar({
  step,
  importing,
  result,
  importedIds,
  createdEntitiesRef,
  undoing,
  canContinue,
  iconBack,
  currentPrompt,
  rowCount,
  onBack,
  onContinue,
  onCloseModal,
  onCancelImport,
  onUndoImport,
  onRetry,
  setLiveAccounts,
}: ImportActionBarProps) {
  return (
    <div className={s.actionBar}>
      <div>
        {step !== 'map-data' &&
          !importing &&
          !currentPrompt &&
          !result &&
          (iconBack ? (
            <IconButton
              icon={<ArrowLeft size={16} />}
              tooltip="Back"
              size="md"
              variant="secondary"
              onClick={onBack}
            />
          ) : (
            <button
              type="button"
              onClick={onBack}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              <ArrowLeft size={16} /> Back
            </button>
          ))}
        {importing && (
          <button
            type="button"
            onClick={onCancelImport}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
          >
            Cancel &amp; Revert
          </button>
        )}
        {step === 'monitor' &&
          result &&
          (importedIds.length > 0 || createdEntitiesRef.current.length > 0) && (
            <button
              type="button"
              onClick={onUndoImport}
              disabled={undoing}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnDanger}`}
              style={{ opacity: undoing ? 0.5 : 1 }}
            >
              {undoing ? (
                'Undoing…'
              ) : (
                <>
                  <Undo2 size={16} /> Undo Import
                </>
              )}
            </button>
          )}
        {step === 'monitor' &&
          result &&
          result.success === 0 &&
          importedIds.length === 0 &&
          createdEntitiesRef.current.length === 0 && (
            <button
              type="button"
              onClick={() => {
                onRetry();
                setLiveAccounts([]);
              }}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
            >
              <Redo2 size={16} /> Try Again
            </button>
          )}
      </div>
      <div className={s.actionBarRight}>
        {!importing && (
          <button
            type="button"
            onClick={onCloseModal}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
          >
            Cancel
          </button>
        )}
        {step === 'monitor' && result && (
          <button
            type="button"
            onClick={onCloseModal}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            Finish
          </button>
        )}
        {step !== 'monitor' && (
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            style={{ opacity: !canContinue ? 0.5 : 1 }}
          >
            {step === 'preview' ? (
              `Import ${rowCount} Transactions`
            ) : (
              <>
                <span>Continue</span> <ArrowRight size={16} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
