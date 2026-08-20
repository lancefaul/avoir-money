/**
 * Unit tests for prices.ts — external price fetching.
 *
 * Uses vi.stubGlobal to intercept fetch calls since these functions
 * hit external APIs (CoinGecko, Finnhub) that can't be called in tests.
 *
 * The Finnhub key now comes from the database with the environment as
 * fallback, so stubbing FINNHUB_API_KEY still configures these tests — and the
 * fact that it does is itself the fallback working, since no ConnectedService
 * row exists in the test database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPrices } from '../prices.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubEnv('FINNHUB_API_KEY', 'test-key');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

/**
 * Adapt a (url, init) handler to fetch's real signature.
 *
 * Written as a wrapper rather than a double cast: `as unknown as typeof fetch`
 * would silence the mismatch instead of resolving it, and the repo bans that
 * for exactly this reason — the mock would then be free to drift from the
 * shape it is standing in for.
 */
function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchPrices', () => {
  it('returns BTC price when hasBitcoin is true', async () => {
    mockFetch(async (url) => {
      if (url.includes('coingecko')) {
        return new Response(JSON.stringify({ bitcoin: { usd: 65000 } }));
      }
      return new Response('{}');
    });

    const { prices } = await fetchPrices([], true);
    expect(prices['BTC']).toBe(65000);
  });

  it('does not fetch BTC price when hasBitcoin is false', async () => {
    let btcCalled = false;
    mockFetch(async (url) => {
      if (url.includes('coingecko')) btcCalled = true;
      return new Response('{}');
    });

    await fetchPrices([], false);
    expect(btcCalled).toBe(false);
  });

  it('returns stock prices for given tickers', async () => {
    mockFetch(async (url) => {
      if (url.includes('AAPL')) return new Response(JSON.stringify({ c: 185.5 }));
      if (url.includes('MSFT')) return new Response(JSON.stringify({ c: 420.0 }));
      return new Response('{}');
    });

    const { prices } = await fetchPrices(['AAPL', 'MSFT'], false);
    expect(prices['AAPL']).toBe(185.5);
    expect(prices['MSFT']).toBe(420.0);
  });

  it('returns null for BTC when API returns non-ok', async () => {
    mockFetch(async (url) => {
      if (url.includes('coingecko')) {
        return new Response('error', { status: 500 });
      }
      return new Response('{}');
    });

    const { prices } = await fetchPrices([], true);
    expect(prices['BTC']).toBeNull();
  });

  it('returns null for BTC when fetch throws', async () => {
    mockFetch(async (url) => {
      if (url.includes('coingecko')) throw new Error('Network error');
      return new Response('{}');
    });

    const { prices } = await fetchPrices([], true);
    expect(prices['BTC']).toBeNull();
  });

  it('returns null for stock when API returns non-ok', async () => {
    mockFetch(async () => new Response('error', { status: 500 }));

    const { prices } = await fetchPrices(['AAPL'], false);
    expect(prices['AAPL']).toBeNull();
  });

  it('returns null for stock when price is 0', async () => {
    mockFetch(async () => new Response(JSON.stringify({ c: 0 })));

    const { prices } = await fetchPrices(['AAPL'], false);
    expect(prices['AAPL']).toBeNull();
  });

  it('skips stock fetches when FINNHUB_API_KEY is empty', async () => {
    vi.stubEnv('FINNHUB_API_KEY', '');
    let fetchCalled = false;
    mockFetch(async () => {
      fetchCalled = true;
      return new Response('{}');
    });

    const { prices } = await fetchPrices(['AAPL'], false);
    expect(fetchCalled).toBe(false);
    expect(prices['AAPL']).toBeUndefined();
  });

  describe('stale reporting', () => {
    it('reports BTC as stale when CoinGecko fails', async () => {
      // Previously impossible: BTC could not appear in `stale` at all, so a
      // rate-limit or outage showed a snapshot as though it were live.
      mockFetch(async () => new Response('error', { status: 429 }));

      const { stale } = await fetchPrices([], true);
      expect(stale).toContain('BTC');
    });

    it('does not report BTC when it priced successfully', async () => {
      mockFetch(async (url) =>
        url.includes('coingecko')
          ? new Response(JSON.stringify({ bitcoin: { usd: 65000 } }))
          : new Response('{}'),
      );

      const { stale } = await fetchPrices([], true);
      expect(stale).not.toContain('BTC');
    });

    it('does not report stocks that were never attempted', async () => {
      // With no key the request is not made, and `stocksEnabled: false` already
      // says so. Listing them here would bury a real outage among rows that
      // were never going to have a price.
      vi.stubEnv('FINNHUB_API_KEY', '');
      mockFetch(async () => new Response('{}'));

      const { stale, stocksEnabled } = await fetchPrices(['AAPL', 'MSFT'], false);

      expect(stocksEnabled).toBe(false);
      expect(stale).toEqual([]);
    });

    it('reports a stock that was attempted and failed', async () => {
      mockFetch(async () => new Response('error', { status: 500 }));

      const { stale } = await fetchPrices(['AAPL'], false);
      expect(stale).toContain('AAPL');
    });
  });

  describe('CoinGecko key', () => {
    it('sends no auth header when no key is configured', async () => {
      // Bitcoin must keep working with nothing configured — that is the whole
      // reason CoinGecko is optional.
      let sawHeaders: unknown = 'never called';
      mockFetch(async (url, init) => {
        if (url.includes('coingecko')) sawHeaders = init?.headers;
        return new Response(JSON.stringify({ bitcoin: { usd: 65000 } }));
      });

      const { prices } = await fetchPrices([], true);

      expect(prices['BTC']).toBe(65000);
      expect(sawHeaders).toBeUndefined();
    });

    it('sends the demo header when a key is configured', async () => {
      vi.stubEnv('COINGECKO_API_KEY', 'CG-demo-key-123');
      let sawHeaders: Record<string, string> | undefined;
      mockFetch(async (url, init) => {
        if (url.includes('coingecko')) sawHeaders = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ bitcoin: { usd: 65000 } }));
      });

      await fetchPrices([], true);

      // Header name verified against CoinGecko's docs; a Demo key rides the
      // same base URL, so this is the entire difference.
      expect(sawHeaders?.['x-cg-demo-api-key']).toBe('CG-demo-key-123');
    });
  });

  it('fetches both BTC and stocks in parallel', async () => {
    mockFetch(async (url) => {
      if (url.includes('coingecko')) {
        return new Response(JSON.stringify({ bitcoin: { usd: 70000 } }));
      }
      if (url.includes('TSLA')) {
        return new Response(JSON.stringify({ c: 250.0 }));
      }
      return new Response('{}');
    });

    const { prices } = await fetchPrices(['TSLA'], true);
    expect(prices['BTC']).toBe(70000);
    expect(prices['TSLA']).toBe(250.0);
  });
});
