import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Plus, Zap, UtilityPole, Flame, EthernetPort, Droplets } from 'lucide-react';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { buttonStyles, Tabs, VerticalTabPanel } from '@budget-tracker/ui';
import type { TabItem } from '@budget-tracker/ui';
import {
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useServices,
  useCreateService,
  useUpdateService,
  useDeleteService,
  useLinkService,
  useUnlinkService,
  useUtilities,
  useCreateUtility,
  useUpdateUtility,
  useDeleteUtility,
  useExpenses,
} from '../hooks/useApi.js';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import { pageFallback } from '../components/page-fallback.css.js';
import ProviderPanel from './utilities/ProviderPanel.js';
import ServicePanel from './utilities/ServicePanel.js';
import ReadingPanel from './utilities/ReadingPanel.js';
import SummaryCard from './utilities/SummaryCard.js';
import type { Provider, Service, Reading, Expense } from './utilities/types.js';

/**
 * The icon for a provider, from WHAT IT SUPPLIES.
 *
 * This used to match on provider NAMES — a hardcoded list of four. That worked
 * only for those four, gave every other provider a generic bolt, and disclosed
 * which utilities the author personally used. Service type is the property the
 * icon is actually about, and every provider has one.
 *
 * A provider can supply several services (power and gas from one company is
 * common), so the first match in this order wins. The order is deliberate: the
 * visually distinct types come first, so a combined provider reads as its most
 * characteristic service rather than by chance.
 */
const SERVICE_ICONS: readonly (readonly [string, ReactNode])[] = [
  ['WATER', <Droplets size={16} />],
  ['GAS', <Flame size={16} />],
  ['INTERNET', <EthernetPort size={16} />],
  ['ELECTRIC', <UtilityPole size={16} />],
];

function iconForServiceTypes(types: readonly string[] | undefined): ReactNode {
  for (const [type, icon] of SERVICE_ICONS) {
    if (types?.includes(type)) return icon;
  }
  // Everything else — garbage, sewage, cellular, or a provider with no services
  // recorded yet — gets the generic mark rather than a wrong specific one.
  return <Zap size={16} />;
}

