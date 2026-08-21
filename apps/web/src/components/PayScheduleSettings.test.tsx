import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../test/wrapper.js';
import PayScheduleSettings from './PayScheduleSettings.js';

const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'sched-1' });

vi.mock('../hooks/usePaySchedules.js', () => ({
  usePaySchedules: vi.fn(() => ({ data: undefined, isLoading: false })),
  useCreatePaySchedule: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useUpdatePaySchedule: vi.fn(() => ({ mutateAsync: mockMutateAsync, isPending: false })),
  useGeneratePeriods: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
}));

import {
  usePaySchedules,
  useCreatePaySchedule,
  useUpdatePaySchedule,
  useGeneratePeriods,
} from '../hooks/usePaySchedules.js';

const mockedUsePaySchedules = vi.mocked(usePaySchedules);
const mockedUseCreatePaySchedule = vi.mocked(useCreatePaySchedule);
const mockedUseGeneratePeriods = vi.mocked(useGeneratePeriods);

describe('PayScheduleSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 'sched-1' });
    mockedUsePaySchedules.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof usePaySchedules
    >);
    mockedUseCreatePaySchedule.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCreatePaySchedule>);
    mockedUseGeneratePeriods.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    } as unknown as ReturnType<typeof useGeneratePeriods>);
  });

  function setup() {
    const Wrapper = createWrapper();
    return render(<PayScheduleSettings />, { wrapper: Wrapper });
  }

  it('renders loading state', () => {
    mockedUsePaySchedules.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof usePaySchedules
    >);
    setup();
    expect(screen.queryByText('Pay Schedule')).not.toBeInTheDocument();
  });

  it('renders schedule form when no existing schedule', () => {
    setup();
    expect(screen.getByText('Pay Schedule')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Pay schedule type')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Schedule' })).toBeInTheDocument();
  });

  it('renders Update Schedule button when existing schedule is present', () => {
    mockedUsePaySchedules.mockReturnValue({
      data: [
        {
          id: 'sched-1',
          name: 'Primary',
          type: 'BIWEEKLY',
          anchorDate: '2026-01-07T00:00:00.000Z',
          firstPayDay: null,
          secondPayDay: null,
          isDefault: true,
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof usePaySchedules>);

    setup();
    expect(screen.getByRole('button', { name: 'Update Schedule' })).toBeInTheDocument();
  });

  it('calls create mutation on form submit when no existing schedule', async () => {
    const user = userEvent.setup();
    const createMutateAsync = vi.fn().mockResolvedValue({ id: 'new-sched' });
    const generateMutateAsync = vi.fn().mockResolvedValue({});
    mockedUseCreatePaySchedule.mockReturnValue({
      mutateAsync: createMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useCreatePaySchedule>);
    mockedUseGeneratePeriods.mockReturnValue({
      mutateAsync: generateMutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof useGeneratePeriods>);

    setup();

    // Open the DatePicker then type a date. The mask emits dashes now; typing
    // slashes still parses (parseMasked accepts either), which is what this
    // types deliberately — a user's habit must not be silently rejected.
    await user.click(screen.getByText('MM-DD-YYYY'));
    const dateInput = screen.getByPlaceholderText('MM-DD-YYYY');
    await user.type(dateInput, '01/07/2026');

    await user.click(screen.getByRole('button', { name: 'Create Schedule' }));

    await waitFor(() => {
      expect(createMutateAsync).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(generateMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('shows first pay day fields for SEMI_MONTHLY type', async () => {
    const user = userEvent.setup();
    setup();

    // Click the DS Select to open dropdown, then pick an option
    const typeSelect = screen.getByLabelText('Pay schedule type');
    await user.click(typeSelect);
    await user.click(screen.getByText('Semi-Monthly'));

    expect(screen.getByLabelText(/First Pay Day/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Second Pay Day/)).toBeInTheDocument();
  });

  it('shows first pay day field for MONTHLY type', async () => {
    const user = userEvent.setup();
    setup();

    const typeSelect = screen.getByLabelText('Pay schedule type');
    await user.click(typeSelect);
    await user.click(screen.getByText('Monthly'));

    expect(screen.getByLabelText(/First Pay Day/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Second Pay Day/)).not.toBeInTheDocument();
  });
});
