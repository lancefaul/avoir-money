import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select, type SelectOption } from './Select.js';
import { Badge } from './Badge.js';

/* ── Helpers ── */

/**
 * The DropdownMenu uses double-rAF for phase transitions (opening → open).
 * We flush those frames so the portal content actually renders.
 */
async function flushRAF() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

const options: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

const groupedOptions: SelectOption[] = [
  { value: '1', label: 'Apple', group: 'Fruits' },
  { value: '2', label: 'Banana', group: 'Fruits' },
  { value: '3', label: 'Carrot', group: 'Vegetables' },
];

/* ── Tests ── */

describe('Select', () => {
  describe('single-select', () => {
    it('clicking trigger opens dropdown and displays all options', async () => {
      const user = userEvent.setup();
      render(<Select options={options} onChange={() => {}} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // All options should be visible in the portal
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();
      expect(screen.getByText('Gamma')).toBeInTheDocument();
    });

    it('clicking option fires onChange with value and trigger shows selected label', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { rerender } = render(<Select options={options} onChange={onChange} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // Click the "Beta" option
      await user.click(screen.getByText('Beta'));

      expect(onChange).toHaveBeenCalledWith('b');

      // Rerender with the selected value to verify trigger label
      rerender(<Select options={options} value="b" onChange={onChange} />);
      expect(trigger).toHaveTextContent('Beta');
    });
  });

  describe('multi-select', () => {
    it('clicking option fires onChange with array containing value', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select multi options={options} value={[]} onChange={onChange} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      await user.click(screen.getByText('Alpha'));
      expect(onChange).toHaveBeenCalledWith(['a']);
    });

    it('chips render for selected values and chip remove fires onChange without that value', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select multi options={options} value={['a', 'b']} onChange={onChange} />);

      // Chips should be visible
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Beta')).toBeInTheDocument();

      // Click the remove button on the "Alpha" chip
      const removeAlpha = screen.getByRole('button', { name: 'Remove Alpha' });
      await user.click(removeAlpha);

      expect(onChange).toHaveBeenCalledWith(['b']);
    });

    it('removing a chip via keyboard fires onChange and does not open the dropdown', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select multi options={options} value={['a', 'b']} onChange={onChange} />);

      const removeAlpha = screen.getByRole('button', { name: 'Remove Alpha' });
      removeAlpha.focus();
      await user.keyboard('{Enter}');

      // The chip is removed, and the keydown did not bubble to the trigger to open
      // the dropdown (regression: Enter/Space used to open it instead of removing).
      expect(onChange).toHaveBeenCalledWith(['b']);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('"Select all" fires onChange with all values, "Clear" fires with empty array', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Select multi options={options} value={['a']} onChange={onChange} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // Click "Select all"
      await user.click(screen.getByText('Select all'));
      expect(onChange).toHaveBeenCalledWith(['a', 'b', 'c']);

      // Click "Clear"
      onChange.mockClear();
      await user.click(screen.getByText('Clear'));
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe('searchable', () => {
    it('typing filters options case-insensitively', async () => {
      const user = userEvent.setup();
      render(<Select searchable options={options} onChange={() => {}} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // Type "alp" in the search input (case-insensitive match for "Alpha")
      const searchInput = screen.getByPlaceholderText('Search…');
      await user.type(searchInput, 'alp');

      // Only Alpha should be visible
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.queryByText('Beta')).not.toBeInTheDocument();
      expect(screen.queryByText('Gamma')).not.toBeInTheDocument();
    });

    it('no matches shows "No results found"', async () => {
      const user = userEvent.setup();
      render(<Select searchable options={options} onChange={() => {}} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      const searchInput = screen.getByPlaceholderText('Search…');
      await user.type(searchInput, 'zzz');

      expect(screen.getByText('No results found')).toBeInTheDocument();
    });
  });

  describe('disabled', () => {
    it('clicking trigger does not open dropdown', async () => {
      const user = userEvent.setup();
      render(<Select disabled options={options} onChange={() => {}} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // The dropdown should not open — no menu should be present
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  describe('grouped options', () => {
    it('renders group labels and separators', async () => {
      const user = userEvent.setup();
      render(<Select options={groupedOptions} onChange={() => {}} />);

      const trigger = screen.getByRole('combobox');
      await user.click(trigger);
      await flushRAF();

      // Group labels should be visible
      expect(screen.getByText('Fruits')).toBeInTheDocument();
      expect(screen.getByText('Vegetables')).toBeInTheDocument();

      // Separator should be present between groups
      expect(screen.getByRole('separator')).toBeInTheDocument();

      // All options should be visible
      expect(screen.getByText('Apple')).toBeInTheDocument();
      expect(screen.getByText('Banana')).toBeInTheDocument();
      expect(screen.getByText('Carrot')).toBeInTheDocument();
    });
  });

  describe('custom trigger', () => {
    it('renders a custom trigger instead of the combobox, opens it, and fires onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <Select
          options={options}
          value="a"
          onChange={onChange}
          searchable
          trigger={<Badge chevron>Custom</Badge>}
        />,
      );
      // The default combobox box is replaced by the Badge trigger.
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      const trigger = screen.getByRole('button', { name: 'Custom' });

      await user.click(trigger);
      await flushRAF();
      expect(screen.getByText('Beta')).toBeInTheDocument();

      await user.click(screen.getByText('Beta'));
      expect(onChange).toHaveBeenCalledWith('b');
    });
  });

  describe('accessible name', () => {
    it('names the combobox from a visible <label htmlFor> via aria-labelledby', () => {
      render(
        <>
          <label htmlFor="acct-select">Account</label>
          <Select id="acct-select" options={options} value="a" onChange={() => {}} />
        </>,
      );
      // `<label for>` is inert against a div[role=combobox]; the DS wires
      // aria-labelledby so the combobox's accessible name is "Account".
      expect(screen.getByRole('combobox', { name: 'Account' })).toBeInTheDocument();
    });

    it('prefers an explicit aria-label over the visible label', () => {
      render(
        <>
          <label htmlFor="b-select">Ignored</label>
          <Select
            id="b-select"
            aria-label="Choose account"
            options={options}
            value="a"
            onChange={() => {}}
          />
        </>,
      );
      expect(screen.getByRole('combobox', { name: 'Choose account' })).toBeInTheDocument();
    });
  });
});

/**
 * `menuWidth` — an explicit panel width.
 *
 * The panel matches its trigger by default (`matchTriggerWidth`), which is right
 * for an ordinary field and wrong behind a deliberately small trigger: a Badge
 * sized to a budget name leaves the option list cramped. The CSS `max-width` on
 * the menu cannot fix that, because `matchTriggerWidth` writes `width` as an
 * INLINE style and inline wins — which is exactly why widening the stylesheet
 * appeared to do nothing.
 */
describe('menuWidth', () => {
  it('sets the panel width, overriding the trigger-derived one', async () => {
    const user = userEvent.setup();
    render(
      <Select
        options={options}
        menuWidth="16rem"
        aria-label="Pick"
        trigger={<Badge chevron>Pick…</Badge>}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pick…' }));
    await flushRAF();

    const panel = screen.getByText('Alpha').closest('[role="menu"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.style.width).toBe('16rem');
    expect(panel!.style.minWidth).toBe('16rem');
    expect(panel!.style.maxWidth).toBe('16rem');
  });

  it('falls back to the trigger width when omitted', async () => {
    const user = userEvent.setup();
    render(<Select options={options} aria-label="Pick" trigger={<Badge chevron>Pick…</Badge>} />);
    await user.click(screen.getByRole('button', { name: 'Pick…' }));
    await flushRAF();

    const panel = screen.getByText('Alpha').closest('[role="menu"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    // jsdom reports offsetWidth 0, so this is the trigger-derived path rather
    // than a fixed rem value — the point is only that it is NOT 16rem.
    expect(panel!.style.width).not.toBe('16rem');
  });
});
