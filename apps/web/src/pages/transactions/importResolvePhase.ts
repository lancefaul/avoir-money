/**
 * Import phase 1+2: parse the raw sheet rows into ParsedRow[] and resolve every
 * referenced entity (accounts, custodians, wallets) against the database — with
 * interactive prompts for the unmatched ones. Extracted verbatim from
 * TransactionImportExport.tsx's doImport; UI side effects flow through ImportIo.
 */
import { api } from '../../lib/api.js';
import { parseCSVRows, type CSVColumnName, type SignConventionConfig } from '@budget-tracker/core';
import {
  type Account,
  type Category,
  type Row,
  type ParsedRow,
  type PendingEntity,
  type ImportIo,
  FIELDS,
  findAccount,
  findFuzzyAccount,
} from './importExportShared.js';

export interface ParseAndResolveArgs {
  rows: Row[];
  mapping: Record<string, string>;
  fullColumnMapping: Partial<Record<CSVColumnName, string>>;
  categories: Category[];
  accounts: Account[];
  defaultAccountId: string;
  defaultBudgetId: string;
  signConventionConfig: SignConventionConfig | null;
  io: ImportIo;
}

export interface ParseAndResolveResult {
  parsed: ParsedRow[];
  parseErrorSamples: string[];
  fallbackBudgetId: string;
  acctResolutionMap: Map<string, string | 'exclude'>;
  currentAccounts: Account[];
}

