/** Group an array of objects by the value at a given key. */
export function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    const bucket = map.get(key) ?? [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

/** Sum a numeric field across an array. */
export function sumBy<T>(items: T[], getValue: (item: T) => number): number {
  return items.reduce((acc, item) => acc + getValue(item), 0);
}

/** Group items by a key and sum a value within each group. */
export function groupAndSum<T>(
  items: T[],
  getKey: (item: T) => string,
  getValue: (item: T) => number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, (map.get(key) ?? 0) + getValue(item));
  }
  return map;
}

/**
 * Convert a Map<string, number> to an array of { key, total } sorted descending by total.
 * Useful for category breakdown and YTD summaries.
 */
export function sortedTotals(map: Map<string, number>): Array<{ key: string; total: number }> {
  return [...map.entries()]
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total);
}

/** Calculate what percentage `part` is of `whole`. Returns 0 if whole is 0. */
export function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal place
}
