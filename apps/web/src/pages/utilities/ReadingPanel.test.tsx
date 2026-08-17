import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../../test/wrapper.js';
import type { Reading, Service, Expense } from './types.js';

// Mock matchMedia for responsive column collapse (useIsNarrow in ReadingTable)
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

// ─── Mocks ───

vi.mock('@budget-tracker/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@budget-tracker/ui')>();
  return {
    ...actual,
    Modal: ({
      open,
      title,
      children,
      footer,
    }: {
      open: boolean;
      title: string;
      children: React.ReactNode;
      footer?: React.ReactNode;
    }) =>
      open ? (
        <div data-testid="modal">
          <h2>{title}</h2>
          {children}
          {footer}
        </div>
      ) : null,
  };
});

vi.mock('../../components/ConfirmDialog.js', () => ({
  default: ({
    open,
    title,
    message,
    onConfirm,
    onCancel,
    confirmLabel,
  }: {
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel?: string;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <p>{title}</p>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmLabel ?? 'Confirm'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

vi.mock('../../components/EmptyState.js', () => ({
  default: ({ message, action }: { message: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <p>{message}</p>
      {action}
    </div>
  ),
}));

import ReadingPanel from './ReadingPanel.js';

// ─── Helpers ───

function makeService(overrides?: Partial<Service>): Service {
  return {
    id: 'svc-1',
    providerId: 'prov-1',
    serviceType: 'ELECTRIC',
    metering: 'UNMETERED',
    expenseId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReading(overrides?: Partial<Reading>): Reading {
  return {
    id: 'read-1',
    serviceId: 'svc-1',
    billDate: '2024-03-15T00:00:00.000Z',
    dueDate: '2024-04-01T00:00:00.000Z',
    usage: null,
    cost: 85.5,
    unitCost: null,
    convenienceFee: null,
    convenienceFeeType: null,
    otherFees: null,
    details: null,
    createdAt: '2024-03-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeMutation(mutateFn = vi.fn()) {
  return {
    mutate: mutateFn,
    mutateAsync: vi.fn(),
    isPending: false,
    isIdle: true,
    isSuccess: false,
    isError: false,
    data: undefined,
    error: null,
    variables: undefined,
    status: 'idle' as const,
    failureCount: 0,
    failureReason: null,
    reset: vi.fn(),
    context: undefined,
    submittedAt: 0,
  } as unknown as import('@tanstack/react-query').UseMutationResult<unknown, Error, unknown>;
}

const defaultExpenses: Expense[] = [{ id: 'exp-1', name: 'Electric Bill' }];

// ─── Tests ───

describe('ReadingPanel', () => {
  const mockCreateMutate = vi.fn();
  const mockUpdateMutate = vi.fn();
  const mockDeleteMutate = vi.fn();
  const mockOnDeleteService = vi.fn();
  const mockOnLinkService = vi.fn();
  const mockOnUnlinkService = vi.fn();

  function renderPanel(overrides?: {
    service?: Service | undefined;
    readings?: Reading[];
    isLoading?: boolean;
    expenses?: Expense[];
  }) {
    const service = overrides && 'service' in overrides ? overrides.service : makeService();
    return render(
      <ReadingPanel
        service={service}
        readings={overrides?.readings ?? []}
        isLoading={overrides?.isLoading ?? false}
        expenses={overrides?.expenses ?? defaultExpenses}
        createReading={makeMutation(mockCreateMutate) as never}
        updateReading={makeMutation(mockUpdateMutate) as never}
        deleteReading={makeMutation(mockDeleteMutate) as never}
        onDeleteService={mockOnDeleteService}
        onLinkService={mockOnLinkService}
        onUnlinkService={mockOnUnlinkService}
        updateService={makeMutation() as never}
      />,
      { wrapper: createWrapper() },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty states', () => {
    it('shows empty state when no service is selected', () => {
      renderPanel({ service: undefined });

      expect(screen.getByText('Select a service to view readings')).toBeInTheDocument();
    });

    it('shows empty state with add button when service has no readings', () => {
      renderPanel({ readings: [] });

      expect(screen.getByText('No readings for this service')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Reading/i })).toBeInTheDocument();
    });

    it('shows loading text when isLoading is true', () => {
      renderPanel({ isLoading: true });

      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
  });

  describe('readings list', () => {
    it('renders the readings table when readings exist', () => {
      const readings = [
        makeReading({ id: 'r1', billDate: '2024-01-10T00:00:00.000Z', cost: 50 }),
        makeReading({ id: 'r2', billDate: '2024-02-10T00:00:00.000Z', cost: 60 }),
      ];

      renderPanel({ readings });

      expect(screen.getByRole('table', { name: /utility bill readings/i })).toBeInTheDocument();
    });

    it('shows the service type in the card title', () => {
      const readings = [makeReading()];

      renderPanel({ readings, service: makeService({ serviceType: 'ELECTRIC' }) });

      expect(screen.getByText('Electric Bills')).toBeInTheDocument();
    });
  });

  describe('add reading flow', () => {
    it('opens the form modal when Add Reading button is clicked from empty state', async () => {
      const user = userEvent.setup();

      renderPanel({ readings: [] });

      await user.click(screen.getByRole('button', { name: /Add Reading/i }));

      expect(screen.getByTestId('modal')).toBeInTheDocument();
      expect(screen.getByText(/Add Reading – Electric/)).toBeInTheDocument();
    });

    it('opens the form modal when plus icon button is clicked', async () => {
      const user = userEvent.setup();
      const readings = [makeReading()];

      renderPanel({ readings });

      await user.click(screen.getByRole('button', { name: /Add reading/i }));

      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });
  });

  describe('edit reading flow', () => {
    it('opens the form modal with edit title when overflow Edit is clicked', async () => {
      const user = userEvent.setup();
      const readings = [makeReading()];

      renderPanel({ readings });

      // Click the overflow menu trigger (DropdownMenu with "Actions" tooltip)
      await user.click(screen.getByRole('button', { name: /Actions/i }));
      // Click "Edit" item in the dropdown
      await user.click(screen.getByText('Edit'));

      expect(screen.getByTestId('modal')).toBeInTheDocument();
      expect(screen.getByText(/Edit Reading/)).toBeInTheDocument();
    });
  });

  describe('delete reading flow', () => {
    it('opens confirm dialog when overflow Delete is clicked', async () => {
      const user = userEvent.setup();
      const readings = [makeReading()];

      renderPanel({ readings });

      // Click the overflow menu trigger
      await user.click(screen.getByRole('button', { name: /Actions/i }));
      // Click "Delete" item in the dropdown
      await user.click(screen.getByText('Delete'));

      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText('Delete Reading')).toBeInTheDocument();
    });

    it('calls deleteReading.mutate when confirm is clicked', async () => {
      const user = userEvent.setup();
      const readings = [makeReading({ id: 'read-42' })];

      renderPanel({ readings });

      // Click the overflow menu trigger
      await user.click(screen.getByRole('button', { name: /Actions/i }));
      // Click "Delete" item in the dropdown
      await user.click(screen.getByText('Delete'));

      // Now click the confirm "Delete" button inside the confirm dialog
      const dialog = screen.getByTestId('confirm-dialog');
      const confirmDeleteBtn = dialog.querySelector('button')!;
      await user.click(confirmDeleteBtn);

      expect(mockDeleteMutate).toHaveBeenCalledWith('read-42', expect.any(Object));
    });

    it('closes confirm dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      const readings = [makeReading()];

      renderPanel({ readings });

      // Click the overflow menu trigger
      await user.click(screen.getByRole('button', { name: /Actions/i }));
      // Click "Delete" item in the dropdown
      await user.click(screen.getByText('Delete'));
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /Cancel/i }));
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });
  });

  describe('service actions', () => {
    it('calls onDeleteService when delete service button is clicked', async () => {
      const user = userEvent.setup();
      const service = makeService();
      const readings = [makeReading()];

      renderPanel({ service, readings });

      await user.click(screen.getByRole('button', { name: /Delete service/i }));

      expect(mockOnDeleteService).toHaveBeenCalledWith(service);
    });

    it('calls onLinkService when link button is clicked (no linked expense)', async () => {
      const user = userEvent.setup();
      const service = makeService({ expenseId: null });
      const readings = [makeReading()];

      renderPanel({ service, readings });

      await user.click(screen.getByRole('button', { name: /Link to expense/i }));

      expect(mockOnLinkService).toHaveBeenCalledWith(service);
    });

    it('shows unlink button when service has a linked expense', async () => {
      const user = userEvent.setup();
      const service = makeService({ expenseId: 'exp-1' });
      const readings = [makeReading()];

      renderPanel({ service, readings, expenses: defaultExpenses });

      const unlinkBtn = screen.getByRole('button', { name: /Unlink Electric Bill/i });
      expect(unlinkBtn).toBeInTheDocument();

      await user.click(unlinkBtn);

      // Should open unlink confirmation
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      expect(screen.getByText('Unlink Expense')).toBeInTheDocument();
    });
  });
});
