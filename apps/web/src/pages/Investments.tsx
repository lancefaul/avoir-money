import { lazy, Suspense, useState, type CSSProperties } from 'react';
import {
  Plus,
  LineChart,
  History,
  Building2,
  Wallet,
  TrendingUp,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  buttonStyles,
  BadgeCount,
  Tabs,
  VerticalTabPanel,
  DisplayHeading,
  Toast,
} from '@budget-tracker/ui';
import type { TabItem } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { api } from '../lib/api.js';
import {
  useInvestments,
  useUpdateInvestment,
  useInvestmentPrices,
  useCustodians,
  useCreateCustodian,
  useUpdateCustodian,
  useDeleteCustodian,
  useWallets,
  useCreateWallet,
  useUpdateWallet,
  useDeleteWallet,
  useDeleteHolding,
  useBitcoinTransfer,
  useStockTransfer,
} from '../hooks/useApi.js';
import {
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useCreatePurchase,
  useUpdatePurchasePayments,
} from '../hooks/useTransactionMutations.js';
import { useTransactionForm } from './transactions/useTransactionForm.js';
import TransactionForm from './transactions/TransactionForm.js';
import type { Account, Category, StockHolding } from './transactions/types.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import { formatCount } from '../lib/utils.js';
import { useIsNarrow } from '../hooks/useIsNarrow.js';
import InvestmentHistoryPanel from '../components/InvestmentHistoryPanel.js';
import HoldingsPanel from './investments/HoldingsPanel.js';
import { liveValue } from './investments/liveValue.js';
const PerformanceChart = lazy(() => import('./investments/PerformanceChart.js'));
import CustodianPanel from './investments/CustodianPanel.js';
import WalletPanel from './investments/WalletPanel.js';
import { below } from '@budget-tracker/ui/theme/breakpoints.js';

/**
 * How each service is written on screen.
 *
 * The API returns its own lowercase identifiers, which are keys rather than
 * names — a message reading "finnhub rejected your API key" looks like a bug in
 * the message. `Record` over the union rather than a lookup with a fallback, so
 * adding a service to the schema fails to compile until it has a label.
 */
const SERVICE_LABELS: Record<'finnhub' | 'coingecko', string> = {
  finnhub: 'Finnhub',
  coingecko: 'CoinGecko',
};

/**
 * Below this width the "Add Custodian" / "Add Wallet" actions leave the page header
 * and sit beside their own tab's title instead — the same title+action arrangement
 * the Utilities page uses. "New Trade" stays in the header at every width.
 */
const TAB_LEVEL_ADD_BUTTONS_BREAKPOINT = below.lg;

/**
 * Title + action row on the Custodians / Wallets tabs. Carries the bottom margin the
 * DisplayHeading used to own, so spacing is unchanged when no button is present.
 */
const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: vars.space['4'],
  marginBottom: vars.space['5'],
};

const INVESTMENT_TABS: TabItem[] = [
  { value: 'portfolio', label: 'Portfolio', icon: <TrendingUp size={16} /> },
  { value: 'history', label: 'History', icon: <History size={16} /> },
  { value: 'custodians', label: 'Custodians', icon: <Building2 size={16} /> },
  { value: 'wallets', label: 'Wallets', icon: <Wallet size={16} /> },
];

interface Snapshot {
  id: string;
  date: string;
  quantity: number;
  value: number | null;
}
interface Holding {
  id: string;
  name: string;
  ticker: string | null;
  type: string;
  quantity: number;
  costBasis: number | null;
  custodianId: string | null;
  walletId: string | null;
  custodianName: string | null;
  walletName: string | null;
  latestSnapshot: Snapshot | null;
}
interface NamedEntityLocal {
  id: string;
  name: string;
  managementUrl: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}
interface WalletEntity extends NamedEntityLocal {
  custodyType: 'CUSTODIAL' | 'NON_CUSTODIAL';
  storageType: 'HOT' | 'COLD' | null;
}

