import { useState, useRef, useEffect, useMemo } from 'react';
import { read, utils } from 'xlsx';
import { useQuery } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Modal, StepIndicator, buttonStyles } from '@budget-tracker/ui';
import type { SelectOption } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { api } from '../../lib/api.js';
import {
  autoMapColumns,
  type CSVColumnName,
  type SignConventionConfig,
} from '@budget-tracker/core';
import SignConventionForm from '../../components/SignConventionForm';
import { useIsNarrow } from '../../hooks/useIsNarrow.js';
import * as s from './import-modal.css.js';
import {
  type Account,
  type Category,
  type Row,
  type ImportStep,
  FIELDS,
  NAV_STEPS,
  INLINE_NAV_STEPS,
  STEP_ORDER,
  INLINE_STEP_ORDER,
} from './importExportShared.js';
import { useImportRunner } from './useImportRunner.js';
import ImportPreviewStep from './ImportPreviewStep.js';
import ImportMonitorStep from './ImportMonitorStep.js';
import ImportMapDataStep from './ImportMapDataStep.js';
import ImportActionBar from './ImportActionBar.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/** Below this width the mapping/defaults field grids stack into one column. */
const STACK_FIELDS_BREAKPOINT = below.md;

/** Below this width the action bar's Back button collapses to an icon button. */
const ICON_BACK_BREAKPOINT = below.sm;

// ─── Component Props ─────────────────────────────────────────────────────────

interface TransactionImportExportProps {
  open: boolean;
  onClose: () => void;
  file: File | null;
  inline?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TransactionImportExport({
  open,
  onClose,
  file,
  inline = false,
}: TransactionImportExportProps) {
  const { data: acctData, refetch: refetchAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list() as Promise<Account[]>,
  });
  const { data: catData } = useQuery({
    queryKey: ['budgetItems'],
    queryFn: () => api.budgetItems.list() as Promise<Category[]>,
  });
  const [liveAccounts, setLiveAccounts] = useState<Account[]>([]);
  const accounts = liveAccounts.length > 0 ? liveAccounts : ((acctData ?? []) as Account[]);
  const categories = (catData ?? []) as Category[];
  const uncategorizedId =
    categories.find((c) => c.name.toLowerCase() === 'uncategorized')?.id ?? '';

  // Step state
  const [step, setStep] = useState<ImportStep>(inline ? 'choose-file' : 'map-data');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stackFields = useIsNarrow(STACK_FIELDS_BREAKPOINT);
  const iconBack = useIsNarrow(ICON_BACK_BREAKPOINT);

