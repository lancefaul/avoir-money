import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWrapper } from '../../test/wrapper.js';

// ─── Mocks ───

const mockListChildren = vi.fn();
const mockCreateChild = vi.fn();
const mockUpdateChild = vi.fn();
const mockDeleteChild = vi.fn();

vi.mock('../../lib/api.js', () => ({
  api: {
    transactions: {
      listChildren: (...args: unknown[]) => mockListChildren(...args),
      createChild: (...args: unknown[]) => mockCreateChild(...args),
      updateChild: (...args: unknown[]) => mockUpdateChild(...args),
      deleteChild: (...args: unknown[]) => mockDeleteChild(...args),
    },
  },
}));

vi.mock('../../lib/cache-invalidation.js', () => ({
  invalidateTransactionCaches: vi.fn(),
}));

vi.mock('../../store/toast.js', () => ({
  useToastStore: (selector: (s: any) => any) => selector({ addToast: mockAddToast }),
}));

const mockAddToast = vi.fn();

import SplitTransactionModal from './SplitTransactionModal.js';
import type { Category } from './types.js';

// ─── Helpers ───

const categories: Category[] = [
  { id: 'cat-1', name: 'Groceries', icon: '🛒', groupName: 'Essentials' },
  { id: 'cat-2', name: 'Dining', icon: '🍽️', groupName: 'Lifestyle' },
  { id: 'cat-3', name: 'Transport', icon: '🚗', groupName: 'Essentials' },
];

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  parentId: 'tx-parent-1',
  parentAmount: 100,
  parentBudgetId: 'cat-1',
  categories,
};

function renderModal(overrides?: Partial<typeof defaultProps>) {
  return render(<SplitTransactionModal {...defaultProps} {...overrides} />, {
    wrapper: createWrapper(),
  });
}

// ─── Tests ───

describe('SplitTransactionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListChildren.mockResolvedValue({ children: [] });
    mockCreateChild.mockResolvedValue({ id: 'child-1', budgetId: 'cat-2', lineTotal: 30 });
  });

  describe('add/remove rows', () => {
    it('adds a new split row when "Add Category" is clicked', async () => {
      const user = userEvent.setup();
      renderModal();

      const addBtn = screen.getByRole('button', { name: /add category/i });
      await user.click(addBtn);

      // Should now have a remove button for the new row
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('adds multiple rows on repeated clicks', async () => {
      const user = userEvent.setup();
      renderModal();

      const addBtn = screen.getByRole('button', { name: /add category/i });
      await user.click(addBtn);
      await user.click(addBtn);
      await user.click(addBtn);

      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons).toHaveLength(3);
    });

    it('removes a row when the remove button is clicked', async () => {
      const user = userEvent.setup();
      renderModal();

      const addBtn = screen.getByRole('button', { name: /add category/i });
      await user.click(addBtn);
      await user.click(addBtn);

      let removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons).toHaveLength(2);

      await user.click(removeButtons[0]!);

      removeButtons = screen.getAllByRole('button', { name: /remove/i });
      expect(removeButtons).toHaveLength(1);
    });
  });

  describe('amount validation (sum ≤ parent)', () => {
    it('shows the parent amount as the remainder when no splits are added', () => {
      renderModal({ parentAmount: 50 });

      // The segmented progress should show the full parent amount
      expect(screen.getByText('$50.00')).toBeInTheDocument();
    });

    it('shows error toast when saving with no valid rows', async () => {
      const user = userEvent.setup();
      renderModal();

      // Add a row but don't set category or amount
      await user.click(screen.getByRole('button', { name: /add category/i }));
      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockAddToast).toHaveBeenCalledWith(
        'error',
        'Add at least one category split with an amount',
      );
      expect(mockCreateChild).not.toHaveBeenCalled();
    });

    it('disables save button when no rows exist', () => {
      renderModal();

      const saveBtn = screen.getByRole('button', { name: /save/i });
      expect(saveBtn).toBeDisabled();
    });
  });

  describe('save flow', () => {
    it('creates new child transactions on save', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderModal({ onClose });

      // Add a row
      await user.click(screen.getByRole('button', { name: /add category/i }));

      // CurrencyInput renders type="text" with inputMode="numeric" → role is textbox
      // First textbox is row1 (read-only), second is the new row's amount
      const textboxes = screen.getAllByRole('textbox');
      const editableInput = textboxes[textboxes.length - 1]!;
      await user.click(editableInput);
      await user.type(editableInput, '3000'); // types digits → CurrencyInput interprets as 30.00

      // Select a category for the new row
      const selectTriggers = screen.getAllByRole('combobox');
      await user.click(selectTriggers[selectTriggers.length - 1]!);

      // Select "Dining" from the dropdown
      await waitFor(() => {
        expect(screen.getByText('🍽️ Dining')).toBeInTheDocument();
      });
      await user.click(screen.getByText('🍽️ Dining'));

      // Save
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockCreateChild).toHaveBeenCalledWith(
          'tx-parent-1',
          expect.objectContaining({ budgetId: 'cat-2', preTaxAmount: 30 }),
        );
      });

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('shows success toast after saving', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByRole('button', { name: /add category/i }));

      const textboxes = screen.getAllByRole('textbox');
      const editableInput = textboxes[textboxes.length - 1]!;
      await user.click(editableInput);
      await user.type(editableInput, '2500');

      const selectTriggers = screen.getAllByRole('combobox');
      await user.click(selectTriggers[selectTriggers.length - 1]!);
      await waitFor(() => {
        expect(screen.getByText('🍽️ Dining')).toBeInTheDocument();
      });
      await user.click(screen.getByText('🍽️ Dining'));

      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('success', expect.stringContaining('Split into'));
      });
    });

    it('shows error toast when save fails', async () => {
      const user = userEvent.setup();
      mockCreateChild.mockRejectedValue(new Error('Network error'));
      renderModal();

      await user.click(screen.getByRole('button', { name: /add category/i }));

      const textboxes = screen.getAllByRole('textbox');
      const editableInput = textboxes[textboxes.length - 1]!;
      await user.click(editableInput);
      await user.type(editableInput, '2000');

      const selectTriggers = screen.getAllByRole('combobox');
      await user.click(selectTriggers[selectTriggers.length - 1]!);
      await waitFor(() => {
        expect(screen.getByText('🍽️ Dining')).toBeInTheDocument();
      });
      await user.click(screen.getByText('🍽️ Dining'));

      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'Network error');
      });
    });

    it('deletes removed existing children on save', async () => {
      const user = userEvent.setup();
      // Return existing children from the API
      mockListChildren.mockResolvedValue({
        children: [
          { id: 'child-existing-1', budgetId: 'cat-2', lineTotal: 25 },
          { id: 'child-existing-2', budgetId: 'cat-3', lineTotal: 35 },
        ],
      });
      mockDeleteChild.mockResolvedValue(undefined);
      mockUpdateChild.mockResolvedValue({});

      renderModal();

      // Wait for children to load and rows to appear
      await waitFor(() => {
        expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(2);
      });

      // Remove the first existing child row
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      await user.click(removeButtons[0]!);

      // Save — should delete the removed child
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockDeleteChild).toHaveBeenCalledWith('tx-parent-1', 'child-existing-1');
      });
    });

    it('calls cancel and resets state when Cancel is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderModal({ onClose });

      await user.click(screen.getByRole('button', { name: /add category/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onClose).toHaveBeenCalled();
    });
  });
});
