import { useState, useRef, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CSVColumnName, SignConventionConfig } from '@budget-tracker/core';
import { api } from '../../lib/api.js';
import {
  type Account,
  type Category,
  type Row,
  type DupeAction,
  type ImportStep,
  type MonitorMessage,
  type PendingEntity,
  type ImportIo,
} from './importExportShared.js';
import { parseAndResolveImport } from './importResolvePhase.js';
import { filterPairInsertImport } from './importInsertPhase.js';

export interface ImportResultSummary {
  success: number;
  skipped: number;
  replaced: number;
  excluded: number;
  errors: number;
  errorSamples: string[];
  transfersTotal: number;
  transfersPaired: number;
  transfersUnpaired: number;
}

interface UseImportRunnerArgs {
  rows: Row[];
  mapping: Record<string, string>;
  fullColumnMapping: Partial<Record<CSVColumnName, string>>;
  accounts: Account[];
  categories: Category[];
  defaultAccountId: string;
  defaultBudgetId: string;
  verboseMode: boolean;
  signConventionConfigRef: RefObject<SignConventionConfig | null>;
  setStep: (s: ImportStep) => void;
  setLiveAccounts: (a: Account[]) => void;
  refetchAccounts: () => void;
}

/**
 * Owns all import-execution state (terminal log, progress, entity/dupe prompts,
 * result, undo/cancel bookkeeping) and the doImport orchestration. Extracted
 * from TransactionImportExport.tsx; the parse/resolve and filter/pair/insert
 * phases live in importResolvePhase.ts / importInsertPhase.ts.
 */