export default function UtilitiesPage() {
  // ─── Selection state ───────────────────────────────────────────────────────
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [deleteServiceTarget, setDeleteServiceTarget] = useState<Service | null>(null);
  const [linkingService, setLinkingService] = useState<Service | null>(null);

  // ─── Data hooks ────────────────────────────────────────────────────────────
  const { data: providersData, isLoading: providersLoading } = useProviders();
  const { data: servicesData, isLoading: servicesLoading } = useServices(
    selectedProviderId ?? undefined,
  );
  const { data: readingsData, isLoading: readingsLoading } = useUtilities();
  const { data: expensesData } = useExpenses({ limit: 500 });

  // ─── Mutation hooks ────────────────────────────────────────────────────────
  const createProvider = useCreateProvider();
  const updateProvider = useUpdateProvider();
  const deleteProvider = useDeleteProvider();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();
  const linkServiceMut = useLinkService();
  const unlinkServiceMut = useUnlinkService();
  const createReading = useCreateUtility();
  const updateReading = useUpdateUtility();
  const deleteReading = useDeleteUtility();

  // ─── Derived data ──────────────────────────────────────────────────────────
  const providers = useMemo(() => (providersData ?? []) as Provider[], [providersData]);
  const services = (servicesData ?? []) as Service[];
  const allReadings = useMemo(() => (readingsData ?? []) as Reading[], [readingsData]);
  const expenses = (expensesData ?? []) as Expense[];

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);

  const providerNavItems: TabItem[] = useMemo(
    () =>
      providers.map((p) => ({
        value: p.id,
        label: p.name,
        icon: iconForServiceTypes(p.serviceTypes),
      })),
    [providers],
  );

  // Group readings by serviceId
  const readingsByService = useMemo(() => {
    const map = new Map<string, Reading[]>();
    for (const r of allReadings) {
      const list = map.get(r.serviceId) ?? [];
      list.push(r);
      map.set(r.serviceId, list);
    }
    return map;
  }, [allReadings]);

  // Auto-select first provider when data loads
  useEffect(() => {
    if (
      providers.length > 0 &&
      (!selectedProviderId || !providers.some((p) => p.id === selectedProviderId))
    ) {
      setSelectedProviderId(providers[0]!.id);
    }
  }, [providers, selectedProviderId]);

  // Reset service selection when provider changes
  function handleSelectProvider(id: string) {
    setSelectedProviderId(id);
  }

  return (
    <>
      <PageHeader
        title="Utilities"
        action={
          <button
            type="button"
            onClick={() => setShowAddProvider(true)}
            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
          >
            <Plus size={15} /> Add Provider
          </button>
        }
      />

      {providerNavItems.length > 0 ? (
        <Tabs
          tabs={providerNavItems}
          value={selectedProviderId ?? ''}
          onChange={handleSelectProvider}
          variant="vertical"
          ariaLabel="Utility providers"
        >
          {() => (
            <VerticalTabPanel
              value={selectedProviderId ?? ''}
              activeValue={selectedProviderId ?? ''}
            >
              <div style={{ maxWidth: '75rem', margin: '0 auto' }}>
                {/* Provider heading + edit/delete */}
                <ProviderPanel
                  providers={providers}
                  isLoading={providersLoading}
                  selectedProvider={selectedProvider}
                  createProvider={createProvider}
                  updateProvider={updateProvider}
                  deleteProvider={deleteProvider}
                  showAddModal={showAddProvider}
                  onShowAddModalChange={setShowAddProvider}
                  onAddService={() => setShowAddService(true)}
                />

                {/* Hidden ServicePanel — only renders modals (add service, link expense, delete service) */}
                <div style={{ display: 'none' }}>
                  <ServicePanel
                    provider={selectedProvider}
                    services={services}
                    isLoading={servicesLoading}
                    selectedServiceId={null}
                    onSelectService={() => {}}
                    expenses={expenses}
                    createService={createService}
                    deleteService={deleteService}
                    linkService={linkServiceMut}
                    unlinkService={unlinkServiceMut}
                    showAddModal={showAddService}
                    onShowAddModalChange={setShowAddService}
                    deleteTarget={deleteServiceTarget}
                    onDeleteTargetChange={setDeleteServiceTarget}
                    linkingService={linkingService}
                    onLinkingServiceChange={setLinkingService}
                  />
                </div>

                {/* All service bill cards */}
                {selectedProvider && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: vars.space['6'],
                      marginTop: vars.space['5'],
                    }}
                  >
                    {servicesLoading ? (
                      <p style={{ fontSize: vars.font.sm, color: vars.color.textTertiary }}>
                        Loading services…
                      </p>
                    ) : services.length === 0 ? (
                      <EmptyState
                        icon={<Zap size={32} />}
                        message="No services yet — add one to start tracking bills"
                        action={
                          <button
                            type="button"
                            onClick={() => setShowAddService(true)}
                            className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                          >
                            <Plus size={15} /> Add Service
                          </button>
                        }
                      />
                    ) : (
                      <>
                        {services.length >= 2 && (
                          <SummaryCard
                            providerName={selectedProvider.name}
                            readings={allReadings.filter((r) =>
                              services.some((svc) => svc.id === r.serviceId),
                            )}
                          />
                        )}
                        {services.map((svc) => (
                          <ReadingPanel
                            key={svc.id}
                            service={svc}
                            readings={readingsByService.get(svc.id) ?? []}
                            isLoading={readingsLoading}
                            expenses={expenses}
                            createReading={createReading}
                            updateReading={updateReading}
                            deleteReading={deleteReading}
                            onDeleteService={setDeleteServiceTarget}
                            onLinkService={setLinkingService}
                            onUnlinkService={(s) => unlinkServiceMut.mutate(s.id)}
                            updateService={updateService}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </VerticalTabPanel>
          )}
        </Tabs>
      ) : (
        !providersLoading && (
          // `/utilities` is a subnav route, so `Layout.tsx` gives the page no
          // padding — the Tabs pad their own panels. With no providers there
          // are no tabs, so this is the only thing on screen and had nothing
          // between it and the viewport edge.
          <div className={pageFallback}>
            <EmptyState
              icon={<Zap size={32} />}
              message="No utility providers yet — add one to get started"
              action={
                <button
                  type="button"
                  onClick={() => setShowAddProvider(true)}
                  className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
                >
                  <Plus size={15} /> Add Provider
                </button>
              }
            />
          </div>
        )
      )}
    </>
  );
}
