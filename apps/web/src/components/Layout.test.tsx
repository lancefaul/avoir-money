import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUIStore } from '../store/ui.js';

// Mock matchMedia for responsive collapse detection
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

// Mock @tanstack/react-router with all exports Layout uses
vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">Page Content</div>,
  useRouterState: () => '/',
  useNavigate: () => vi.fn(),
}));

// Mock @budget-tracker/ui SideNav components
vi.mock('@budget-tracker/ui', () => ({
  // Items are exposed as testids rather than text: several nav labels
  // ("Dashboard") are also page titles, and rendering both would make
  // getByText ambiguous in the title tests.
  SideNav: ({ items }: any) => (
    <nav data-testid="sidebar">
      {items?.map((i: any) => <span key={i.value} data-testid={`nav-item-${i.value}`} />)}
    </nav>
  ),
  // Pass-through: masking is not what these tests are about, and a provider
  // that rendered nothing would silently drop the whole tree.
  MaskProvider: ({ children }: any) => <>{children}</>,
  SideNavLayout: ({ children }: any) => <div data-testid="sidenav-layout">{children}</div>,
  SideNavContent: ({ children }: any) => <div data-testid="sidenav-content">{children}</div>,
  Modal: ({ children, open }: any) => (open ? <div data-testid="modal">{children}</div> : null),
  DisplayHeading: ({ children }: any) => <h1>{children}</h1>,
  brandIconImage: 'mock-brand-icon-image',
}));

// Mock ToastContainer
vi.mock('./ToastContainer.js', () => ({ default: () => null }));

// Mock SettingsModal
vi.mock('./SettingsModal.js', () => ({ default: () => null }));

// Mock NotificationsDrawer
vi.mock('./NotificationsDrawer.js', () => ({ default: () => null }));

import Layout from './Layout.js';

describe('Layout', () => {
  beforeEach(() => {
    useUIStore.setState({
      sidebarOpen: true,
      pageTitle: '',
      sidebarCollapsed: false,
      theme: 'light',
    });
  });

  it('renders sidebar and outlet', () => {
    render(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders page title from store', () => {
    useUIStore.setState({ pageTitle: 'Dashboard' });
    render(<Layout />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('does not render title heading when pageTitle is empty', () => {
    useUIStore.setState({ pageTitle: '' });
    render(<Layout />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders correctly with sidebar collapsed', () => {
    useUIStore.setState({ sidebarCollapsed: true });
    render(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders correctly with sidebar expanded', () => {
    useUIStore.setState({ sidebarCollapsed: false });
    render(<Layout />);
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders the SideNavLayout structure', () => {
    render(<Layout />);
    expect(screen.getByTestId('sidenav-layout')).toBeInTheDocument();
    expect(screen.getByTestId('sidenav-content')).toBeInTheDocument();
  });

  it('renders page action from store', () => {
    useUIStore.setState({ pageAction: <button type="button">Action</button> });
    render(<Layout />);
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  describe('hidden destinations', () => {
    it('does not offer Notifications while the feature is on hold', () => {
      // The nav was advertising a feature that is not being built, so the only
      // way to discover that was to click it.
      render(<Layout />);
      expect(screen.queryByTestId('nav-item-/notifications')).not.toBeInTheDocument();
    });

    it('still offers every other destination', () => {
      // Guards the filter against over-matching — hiding one entry must not
      // quietly drop its neighbours.
      render(<Layout />);
      for (const value of [
        '/',
        '/transactions',
        '/recurring',
        '/accounts',
        '/budgets',
        '/debts',
        '/utilities',
        '/investments',
        '/healthcare',
        '/settings',
      ]) {
        expect(screen.getByTestId(`nav-item-${value}`)).toBeInTheDocument();
      }
    });
  });
});
