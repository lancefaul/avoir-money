import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SIGN_CONVENTION_CONFIG } from '@budget-tracker/core';

// Mock matchMedia for the field-stacking breakpoint (useIsNarrow in the form)
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

import SignConventionForm from './SignConventionForm.js';

vi.mock('../lib/api.js', () => ({
  api: {
    signConventions: {
      get: vi.fn(),
      save: vi.fn(),
    },
  },
}));

import { api } from '../lib/api.js';

const mockGet = api.signConventions.get as ReturnType<typeof vi.fn>;
const mockSave = api.signConventions.save as ReturnType<typeof vi.fn>;

describe('SignConventionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(DEFAULT_SIGN_CONVENTION_CONFIG);
  });

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SignConventionForm />);
    expect(screen.getByText('Loading sign conventions…')).toBeInTheDocument();
  });

  it('renders sections for each transaction type after loading', async () => {
    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    // Section headings
    expect(screen.getByText('Expense transactions')).toBeInTheDocument();
    expect(screen.getByText('Income transactions')).toBeInTheDocument();
    expect(screen.getByText('Transfer transactions')).toBeInTheDocument();
    expect(screen.getByText('Trade transactions')).toBeInTheDocument();
    expect(screen.getByText('Refund transactions')).toBeInTheDocument();

    // ButtonGroup buttons — multiple "Positive (+)" and "Negative (−)" buttons
    const positiveButtons = screen.getAllByText('Positive (+)');
    const negativeButtons = screen.getAllByText('Negative (−)');
    expect(positiveButtons.length).toBeGreaterThan(0);
    expect(negativeButtons.length).toBeGreaterThan(0);
  });

  it('loads config and reflects current values via ButtonGroup state', async () => {
    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    // Default config: expense.positiveMeaning = 'money_out' → Spending = Positive
    // The "Spending" field label should exist
    expect(screen.getByText('Spending')).toBeInTheDocument();
  });

  it('saves config when Save button is clicked', async () => {
    const user = userEvent.setup();
    const savedConfig = { ...DEFAULT_SIGN_CONVENTION_CONFIG };
    mockSave.mockResolvedValue(savedConfig);

    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save conventions' }));
    expect(mockSave).toHaveBeenCalledWith(DEFAULT_SIGN_CONVENTION_CONFIG);

    await waitFor(() => {
      expect(screen.getByText('Sign conventions saved successfully.')).toBeInTheDocument();
    });
  });

  it('calls onConfigChange when a ButtonGroup value changes', async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();

    render(<SignConventionForm onConfigChange={onConfigChange} />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    // onConfigChange is called once on load with the fetched config
    expect(onConfigChange).toHaveBeenCalledWith(DEFAULT_SIGN_CONVENTION_CONFIG);
    onConfigChange.mockClear();

    // Click on the first "Negative (−)" button in Expense section to flip spending sign
    const negativeButtons = screen.getAllByText('Negative (−)');
    await user.click(negativeButtons[0]!);

    expect(onConfigChange).toHaveBeenCalled();
  });

  it('hides save button when hideSave is true', async () => {
    render(<SignConventionForm hideSave />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: 'Save conventions' })).not.toBeInTheDocument();
  });

  it('shows error message when save fails', async () => {
    const user = userEvent.setup();
    mockSave.mockRejectedValue(new Error('Network error'));

    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Save conventions' }));

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('uses defaults AND surfaces a warning when the API load fails', async () => {
    mockGet.mockRejectedValue(new Error('Failed'));

    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.queryByText('Loading sign conventions…')).not.toBeInTheDocument();
    });

    // Still usable with defaults — section headings present
    expect(screen.getByText('Expense transactions')).toBeInTheDocument();
    expect(screen.getByText('Spending')).toBeInTheDocument();

    // …but the failure is no longer silent: a warning alert appears
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not load your saved sign conventions/i);
    expect(alert).toHaveTextContent(/overwrite the stored configuration/i);
  });

  it('shows no load-error alert on a successful load', async () => {
    render(<SignConventionForm />);
    await waitFor(() => {
      expect(screen.getByText('Expense transactions')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
