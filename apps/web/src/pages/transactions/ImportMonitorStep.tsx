import { Play, ChevronDown } from 'lucide-react';
import {
  Toast,
  Toggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  buttonStyles,
} from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { darkTheme } from '@budget-tracker/ui/theme/theme-dark.css.js';
import * as s from './import-modal.css.js';
import type { Account, MonitorMessage, PendingEntity, DupeAction } from './importExportShared.js';
import type { ImportResultSummary } from './useImportRunner.js';

interface ImportMonitorStepProps {
  terminalLines: Array<{ text: string; status: 'pending' | 'done' | 'error' | 'info' | 'warning' }>;
  terminalProgress: { current: number; total: number; hasErrors?: boolean } | null;
  verboseLog: string[];
  currentPrompt: PendingEntity | null;
  promptPickId: string;
  resolveCurrentPrompt: (resolution: 'create' | 'pick' | 'exclude', pickId?: string) => void;
  activeResolution: MonitorMessage | null;
  resolveDupe: (action: DupeAction) => void;
  accounts: Account[];
  custodianList: Array<{ id: string; name: string }>;
  walletList: Array<{ id: string; name: string }>;
  waitingForVerboseChoice: boolean;
  verboseMode: boolean;
  setVerboseMode: (v: boolean) => void;
  onStartImport: () => void;
  importing: boolean;
  result: ImportResultSummary | null;
}

