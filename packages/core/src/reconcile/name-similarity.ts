/**
 * Merchant-name comparison for reconciliation.
 *
 * Bank descriptors are aliases, not spellings: a card processor prefix, a store
 * number, a truncated legal entity. Similarity here is only ever used to rank
 * or annotate — never as the sole key for a match. See `matcher.ts`.
 */

/** Lowercase, drop punctuation, store numbers, and card-processing noise words. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ') // store #, reference codes
    .replace(/\b(purchase|debit|card|pos|xxxx|payment|recurring)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dice coefficient over character bigrams — robust to truncation and suffixes,
 * which is what bank descriptors mostly do to a merchant name.
 */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.startsWith(y) || y.startsWith(x)) return 0.9;

  const bigrams = (s: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };

  const ba = bigrams(x);
  const bb = bigrams(y);
  let overlap = 0;
  for (const [g, n] of ba) overlap += Math.min(n, bb.get(g) ?? 0);
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * overlap) / total : 0;
}

/**
 * Whole days between two YYYY-MM-DD dates, always positive.
 *
 * Parses with an explicit `Z` so the arithmetic is UTC regardless of the host
 * timezone — a local-time parse shifts dates by a day either side of midnight,
 * which is exactly the class of bug that cost this project 243 pay periods.
 */
export function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86_400_000));
}
