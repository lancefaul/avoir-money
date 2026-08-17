import { describe, it, expect, vi } from 'vitest';

// Mock all page components to avoid heavy rendering
vi.mock('./components/Layout.js', () => ({ default: () => <div>Layout</div> }));
vi.mock('./pages/Dashboard.js', () => ({ default: () => <div>Dashboard</div> }));
vi.mock('./pages/Recurring.js', () => ({ default: () => <div>Recurring</div> }));
vi.mock('./pages/Transactions.js', () => ({ default: () => <div>Transactions</div> }));
vi.mock('./pages/Accounts.js', () => ({ default: () => <div>Accounts</div> }));
vi.mock('./pages/Utilities.js', () => ({ default: () => <div>Utilities</div> }));
vi.mock('./pages/Healthcare.js', () => ({ default: () => <div>Healthcare</div> }));
vi.mock('./pages/Investments.js', () => ({ default: () => <div>Investments</div> }));
vi.mock('./pages/Budgets.js', () => ({ default: () => <div>Budgets</div> }));
vi.mock('./pages/Debts.js', () => ({ default: () => <div>Debts</div> }));

import { router } from './router.js';

describe('Router', () => {
  it('exports a router instance', () => {
    expect(router).toBeDefined();
    expect(router.routeTree).toBeDefined();
  });

  it('has a route tree with children', () => {
    const tree = router.routeTree;
    expect(tree).toBeDefined();
    // The root route should have children
    const children = (tree as any).children;
    expect(children).toBeDefined();
    expect(Object.keys(children).length).toBe(10);
  });

  it('contains all expected route paths', () => {
    const children = (router.routeTree as any).children;
    const paths = Object.values(children).map((r: any) => r.path);
    expect(paths).toContain('/');
    expect(paths).toContain('recurring');
    expect(paths).toContain('transactions');
    expect(paths).toContain('accounts');
    expect(paths).toContain('utilities');
    expect(paths).toContain('healthcare');
    expect(paths).toContain('investments');
    expect(paths).toContain('budgets');
    expect(paths).toContain('debts');
    expect(paths).toContain('settings');
  });
});