export default function InvestmentsPage() {
  const { data, isLoading } = useInvestments();
  const { data: pricesData } = useInvestmentPrices();
  const updateInvestment = useUpdateInvestment();
  const deleteHoldingMut = useDeleteHolding();

  const { data: custodiansData } = useCustodians();
  const createCustodian = useCreateCustodian();
  const updateCustodian = useUpdateCustodian();
  const deleteCustodian = useDeleteCustodian();

  const { data: walletsData } = useWallets();
  const createWallet = useCreateWallet();
  const updateWallet = useUpdateWallet();
  const deleteWallet = useDeleteWallet();

  // Data needed for TransactionForm
  const { data: acctData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list() as Promise<Account[]>,
  });
  const { data: catData } = useQuery({
    queryKey: ['budgetItems'],
    queryFn: () => api.budgetItems.list() as Promise<Category[]>,
  });

  const createTx = useCreateTransaction();
  const updateTx = useUpdateTransaction();
  const deleteTx = useDeleteTransaction();
  const createPurchase = useCreatePurchase();
  const updatePurchasePayments = useUpdatePurchasePayments();
  const bitcoinTransferMutation = useBitcoinTransfer();
  const stockTransferMutation = useStockTransfer();

  const holdings = (data ?? []) as Holding[];
  const prices = pricesData?.prices ?? {};
  /*
   * Tickers with no live figure this fetch — no key configured, or the lookup
   * failed. Their value still comes from the holding's last snapshot, so the
   * portfolio total stays meaningful; this only lets the row say the price is
   * not live rather than implying it is.
   */
  /*
   * A refused key is separated from every other reason a price is missing,
   * because it is the only one the reader can do something about. The rest —
   * a rate limit, an outage, a delisted ticker — resolve on their own and want
   * the quieter message.
   *
   * Symbols covered by a rejection are removed from the generic list rather
   * than appearing in both: saying "Finnhub rejected your key" AND "no live
   * price for TCKB, TCKR.WS, TCKC" is one message and one restatement of it.
   */
  const priceProblems = pricesData?.problems ?? [];
  const rejections = priceProblems.filter((p) => p.reason === 'rejected');
  // 429. Worth saying, because the natural response — press refresh — is exactly
  // what keeps it rate-limited.
  const rateLimited = priceProblems.some((p) => p.reason === 'rate-limited');
  const explained = new Set(rejections.flatMap((p) => p.symbols));
  const stalePrices = new Set((pricesData?.stale ?? []).filter((s) => !explained.has(s)));
  const stocksEnabled = pricesData?.stocksEnabled ?? false;
  const custodians = (custodiansData ?? []) as NamedEntityLocal[];
  const wallets = (walletsData ?? []) as WalletEntity[];
  const accounts = (acctData ?? []) as Account[];
  const categories = (catData ?? []) as Category[];
  const stockHoldings: StockHolding[] = holdings.filter((h) => h.type === 'STOCK');

  const form = useTransactionForm({
    accounts,
    categories,
    stockHoldings,
    pricesData: prices,
    createTx,
    updateTx,
    deleteTx,
    createPurchase,
    updatePurchasePayments,
    bitcoinTransferMutation,
    stockTransferMutation,
  });

  const isPending =
    bitcoinTransferMutation.isPending ||
    stockTransferMutation.isPending ||
    createTx.isPending ||
    updateTx.isPending;

  const [activeTab, setActiveTab] = useState('portfolio');
  // "Add" modals, owned by the modalOnly panel instances below so the header/tab-title
  // buttons can open them from anywhere.
  const [showCustodianModal, setShowCustodianModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);

  // "Edit" modals, owned by the in-tab panel instances that render the lists. These
  // must be real state: the panels call setShowModal(true) from their row Edit action,
  // and passing a no-op here silently made the edit modal unopenable.
  const [showCustodianEdit, setShowCustodianEdit] = useState(false);
  const [showWalletEdit, setShowWalletEdit] = useState(false);

  const tabLevelAddButtons = useIsNarrow(TAB_LEVEL_ADD_BUTTONS_BREAKPOINT);

  // Wrapper functions that navigate to the appropriate tab after successful creation
  const handleCustodianSuccess = () => {
    setShowCustodianModal(false);
    setActiveTab('custodians');
  };

  const handleWalletSuccess = () => {
    setShowWalletModal(false);
    setActiveTab('wallets');
  };

  // Wrap the mutations to add navigation on success
  // Using explicit MutateOnly shape to avoid TypeScript union type issues with spread
  const createCustodianWithNav: {
    mutate: (
      data: unknown,
      options?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  } = {
    isPending: createCustodian.isPending,
    mutate: (
      data: unknown,
      options?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => {
      createCustodian.mutate(data, {
        onSuccess: () => {
          options?.onSuccess?.();
          handleCustodianSuccess();
        },
        onError: options?.onError,
      });
    },
  };

  const createWalletWithNav: {
    mutate: (
      data: unknown,
      options?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  } = {
    isPending: createWallet.isPending,
    mutate: (
      data: unknown,
      options?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => {
      createWallet.mutate(data, {
        onSuccess: () => {
          options?.onSuccess?.();
          handleWalletSuccess();
        },
        onError: options?.onError,
      });
    },
  };

  // The rule itself lives in `investments/liveValue.ts` — pure, and testable
  // without re-implementing it. Bound to this render's price table here.
  const valueOf = (h: Holding) => liveValue(h, prices);

  const valued = holdings.filter((h) => valueOf(h) !== null);
  const unvalued = holdings.filter((h) => valueOf(h) === null);
  const totalValue = valued.reduce((s, h) => s + (valueOf(h) ?? 0), 0);
  /*
   * Cost basis of the holdings we could value, NOT of all of them. Comparing a
   * partial value against a complete cost basis is what turns "two coins have
   * no price today" into "you have lost almost everything".
   */
  const totalCostBasis = valued.reduce((s, h) => s + (h.costBasis ?? 0), 0);

  // Subtotals sum what is known. An unvalued holding contributes nothing to the
  // figure AND is reported separately, rather than being silently counted as
  // zero — which would understate the group without saying so.
  function custodianValue(custodianId: string): number {
    return holdings
      .filter((h) => h.custodianId === custodianId)
      .reduce((sum, h) => sum + (valueOf(h) ?? 0), 0);
  }

  function walletValue(walletId: string): number {
    return holdings
      .filter((h) => h.walletId === walletId)
      .reduce((sum, h) => sum + (valueOf(h) ?? 0), 0);
  }

  return (
    <>
      <PageHeader
        title={
          <>
            Investments <BadgeCount>{formatCount(holdings.length)}</BadgeCount>
          </>
        }
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['2'] }}>
            {/* Below 800px these two move beside their own tab's title. */}
            {!tabLevelAddButtons && (
              <>
                <button
                  type="button"
                  onClick={() => setShowCustodianModal(true)}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                >
                  <Plus size={15} /> Add Custodian
                </button>
                <button
                  type="button"
                  onClick={() => setShowWalletModal(true)}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                >
                  <Plus size={15} /> Add Wallet
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => form.openCreate('TRADE')}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={15} /> New Trade
            </button>
          </div>
        }
      />

      {isLoading ? (
        <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>Loading…</p>
      ) : (
        <Tabs
          tabs={INVESTMENT_TABS}
          value={activeTab}
          onChange={setActiveTab}
          variant="vertical"
          ariaLabel="Investments"
        >
          {() => (
            <VerticalTabPanel value={activeTab} activeValue={activeTab}>
              <div style={{ maxWidth: '75rem', margin: '0 auto' }}>
                {/*
                  Shown only once a stock holding exists — the moment a key
                  first buys anything, never at onboarding when it would be a
                  demand before there is a reason for it. Bitcoin is
                  unaffected: CoinGecko is free and keyless, so someone holding
                  only BTC never sees this.
                */}
                {!stocksEnabled && holdings.some((h) => h.type === 'STOCK') && (
                  <div style={{ marginBottom: vars.space['4'] }}>
                    <Toast
                      id="finnhub-key-missing"
                      severity="info"
                      variant="filled"
                      flat
                      fullWidth
                      autoDismiss={false}
                      // No dismiss: the condition decides when this goes away, not
                      // the reader — it disappears the moment a key is saved.
                      customActions={<></>}
                      onDismiss={() => {}}
                      title={
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: vars.space['1'],
                          }}
                        >
                          Stock values are showing their last recorded figures. Add a free Finnhub
                          key in Settings
                          <ChevronRight size={13} aria-hidden />
                          Connected Services for live prices.
                        </span>
                      }
                    />
                  </div>
                )}

                {/*
                  A refused key, said plainly and with somewhere to go.

                  This is the message that did not exist on 2026-08-12, when a
                  doubled API key produced "No live price for TCKB, TCKR.WS,
                  TCKC" on this page while the backend held
                  `401 {"error":"Invalid API key."}` in a terminal nobody reads.
                  An hour went into the wrong half of the system. `error`
                  rather than `warning` because nothing improves until someone
                  acts.
                */}
                {rejections.map((p) => (
                  <div key={p.service} style={{ marginBottom: vars.space['4'] }}>
                    <Toast
                      id={`price-key-rejected-${p.service}`}
                      severity="error"
                      variant="filled"
                      flat
                      fullWidth
                      autoDismiss={false}
                      customActions={<></>}
                      onDismiss={() => {}}
                      title={
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: vars.space['1'],
                          }}
                        >
                          {SERVICE_LABELS[p.service]} rejected your API key — showing the last
                          recorded figures. Update it in Settings
                          <ChevronRight size={13} aria-hidden />
                          Connected Services.
                        </span>
                      }
                      description={`Affected: ${p.symbols.join(', ')}`}
                    />
                  </div>
                ))}

                {/*
                  Any attempted-and-failed lookup, Bitcoin included. Previously
                  gated on `stocksEnabled`, which meant a CoinGecko outage was
                  invisible whenever no Finnhub key was configured — the two
                  have nothing to do with each other.
                */}
                {stalePrices.size > 0 && (
                  <div style={{ marginBottom: vars.space['4'] }}>
                    <Toast
                      id="stale-prices"
                      /*
                       * `error` when nothing could be valued at all, `warning`
                       * when a recorded figure is standing in. The old message
                       * always claimed "showing the last recorded figure" — and
                       * on 2026-08-13 there were no recorded figures at all, so
                       * the holdings fell back to ZERO and the page reported a
                       * near-total loss while promising the opposite. A message that
                       * describes a fallback which did not happen is worse than
                       * no message.
                       */
                      severity={unvalued.length > 0 ? 'error' : 'warning'}
                      variant="filled"
                      flat
                      fullWidth
                      autoDismiss={false}
                      customActions={<></>}
                      onDismiss={() => {}}
                      title={
                        unvalued.length > 0
                          ? `No price for ${unvalued.map((h) => (h.type === 'BITCOIN' ? 'BTC' : (h.ticker ?? h.name))).join(', ')} and nothing recorded previously — ${unvalued.length === 1 ? 'it is' : 'they are'} left out of the totals below rather than counted as zero.`
                          : `No live price for ${[...stalePrices].join(', ')} — showing the last recorded figure.`
                      }
                      description={
                        rateLimited
                          ? 'The price service is rate-limiting requests. It usually clears within a minute — refreshing again makes it worse.'
                          : undefined
                      }
                    />
                  </div>
                )}

                {activeTab === 'portfolio' && (
                  <>
                    <DisplayHeading size="lg" as="h3" style={{ marginBottom: vars.space['5'] }}>
                      Portfolio
                    </DisplayHeading>
                    {holdings.length === 0 ? (
                      <div style={{ marginBottom: vars.space['6'] }}>
                        <EmptyState
                          icon={<LineChart size={32} />}
                          message="Add investments to see portfolio performance"
                        />
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>
                            Loading chart…
                          </p>
                        }
                      >
                        <PerformanceChart
                          currentValue={totalValue}
                          totalCostBasis={totalCostBasis}
                          holdings={holdings}
                        />
                      </Suspense>
                    )}
                    <HoldingsPanel
                      holdings={holdings}
                      liveValue={valueOf}
                      totalValue={totalValue}
                      updateInvestment={updateInvestment}
                      deleteHolding={deleteHoldingMut}
                    />
                  </>
                )}
                {activeTab === 'history' && (
                  <>
                    <DisplayHeading size="lg" as="h3" style={{ marginBottom: vars.space['5'] }}>
                      History
                    </DisplayHeading>
                    <InvestmentHistoryPanel />
                  </>
                )}
                {activeTab === 'custodians' && (
                  <>
                    <div style={titleRowStyle}>
                      <DisplayHeading size="lg" as="h3">
                        Custodians
                      </DisplayHeading>
                      {tabLevelAddButtons && (
                        <button
                          type="button"
                          onClick={() => setShowCustodianModal(true)}
                          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                        >
                          <Plus size={15} /> Add Custodian
                        </button>
                      )}
                    </div>
                    <CustodianPanel
                      custodians={custodians}
                      custodianValue={custodianValue}
                      createCustodian={createCustodian}
                      updateCustodian={updateCustodian}
                      deleteCustodian={deleteCustodian}
                      showModal={showCustodianEdit}
                      setShowModal={setShowCustodianEdit}
                    />
                  </>
                )}
                {activeTab === 'wallets' && (
                  <>
                    <div style={titleRowStyle}>
                      <DisplayHeading size="lg" as="h3">
                        Wallets
                      </DisplayHeading>
                      {tabLevelAddButtons && (
                        <button
                          type="button"
                          onClick={() => setShowWalletModal(true)}
                          className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnSecondary}`}
                        >
                          <Plus size={15} /> Add Wallet
                        </button>
                      )}
                    </div>
                    <WalletPanel
                      wallets={wallets}
                      walletValue={walletValue}
                      createWallet={createWallet}
                      updateWallet={updateWallet}
                      deleteWallet={deleteWallet}
                      showModal={showWalletEdit}
                      setShowModal={setShowWalletEdit}
                    />
                  </>
                )}
              </div>
            </VerticalTabPanel>
          )}
        </Tabs>
      )}

      {/* Modals rendered outside tabs so they work from any tab */}
      <CustodianPanel
        custodians={custodians}
        custodianValue={custodianValue}
        createCustodian={createCustodianWithNav}
        updateCustodian={updateCustodian}
        deleteCustodian={deleteCustodian}
        showModal={showCustodianModal}
        setShowModal={setShowCustodianModal}
        modalOnly
      />
      <WalletPanel
        wallets={wallets}
        walletValue={walletValue}
        createWallet={createWalletWithNav}
        updateWallet={updateWallet}
        deleteWallet={deleteWallet}
        showModal={showWalletModal}
        setShowModal={setShowWalletModal}
        modalOnly
      />

      <TransactionForm
        form={form}
        accounts={accounts}
        categories={categories}
        incomes={[]}
        wallets={wallets}
        custodians={custodians}
        stockHoldings={stockHoldings}
        isPending={isPending}
        nameSuggestions={[]}
        hideTypeSelector
        title="New Trade"
      />
    </>
  );
}
