import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ServicePanel from './ServicePanel.js';
import type { Provider, Service, Expense } from './types.js';

vi.mock('@budget-tracker/ui', () => ({
  buttonStyles: {
    btnBase: 'btnBase',
    btnSm: 'btnSm',
    btnMd: 'btnMd',
    btnPrimary: 'btnPrimary',
    btnSecondary: 'btnSecondary',
  },
  inputStyles: {
    formStack: 'formStack',
    field: 'field',
    fieldLabel: 'fieldLabel',
    fieldHelper: 'fieldHelper',
  },
  Modal: ({ open, title, children, footer }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
  Select: ({ id, placeholder, onChange, options }: any) => (
    <select data-testid={id ?? 'select'} onChange={(e: any) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options?.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Toggle: ({ label, checked, onChange }: any) => (
    <label>
      <input type="checkbox" checked={checked} onChange={(e: any) => onChange(e.target.checked)} />
      {label}
    </label>
  ),
}));

vi.mock('../../components/EmptyState.js', () => ({
  default: ({ message, action }: any) => (
    <div data-testid="empty-state">
      {message}
      {action}
    </div>
  ),
}));

vi.mock('../../components/ConfirmDialog.js', () => ({
  default: ({ open, title, message, onConfirm, onCancel }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <p>{message}</p>
        <button type="button" onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    ) : null,
}));

function makeMutation(overrides: Partial<{ isPending: boolean }> = {}) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: overrides.isPending ?? false,
    isError: false,
    isIdle: true,
    isSuccess: false,
    data: undefined,
    error: null,
    reset: vi.fn(),
    status: 'idle' as const,
    variables: undefined,
    failureCount: 0,
    failureReason: null,
    context: undefined,
    isPaused: false,
    submittedAt: 0,
  } as any;
}

const provider: Provider = {
  id: 'prov-1',
  name: 'City Power',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

const services: Service[] = [
  {
    id: 'svc-1',
    providerId: 'prov-1',
    serviceType: 'ELECTRIC',
    metering: 'METERED',
    expenseId: null,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
  {
    id: 'svc-2',
    providerId: 'prov-1',
    serviceType: 'GAS',
    metering: 'UNMETERED',
    expenseId: 'exp-1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
  },
];

const expenses: Expense[] = [
  { id: 'exp-1', name: 'Monthly Electric' },
  { id: 'exp-2', name: 'Monthly Gas' },
];

const defaultProps = {
  provider,
  services,
  isLoading: false,
  selectedServiceId: null as string | null,
  onSelectService: vi.fn(),
  expenses,
  createService: makeMutation(),
  deleteService: makeMutation(),
  linkService: makeMutation(),
  unlinkService: makeMutation(),
  showAddModal: false,
  onShowAddModalChange: vi.fn(),
  deleteTarget: null as Service | null,
  onDeleteTargetChange: vi.fn(),
  linkingService: null as Service | null,
  onLinkingServiceChange: vi.fn(),
};

function setup(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  const user = userEvent.setup();
  const result = render(<ServicePanel {...props} />);
  return { props, user, ...result };
}

describe('ServicePanel', () => {
  it('renders empty state when no provider is selected', () => {
    setup({ provider: undefined });
    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'Select a provider to view services',
    );
  });

  it('renders service list as buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Electric' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gas' })).toBeInTheDocument();
  });

  it('renders provider name in heading', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'City Power – Services' })).toBeInTheDocument();
  });

  it('calls onSelectService when a service button is clicked', async () => {
    const onSelectService = vi.fn();
    const { user } = setup({ onSelectService });
    await user.click(screen.getByRole('button', { name: 'Electric' }));
    expect(onSelectService).toHaveBeenCalledWith('svc-1');
  });

  it('renders empty state with Add Service button when services list is empty', () => {
    setup({ services: [] });
    expect(screen.getByTestId('empty-state')).toHaveTextContent('No services for this provider');
    expect(screen.getByRole('button', { name: /Add Service/ })).toBeInTheDocument();
  });

  it('opens Add Service modal when showAddModal is true', () => {
    setup({ showAddModal: true });
    expect(screen.getByRole('dialog', { name: 'Add Service' })).toBeInTheDocument();
  });

  it('opens delete confirmation when deleteTarget is set', () => {
    setup({ deleteTarget: services[0]! });
    expect(screen.getByRole('dialog', { name: 'Delete Service' })).toBeInTheDocument();
    expect(
      screen.getByText(/Delete "Electric" service\? This cannot be undone\./),
    ).toBeInTheDocument();
  });

  it('opens link expense modal when linkingService is set', () => {
    setup({ linkingService: services[0]! });
    expect(screen.getByRole('dialog', { name: 'Link Electric to Expense' })).toBeInTheDocument();
  });

  it('calls createService.mutate when Save is clicked in Add Service modal', async () => {
    const createService = makeMutation();
    const { user } = setup({ showAddModal: true, createService });

    // Select a service type
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'ELECTRIC');

    // Click Add
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(createService.mutate).toHaveBeenCalledWith(
      { providerId: 'prov-1', body: { serviceType: 'ELECTRIC', metering: 'METERED' } },
      expect.any(Object),
    );
  });

  it('calls deleteService.mutate when confirm is clicked in delete dialog', async () => {
    const deleteService = makeMutation();
    const { user } = setup({ deleteTarget: services[0]!, deleteService });

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(deleteService.mutate).toHaveBeenCalledWith('svc-1', expect.any(Object));
  });

  it('calls linkService.mutate when Link is clicked in link modal', async () => {
    const linkService = makeMutation();
    const { user } = setup({ linkingService: services[0]!, linkService });

    // Select an expense
    await user.selectOptions(screen.getAllByRole('combobox')[0]!, 'exp-1');

    // Click Link
    await user.click(screen.getByRole('button', { name: 'Link' }));

    expect(linkService.mutate).toHaveBeenCalledWith(
      { id: 'svc-1', expenseId: 'exp-1' },
      expect.any(Object),
    );
  });

  it('shows loading text when isLoading is true', () => {
    setup({ isLoading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
