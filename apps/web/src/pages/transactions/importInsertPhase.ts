/**
 * Import phase 3: filter excluded rows, pair transfers, detect duplicates and
 * insert everything (parents, then children, then dupe resolutions). Extracted
 * verbatim from TransactionImportExport.tsx's doImport; UI side effects flow
 * through ImportIo. Returns { cancelled: true } when the user cancels mid-run.
 */
import { api } from '../../lib/api.js';
import {
  type Account,
  type Transaction,
  type ParsedRow,
  type DupeAction,
  type MonitorMessage,
  type ImportIo,
  formatImportError,
  toLocalDate,
} from './importExportShared.js';

export interface InsertPhaseArgs {
  parsed: ParsedRow[];
  acctResolutionMap: Map<string, string | 'exclude'>;
  currentAccounts: Account[];
  defaultAccountId: string;
  defaultBudgetId: string;
  fallbackBudgetId: string;
  parseErrorSamples: string[];
  initialDupeGlobal: DupeAction;
  /** Verbose logging enabled. */
  v: boolean;
  /** Verbose log sink (mutated in place). */
  log: string[];
  io: ImportIo;
}

export interface InsertPhaseTotals {
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

/** Filter, pair, dupe-check and insert the parsed rows. */
export async function filterPairInsertImport(
  args: InsertPhaseArgs,
): Promise<{ cancelled: true } | { cancelled: false; ids: string[]; totals: InsertPhaseTotals }> {
  const {
    parsed,
    acctResolutionMap,
    currentAccounts,
    defaultAccountId,
    defaultBudgetId,
    fallbackBudgetId,
    parseErrorSamples,
    initialDupeGlobal,
    v,
    log,
    io,
  } = args;

  // ─── Filter excluded rows ────────────────────────────────────────────────
  let excluded = 0;
  const importable: ParsedRow[] = [];
  for (const p of parsed) {
    const key = p.rawAccount.toLowerCase();
    const resolved = key ? acctResolutionMap.get(key) : undefined;
    const blankResolved = !key ? acctResolutionMap.get('(blank – no account in file)') : undefined;
    const finalResolved = resolved || blankResolved;
    if (finalResolved === 'exclude') {
      excluded++;
      if (v) log.push(`⛔ EXCLUDED: "${p.name}" ${p.amount} on ${p.date} – account excluded`);
      continue;
    }
    p.accountId = (finalResolved as string) || defaultAccountId || undefined;
    if (!p.accountId) {
      excluded++;
      if (v) log.push(`⛔ EXCLUDED: "${p.name}" ${p.amount} on ${p.date} – no account resolved`);
      continue;
    }
    importable.push(p);
  }

  // ─── Transfer pairing ────────────────────────────────────────────────────
  const endTransfers = await io.termTask('Pairing transfers');
  const transfers = importable.filter((p) => p.type === 'TRANSFER');
  const nonTransfers = importable.filter((p) => p.type !== 'TRANSFER');
  const paired: ParsedRow[] = [];
  const usedTransferIndices = new Set<number>();

  function transferDaysDiff(a: string, b: string): number {
    const na = Number(a),
      nb = Number(b);
    if (Number.isFinite(na) && na > 10000 && Number.isFinite(nb) && nb > 10000) {
      return Math.abs(Math.floor(na) - Math.floor(nb));
    }
    const da = new Date(a.split('T')[0]!).getTime();
    const db = new Date(b.split('T')[0]!).getTime();
    return Math.abs(da - db) / 86400000;
  }

  function normalizeName(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function pairScore(a: ParsedRow, b: ParsedRow): number {
    const dayDiff = transferDaysDiff(a.date, b.date);
    const amountMatch = Math.abs(a.amount - b.amount) < 0.01;
    const diffAccounts = a.accountId !== b.accountId;
    const nameMatch = normalizeName(a.name) === normalizeName(b.name);
    if (!diffAccounts) return -1;
    if (!amountMatch) return -1;
    if (dayDiff > 7) return -1;
    let score = 0;
    if (nameMatch) score += 50;
    score += (7 - dayDiff) * 10;
    return score;
  }

  for (let i = 0; i < transfers.length; i++) {
    if (usedTransferIndices.has(i)) continue;
    const t = transfers[i]!;
    let bestIdx = -1;
    let bestScore = -1;
    for (let j = i + 1; j < transfers.length; j++) {
      if (usedTransferIndices.has(j)) continue;
      const score = pairScore(t, transfers[j]!);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      const partner = transfers[bestIdx]!;
      usedTransferIndices.add(i);
      usedTransferIndices.add(bestIdx);
      paired.push({ ...t, toAccountId: partner.accountId });
    } else {
      paired.push(t);
    }
  }

  // Placeholder account for unpaired transfers
  const unpairedTransfers = paired.filter((p) => p.type === 'TRANSFER' && !p.toAccountId);
  let placeholderAccountId: string | undefined;
  if (unpairedTransfers.length > 0) {
    const existing = currentAccounts.find((a) => a.name === 'Unmatched Transfers');
    if (existing) {
      placeholderAccountId = existing.id;
    } else {
      try {
        const created = (await api.accounts.create({
          name: 'Unmatched Transfers',
          type: 'Other',
        })) as Account;
        currentAccounts.push(created);
        io.setLiveAccounts([...currentAccounts]);
        placeholderAccountId = created.id;
        io.createdEntitiesRef.current.push({ type: 'account', id: created.id });
      } catch {
        placeholderAccountId = undefined;
      }
    }
    for (const p of unpairedTransfers) {
      if (placeholderAccountId && p.accountId !== placeholderAccountId) {
        p.toAccountId = placeholderAccountId;
      } else {
        p.type = 'EXPENSE';
      }
    }
  }

  const finalImportable = [...nonTransfers, ...paired];
  const transfersTotal = transfers.length;
  const transfersPaired = usedTransferIndices.size;
  const transfersUnpaired = transfers.length - usedTransferIndices.size;

  endTransfers(true, `${transfersPaired / 2} paired, ${transfersUnpaired} unpaired`);

  // ─── Dupe check ──────────────────────────────────────────────────────────
  const endDupes = await io.termTask('Checking for duplicates');
  if (io.cancelRef.current) {
    return { cancelled: true as const };
  }
  await new Promise((r) => setTimeout(r, 0));

  let existing: Transaction[] = [];
  try {
    const abortCtrl = new AbortController();
    const timeout = setTimeout(() => abortCtrl.abort(), 10000);
    const res = await fetch('/api/v1/transactions?limit=10000&skipGenerate=true', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_API_KEY ?? 'budget-tracker-dev-key'}`,
      },
      signal: abortCtrl.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const json = await res.json();
      existing = (json.transactions ?? []) as Transaction[];
    }
  } catch {
    io.termLog('Dupe check skipped (timed out)', 'info');
  }

  function normalize(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function isSimilar(a: string, b: string): boolean {
    const na = normalize(a),
      nb = normalize(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }
  function daysDiff(a: string | Date, b: string | Date): number {
    const sa = typeof a === 'string' ? a.split('T')[0]! : a.toISOString().split('T')[0]!;
    const sb = typeof b === 'string' ? b.split('T')[0]! : b.toISOString().split('T')[0]!;
    const da = new Date(sa).getTime();
    const db = new Date(sb).getTime();
    return Math.abs(da - db) / 86400000;
  }

  for (let idx = 0; idx < finalImportable.length; idx++) {
    if (io.cancelRef.current) break;
    const p = finalImportable[idx]!;
    if (idx % 50 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const match = existing.find(
      (t) =>
        Math.abs(Math.abs(t.amount) - p.amount) < 0.01 &&
        daysDiff(t.date, p.date) <= 2 &&
        (isSimilar(t.name, p.name) ||
          (t.note && isSimilar(t.note, p.name)) ||
          (p.note && isSimilar(t.name, p.note!))),
    );
    if (match) {
      p.existingId = match.id;
      if (v) {
        const matchDateStr =
          typeof match.date === 'string'
            ? match.date.split('T')[0]
            : new Date(match.date).toISOString().split('T')[0];
        log.push(
          `🔄 DUPLICATE: "${p.name}" ${p.amount} on ${p.date} ↔ existing "${match.name}" ${Math.abs(match.amount)} on ${matchDateStr}`,
        );
      }
    } else {
      if (v) log.push(`✅ NEW: "${p.name}" ${p.amount} on ${p.date}`);
    }
  }
  const dupeRows = finalImportable.filter((p) => p.existingId);
  const freshRows = finalImportable.filter((p) => !p.existingId);

  endDupes(true, `${freshRows.length} new, ${dupeRows.length} duplicates`);

  const endImporting = await io.termTask('Importing transactions');

  let success = 0;
  let skipped = 0;
  let replaced = 0;
  let errors = parseErrorSamples.length;
  const errorSamples = [...parseErrorSamples];
  const ids: string[] = [];

  function buildBody(p: ParsedRow): Record<string, unknown> {
    const body: Record<string, unknown> = {
      type: p.type,
      name: p.name,
      amount: p.amount,
      date: toLocalDate(p.date),
      accountId: p.accountId,
      imported: true,
    };
    if (p.budgetId) body.budgetId = p.budgetId;
    if (p.toAccountId) body.toAccountId = p.toAccountId;
    if (p.note) body.note = p.note;
    if (p.resolvedTradeMetadata) body.tradeMetadata = p.resolvedTradeMetadata;
    if (p.resolvedBitcoinMetadata && p.resolvedBitcoinMetadata.walletId)
      body.bitcoinMetadata = p.resolvedBitcoinMetadata;
    if (p.occurrenceDate) body.occurrenceDate = p.occurrenceDate;
    // Note: expenseId, incomeId, payPeriodId are intentionally excluded —
    // they reference recurring records that may not exist on the target DB.
    // The schedule matcher lifecycle hook will re-link them automatically.
    return body;
  }

  function buildChildBody(p: ParsedRow): Record<string, unknown> {
    const body: Record<string, unknown> = { amount: p.amount };
    const resolvedBudget = p.budgetId || defaultBudgetId || fallbackBudgetId;
    if (resolvedBudget) body.budgetId = resolvedBudget;
    if (p.note) body.note = p.note;
    if (p.preTaxAmount !== undefined) body.preTaxAmount = p.preTaxAmount;
    // API requires either taxAmount or taxRate, not both — prefer taxAmount
    if (p.taxAmount !== undefined) body.taxAmount = p.taxAmount;
    else if (p.taxRate !== undefined) body.taxRate = p.taxRate;
    return body;
  }

  // Parent-child ordering
  const parentRowIndices = new Map<number, string>();
  for (let i = 0; i < freshRows.length; i++) {
    const p = freshRows[i]!;
    if (p.parentId) continue;
    const assignedParentIds = new Set(parentRowIndices.values());
    for (let j = i + 1; j < freshRows.length; j++) {
      const next = freshRows[j]!;
      if (!next.parentId) break;
      if (!assignedParentIds.has(next.parentId)) {
        parentRowIndices.set(i, next.parentId);
        break;
      }
    }
  }
  const parentIdMap = new Map<string, string>();

  // Create fresh rows
  for (let i = 0; i < freshRows.length; i++) {
    if (io.cancelRef.current) break;
    const p = freshRows[i]!;
    if (p.parentId) continue;
    if (i % 25 === 0) {
      io.setTerminalProgress({ current: i, total: freshRows.length });
      await new Promise((r) => setTimeout(r, 0));
    }
    const body = buildBody(p);
    try {
      const created = (await api.transactions.create(body)) as { id: string };
      ids.push(created.id);
      io.importedIdsRef.current.push(created.id);
      success++;
      const pid = parentRowIndices.get(i);
      if (pid) parentIdMap.set(pid, created.id);
      if (v) log.push(`  ✅ Imported: "${p.name}" ${p.amount} on ${p.date}`);
    } catch (err) {
      errors++;
      const msg = formatImportError(err);
      if (errorSamples.length < 10) errorSamples.push(`"${p.name}" on ${p.date}: ${msg}`);
      if (v) log.push(`  ❌ Failed: "${p.name}" ${p.amount} on ${p.date} – ${msg}`);
    }
  }

  // Create children
  for (let i = 0; i < freshRows.length; i++) {
    if (io.cancelRef.current) break;
    const p = freshRows[i]!;
    if (!p.parentId) continue;
    const newParentId = parentIdMap.get(p.parentId);
    if (!newParentId) {
      errors++;
      if (v) log.push(`  ❌ Child "${p.name}" skipped: parent not found`);
      continue;
    }
    const childBody = buildChildBody(p);
    try {
      const created = (await api.transactions.createChild(newParentId, childBody)) as {
        id: string;
      };
      ids.push(created.id);
      io.importedIdsRef.current.push(created.id);
      success++;
      if (v) log.push(`  ✅ Imported child: "${p.name}" ${p.amount}`);
    } catch (err) {
      errors++;
      const msg = formatImportError(err);
      if (errorSamples.length < 5) errorSamples.push(`Child "${p.name}": ${msg}`);
      if (v) log.push(`  ❌ Failed child: "${p.name}" – ${msg}`);
    }
  }

  // Handle duplicates
  let globalAction = initialDupeGlobal;
  for (let i = 0; i < dupeRows.length; i++) {
    const p = dupeRows[i]!;
    let action = globalAction;
    if (!action) {
      const msg: MonitorMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'duplicate',
        title: `Duplicate: "${p.name}"`,
        description: `${i + 1} of ${dupeRows.length} – ${p.date} – $${p.amount}`,
        status: 'pending',
      };
      io.setActiveResolution(msg);
      action = await io.waitForDupeResolution();
      if (action === 'skip_all') {
        globalAction = 'skip_all';
        io.setDupeGlobal('skip_all');
        action = 'skip';
      }
      if (action === 'replace_all') {
        globalAction = 'replace_all';
        io.setDupeGlobal('replace_all');
        action = 'replace';
      }
      io.setActiveResolution(null);
    } else {
      action = globalAction === 'skip_all' ? 'skip' : 'replace';
    }
    if (action === 'skip') {
      skipped++;
      if (v) log.push(`  ⏭️ Skipped dupe: "${p.name}"`);
      continue;
    }
    if (action === 'replace') {
      const body = buildBody(p);
      try {
        await api.transactions.update(p.existingId!, body);
        replaced++;
        if (v) log.push(`  🔄 Replaced: "${p.name}"`);
      } catch (err) {
        errors++;
        const msg = formatImportError(err);
        if (errorSamples.length < 5) errorSamples.push(`Replace "${p.name}": ${msg}`);
      }
    }
  }

  if (io.cancelRef.current) {
    return { cancelled: true as const };
  }
  endImporting(errors === 0, `${success} imported, ${errors} errors, ${skipped} skipped`);
  io.setTerminalProgress({
    current: success,
    total: success + errors + skipped,
    hasErrors: errors > 0,
  });
  return {
    cancelled: false as const,
    ids,
    totals: {
      success,
      skipped,
      replaced,
      excluded,
      errors,
      errorSamples,
      transfersTotal,
      transfersPaired,
      transfersUnpaired,
    },
  };
}
