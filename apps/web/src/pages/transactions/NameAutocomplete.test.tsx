import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import NameAutocomplete from './NameAutocomplete.js';

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock('../../lib/api.js', () => ({
  api: {
    descriptions: {
      list: (...args: unknown[]) => mockList(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// Mock the DropdownMenu components to render simple HTML for testing
vi.mock('@budget-tracker/ui', () => ({
  DropdownMenu: ({
    children,
  }: {
    children: ReactNode;
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) => <div data-testid="dropdown">{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
    icon,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    icon?: ReactNode;
  }) => (
    <button type="button" role="menuitem" onClick={onSelect}>
      {icon}
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

function makeRegistration() {
  const ref = vi.fn();
  const onChange = vi.fn().mockResolvedValue(undefined);
  const onBlur = vi.fn().mockResolvedValue(undefined);
  return {
    registration: { name: 'name' as const, ref, onChange, onBlur },
    ref,
    onChange,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const { registration } = makeRegistration();
  const setValue = vi.fn();
  const onDescriptionSelect = vi.fn();
  const user = userEvent.setup();

  const props = {
    registration,
    setValue,
    suggestions: [] as string[],
    className: 'input-class',
    placeholder: 'Enter name',
    onDescriptionSelect,
    ...overrides,
  };

  const result = render(<NameAutocomplete {...props} />);

  return { user, setValue, onDescriptionSelect, ...result };
}

describe('NameAutocomplete', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'new-1', name: 'New Item' });
  });

  it('renders an input with correct placeholder and aria attributes', () => {
    setup();
    const input = screen.getByPlaceholderText('Enter name');

    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('shows suggestions after typing', async () => {
    mockList.mockResolvedValue([
      { id: '1', name: 'Groceries' },
      { id: '2', name: 'Gas Station' },
    ]);

    const { user } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'G');

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledWith('G');
    });

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('Gas Station')).toBeInTheDocument();
    });
  });

  it('calls setValue and onDescriptionSelect when a suggestion is selected', async () => {
    mockList.mockResolvedValue([{ id: '1', name: 'Groceries' }]);

    const { user, setValue, onDescriptionSelect } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'G');

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Groceries'));

    expect(setValue).toHaveBeenCalledWith('name', 'Groceries', { shouldValidate: true });
    expect(onDescriptionSelect).toHaveBeenCalledWith('Groceries');
  });

  it('shows "Create" option when no exact match exists', async () => {
    mockList.mockResolvedValue([{ id: '1', name: 'Groceries' }]);

    const { user } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'Gro');

    await waitFor(() => {
      expect(screen.getByText(/Create "Gro"/)).toBeInTheDocument();
    });
  });

  it('does not show "Create" option when exact match exists', async () => {
    mockList.mockResolvedValue([{ id: '1', name: 'Groceries' }]);

    const { user } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'Groceries');

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Create "Groceries"/)).not.toBeInTheDocument();
  });

  it('creates a new description and selects it', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'new-1', name: 'NewItem' });

    const { user, setValue, onDescriptionSelect } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'NewItem');

    await waitFor(() => {
      expect(screen.getByText(/Create "NewItem"/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Create "NewItem"/));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('NewItem');
    });

    await waitFor(() => {
      expect(setValue).toHaveBeenCalledWith('name', 'NewItem', { shouldValidate: true });
      expect(onDescriptionSelect).toHaveBeenCalledWith('NewItem');
    });
  });

  it('selects first suggestion on Enter key', async () => {
    mockList.mockResolvedValue([
      { id: '1', name: 'Groceries' },
      { id: '2', name: 'Gas' },
    ]);

    const { user, setValue } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    await user.type(input, 'G');

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    await user.keyboard('{Enter}');

    expect(setValue).toHaveBeenCalledWith('name', 'Groceries', { shouldValidate: true });
  });

  it('does not fetch when input length is less than 1', async () => {
    mockList.mockClear();
    const { user } = setup();
    const input = screen.getByPlaceholderText('Enter name');

    // Type a character then clear it
    await user.type(input, 'A');
    mockList.mockClear();

    await user.clear(input);

    // Wait for any debounce to fire
    await new Promise((r) => setTimeout(r, 200));

    expect(mockList).not.toHaveBeenCalled();
  });
});