  // File/mapping state
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultAccountId, setDefaultAccountId] = useState('');
  const [defaultBudgetId, setDefaultCategoryId] = useState('');
  const [defaultType, setDefaultType] = useState<'EXPENSE' | 'INCOME' | ''>('');
  const [fullColumnMapping, setFullColumnMapping] = useState<
    Partial<Record<CSVColumnName, string>>
  >({});
  const [verboseMode, setVerboseMode] = useState(false);
  const signConventionConfigRef = useRef<SignConventionConfig | null>(null);

  // Import runner — owns all execution state, prompts, terminal + undo/cancel
  const runner = useImportRunner({
    rows,
    mapping,
    fullColumnMapping,
    accounts,
    categories,
    defaultAccountId,
    defaultBudgetId,
    verboseMode,
    signConventionConfigRef,
    setStep,
    setLiveAccounts,
    refetchAccounts,
  });
  const {
    importing,
    result,
    setResult,
    importedIds,
    undoing,
    verboseLog,
    activeResolution,
    waitingForVerboseChoice,
    setWaitingForVerboseChoice,
    terminalLines,
    terminalProgress,
    currentPrompt,
    promptPickId,
    resolveCurrentPrompt,
    resolveDupe,
    custodianList,
    walletList,
    doImport,
    undoImport,
    cancelImport,
    resetRunner,
    resetForRetry,
    createdEntitiesRef,
  } = runner;

  // Compute distinct preview rows
  const previewRows = useMemo(() => {
    if (rows.length === 0) return [];
    const variationHeaders = ['type', 'account', 'category']
      .map((f) => mapping[f])
      .filter((h): h is string => !!h);
    const extraVariation = [
      'trade_direction',
      'trade_asset_type',
      'bitcoin_wallet',
      'to_account',
    ] as const;
    for (const col of extraVariation) {
      const h = fullColumnMapping[col];
      if (h && !variationHeaders.includes(h)) variationHeaders.push(h);
    }
    if (variationHeaders.length === 0) return rows.slice(0, 10);
    const picked = new Set<number>();
    for (const header of variationHeaders) {
      const valueSeen = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const val = String(rows[i]![header] ?? '')
          .trim()
          .toLowerCase();
        if (!valueSeen.has(val)) {
          valueSeen.add(val);
          picked.add(i);
        }
      }
    }
    return [...picked].toSorted((a, b) => a - b).map((i) => rows[i]!);
  }, [rows, mapping, fullColumnMapping]);

  // Memoized option arrays for DS Select
  const headerOptions: SelectOption[] = useMemo(
    () => [{ value: '', label: 'Skip' }, ...headers.map((h) => ({ value: h, label: h }))],
    [headers],
  );
  const accountOptions: SelectOption[] = useMemo(
    () => [{ value: '', label: 'None' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))],
    [accounts],
  );
  const budgetOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'None' },
      ...categories.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() })),
    ],
    [categories],
  );
  const typeOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: 'None' },
      { value: 'EXPENSE', label: 'Expense' },
      { value: 'INCOME', label: 'Income' },
    ],
    [],
  );

  // Auto-process file when provided from parent
  function processFile(f: File) {
    setResult(null);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer);
      const wb = read(data, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]!]!;
      const json = utils.sheet_to_json<Row>(sheet, {
        defval: null,
        raw: false,
        dateNF: 'MM/DD/YYYY',
      });
      if (json.length === 0) return;
      const hdrs = Object.keys(json[0]!);
      setHeaders(hdrs);
      setRows(json);
      const fullMap = autoMapColumns(hdrs);
      setFullColumnMapping(fullMap);
      const autoMap: Record<string, string> = {};
      for (const field of FIELDS) {
        const mapped = fullMap[field as CSVColumnName];
        if (mapped) autoMap[field] = mapped;
      }
      setMapping(autoMap);
    };
    reader.readAsArrayBuffer(f);
  }

  useEffect(() => {
    if (open && file) {
      processFile(file);
      if (inline) setStep('map-data');
    }
  }, [open, file]);

  // Default budget to "Uncategorized" once categories load
  useEffect(() => {
    if (!defaultBudgetId && uncategorizedId) {
      setDefaultCategoryId(uncategorizedId);
    }
  }, [uncategorizedId, defaultBudgetId]);

  function handleClose() {
    setStep('map-data');
    setRows([]);
    setHeaders([]);
    setMapping({});
    setDefaultAccountId('');
    setDefaultCategoryId('');
    setDefaultType('');
    setLiveAccounts([]);
    setFullColumnMapping({});
    setVerboseMode(false);
    resetRunner();
    signConventionConfigRef.current = null;
    onClose();
  }

  // ─── Step navigation ───────────────────────────────────────────────────────

  const canContinue =
    step === 'choose-file'
      ? false
      : step === 'map-data'
        ? rows.length > 0 && !!mapping['name'] && !!mapping['amount'] && !!mapping['date']
        : step === 'sign-conventions'
          ? true
          : step === 'preview'
            ? rows.length > 0 && !!mapping['name'] && !!mapping['amount'] && !!mapping['date']
            : false;

  function handleBack() {
    if (step === 'map-data' && inline) setStep('choose-file');
    else if (step === 'sign-conventions') setStep('map-data');
    else if (step === 'preview') setStep('sign-conventions');
    else if (step === 'monitor' && !importing) setStep('preview');
  }

  function handleContinue() {
    if (step === 'map-data') setStep('sign-conventions');
    else if (step === 'sign-conventions') setStep('preview');
    else if (step === 'preview') {
      setStep('monitor');
      setWaitingForVerboseChoice(true);
    }
  }

  function handleVerboseChoice() {
    setWaitingForVerboseChoice(false);
    doImport();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const navSteps = inline ? INLINE_NAV_STEPS : NAV_STEPS;
  const stepOrder = inline ? INLINE_STEP_ORDER : STEP_ORDER;
  const currentStepIndex = stepOrder.indexOf(step);

  const content = (
    <>
      <div className={s.contentWrap}>
        <div className={s.stepIndicatorWrap}>
          <StepIndicator
            steps={navSteps}
            currentStep={currentStepIndex}
            ariaLabel="Import progress"
          />
        </div>
        {step === 'choose-file' ? (
          <div className={s.contentScroll}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
              <h2 className={s.sectionHeading}>Import Data</h2>
              <p className={s.sectionDescription}>Import transactions from a CSV or Excel file.</p>
              <div>
                <button
                  type="button"
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} />
                  Choose File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  aria-label="Import data file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      processFile(f);
                      setStep('map-data');
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </div>
        ) : step === 'preview' ? (
          <ImportPreviewStep
            rows={rows}
            headers={headers}
            previewRows={previewRows}
            dateHeader={mapping['date']}
          />
        ) : step === 'monitor' ? (
          <ImportMonitorStep
            terminalLines={terminalLines}
            terminalProgress={terminalProgress}
            verboseLog={verboseLog}
            currentPrompt={currentPrompt}
            promptPickId={promptPickId}
            resolveCurrentPrompt={resolveCurrentPrompt}
            activeResolution={activeResolution}
            resolveDupe={resolveDupe}
            accounts={accounts}
            custodianList={custodianList}
            walletList={walletList}
            waitingForVerboseChoice={waitingForVerboseChoice}
            verboseMode={verboseMode}
            setVerboseMode={setVerboseMode}
            onStartImport={handleVerboseChoice}
            importing={importing}
            result={result}
          />
        ) : (
          <div className={s.contentScroll}>
            {/* Step 1: Map Data */}
            {step === 'map-data' && (
              <ImportMapDataStep
                mapping={mapping}
                onMappingChange={onMappingChange}
                headerOptions={headerOptions}
                accountOptions={accountOptions}
                budgetOptions={budgetOptions}
                typeOptions={typeOptions}
                defaultAccountId={defaultAccountId}
                setDefaultAccountId={setDefaultAccountId}
                defaultBudgetId={defaultBudgetId}
                setDefaultCategoryId={setDefaultCategoryId}
                defaultType={defaultType}
                setDefaultType={setDefaultType}
                stackFields={stackFields}
                rows={rows}
              />
            )}

            {/* Step 2: Sign Conventions */}
            {step === 'sign-conventions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['5'] }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: vars.space['2'] }}>
                  <h2 className={s.sectionHeading}>Sign Conventions</h2>
                  <p className={s.sectionDescription}>
                    Configure what positive and negative values mean for each transaction type.
                  </p>
                </div>
                <SignConventionForm
                  hideSave
                  onConfigChange={(config) => {
                    signConventionConfigRef.current = config;
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Action bar */}
        <ImportActionBar
          step={step}
          importing={importing}
          result={result}
          importedIds={importedIds}
          createdEntitiesRef={createdEntitiesRef}
          undoing={undoing}
          canContinue={canContinue}
          iconBack={iconBack}
          currentPrompt={currentPrompt}
          rowCount={rows.length}
          onBack={handleBack}
          onContinue={handleContinue}
          onCloseModal={handleClose}
          onCancelImport={cancelImport}
          onUndoImport={undoImport}
          onRetry={resetForRetry}
          setLiveAccounts={setLiveAccounts}
        />
      </div>
    </>
  );

  if (inline) {
    if (!open) return null;
    return (
      <div className={s.body} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {content}
      </div>
    );
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Import Transactions"
      variant="pinned"
      closeButton="none"
      bodyClassName={s.body}
      panelClassName={s.panel}
    >
      {content}
    </Modal>
  );

  function onMappingChange(field: string, value: string) {
    setMapping((prev) => ({ ...prev, [field]: value }));
  }
}