/** Parse rows and interactively resolve accounts/custodians/wallets. */
export async function parseAndResolveImport(
  args: ParseAndResolveArgs,
): Promise<ParseAndResolveResult> {
  const {
    rows,
    mapping,
    fullColumnMapping,
    categories,
    accounts,
    defaultAccountId,
    defaultBudgetId,
    signConventionConfig,
    io,
  } = args;

  // Ensure we have fresh category data for budgetId resolution
  const freshCategories = (await api.budgetItems.list()) as Category[];
  const fallbackBudgetId =
    defaultBudgetId ||
    freshCategories.find((c) => c.name.toLowerCase() === 'uncategorized')?.id ||
    '';

  // Parsing
  const endParsing = await io.termTask('Parsing rows');

  // Build column mapping
  const columnMapping: Partial<Record<CSVColumnName, string>> = { ...fullColumnMapping };
  for (const f of FIELDS) {
    const val = mapping[f];
    if (val) {
      columnMapping[f as CSVColumnName] = val;
    } else {
      delete columnMapping[f as CSVColumnName];
    }
  }

  const parseResult = parseCSVRows(rows, columnMapping);

  const parseErrorSamples: string[] = parseResult.errors
    .slice(0, 5)
    .map((e) => `Row ${e.row} [${e.field}]: ${e.message}`);

  // Sign convention config
  let signConfig: SignConventionConfig;
  if (signConventionConfig) {
    try {
      signConfig = await api.signConventions.save(signConventionConfig);
    } catch {
      signConfig = signConventionConfig;
    }
  } else {
    try {
      signConfig = await api.signConventions.get();
    } catch {
      const { DEFAULT_SIGN_CONVENTION_CONFIG } = await import('@budget-tracker/core');
      signConfig = DEFAULT_SIGN_CONVENTION_CONFIG;
    }
  }
  const { normalizeAmount } = await import('@budget-tracker/core');

  // Build parsed rows
  const parsed: ParsedRow[] = [];
  for (const tx of parseResult.transactions) {
    const effectiveCategoryDefault = defaultBudgetId || fallbackBudgetId || undefined;
    const catId = tx.rawCategory
      ? (categories.find((c) => c.name.toLowerCase() === tx.rawCategory!.toLowerCase())?.id ??
        categories.find(
          (c) =>
            c.name.toLowerCase().includes(tx.rawCategory!.toLowerCase()) ||
            tx.rawCategory!.toLowerCase().includes(c.name.toLowerCase()),
        )?.id ??
        effectiveCategoryDefault)
      : effectiveCategoryDefault;

    let finalType = tx.type as 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'TRADE' | 'REFUND';
    const normalized = normalizeAmount(tx.amount, finalType, signConfig);
    if ('excluded' in normalized) continue;
    const finalAmount = Math.abs(normalized.amount);
    if (
      tx.type === 'EXPENSE' &&
      tx.amount < 0 &&
      normalized.amount > 0 &&
      signConfig.expense.negativeMeaning === 'refund'
    ) {
      finalType = 'REFUND';
    }

    const row: ParsedRow = {
      name: tx.name,
      amount: finalAmount,
      date: tx.date,
      type: finalType,
      rawAccount: tx.rawAccount,
      budgetId: catId,
      note: tx.note,
    };
    if (tx.tradeMetadata) {
      row.rawCustodian = tx.tradeMetadata.rawCustodian;
      row.rawTradeWallet = tx.tradeMetadata.rawWallet;
      row.resolvedTradeMetadata = {
        direction: tx.tradeMetadata.direction,
        assetType: tx.tradeMetadata.assetType,
        ticker: tx.tradeMetadata.ticker,
        unitPrice: tx.tradeMetadata.unitPrice,
        quantity: tx.tradeMetadata.quantity,
        bitcoinUnit: tx.tradeMetadata.bitcoinUnit,
      };
    }
    if (tx.bitcoinMetadata) {
      row.rawBitcoinWallet = tx.bitcoinMetadata.rawWallet;
      row.resolvedBitcoinMetadata = {
        walletId: '',
        quantity: tx.bitcoinMetadata.quantity,
        bitcoinUnit: tx.bitcoinMetadata.bitcoinUnit,
        unitPrice: tx.bitcoinMetadata.unitPrice,
      };
    }
    if (tx.parentId) row.parentId = tx.parentId;
    if (tx.preTaxAmount !== undefined) row.preTaxAmount = tx.preTaxAmount;
    if (tx.taxAmount !== undefined) row.taxAmount = tx.taxAmount;
    if (tx.taxRate !== undefined) row.taxRate = tx.taxRate;
    if (tx.expenseId) row.expenseId = tx.expenseId;
    if (tx.incomeId) row.incomeId = tx.incomeId;
    if (tx.payPeriodId) row.payPeriodId = tx.payPeriodId;
    if (tx.occurrenceDate) row.occurrenceDate = tx.occurrenceDate;
    parsed.push(row);
  }

  endParsing(true, `${parsed.length} transactions parsed`);

  // ─── Collect all unmatched entities ──────────────────────────────────────
  const endAccounts = await io.termTask('Resolving accounts');
  const currentAccounts = [...accounts];
  const acctResolutionMap = new Map<string, string | 'exclude'>();
  const unmatchedNames = new Map<string, number>();
  for (const p of parsed) {
    const key = p.rawAccount || '';
    if (acctResolutionMap.has(key.toLowerCase())) continue;
    if (!key) {
      unmatchedNames.set('(no account)', (unmatchedNames.get('(no account)') || 0) + 1);
      continue;
    }
    const found = findAccount(key, currentAccounts);
    if (found) {
      acctResolutionMap.set(key.toLowerCase(), found.id);
    } else {
      unmatchedNames.set(key, (unmatchedNames.get(key) || 0) + 1);
    }
  }
  const emptyAcctCount = unmatchedNames.get('(no account)') || 0;
  unmatchedNames.delete('(no account)');
  if (emptyAcctCount > 0 && !defaultAccountId) {
    unmatchedNames.set('(blank – no account in file)', emptyAcctCount);
  }
  endAccounts(
    unmatchedNames.size === 0,
    unmatchedNames.size === 0 ? 'all matched' : `${unmatchedNames.size} unmatched`,
  );

  // Resolve each entity type sequentially
  // Resolve accounts one by one via modal queue
  if (unmatchedNames.size > 0) {
    io.termLog('Please resolve unmatched accounts in the prompt below.', 'info');
    for (const [name, count] of unmatchedNames.entries()) {
      const fuzzy = findFuzzyAccount(name, currentAccounts);
      const entity: PendingEntity = {
        id: `acct-${name}`,
        type: 'account',
        name,
        count,
        resolution: null,
        pickId: '',
        suggestedPickId: fuzzy?.id,
      };
      const result = await io.promptEntity(entity);
      if (result.resolution === 'exclude') {
        acctResolutionMap.set(name.toLowerCase(), 'exclude');
        io.termLog(
          `Exclude account: "${name}" (${count} transaction${count > 1 ? 's' : ''})`,
          'warning',
        );
      } else if (result.resolution === 'create') {
        try {
          const created = (await api.accounts.create({ name, type: 'Other' })) as Account;
          currentAccounts.push(created);
          acctResolutionMap.set(name.toLowerCase(), created.id);
          io.createdEntitiesRef.current.push({ type: 'account', id: created.id });
          io.termLog(`Create new account: "${name}"`, 'done');
        } catch {
          acctResolutionMap.set(name.toLowerCase(), 'exclude');
          io.termLog(`Failed to create account: "${name}" — excluded`, 'error');
        }
      } else if (result.resolution === 'pick' && result.pickId) {
        acctResolutionMap.set(name.toLowerCase(), result.pickId);
        const picked = currentAccounts.find((a) => a.id === result.pickId);
        io.termLog(`Map account "${name}" → "${picked?.name ?? result.pickId}"`, 'done');
      }
    }
  }

  // Custodians
  const endCustodians = await io.termTask('Resolving custodians');
  const custodians = (await api.investments.custodians.list()) as Array<{
    id: string;
    name: string;
  }>;
  let currentCustodians = [...custodians];
  io.setCustodianList(currentCustodians);
  const custResolutionMap = new Map<string, string | 'skip'>();
  const unmatchedCustodians = new Map<string, number>();
  for (const p of parsed) {
    const name = p.rawCustodian;
    if (!name) continue;
    if (custResolutionMap.has(name.toLowerCase())) continue;
    const found = currentCustodians.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (found) {
      custResolutionMap.set(name.toLowerCase(), found.id);
    } else {
      unmatchedCustodians.set(name, (unmatchedCustodians.get(name) || 0) + 1);
    }
  }
  endCustodians(
    unmatchedCustodians.size === 0,
    unmatchedCustodians.size === 0 ? 'all matched' : `${unmatchedCustodians.size} unmatched`,
  );

  if (unmatchedCustodians.size > 0) {
    io.termLog('Please resolve unmatched custodians in the prompt below.', 'info');
    for (const [name, count] of unmatchedCustodians.entries()) {
      const entity: PendingEntity = {
        id: `cust-${name}`,
        type: 'custodian',
        name,
        count,
        resolution: null,
        pickId: '',
      };
      const result = await io.promptEntity(entity);
      if (result.resolution === 'exclude') {
        custResolutionMap.set(name.toLowerCase(), 'skip');
        io.termLog(
          `Exclude custodian: "${name}" (${count} transaction${count > 1 ? 's' : ''})`,
          'warning',
        );
      } else if (result.resolution === 'create') {
        try {
          const created = (await api.investments.custodians.create({ name })) as {
            id: string;
            name: string;
          };
          currentCustodians = [...currentCustodians, created];
          custResolutionMap.set(name.toLowerCase(), created.id);
          io.createdEntitiesRef.current.push({ type: 'custodian', id: created.id });
          io.termLog(`Create new custodian: "${name}"`, 'done');
        } catch {
          custResolutionMap.set(name.toLowerCase(), 'skip');
          io.termLog(`Failed to create custodian: "${name}" — skipped`, 'error');
        }
      } else if (result.resolution === 'pick' && result.pickId) {
        custResolutionMap.set(name.toLowerCase(), result.pickId);
        const picked = currentCustodians.find((c) => c.id === result.pickId);
        io.termLog(`Map custodian "${name}" → "${picked?.name ?? result.pickId}"`, 'done');
      }
    }
  }

  // Wallets
  const endWallets = await io.termTask('Resolving wallets');
  const wallets = (await api.investments.wallets.list()) as Array<{ id: string; name: string }>;
  let currentWallets = [...wallets];
  io.setWalletList(currentWallets);
  const walletResolutionMap = new Map<string, string | 'skip'>();
  const unmatchedWallets = new Map<string, number>();
  for (const p of parsed) {
    const tradeName = p.rawTradeWallet;
    if (tradeName && !walletResolutionMap.has(tradeName.toLowerCase())) {
      const found = currentWallets.find((w) => w.name.toLowerCase() === tradeName.toLowerCase());
      if (found) {
        walletResolutionMap.set(tradeName.toLowerCase(), found.id);
      } else {
        unmatchedWallets.set(tradeName, (unmatchedWallets.get(tradeName) || 0) + 1);
      }
    }
    const btcName = p.rawBitcoinWallet;
    if (btcName && !walletResolutionMap.has(btcName.toLowerCase())) {
      const found = currentWallets.find((w) => w.name.toLowerCase() === btcName.toLowerCase());
      if (found) {
        walletResolutionMap.set(btcName.toLowerCase(), found.id);
      } else {
        unmatchedWallets.set(btcName, (unmatchedWallets.get(btcName) || 0) + 1);
      }
    }
  }
  endWallets(
    unmatchedWallets.size === 0,
    unmatchedWallets.size === 0 ? 'all matched' : `${unmatchedWallets.size} unmatched`,
  );

  if (unmatchedWallets.size > 0) {
    io.termLog('Please resolve unmatched wallets in the prompt below.', 'info');
    for (const [name, count] of unmatchedWallets.entries()) {
      const entity: PendingEntity = {
        id: `wallet-${name}`,
        type: 'wallet',
        name,
        count,
        resolution: null,
        pickId: '',
      };
      const result = await io.promptEntity(entity);
      if (result.resolution === 'exclude') {
        walletResolutionMap.set(name.toLowerCase(), 'skip');
        io.termLog(
          `Exclude wallet: "${name}" (${count} transaction${count > 1 ? 's' : ''})`,
          'warning',
        );
      } else if (result.resolution === 'create') {
        try {
          const created = (await api.investments.wallets.create({ name })) as {
            id: string;
            name: string;
          };
          currentWallets = [...currentWallets, created];
          walletResolutionMap.set(name.toLowerCase(), created.id);
          io.createdEntitiesRef.current.push({ type: 'wallet', id: created.id });
          io.termLog(`Create new wallet: "${name}"`, 'done');
        } catch {
          walletResolutionMap.set(name.toLowerCase(), 'skip');
          io.termLog(`Failed to create wallet: "${name}" — skipped`, 'error');
        }
      } else if (result.resolution === 'pick' && result.pickId) {
        walletResolutionMap.set(name.toLowerCase(), result.pickId);
        const picked = currentWallets.find((w) => w.id === result.pickId);
        io.termLog(`Map wallet "${name}" → "${picked?.name ?? result.pickId}"`, 'done');
      }
    }
  }

  io.setLiveAccounts(currentAccounts);

  // Apply custodian resolution to parsed rows
  for (const p of parsed) {
    if (p.rawCustodian && p.resolvedTradeMetadata) {
      const resolved = custResolutionMap.get(p.rawCustodian.toLowerCase());
      if (resolved && resolved !== 'skip') {
        p.resolvedTradeMetadata.custodianId = resolved;
      } else if (resolved === 'skip') {
        delete p.resolvedTradeMetadata;
        p.type = 'EXPENSE';
      }
    }
  }

  // Apply wallet resolution to parsed rows
  for (const p of parsed) {
    if (p.rawTradeWallet && p.resolvedTradeMetadata) {
      const resolved = walletResolutionMap.get(p.rawTradeWallet.toLowerCase());
      if (resolved && resolved !== 'skip') {
        p.resolvedTradeMetadata.walletId = resolved;
      } else if (resolved === 'skip') {
        delete p.resolvedTradeMetadata;
        p.type = 'EXPENSE';
      }
    }
    if (p.rawBitcoinWallet && p.resolvedBitcoinMetadata) {
      const resolved = walletResolutionMap.get(p.rawBitcoinWallet.toLowerCase());
      if (resolved && resolved !== 'skip') {
        p.resolvedBitcoinMetadata.walletId = resolved;
      } else if (resolved === 'skip') {
        delete p.resolvedBitcoinMetadata;
      }
    }
  }

  return { parsed, parseErrorSamples, fallbackBudgetId, acctResolutionMap, currentAccounts };
}
