/**
 * Shared types, constants and pure utilities for the transaction import flow.
 * Extracted from TransactionImportExport.tsx.
 */
import type { StepItem } from '@budget-tracker/ui';
import { ApiError } from '../../lib/api/request.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
}
export interface Category {
  id: string;
  name: string;
  icon: string | null;
}
export interface Transaction {
  id: string;
  name: string;
  amount: number;
  date: string | Date;
  type: string;
  accountId: string | null;
  toAccountId: string | null;
  budgetId: string | null;
  note: string | null;
  tradeMetadata?: unknown;
  bitcoinMetadata?: unknown;
  parentId?: string | null;
  childCount?: number;
  expenseId?: string | null;
  incomeId?: string | null;
  payPeriodId?: string | null;
}

export type Row = Record<string, string | number | null>;
export type DupeAction = 'skip' | 'replace' | 'skip_all' | 'replace_all' | null;

export interface ParsedRow {
  name: string;
  amount: number;
  date: string;
  type: string;
  rawAccount: string;
  budgetId?: string;
  note?: string;
  accountId?: string;
  toAccountId?: string;
  existingId?: string;
  rawCustodian?: string;
  rawTradeWallet?: string;
  rawBitcoinWallet?: string;
  resolvedTradeMetadata?: {
    direction: string;
    assetType: string;
    ticker?: string;
    custodianId?: string;
    walletId?: string;
    unitPrice: number;
    quantity: number;
    bitcoinUnit?: string;
  };
  resolvedBitcoinMetadata?: {
    walletId: string;
    quantity: number;
    bitcoinUnit: string;
    unitPrice: number;
  };
  parentId?: string;
  preTaxAmount?: number;
  taxAmount?: number;
  taxRate?: number;
  expenseId?: string;
  incomeId?: string;
  payPeriodId?: string;
  occurrenceDate?: string;
}

export type ImportStep = 'choose-file' | 'map-data' | 'sign-conventions' | 'preview' | 'monitor';

export interface MonitorMessage {
  id: string;
  type: 'account' | 'custodian' | 'wallet' | 'duplicate' | 'progress' | 'result';
  title: string;
  description: string;
  status: 'pending' | 'resolved' | 'info';
  entityName?: string;
  count?: number;
  index?: number;
  total?: number;
  existingEntities?: Array<{ id: string; name: string }>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const FIELDS = ['name', 'amount', 'date', 'type', 'account', 'category', 'note'] as const;
export const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  amount: 'Amount',
  date: 'Date',
  type: 'Type',
  account: 'Account',
  category: 'Budget',
  note: 'Note',
};

export const NAV_STEPS: StepItem[] = [
  { label: 'Map Data', description: 'Map columns' },
  { label: 'Sign Conventions', description: 'Set signs' },
  { label: 'Preview', description: 'Review data' },
  { label: 'Import', description: 'Run import' },
];

export const INLINE_NAV_STEPS: StepItem[] = [
  { label: 'Choose File', description: 'Select file' },
  { label: 'Map Data', description: 'Map columns' },
  { label: 'Sign Conventions', description: 'Set signs' },
  { label: 'Preview', description: 'Review data' },
  { label: 'Import', description: 'Run import' },
];

export const STEP_ORDER: ImportStep[] = ['map-data', 'sign-conventions', 'preview', 'monitor'];
export const INLINE_STEP_ORDER: ImportStep[] = [
  'choose-file',
  'map-data',
  'sign-conventions',
  'preview',
  'monitor',
];

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Expand 2-digit year to 4-digit. 00-49 → 2000s, 50-99 → 1900s. */
export function expandYear(y: string): string {
  if (y.length === 4) return y;
  const n = parseInt(y, 10);
  return String(n <= 49 ? 2000 + n : 1900 + n);
}

export function findAccount(val: string, acctList: Account[]): Account | undefined {
  const lower = val.toLowerCase();
  return acctList.find((a) => a.name.toLowerCase() === lower);
}

export function findFuzzyAccount(val: string, acctList: Account[]): Account | undefined {
  const lower = val.toLowerCase();
  return acctList.find(
    (a) => a.name.toLowerCase().includes(lower) || lower.includes(a.name.toLowerCase()),
  );
}

/** Format an import error into a user-friendly message */
export function formatImportError(err: unknown): string {
  if (err instanceof ApiError) {
    const msg = err.message;

    // Parse stringified Zod errors: {"issues":[...],"name":"ZodError"}
    if (msg.includes('"ZodError"') || msg.includes('"issues"')) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          return parsed.issues
            .map((i: { path?: string[]; message?: string }) => {
              const field = i.path?.join('.') || 'unknown field';
              return `${field}: ${i.message ?? 'invalid'}`;
            })
            .join(', ');
        }
      } catch {
        /* not valid JSON, fall through */
      }
    }

    // Parse Prisma FK violation
    if (
      msg.includes('Foreign key constraint violated') ||
      (msg.includes('prisma.') && msg.includes('Foreign key'))
    ) {
      const fkMatch = msg.match(/constraint:\s*`(\w+?)_(\w+?)_fkey`/);
      if (fkMatch) {
        const field = fkMatch[2]!;
        const friendly: Record<string, string> = {
          accountId: 'Account',
          budgetId: 'Budget',
          incomeId: 'Income source',
          expenseId: 'Expense',
          payPeriodId: 'Pay period',
          custodianId: 'Custodian',
          walletId: 'Wallet',
        };
        const name = friendly[field] ?? field;
        return `Referenced ${name} does not exist`;
      }
      return 'Referenced record does not exist';
    }

    // Parse Prisma invocation errors (strip the code block)
    if (msg.includes('prisma.') && msg.includes('invocation')) {
      const lines = msg.split('\n').filter((l) => l.trim());
      const lastLine = lines[lines.length - 1]?.trim();
      if (lastLine && !lastLine.includes('prisma.')) return lastLine;
      return 'Database rejected the record';
    }

    // Validation errors with field details
    if (msg === 'Validation failed') {
      const detailPart = err.description?.replace(/\s*\(POST.*$/, '');
      return detailPart || 'One or more fields have invalid values';
    }
    if (err.description && !err.description.startsWith('POST')) {
      const detailPart = err.description.replace(/\s*\(POST.*$/, '');
      if (detailPart && detailPart !== msg) return detailPart;
    }
    return msg;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj.error && typeof obj.error === 'string') return obj.error;
    if (obj.message && typeof obj.message === 'string') return obj.message;
    return JSON.stringify(err);
  }
  return 'Unknown error';
}