export function useImportRunner({
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
}: UseImportRunnerArgs) {
  const qc = useQueryClient();

  // Import state
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResultSummary | null>(null);
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [verboseLog, setVerboseLog] = useState<string[]>([]);
  const cancelRef = useRef(false);
  const importedIdsRef = useRef<string[]>([]);
  const createdEntitiesRef = useRef<
    Array<{ type: 'account' | 'custodian' | 'wallet'; id: string }>
  >([]);

  // Monitor messages
  const [activeResolution, setActiveResolution] = useState<MonitorMessage | null>(null);
  const [waitingForVerboseChoice, setWaitingForVerboseChoice] = useState(false);

  // Terminal log
  const [terminalLines, setTerminalLines] = useState<
    Array<{ text: string; status: 'pending' | 'done' | 'error' | 'info' | 'warning' }>
  >([]);
  const [terminalProgress, setTerminalProgress] = useState<{
    current: number;
    total: number;
    hasErrors?: boolean;
  } | null>(null);

  // Entity resolution — one modal at a time, queued
  const [currentPrompt, setCurrentPrompt] = useState<PendingEntity | null>(null);
  const [promptPickId, setPromptPickId] = useState('');
  const entityResolveRef = useRef<
    ((resolution: 'create' | 'pick' | 'exclude', pickId?: string) => void) | null
  >(null);

  // Resolution refs (for duplicates only now)
  const dupeResolveRef = useRef<((action: DupeAction) => void) | null>(null);
  const [dupeGlobal, setDupeGlobal] = useState<DupeAction>(null);

  // Live entity lists for resolution
  const [custodianList, setCustodianList] = useState<Array<{ id: string; name: string }>>([]);
  const [walletList, setWalletList] = useState<Array<{ id: string; name: string }>>([]);

  // Resolution helpers
  function waitForDupeResolution(): Promise<DupeAction> {
    return new Promise((resolve) => {
      dupeResolveRef.current = resolve;
    });
  }
  function resolveDupe(action: DupeAction) {
    if (dupeResolveRef.current) {
      dupeResolveRef.current(action);
      dupeResolveRef.current = null;
    }
  }

  function promptEntity(
    entity: PendingEntity,
  ): Promise<{ resolution: 'create' | 'pick' | 'exclude'; pickId?: string }> {
    return new Promise((resolve) => {
      setCurrentPrompt(entity);
      setPromptPickId(entity.suggestedPickId ?? '');
      entityResolveRef.current = (resolution, pickId) => {
        resolve({ resolution, pickId });
        setCurrentPrompt(null);
        entityResolveRef.current = null;
      };
    });
  }

  function resolveCurrentPrompt(resolution: 'create' | 'pick' | 'exclude', pickId?: string) {
    if (entityResolveRef.current) {
      entityResolveRef.current(resolution, pickId);
    }
  }

  // Terminal log helpers
  function termLog(
    text: string,
    status: 'pending' | 'done' | 'error' | 'info' | 'warning' = 'info',
  ) {
    setTerminalLines((prev) => [...prev, { text, status }]);
  }

  async function termTask(label: string): Promise<(success: boolean, result?: string) => void> {
    setTerminalLines((prev) => [...prev, { text: `${label}.`, status: 'pending' }]);
    await new Promise((r) => setTimeout(r, 300));
    setTerminalLines((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.status === 'pending') next[next.length - 1] = { ...last, text: `${label}..` };
      return next;
    });
    await new Promise((r) => setTimeout(r, 300));
    setTerminalLines((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.status === 'pending') next[next.length - 1] = { ...last, text: `${label}...` };
      return next;
    });
    await new Promise((r) => setTimeout(r, 300));

    return (success: boolean, result?: string) => {
      setTerminalLines((prev) => {
        const next = [...prev];
        // Remove the pending dots line
        const pendingIdx = next.findIndex(
          (l) => l.status === 'pending' && l.text.startsWith(label),
        );
        if (pendingIdx >= 0) next.splice(pendingIdx, 1);
        // Add the resolved line
        const resolvedText = result
          ? `${label} — ${result}`
          : `${label} — ${success ? 'done' : 'failed'}`;
        next.push({ text: resolvedText, status: success ? 'done' : 'error' });
        return next;
      });
    };
  }

  async function doImport() {
    if (!mapping['name'] || !mapping['amount'] || !mapping['date']) return;
    setStep('monitor');
    setImporting(true);
    setImportedIds([]);
    setDupeGlobal(null);
    setActiveResolution(null);
    setTerminalLines([]);
    setTerminalProgress(null);
    cancelRef.current = false;
    importedIdsRef.current = [];
    createdEntitiesRef.current = [];
    const log: string[] = [];
    const v = verboseMode;

    const io: ImportIo = {
      termLog,
      termTask,
      promptEntity,
      waitForDupeResolution,
      setActiveResolution,
      setDupeGlobal,
      setTerminalProgress,
      setLiveAccounts,
      setCustodianList,
      setWalletList,
      cancelRef,
      importedIdsRef,
      createdEntitiesRef,
    };

    const { parsed, parseErrorSamples, fallbackBudgetId, acctResolutionMap, currentAccounts } =
      await parseAndResolveImport({
        rows,
        mapping,
        fullColumnMapping,
        categories,
        accounts,
        defaultAccountId,
        defaultBudgetId,
        signConventionConfig: signConventionConfigRef.current,
        io,
      });

    const outcome = await filterPairInsertImport({
      parsed,
      acctResolutionMap,
      currentAccounts,
      defaultAccountId,
      defaultBudgetId,
      fallbackBudgetId,
      parseErrorSamples,
      initialDupeGlobal: dupeGlobal,
      v,
      log,
      io,
    });

    if (outcome.cancelled) {
      setImporting(false);
      return;
    }

    setImportedIds(outcome.ids);
    setResult(outcome.totals);
    if (v) setVerboseLog(log);
    setImporting(false);
    refetchAccounts();
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  /** Delete entities (accounts/custodians/wallets) created during this run, with one retry. */
  async function deleteCreatedEntities() {
    for (const entity of createdEntitiesRef.current) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (entity.type === 'account') {
            await api.accounts.delete(entity.id);
            break;
          } else if (entity.type === 'custodian') {
            await api.investments.custodians.delete(entity.id);
            break;
          } else if (entity.type === 'wallet') {
            await api.investments.wallets.delete(entity.id);
            break;
          }
        } catch {
          if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
    createdEntitiesRef.current = [];
    setLiveAccounts([]);
  }

  async function undoImport() {
    if (importedIds.length === 0) return;
    setUndoing(true);
    const BATCH_SIZE = 25;
    for (let i = 0; i < importedIds.length; i += BATCH_SIZE) {
      const batch = importedIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((id) => api.transactions.delete(id)));
    }
    setImportedIds([]);
    importedIdsRef.current = [];

    // Wait for transaction deletes to fully propagate
    await new Promise((r) => setTimeout(r, 500));

    await deleteCreatedEntities();

    setResult(null);
    setUndoing(false);
    setImporting(false);
    setTerminalLines([]);
    setTerminalProgress(null);
    setActiveResolution(null);
    setDupeGlobal(null);
    setVerboseLog([]);
    setWaitingForVerboseChoice(true);
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
  }

  async function cancelImport() {
    cancelRef.current = true;
    await new Promise((r) => setTimeout(r, 100));
    const idsToDelete = importedIdsRef.current;
    await Promise.allSettled(idsToDelete.map((id) => api.transactions.delete(id)));
    importedIdsRef.current = [];
    setImportedIds([]);

    // Wait for transaction deletes to fully propagate
    await new Promise((r) => setTimeout(r, 500));

    await deleteCreatedEntities();

    setImporting(false);
    setResult(null);
    setActiveResolution(null);
    setCurrentPrompt(null);
    setPromptPickId('');
    setTerminalLines([]);
    setTerminalProgress(null);
    setDupeGlobal(null);
    setVerboseLog([]);
    setWaitingForVerboseChoice(true);
    qc.invalidateQueries({ queryKey: ['transactions'] });
  }

  /** Clear the failed-run state so the user can immediately retry (Try Again). */
  function resetForRetry() {
    setResult(null);
    setTerminalLines([]);
    setTerminalProgress(null);
    setVerboseLog([]);
    setWaitingForVerboseChoice(true);
    createdEntitiesRef.current = [];
  }

  /** Reset every runner-owned piece of state (used when the modal closes). */
  function resetRunner() {
    setImporting(false);
    setResult(null);
    setImportedIds([]);
    setUndoing(false);
    setVerboseLog([]);
    setActiveResolution(null);
    setWaitingForVerboseChoice(false);
    setCurrentPrompt(null);
    setPromptPickId('');
    setTerminalLines([]);
    setTerminalProgress(null);
    setDupeGlobal(null);
    cancelRef.current = false;
    importedIdsRef.current = [];
  }

  return {
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
    setPromptPickId,
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
  };
}
