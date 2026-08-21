import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideNav, SideNavLayout, SideNavContent } from './SideNav.js';
import type { NavItem } from './SideNav.js';

const items: NavItem[] = [
  { value: 'home', label: 'Home', icon: <span>H</span> },
  { value: 'dashboard', label: 'Dashboard', icon: <span>D</span> },
  { value: 'settings', label: 'Settings', icon: <span>S</span> },
];

describe('SideNav', () => {
  it('renders nav items with labels and aria-label="Main navigation" on container', () => {
    render(<SideNav items={items} value="home" onChange={() => {}} />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('clicking item fires onChange with item value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SideNav items={items} value="home" onChange={onChange} />);
    await user.click(screen.getByText('Dashboard'));
    expect(onChange).toHaveBeenCalledWith('dashboard');
  });

  it('collapsed={true} hides labels and renders icon-only buttons with tooltips', async () => {
    const user = userEvent.setup();
    render(<SideNav items={items} value="home" onChange={() => {}} collapsed={true} />);
    // Labels should not be visible in collapsed mode
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    // Icon-only buttons should be rendered
    const buttons = screen.getAllByRole('button');
    // Filter out the collapse button itself
    const navButtons = buttons.filter((b) => b.getAttribute('aria-label') !== 'Expand navigation');
    expect(navButtons.length).toBe(3);
    // Hovering should show tooltip with the label
    await user.hover(navButtons[0]!);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Home');
  });

  it('items with section values render section headers', () => {
    const sectionItems: NavItem[] = [
      { value: 'home', label: 'Home', icon: <span>H</span> },
      { value: 'users', label: 'Users', icon: <span>U</span>, section: 'Admin' },
      { value: 'settings', label: 'Settings', icon: <span>S</span>, section: 'Admin' },
    ];
    render(<SideNav items={sectionItems} value="home" onChange={() => {}} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('items with pinBottom={true} render in bottom section', () => {
    const pinItems: NavItem[] = [
      { value: 'home', label: 'Home', icon: <span>H</span> },
      { value: 'help', label: 'Help', icon: <span>?</span>, pinBottom: true },
    ];
    render(<SideNav items={pinItems} value="home" onChange={() => {}} />);
    // Both items should be rendered
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Help')).toBeInTheDocument();
    // The pinBottom item should be in a separate container from the main items
    const homeButton = screen.getByText('Home').closest('button')!;
    const helpButton = screen.getByText('Help').closest('button')!;
    // They should have different parent list containers (navList vs navBottom)
    const homeContainer = homeButton.closest('[role="list"]');
    const helpContainer = helpButton.closest('[role="list"]');
    expect(homeContainer).not.toBe(null);
    expect(helpContainer).not.toBe(null);
    // They should be in different list containers
    expect(homeContainer).not.toBe(helpContainer);
  });

  it('collapse button click fires onCollapsedChange with toggled state', async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    render(
      <SideNav
        items={items}
        value="home"
        onChange={() => {}}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      />,
    );
    const collapseBtn = screen.getByRole('button', { name: 'Collapse navigation' });
    await user.click(collapseBtn);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});

describe('SideNavLayout', () => {
  it('renders children in layout container', () => {
    render(
      <SideNavLayout>
        <div data-testid="layout-child">Layout content</div>
      </SideNavLayout>,
    );
    expect(screen.getByTestId('layout-child')).toBeInTheDocument();
    expect(screen.getByText('Layout content')).toBeInTheDocument();
  });
});

describe('SideNavContent', () => {
  it('renders children in content container', () => {
    render(
      <SideNavContent>
        <div data-testid="content-child">Content area</div>
      </SideNavContent>,
    );
    expect(screen.getByTestId('content-child')).toBeInTheDocument();
    expect(screen.getByText('Content area')).toBeInTheDocument();
  });
});