/** Monitor step of the import flow (terminal, prompts, verbose log) — extracted verbatim. */
export default function ImportMonitorStep({
  terminalLines,
  terminalProgress,
  verboseLog,
  currentPrompt,
  promptPickId,
  resolveCurrentPrompt,
  activeResolution,
  resolveDupe,
  accounts,
  custodianList,
  walletList,
  waitingForVerboseChoice,
  verboseMode,
  setVerboseMode,
  onStartImport,
  importing,
  result,
}: ImportMonitorStepProps) {
  return (
    <div className={s.contentFlush}>
      {/* Pinned header */}
      <div className={s.contentHeader}>
        <h2 className={s.sectionHeading}>Import Monitor</h2>
        <p className={s.sectionDescription}>Use this view to monitor the progress of the import.</p>
        <div style={{ marginTop: vars.space['3'] }}>
          <Toggle
            label="Enable verbose output"
            checked={verboseMode}
            onChange={setVerboseMode}
            disabled={!waitingForVerboseChoice}
          />
        </div>
        <button
          type="button"
          onClick={() => onStartImport()}
          disabled={!waitingForVerboseChoice || importing}
          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          style={{
            alignSelf: 'flex-start',
            marginTop: vars.space['3'],
            opacity: !waitingForVerboseChoice || importing ? 0.5 : 1,
          }}
        >
          <Play size={16} /> Start Import
        </button>
      </div>
      {/* Scrollable content — terminal style */}
      <div className={s.terminal}>
        {terminalLines.length === 0 && (
          <p className={s.terminalLine} style={{ color: '#8b9099' }}>
            Waiting for user to start import.
          </p>
        )}
        {terminalLines.map((line, i) => (
          <p
            key={`term-${i}`}
            className={s.terminalLine}
            style={{
              color:
                line.status === 'done'
                  ? '#6cc9a1'
                  : line.status === 'error'
                    ? '#e06c75'
                    : line.status === 'warning'
                      ? '#e5a84b'
                      : line.status === 'pending'
                        ? '#8b9099'
                        : '#5c6370',
            }}
          >
            <span style={{ display: 'inline-block', width: '1.5ch', textAlign: 'center' }}>
              {line.status === 'done' && '✓'}
              {line.status === 'error' && '✗'}
              {line.status === 'warning' && '⚠'}
              {line.status === 'pending' && '◌'}
              {line.status === 'info' && ' '}
            </span>{' '}
            {line.text}
          </p>
        ))}

        {/* Terminal progress bar */}
        {terminalProgress && (
          <p
            className={s.terminalLine}
            style={{
              color: terminalProgress.hasErrors ? '#e06c75' : '#6cc9a1',
              marginTop: vars.space['2'],
            }}
          >
            {'  '}
            {(() => {
              const total = 20;
              const filled = Math.round(
                (terminalProgress.current / terminalProgress.total) * total,
              );
              return '▰'.repeat(filled) + '▱'.repeat(total - filled);
            })()}{' '}
            {Math.round((terminalProgress.current / terminalProgress.total) * 100)}%
          </p>
        )}

        {/* Verbose log — errors only */}
        {result &&
          verboseLog.length > 0 &&
          verboseLog
            .filter((l) => l.includes('❌'))
            .map((line) => (
              <p key={line} className={s.terminalLine} style={{ color: '#e06c75' }}>
                ✗ {line.replace(/^\s*❌\s*/, '')}
              </p>
            ))}
      </div>

      {/* Entity resolution prompt — DS Toast */}
      {currentPrompt && (
        <div className={`${s.promptOverlay} ${darkTheme}`}>
          <Toast
            id={currentPrompt.id}
            severity="warning"
            variant="default"
            title={`Unknown ${currentPrompt.type === 'account' ? 'Account' : currentPrompt.type === 'custodian' ? 'Custodian' : 'Wallet'}: "${currentPrompt.name}"`}
            autoDismiss={false}
            onDismiss={() => resolveCurrentPrompt('exclude')}
            customActions={
              <div className={s.promptActions}>
                <button
                  type="button"
                  onClick={() => resolveCurrentPrompt('create')}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
                >
                  Create New
                </button>
                {(() => {
                  const existingList =
                    currentPrompt.type === 'account'
                      ? accounts.map((a) => ({ value: a.id, label: a.name }))
                      : currentPrompt.type === 'custodian'
                        ? custodianList.map((c) => ({ value: c.id, label: c.name }))
                        : walletList.map((w) => ({ value: w.id, label: w.name }));
                  if (existingList.length === 0) return null;
                  // If there's a suggested match, show a direct "Map to: Name" button + fallback select
                  const suggested = promptPickId
                    ? existingList.find((e) => e.value === promptPickId)
                    : null;
                  if (suggested) {
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => resolveCurrentPrompt('pick', suggested.value)}
                          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                        >
                          Suggested: Map to {suggested.label}
                        </button>
                        {existingList.length > 1 && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                              >
                                Map to Other Account <ChevronDown size={14} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className={`${darkTheme} ${s.dropdownCompact}`}>
                              {existingList
                                .filter((e) => e.value !== suggested.value)
                                .map((e) => (
                                  <DropdownMenuItem
                                    key={e.value}
                                    onSelect={() => resolveCurrentPrompt('pick', e.value)}
                                  >
                                    {e.label}
                                  </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </>
                    );
                  }
                  // No suggestion — show dropdown menu
                  return (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                        >
                          Map to… <ChevronDown size={14} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className={`${darkTheme} ${s.dropdownCompact}`}>
                        {existingList.map((e) => (
                          <DropdownMenuItem
                            key={e.value}
                            onSelect={() => resolveCurrentPrompt('pick', e.value)}
                          >
                            {e.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => resolveCurrentPrompt('exclude')}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
                >
                  Exclude
                </button>
              </div>
            }
          />
        </div>
      )}

      {/* Duplicate resolution prompt — toast style */}
      {activeResolution && activeResolution.type === 'duplicate' && (
        <div className={s.promptOverlay}>
          <div className={s.promptCard}>
            <div className={s.promptContent}>
              <p
                style={{
                  fontSize: vars.font.base,
                  fontWeight: vars.font.medium,
                  color: vars.color.warning700,
                  margin: 0,
                }}
              >
                {activeResolution.title}
              </p>
              <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary, margin: 0 }}>
                {activeResolution.description}
              </p>
            </div>
            <div className={s.promptActions}>
              <button
                type="button"
                onClick={() => resolveDupe('skip')}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
              >
                Keep Existing
              </button>
              <button
                type="button"
                onClick={() => resolveDupe('replace')}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => resolveDupe('skip_all')}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnSecondary}`}
              >
                Keep All
              </button>
              <button
                type="button"
                onClick={() => resolveDupe('replace_all')}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnSm} ${buttonStyles.btnPrimary}`}
              >
                Replace All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
