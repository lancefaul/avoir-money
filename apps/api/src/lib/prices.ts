/**
 * External price fetching for investment holdings.
 * - Bitcoin: CoinGecko — works with NO key; a Demo key only raises the rate limit
 * - Stocks: Finnhub — requires the user's own key, nothing is fetched without one
 *
 * With no Finnhub key the stock requests are not attempted at all and those
 * tickers are simply absent from the map. That absence is the degradation
 * contract: the web falls back to each holding's last snapshot, so a portfolio
 * total stays meaningful rather than silently dropping every stock to zero.
 *
 * `stale` means **attempted and failed**, never "not attempted". The difference
 * matters: an unattempted stock is already explained by `stocksEnabled: false`
 * and gets its own message, whereas a failed lookup is a genuine outage the
 * user has no other way to learn about. Bitcoin is included on the same terms —
 * it previously could not appear here at all, so a CoinGecko rate-limit or
 * outage silently showed a stale snapshot as though it were live.
 */

import { getServiceKey, FINNHUB, COINGECKO } from './connected-services.js';

const COINGECKO_BTC_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
const FINNHUB_QUOTE_URL = 'https://finnhub.io/api/v1/quote';

interface PriceMap {
  [tickerOrAsset: string]: number | null;
}

/**
 * Why a lookup failed. `rejected` is the only one the user can act on.
 *
 * Kept in step with `PriceFailure` in `rust/api/src/prices.rs` — this backend is
 * the differential harness's reference, so a shape it does not carry reads as a
 * port defect rather than as a missing feature here.
 */
type PriceFailureReason = 'rejected' | 'rate-limited' | 'unavailable' | 'no-quote';

export interface PriceProblem {
  service: 'finnhub' | 'coingecko';
  reason: PriceFailureReason;
  symbols: string[];
}

export interface PriceResult {
  prices: PriceMap;
  /** Tickers with no live price this call — missing key, or a failed lookup. */
  stale: string[];
  /** False when no Finnhub key is configured at all. */
  stocksEnabled: boolean;
  /** Why the stale ones are stale, grouped so the UI can say one sentence. */
  problems: PriceProblem[];
}

/**
 * A non-2xx response, classified. 403 joins 401 because CoinGecko answers a bad
 * demo key that way and to the key's owner they are the same problem.
 */
function classify(status: number): PriceFailureReason {
  if (status === 401 || status === 403) return 'rejected';
  if (status === 429) return 'rate-limited';
  return 'unavailable';
}

/**
 * A Demo key rides on the SAME base URL as the keyless call, so it is purely an
 * added header — verified against CoinGecko's docs. (A Pro key uses
 * `x-cg-pro-api-key` against pro-api.coingecko.com and is not supported here;
 * pasting one would be rejected, which now surfaces as a stale price.)
 */
type Fetched = { price: number } | { failed: PriceFailureReason };

async function fetchBitcoinPrice(apiKey: string): Promise<Fetched> {
  try {
    const res = await fetch(
      COINGECKO_BTC_URL,
      apiKey ? { headers: { 'x-cg-demo-api-key': apiKey } } : undefined,
    );
    if (!res.ok) return { failed: classify(res.status) };
    const data = (await res.json()) as { bitcoin?: { usd?: number } };
    const usd = data.bitcoin?.usd;
    return usd == null ? { failed: 'no-quote' } : { price: usd };
  } catch {
    return { failed: 'unavailable' };
  }
}

async function fetchStockPrice(ticker: string, apiKey: string): Promise<Fetched> {
  try {
    const url = `${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return { failed: classify(res.status) };
    const data = (await res.json()) as { c?: number };
    // A zero is Finnhub's answer for an unknown symbol — it does not error.
    return data.c && data.c > 0 ? { price: data.c } : { failed: 'no-quote' };
  } catch {
    return { failed: 'unavailable' };
  }
}

export async function fetchPrices(tickers: string[], hasBitcoin: boolean): Promise<PriceResult> {
  // Database first, environment as fallback — see connected-services.ts.
  const [finnhubKey, coingeckoKey] = await Promise.all([
    getServiceKey(FINNHUB).then((k) => k ?? ''),
    getServiceKey(COINGECKO).then((k) => k ?? ''),
  ]);
  const prices: PriceMap = {};
  const failures: {
    service: PriceProblem['service'];
    reason: PriceFailureReason;
    symbol: string;
  }[] = [];
  const promises: Promise<void>[] = [];

  const record = (service: PriceProblem['service'], symbol: string, got: Fetched) => {
    if ('price' in got) {
      prices[symbol] = got.price;
    } else {
      prices[symbol] = null;
      failures.push({ service, reason: got.failed, symbol });
    }
  };

  if (hasBitcoin) {
    promises.push(fetchBitcoinPrice(coingeckoKey).then((got) => record('coingecko', 'BTC', got)));
  }

  if (finnhubKey) {
    for (const ticker of tickers) {
      promises.push(
        fetchStockPrice(ticker, finnhubKey).then((got) => record('finnhub', ticker, got)),
      );
    }
  }

  await Promise.all(promises);

  // Only what was actually attempted. Listing unattempted stocks here would
  // double-report the missing-key case, which already has its own message, and
  // bury a real outage among rows that were never going to have a price.
  const stale: string[] = [];
  if (hasBitcoin && prices['BTC'] == null) stale.push('BTC');
  if (finnhubKey) stale.push(...tickers.filter((t) => prices[t] == null));

  /*
   * Grouped by (service, reason), ordered by `stale` rather than by completion.
   * These fetches run concurrently, so `failures` arrives in whatever order the
   * network answered — and an order that varies run to run is a diff the
   * differential harness would report forever.
   */
  const problems: PriceProblem[] = [];
  for (const symbol of stale) {
    const f = failures.find((x) => x.symbol === symbol);
    if (!f) continue;
    const existing = problems.find((p) => p.service === f.service && p.reason === f.reason);
    if (existing) existing.symbols.push(symbol);
    else problems.push({ service: f.service, reason: f.reason, symbols: [symbol] });
  }

  return { prices, stale, stocksEnabled: Boolean(finnhubKey), problems };
}
