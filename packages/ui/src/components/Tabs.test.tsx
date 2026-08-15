import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabPanel } from './Tabs.js';
import type { TabItem } from './Tabs.js';

const tabs: TabItem[] = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
];

/**
 * The Tabs component uses offsetWidth for overflow measurement.
 * In jsdom offsetWidth is always 0, so all tabs go into the "More" dropdown.
 * Using variant="pill" bypasses the overflow measurement logic entirely,
 * setting visibleCount = tabs.length so all tabs render as visible buttons.
 */

describe('Tabs', () => {
  it('renders tabs with role="tab" and container with role="tablist"', () => {
    render(<Tabs tabs={tabs} value="one" onChange={() => {}} variant="pill" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    const tabElements = screen.getAllByRole('tab');
    expect(tabElements).toHaveLength(3);
  });

  it('clicking a tab fires onChange with that tab value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="one" onChange={onChange} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    await user.click(tabElements[1]!);
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('active tab has aria-selected="true", others have aria-selected="false"', () => {
    render(<Tabs tabs={tabs} value="two" onChange={() => {}} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    expect(tabElements[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabElements[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabElements[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('right arrow fires onChange with next tab value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="one" onChange={onChange} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    tabElements[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('left arrow on first tab wraps to last tab', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} value="one" onChange={onChange} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    tabElements[0]!.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('three');
  });

  it('Home key fires onChange with first enabled tab value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabsWithDisabled: TabItem[] = [
      { value: 'one', label: 'One', disabled: true },
      { value: 'two', label: 'Two' },
      { value: 'three', label: 'Three' },
    ];
    render(<Tabs tabs={tabsWithDisabled} value="three" onChange={onChange} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    tabElements[2]!.focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('End key fires onChange with last enabled tab value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const tabsWithDisabled: TabItem[] = [
      { value: 'one', label: 'One' },
      { value: 'two', label: 'Two' },
      { value: 'three', label: 'Three', disabled: true },
    ];
    render(<Tabs tabs={tabsWithDisabled} value="one" onChange={onChange} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    tabElements[0]!.focus();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('disabled tab has disabled attribute', () => {
    const tabsWithDisabled: TabItem[] = [
      { value: 'one', label: 'One' },
      { value: 'two', label: 'Two', disabled: true },
      { value: 'three', label: 'Three' },
    ];
    render(<Tabs tabs={tabsWithDisabled} value="one" onChange={() => {}} variant="pill" />);
    const tabElements = screen.getAllByRole('tab');
    expect(tabElements[1]).toBeDisabled();
  });
});

describe('TabPanel', () => {
  it('renders content with role="tabpanel" when value matches activeValue', () => {
    render(
      <TabPanel value="one" activeValue="one">
        <p>Panel content</p>
      </TabPanel>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Panel content');
  });

  it('does not render content when value does not match activeValue', () => {
    render(
      <TabPanel value="one" activeValue="two">
        <p>Panel content</p>
      </TabPanel>,
    );
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(screen.queryByText('Panel content')).not.toBeInTheDocument();
  });
});
