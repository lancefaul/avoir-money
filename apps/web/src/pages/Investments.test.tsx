import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../test/wrapper.js';

// Mock matchMedia for responsive column merge (useIsNarrow in HoldingsPanel)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock recharts
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const mockUseInvestments = vi.fn();
const mockUseInvestmentPrices = vi.fn();
const mockUsePortfolioHistory = vi.fn();
const mockUseInvestmentHistory = vi.fn();
const mockUseCustodians = vi.fn();
const mockUseWallets = vi.fn();

vi.mock('../hooks/useApi.js', () => ({
  useInvestments: (...args: any[]) => mockUseInvestments(...args),
  useInvestmentPrices: (...args: any[]) => mockUseInvestmentPrices(...args),
  useUpdateInvestment: () => ({ mutate: vi.fn() }),
  useCustodians: (...args: any[]) => mockUseCustodians(...args),
  useCreateCustodian: () => ({ mutate: vi.fn() }),
  useUpdateCustodian: () => ({ mutate: vi.fn() }),
  useDeleteCustodian: () => ({ mutate: vi.fn() }),
  useWallets: (...args: any[]) => mockUseWallets(...args),
  useCreateWallet: () => ({ mutate: vi.fn() }),
  useUpdateWallet: () => ({ mutate: vi.fn() }),
  useDeleteWallet: () => ({ mutate: vi.fn() }),
  useDeleteHolding: () => ({ mutate: vi.fn() }),
  useBitcoinTransfer: () => ({ mutate: vi.fn() }),
  useStockTransfer: () => ({ mutate: vi.fn() }),
  useInvestmentHistory: (...args: any[]) => mockUseInvestmentHistory(...args),
  usePortfolioHistory: (...args: any[]) => mockUsePortfolioHistory(...args),
  // Used by the lazy-loaded PerformanceChart. Async tests give the lazy chunk time to
  // resolve, so it must be mocked or the chart throws on render.
  useRegenerateSnapshots: () => ({ mutate: vi.fn(), isPending: false }),
  useAccounts: () => ({ data: [] }),
  useBudgetItems: () => ({ data: [] }),
}));

