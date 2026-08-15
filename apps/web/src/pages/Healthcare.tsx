import { useState, useMemo } from 'react';
import { Plus, ShieldPlus, Cross, Glasses, Stethoscope, ListFilter } from 'lucide-react';
import type { InsurancePolicyWithBalance } from '@budget-tracker/core';
import PageHeader from '../components/PageHeader.js';
import EmptyState from '../components/EmptyState.js';
import PolicyFormModal from './healthcare/PolicyFormModal.js';
import ActivePolicySection, { getInsurerName } from './healthcare/ActivePolicySection.js';
import {
  usePolicyYears,
  usePolicies,
  useCreatePolicy,
  useUpdatePolicy,
  useUpdateOverrides,
  useHealthcareSummary,
  useEndCoverage,
  useClosePolicy,
} from '../hooks/useHealthcare.js';
import {
  buttonStyles,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  IconButton,
  Tabs,
  VerticalTabPanel,
  vars,
} from '@budget-tracker/ui';
import type { TabItem } from '@budget-tracker/ui';

const currentYear = new Date().getFullYear();

const TYPE_ICONS: Record<string, React.ReactNode> = {
  MEDICAL: <Stethoscope size={16} />,
  DENTAL: <Cross size={16} />,
  VISION: <Glasses size={16} />,
};

export default function HealthcarePage() {
  const [selectedYear, setSelectedYear] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [editPolicy, setEditPolicy] = useState<InsurancePolicyWithBalance | undefined>(undefined);

  const { data: years } = usePolicyYears();

  const effectiveYear = selectedYear ?? (years?.includes(currentYear) ? currentYear : years?.[0]);

  const { data: policies, isLoading: policiesLoading } = usePolicies(effectiveYear);
  const { data: summary } = useHealthcareSummary(effectiveYear);
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const updateOverrides = useUpdateOverrides();
  const endCoverage = useEndCoverage();
  const closePolicy = useClosePolicy();

  // Build dynamic tabs from policies — one tab per policy, alphabetical by insurer
  const tabItems: TabItem[] = useMemo(() => {
    if (!policies || policies.length === 0) return [];
    return policies
      .toSorted((a, b) => getInsurerName(a).localeCompare(getInsurerName(b)))
      .map((p) => ({
        value: p.id,
        label: getInsurerName(p),
        icon: TYPE_ICONS[p.type] ?? <Stethoscope size={16} />,
      }));
  }, [policies]);

  // Auto-select first tab when policies load
  const effectiveTab =
    activeTab && tabItems.some((t) => t.value === activeTab) ? activeTab : tabItems[0]?.value;

  const selectedPolicy = useMemo(
    () => policies?.find((p) => p.id === effectiveTab),
    [policies, effectiveTab],
  );

  function openCreate() {
    setEditPolicy(undefined);
    setShowForm(true);
  }

  function openEdit(policy: InsurancePolicyWithBalance) {
    setEditPolicy(policy);
    setShowForm(true);
  }

  async function handleFormSubmit(data: unknown) {
    if (editPolicy) {
      await updatePolicy.mutateAsync({ id: editPolicy.id, body: data });
    } else {
      await createPolicy.mutateAsync(data);
    }
  }

  function handleToggleOverride(
    policy: InsurancePolicyWithBalance,
    field: 'deductibleOverride' | 'oopmOverride',
    date?: string,
  ) {
    const turningOn = !policy[field];
    updateOverrides.mutate(
      { id: policy.id, body: { [field]: turningOn } },
      {
        onSuccess: () => {
          if (turningOn && date) {
            const existingMeta = (policy.metadata ?? {}) as Record<string, unknown>;
            updatePolicy.mutate({
              id: policy.id,
              body: { metadata: { ...existingMeta, secondaryInsuranceDate: date } },
            });
          }
        },
      },
    );
  }

  const yearOptions = useMemo(() => {
    const set = new Set(years ?? []);
    set.add(currentYear);
    return [...set].toSorted((a, b) => b - a).map((y) => ({ value: String(y), label: String(y) }));
  }, [years]);

  return (
    <>
      <PageHeader
        title="Health Insurance"
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: vars.space['4'] }}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={<ListFilter size={14} />}
                  tooltip="Filter by year"
                  size="md"
                  variant="secondary"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Year</DropdownMenuLabel>
                {yearOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    checked={effectiveYear != null && String(effectiveYear) === opt.value}
                    checkStyle="check"
                    onSelect={() => setSelectedYear(Number(opt.value))}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={openCreate}
              className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
            >
              <Plus size={15} /> Add Policy
            </button>
          </div>
        }
      />

      {policiesLoading ? (
        <p
          style={{
            fontSize: vars.font.sm,
            color: vars.color.textTertiary,
            padding: vars.space['6'],
          }}
        >
          Loading…
        </p>
      ) : tabItems.length === 0 ? (
        <div style={{ padding: vars.space['6'] }}>
          <EmptyState
            icon={<ShieldPlus size={32} />}
            message={`No policies for ${effectiveYear ?? currentYear} — create one to get started`}
            action={
              <button
                type="button"
                onClick={openCreate}
                className={`${buttonStyles.btnBase} ${buttonStyles.btnMd} ${buttonStyles.btnPrimary}`}
              >
                <Plus size={15} /> Create Policy
              </button>
            }
          />
        </div>
      ) : (
        <Tabs
          tabs={tabItems}
          value={effectiveTab ?? ''}
          onChange={(val) => setActiveTab(val)}
          variant="vertical"
          ariaLabel="Health Insurance Policies"
        >
          {() => (
            <VerticalTabPanel value={effectiveTab ?? ''} activeValue={effectiveTab ?? ''}>
              <div style={{ maxWidth: '75rem', margin: '0 auto' }}>
                {selectedPolicy && (
                  <ActivePolicySection
                    policy={selectedPolicy}
                    onEdit={() => openEdit(selectedPolicy)}
                    onToggleOverride={handleToggleOverride}
                    onEndCoverage={() => endCoverage.mutate(selectedPolicy.id)}
                    onClose={() => closePolicy.mutate(selectedPolicy.id)}
                    summary={summary}
                  />
                )}
              </div>
            </VerticalTabPanel>
          )}
        </Tabs>
      )}

      <PolicyFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        policy={editPolicy}
        onSubmit={handleFormSubmit}
      />
    </>
  );
}
