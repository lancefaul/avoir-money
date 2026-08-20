/**
 * Statement CSV parsing for reconciliation.
 *
 * Two shapes are supported, chosen from the header rather than by asking the
 * user, because the export tells you what it is:
 *
 *  - **Card / bank exports** (e.g. Chase): a transaction date, an optional
 *    posting date, a description, and one signed amount where negative is money
 *    leaving the account.
 *  - **Cash Wallet**: a timestamp, a Transaction Type, a Currency (USD or BTC), a
 *    Net Amount that folds in fees, and a Status that includes rows which never
 *    happened. It needs filtering the card exports do not, so it is a separate
 *    parser rather than a few more column aliases.
 *
 * Both converge on the same `ParsedStatementRow`, signed the same way, so
 * everything downstream — matching, the residual, dedup — is format-blind.
 * Columns are detected from the header rather than assumed by position, because
 * a positional parser silently mis-reads a re-ordered export instead of failing.
 */

export interface ParsedStatementRow {
  postedDate: Date;
  transactionDate: Date;
  description: string;
  /** Signed: negative is money leaving the account. */
  amount: number;
  /** Verbatim source line — the dedupe key and audit trail. */
  rawLine: string;
}

export class StatementParseError extends Error {
  constructor(
    message: string,
    /** 1-based line number in the original file, header included. */
    readonly line: number,
  ) {
    super(message);
    this.name = 'StatementParseError';
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Strip the currency symbol and thousands separators from a money field. */
const MONEY_CHARS = /[$,]/g;

/**
 * Split one CSV line, honouring double-quoted fields.
 *
 * A naive `split(',')` corrupts any description containing a comma — common in
 * merchant names — and shifts every subsequent column, so the amount is read
 * from the wrong field and the row silently imports at the wrong value.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Parse M/D/YYYY or YYYY-MM-DD (optionally followed by a time) to UTC midnight. */
function parseDate(raw: string, line: number): Date {
  // Cash Wallet stamps a full local time — "2026-07-21 13:03:01 CDT". The calendar
  // day is all that matters, and it is the day the app stored when the same
  // transaction was entered; take it verbatim and never convert the time, which
  // could shove a late-night row onto the next day.
  const day = raw.slice(0, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (us) {
    return new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
  }
  throw new StatementParseError(`Unrecognized date "${raw}"`, line);
}

function findColumn(header: string[], candidates: string[]): number {
  const normalized = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  for (const c of candidates) {
    const idx = normalized.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface ParseStatementResult {
  rows: ParsedStatementRow[];
  /** Posted-date coverage — the earliest and latest activity in the file. */
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Cash Wallet's export carries two columns no card statement does. Detecting on
 * both, rather than either, avoids mistaking some future bank's "Net Amount"
 * column for Cash Wallet.
 */
function isCashAppHeader(header: string[]): boolean {
  return findColumn(header, ['netamount']) !== -1 && findColumn(header, ['transactiontype']) !== -1;
}

/** Card / bank export: one signed amount per row. */
function parseCardRows(lines: string[], header: string[]): ParsedStatementRow[] {
  const txCol = findColumn(header, ['transactiondate', 'date', 'tradedate']);
  const postCol = findColumn(header, ['postdate', 'posteddate', 'postingdate']);
  const descCol = findColumn(header, ['description', 'payee', 'name', 'merchant']);
  const amtCol = findColumn(header, ['amount', 'debitcredit', 'value']);

  if (txCol === -1) throw new StatementParseError('No transaction-date column found', 1);
  if (descCol === -1) throw new StatementParseError('No description column found', 1);
  if (amtCol === -1) throw new StatementParseError('No amount column found', 1);

  const rows: ParsedStatementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]!;
    if (!rawLine.trim()) continue;
    const lineNo = i + 1;
    const cols = splitCsvLine(rawLine);

    if (cols.length <= Math.max(txCol, descCol, amtCol)) {
      throw new StatementParseError(
        `Expected at least ${Math.max(txCol, descCol, amtCol) + 1} columns, found ${cols.length}`,
        lineNo,
      );
    }

    const amount = Number(cols[amtCol]!.replace(MONEY_CHARS, ''));
    if (!Number.isFinite(amount)) {
      throw new StatementParseError(`Unreadable amount "${cols[amtCol]}"`, lineNo);
    }

    const transactionDate = parseDate(cols[txCol]!, lineNo);
    // Not every export carries a posting date; fall back to the transaction date.
    const postedDate =
      postCol !== -1 && cols[postCol] ? parseDate(cols[postCol]!, lineNo) : transactionDate;

    rows.push({
      postedDate,
      transactionDate,
      description: cols[descCol]!,
      amount: round2(amount),
      rawLine,
    });
  }
  return rows;
}

/**
 * Cash Wallet export.
 *
 * Four kinds of row are dropped, because each would invent a discrepancy the
 * bank never made:
 *
 *  1. `Status` other than COMPLETE — FAILED card auths and the like never moved
 *     money. Cash Wallet emits a lot of these ($0.01 verification pings).
 *  2. `Currency` other than USD — Bitcoin deposits, withdrawals and lightning
 *     payments move the bitcoin holding, not the USD cash balance. A Bitcoin
 *     BUY or SELL is Currency=USD (it spends or receives dollars) and stays in.
 *  3. A net of $0.00 — device-login notifications and $0 loyalty pings have no
 *     effect on the balance and can pair with nothing.
 *  4. `Savings Interest Payment` — exported as a NEGATIVE on the cash balance
 *     (−$1.40), which reads as money leaving, but the cash balance does not
 *     actually move: the minus sign is how the export narrates interest paid
 *     straight into the separate Savings pot. Keeping it would drive the
 *     reconciled balance below the statement by the interest every period.
 *     The interest is real income and belongs on the Savings account, which is
 *     a separate entry the user makes there — not something a Checking
 *     statement can produce.
 *
 * The figure used is **Net Amount**, not Amount: fees reduce the cash balance,
 * and Net already folds them in (a −$42.50 purchase with a −$3.00 fee left the
 * account by −$45.50). Its sign already matches the card convention — negative
 * is money leaving — so nothing is flipped.
 */
/**
 * A savings-interest sweep, which the cash balance never actually paid.
 *
 * Matched on the exact transaction type rather than anything looser. The
 * failure directions are not symmetric: too loose and a real transaction is
 * silently dropped and never reconciles, which is unrecoverable without
 * noticing; too strict and the row simply reappears as an unmatched line, which
 * is visible and asks its own question. Sub-dollar amount is deliberately NOT
 * part of the test — a real small transaction must still reconcile, and the
 * interest will exceed a dollar as the balance grows.
 */
function isSavingsInterest(transactionType: string | undefined): boolean {
  return (transactionType ?? '').trim().toLowerCase() === 'savings interest payment';
}

function parseCashAppRows(lines: string[], header: string[]): ParsedStatementRow[] {
  const dateCol = findColumn(header, ['date']);
  const netCol = findColumn(header, ['netamount']);
  const amtCol = findColumn(header, ['amount']);
  const notesCol = findColumn(header, ['notes']);
  const nameCol = findColumn(header, ['nameofsenderreceiver']);
  const typeCol = findColumn(header, ['transactiontype']);
  const currencyCol = findColumn(header, ['currency']);
  const statusCol = findColumn(header, ['status']);

  if (dateCol === -1) throw new StatementParseError('No Date column found', 1);
  if (currencyCol === -1) throw new StatementParseError('No Currency column found', 1);
  if (statusCol === -1) throw new StatementParseError('No Status column found', 1);
  // Prefer Net Amount (fee-inclusive); fall back to Amount only if a Net column
  // is genuinely absent.
  const amountCol = netCol !== -1 ? netCol : amtCol;
  if (amountCol === -1) throw new StatementParseError('No amount column found', 1);

  const need = Math.max(dateCol, amountCol, currencyCol, statusCol);

  const rows: ParsedStatementRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]!;
    if (!rawLine.trim()) continue;
    const lineNo = i + 1;
    const cols = splitCsvLine(rawLine);

    if (cols.length <= need) {
      throw new StatementParseError(
        `Expected at least ${need + 1} columns, found ${cols.length}`,
        lineNo,
      );
    }

    if ((cols[statusCol] ?? '').toUpperCase() !== 'COMPLETE') continue;
    if ((cols[currencyCol] ?? '').toUpperCase() !== 'USD') continue;
    if (isSavingsInterest(typeCol !== -1 ? cols[typeCol] : undefined)) continue;

    const amount = Number((cols[amountCol] ?? '').replace(MONEY_CHARS, ''));
    if (!Number.isFinite(amount)) {
      throw new StatementParseError(`Unreadable amount "${cols[amountCol]}"`, lineNo);
    }
    if (Math.round(amount * 100) === 0) continue;

    const date = parseDate(cols[dateCol] ?? '', lineNo);

    const description =
      (notesCol !== -1 ? (cols[notesCol] ?? '').trim() : '') ||
      (nameCol !== -1 ? (cols[nameCol] ?? '').trim() : '') ||
      (typeCol !== -1 ? (cols[typeCol] ?? '').trim() : '') ||
      'Cash Wallet';

    rows.push({
      postedDate: date,
      transactionDate: date,
      description,
      amount: round2(amount),
      rawLine,
    });
  }
  return rows;
}

/**
 * Parse a statement CSV export, detecting the format from its header.
 *
 * Throws `StatementParseError` with the offending line number rather than
 * skipping bad rows: a partially-imported statement produces a residual that
 * looks like a real discrepancy, which is worse than a refusal.
 */
export function parseStatementCsv(csv: string): ParseStatementResult {
  const lines = csv.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length < 2) {
    throw new StatementParseError('Statement has no data rows', 1);
  }

  const header = splitCsvLine(lines[0]!);
  const rows = isCashAppHeader(header)
    ? parseCashAppRows(lines, header)
    : parseCardRows(lines, header);

  if (rows.length === 0) {
    // For Cash Wallet this can mean every row was filtered (all failed, all BTC);
    // the message is deliberately the same, because in both cases there is
    // nothing here to reconcile against.
    throw new StatementParseError('Statement has no reconcilable rows', 1);
  }

  const postedTimes = rows.map((r) => r.postedDate.getTime());
  return {
    rows,
    periodStart: new Date(Math.min(...postedTimes)),
    periodEnd: new Date(Math.max(...postedTimes)),
  };
}