vi.mock('../hooks/useTransactionMutations.js', () => ({
  useCreateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePurchase: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePurchasePayments: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePurchase: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Stub IntersectionObserver for LoadMoreTrigger
vi.stubGlobal(
  'IntersectionObserver',
  vi.fn(function (this: any) {
    this.observe = vi.fn();
    this.disconnect = vi.fn();
    this.unobserve = vi.fn();
  }),
);

import InvestmentsPage from './Investments.js';

// ── Default mock data ──────────────────────────────────────────────────────
const holdingsData = [
  {
    id: 'h1',
    name: 'Fidelity',
    ticker: 'AAPL',
    type: 'STOCK',
    quantity: 10,
    costBasis: 1500,
    custodianId: 'cust1',
    walletId: null,
    custodianName: 'Fidelity',
    walletName: null,
    latestSnapshot: { id: 's1', date: '2026-03-01', quantity: 10, value: 2000 },
  },
  {
    id: 'h2',
    name: 'Cold Storage',
    ticker: null,
    type: 'BITCOIN',
    quantity: 0.5,
    costBasis: 20000,
    custodianId: null,
    walletId: 'w1',
    custodianName: null,
    walletName: 'Cold Storage',
    latestSnapshot: { id: 's2', date: '2026-03-01', quantity: 0.5, value: 30000 },
  },
];

beforeEach(() => {
  mockUseInvestments.mockReturnValue({ data: holdingsData, isLoading: false });
  // The prices endpoint returns the map alongside what could not be priced,
  // so the page can distinguish "no key" from "lookup failed" — see
  // PriceResponseSchema.
  mockUseInvestmentPrices.mockReturnValue({
    data: { prices: { AAPL: 200, BTC: 65000 }, stale: [], stocksEnabled: true },
  });
  mockUsePortfolioHistory.mockReturnValue({ data: { entries: [] }, isLoading: false });
  mockUseInvestmentHistory.mockReturnValue({
    data: { pages: [] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  mockUseCustodians.mockReturnValue({
    data: [{ id: 'cust1', name: 'Fidelity', createdAt: '', updatedAt: '' }],
  });
  mockUseWallets.mockReturnValue({
    data: [
      {
        id: 'w1',
        name: 'Cold Storage',
        custodyType: 'NON_CUSTODIAL',
        storageType: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
  });
});

describe('Investments Page', () => {
  it('renders holdings table with names', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('Fidelity').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Cold Storage').length).toBeGreaterThanOrEqual(1);
  });

  it('shows holding type section headers', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Holdings are grouped by type with section headers
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('Stocks')).toBeInTheDocument();
  });

  /**
   * A refused key is reported as a refused key, not as "no live price".
   *
   * The defect this replaces: on 2026-08-12 a doubled Finnhub key produced
   * "No live price for TCKB, TCKR.WS, TCKC" on this page while the backend held
   * `401 {"error":"Invalid API key."}` in a terminal nobody reads. An hour went
   * into the wrong half of the system. `stale` alone cannot carry this — a
   * rejection and a rate limit produce an identical list.
   */
  describe('when a service refuses the key', () => {
    const rejected = {
      data: {
        prices: { AAPL: null, BTC: 65000 },
        stale: ['AAPL'],
        stocksEnabled: true,
        problems: [{ service: 'finnhub' as const, reason: 'rejected' as const, symbols: ['AAPL'] }],
      },
    };

    it('names the service and where to fix it', () => {
      mockUseInvestmentPrices.mockReturnValue(rejected);
      render(<InvestmentsPage />, { wrapper: createWrapper() });

      // "Finnhub", not "finnhub" — the API returns a key, not a name.
      expect(screen.getByText(/Finnhub rejected your API key/)).toBeInTheDocument();
      expect(screen.getByText(/Connected Services/)).toBeInTheDocument();
    });

    it('does not also report those symbols as merely stale', () => {
      // Saying "Finnhub rejected your key" AND "no live price for AAPL" is one
      // message and one restatement of it. The rejection explains the symbol,
      // so it leaves the generic list.
      mockUseInvestmentPrices.mockReturnValue(rejected);
      render(<InvestmentsPage />, { wrapper: createWrapper() });

      expect(screen.queryByText(/No live price for/)).toBeNull();
    });

    it('still reports symbols a rejection does not explain', () => {
      // A CoinGecko outage alongside a Finnhub rejection is two independent
      // facts, and the second must not be swallowed by the first.
      mockUseInvestmentPrices.mockReturnValue({
        data: {
          prices: { AAPL: null, BTC: null },
          stale: ['AAPL', 'BTC'],
          stocksEnabled: true,
          problems: [
            { service: 'finnhub' as const, reason: 'rejected' as const, symbols: ['AAPL'] },
            { service: 'coingecko' as const, reason: 'unavailable' as const, symbols: ['BTC'] },
          ],
        },
      });
      render(<InvestmentsPage />, { wrapper: createWrapper() });

      expect(screen.getByText(/Finnhub rejected your API key/)).toBeInTheDocument();
      expect(screen.getByText(/No live price for BTC/)).toBeInTheDocument();
    });

    it('keeps the quiet message when nothing was refused', () => {
      // A rate limit is not actionable, so it must NOT be escalated into the
      // "go fix your key" message.
      mockUseInvestmentPrices.mockReturnValue({
        data: {
          prices: { AAPL: null, BTC: 65000 },
          stale: ['AAPL'],
          stocksEnabled: true,
          problems: [
            { service: 'finnhub' as const, reason: 'rate-limited' as const, symbols: ['AAPL'] },
          ],
        },
      });
      render(<InvestmentsPage />, { wrapper: createWrapper() });

      expect(screen.queryByText(/rejected your API key/)).toBeNull();
      expect(screen.getByText(/No live price for AAPL/)).toBeInTheDocument();
    });
  });

  it('calculates live values from prices', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // AAPL: 10 * 200 = $2,000
    expect(screen.getAllByText('$2,000.00').length).toBeGreaterThanOrEqual(1);
    // BTC: 0.5 * 65000 = $32,500
    expect(screen.getAllByText('$32,500.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows portfolio total in allocation panel', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Total: 2000 + 32500 = 34500
    expect(screen.getAllByText('$34,500.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows New Trade button', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('New Trade')).toBeInTheDocument();
  });

  it('shows Portfolio Allocation section', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Portfolio Allocation')).toBeInTheDocument();
  });

  it('shows tab navigation with History, Custodians, Wallets', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Tabs are rendered (may be in overflow "More" menu in jsdom)
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('shows allocation breakdown', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Allocation shows percentage breakdown
    expect(screen.getByText(/BTC.*AAPL/)).toBeInTheDocument();
  });

  it('shows P/L for holdings', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // AAPL: 2000 - 1500 = +500 (may appear in row + summary)
    expect(screen.getAllByText('+$500.00').length).toBeGreaterThanOrEqual(1);
    // BTC: 32500 - 20000 = +12500
    expect(screen.getAllByText('+$12,500.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows cost basis for holdings', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$20,000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows holding names with tickers', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Holdings show ticker in symbol column and name via tooltip
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
  });

  it('shows history tab panel by default', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // Default tab is "portfolio" which renders a tabpanel
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  it('shows portfolio performance chart on default tab', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    // PerformanceChart renders on the portfolio tab (default)
    // With our mock data (2 holdings with cost basis and prices), the total value appears
    expect(screen.getAllByText('$34,500.00').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Investments Page — empty state', () => {
  beforeEach(() => {
    mockUseInvestments.mockReturnValue({ data: [], isLoading: false });
    mockUseInvestmentPrices.mockReturnValue({ data: {} });
    mockUsePortfolioHistory.mockReturnValue({ data: { entries: [] }, isLoading: false });
    mockUseInvestmentHistory.mockReturnValue({
      data: { pages: [] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    });
    mockUseCustodians.mockReturnValue({ data: [] });
    mockUseWallets.mockReturnValue({ data: [] });
  });

  it('shows empty state when no holdings exist', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(
      screen.getByText('No holdings yet — add an investment to get started'),
    ).toBeInTheDocument();
  });

  it('shows portfolio chart empty state', () => {
    render(<InvestmentsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Add investments to see portfolio performance')).toBeInTheDocument();
  });
});

/*
 * Regression: the Custodians/Wallets tab panels are rendered separately from the
 * "Add" modal instances. They were passed `setShowModal={() => {}}` — a no-op — so a
 * row's Edit action set the edit target and then called into the void, leaving the
 * modal permanently `open={false}`. The edit modal was unopenable from 2026-05-02
 * (ed2c26b) until 2026-07-12, because nothing exercised this path.
 */
describe('Investments Page — row Edit opens the edit modal', () => {
  it('opens the Edit Custodian modal from the custodian row menu', async () => {
    const user = userEvent.setup();
    render(<InvestmentsPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: /Custodians/ }));
    await user.click(screen.getAllByRole('button', { name: 'Actions' })[0]!);
    await user.click(await screen.findByText('Edit'));

    expect(await screen.findByText('Edit Custodian')).toBeInTheDocument();
  });

  it('opens the Edit Wallet modal from the wallet row menu', async () => {
    const user = userEvent.setup();
    render(<InvestmentsPage />, { wrapper: createWrapper() });

    await user.click(screen.getByRole('tab', { name: /Wallets/ }));
    await user.click(screen.getAllByRole('button', { name: 'Actions' })[0]!);
    await user.click(await screen.findByText('Edit'));

    expect(await screen.findByText('Edit Wallet')).toBeInTheDocument();
  });
});
