import { format } from 'date-fns';

/** Get today's date as YYYY-MM-DD in local timezone */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCurrency(amount: number): string {
  // Clamp near-zero to zero to prevent "-$0.00" from floating point artifacts
  const val = Math.abs(amount) < 0.005 ? 0 : amount;
  return currencyFormatter.format(val);
}

/**
 * Abbreviated currency for narrow viewports.
 *
 *   < $10,000               whole dollars   $1,156
 *   $10,000 – $999,999      $xxx.xxk        $16.43k
 *   >= $1,000,000           $xxx.xxm        $1.25m
 *
 * The unit is chosen AFTER rounding, so a value never overflows its own bucket:
 * $9,999.99 renders "$10.00k" (not "$10,000") and $999,999.99 renders "$1.00m"
 * (not "$1000.00k"). Negatives keep their sign: -$16,432.89 -> "-$16.43k".
 *
 * Display only — never feed this back into a calculation.
 */
export function formatCurrencyCompact(amount: number): string {
  // Match formatCurrency's near-zero clamp so -0.001 never renders as "-$0"
  const val = Math.abs(amount) < 0.005 ? 0 : amount;
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);

  if (abs < 10_000) {
    const whole = Math.round(abs);
    if (whole < 10_000) return `${sign}$${whole.toLocaleString('en-US')}`;
    // rounded up into the next unit — fall through
  }

  if (abs < 1_000_000) {
    const k = (abs / 1_000).toFixed(2);
    if (Number(k) < 1_000) return `${sign}$${k}k`;
    // rounded up into the next unit — fall through
  }

  return `${sign}$${(abs / 1_000_000).toFixed(2)}m`;
}

/**
 * Whole-dollar currency for narrow viewports: "$14,509", never abbreviated.
 * Use when cents are noise but magnitudes must stay literal (unlike
 * formatCurrencyCompact's k/m units). Negatives keep their sign; near-zero
 * clamps to $0 like formatCurrency.
 *
 * Display only — never feed this back into a calculation.
 */
export function formatCurrencyWhole(amount: number): string {
  const val = Math.abs(amount) < 0.005 ? 0 : amount;
  const sign = val < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(val)).toLocaleString('en-US')}`;
}

/** Format a count with locale-aware thousands separators (e.g., 1,234) */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Parse a date string as local time (avoids UTC timezone shift) */
function parseLocal(date: string | Date): Date {
  // Always extract the date part and create in local timezone to avoid UTC shift
  const iso = typeof date === 'string' ? date : date.toISOString();
  const parts = iso.split('T')[0]!.split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

export function formatDate(date: string | Date): string {
  return format(parseLocal(date), 'MMM dd, yyyy');
}

/**
 * Month spelled out, e.g. July 8, 2026.
 *
 * For period headings, where the span is the subject of the heading rather than
 * a cell in a dense row — matching how Budgets renders its pay period.
 */
export function formatLongDate(date: string | Date): string {
  return format(parseLocal(date), 'MMMM d, yyyy');
}

export function formatShortDate(date: string | Date): string {
  return format(parseLocal(date), 'MMM d');
}

/**
 * Numeric US date, e.g. 07-19-2026.
 *
 * For dense rows where a written-out month costs more width than it earns —
 * statement periods, ledger comparisons sitting beside amounts. Goes through
 * `parseLocal` like the others so a UTC-midnight date from the API cannot slip
 * to the previous day in a negative-offset timezone.
 */
export function formatDateNumeric(date: string | Date): string {
  return format(parseLocal(date), 'MM-dd-yyyy');
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function frequencyLabel(freq: string): string {
  const map: Record<string, string> = {
    ONE_TIME: 'One-time',
    WEEKLY: 'Weekly',
    BIWEEKLY: 'Biweekly',
    SEMI_MONTHLY: 'Semi-monthly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    BIANNUAL: 'Biannual',
    ANNUAL: 'Annual',
  };
  return map[freq] ?? freq;
}

export function computePeriodExpensesTotal(
  items: Array<{ amount: number; actualAmount: number | null }>,
): number {
  return items.reduce((sum, item) => sum + (item.actualAmount ?? item.amount), 0);
}

/**
 * Human-readable byte size. Shared by the backup list and the restore-upload
 * preview, which describe the same files and must not disagree about them.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
