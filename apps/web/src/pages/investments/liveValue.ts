/**
 * What a holding is worth — or `null` when that cannot be known right now.
 *
 * # Zero and unknown are different claims
 *
 * This rule used to end in `?? 0`. On 2026-08-13 CoinGecko answered **429** —
 * which it does on the free tier if you press refresh a few times — and the
 * `InvestmentSnapshot` table happened to be empty, so there was no recorded
 * figure to fall back to either. Every bitcoin holding was therefore valued at
 * nothing, and the page reported a portfolio worth only the one holding it
 * could price, against the cost basis of ALL of them — a near-total loss, in
 * confident red. (Illustrated below with invented figures.)
 *
 * The app was not displaying a stale number. It was asserting the coins were
 * worthless, because it could not reach a price server. Absence of a price and
 * a price of zero must not share a representation, or every total downstream
 * silently treats "I don't know" as a quantity.
 *
 * # Why this lives in its own file
 *
 * It was a closure inside `Investments.tsx`, which meant a test could only
 * reach it by re-implementing it — and a test that asserts against a replica of
 * the code proves the replica correct. (The same reason `mutation-observer.ts`
 * was pulled out of `App.tsx`.) It is a pure function of a holding and a price
 * table, so there is nothing to gain by keeping it inside the component.
 */

/** Only the fields the valuation actually reads. */
export interface ValuableHolding {
  type: string;
  ticker: string | null;
  quantity: number;
  // `value` is itself nullable on the wire — a snapshot can record a quantity
  // with no valuation — which is why the fallback tests `!= null` rather than
  // merely testing that a snapshot exists.
  latestSnapshot: { value: number | null } | null;
}

/** Ticker → price. A missing, null or zero entry all mean "no price". */
export type PriceTable = Record<string, number | null | undefined>;

export function liveValue(h: ValuableHolding, prices: PriceTable): number | null {
  const price = h.type === 'BITCOIN' ? prices['BTC'] : h.ticker ? prices[h.ticker] : undefined;
  if (price) return h.quantity * price;
  // No live price — the last recorded figure, if one was ever recorded.
  if (h.latestSnapshot?.value != null) return h.latestSnapshot.value;
  // Nothing held is worth nothing. That is knowledge, not the absence of it,
  // and collapsing it into `null` would be the same mistake pointing the other
  // way — an empty holding would render "—" forever.
  if (h.quantity === 0) return 0;
  return null;
}