export function toLocalDate(dateStr: string): string {
  if (!dateStr) return dateStr;

  // 1. Excel serial date numbers (e.g., 46121.79)
  const num = Number(dateStr);
  if (Number.isFinite(num) && num > 10000 && num < 100000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 31));
    const ms = excelEpoch.getTime() + Math.floor(num) * 86400000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T12:00:00`;
  }

  const str = dateStr.trim();

  // 2. Already ISO-ish
  const isoMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}T12:00:00`;
  }

  const MONTHS: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  };

  // 3. Named month: Month Day Year
  const namedA = str.match(/^([A-Za-z]+)[.\s]+(\d{1,2})[,\s]+(\d{2,4})$/);
  if (namedA) {
    const mo = MONTHS[namedA[1]!.toLowerCase()];
    if (mo) {
      const yr = expandYear(namedA[3]!);
      return `${yr}-${mo}-${namedA[2]!.padStart(2, '0')}T12:00:00`;
    }
  }
  // Day Month Year
  const namedB = str.match(/^(\d{1,2})[\s.-]+([A-Za-z]+)[\s.-]+(\d{2,4})$/);
  if (namedB) {
    const mo = MONTHS[namedB[2]!.toLowerCase()];
    if (mo) {
      const yr = expandYear(namedB[3]!);
      return `${yr}-${mo}-${namedB[1]!.padStart(2, '0')}T12:00:00`;
    }
  }
  // Day Month (no year)
  const namedC = str.match(/^([A-Za-z]+)\s+(\d{1,2})$/) || str.match(/^(\d{1,2})\s+([A-Za-z]+)$/);
  if (namedC) {
    const parts = [namedC[1]!, namedC[2]!];
    const monthPart = parts.find((p) => MONTHS[p.toLowerCase()]);
    const dayPart = parts.find((p) => /^\d+$/.test(p));
    if (monthPart && dayPart) {
      const mo = MONTHS[monthPart.toLowerCase()]!;
      const yr = String(new Date().getUTCFullYear());
      return `${yr}-${mo}-${dayPart.padStart(2, '0')}T12:00:00`;
    }
  }

  // 4. Numeric: M/D/Y, D.M.Y
  const numParts = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (numParts) {
    const a = parseInt(numParts[1]!, 10);
    const b = parseInt(numParts[2]!, 10);
    const yr = expandYear(numParts[3]!);
    const sep = str.includes('.') ? '.' : str.includes('/') ? '/' : '-';
    let month: number, day: number;
    if (sep === '.') {
      day = a;
      month = b;
    } else if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      month = a;
      day = b;
    }
    return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`;
  }

  // 5. Two-part without year
  const twoPartMatch = str.match(/^(\d{1,2})[/.-](\d{1,2})$/);
  if (twoPartMatch) {
    const a = parseInt(twoPartMatch[1]!, 10);
    const b = parseInt(twoPartMatch[2]!, 10);
    const yr = String(new Date().getUTCFullYear());
    const sep = str.includes('.') ? '.' : '/';
    let month: number, day: number;
    if (sep === '.') {
      day = a;
      month = b;
    } else if (a > 12 && b <= 12) {
      day = a;
      month = b;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    } else {
      month = a;
      day = b;
    }
    return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00`;
  }

  // 6. Fallback
  return `${str}T12:00:00`;
}

/** One unmatched entity awaiting a user resolution during import. */
export interface PendingEntity {
  id: string;
  type: 'account' | 'custodian' | 'wallet';
  name: string;
  count: number;
  resolution: 'create' | 'pick' | 'exclude' | null;
  pickId: string;
  suggestedPickId?: string;
}

/** Side-channel callbacks + refs the import phases use to talk to the UI. */
export interface ImportIo {
  termLog: (text: string, status?: 'pending' | 'done' | 'error' | 'info' | 'warning') => void;
  termTask: (label: string) => Promise<(success: boolean, result?: string) => void>;
  promptEntity: (
    entity: PendingEntity,
  ) => Promise<{ resolution: 'create' | 'pick' | 'exclude'; pickId?: string }>;
  waitForDupeResolution: () => Promise<DupeAction>;
  setActiveResolution: (m: MonitorMessage | null) => void;
  setDupeGlobal: (a: DupeAction) => void;
  setTerminalProgress: (p: { current: number; total: number; hasErrors?: boolean } | null) => void;
  setLiveAccounts: (a: Account[]) => void;
  setCustodianList: (l: Array<{ id: string; name: string }>) => void;
  setWalletList: (l: Array<{ id: string; name: string }>) => void;
  cancelRef: { current: boolean };
  importedIdsRef: { current: string[] };
  createdEntitiesRef: { current: Array<{ type: 'account' | 'custodian' | 'wallet'; id: string }> };
}
