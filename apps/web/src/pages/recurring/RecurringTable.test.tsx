/**
 * The row actions menu.
 *
 * Order is the point here, not just presence: the menu groups actions that
 * change the item, then the one that only looks at it, then the destructive
 * one. Delete sitting alone after a separator is what keeps it from being
 * clicked on the way to something else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecurringTable from './RecurringTable.js';
import type { RecurringItem } from './types.js';

beforeEach(() => {
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
});

const item = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'exp-1',
  type: 'expense',
  name: 'Mortgage',
  amount: 1051.24,
  frequency: 'MONTHLY',
  budgetId: 'cat-1',
  accountId: 'acct-1',
  pausedUntil: null,
  archivedAt: null,
  managementUrl: null,
  original: {} as RecurringItem['original'],
  ...over,
});

function renderTable(over: Partial<RecurringItem> = {}, isArchivedSection = false) {
  const handlers = {
    onEdit: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onRestore: vi.fn(),
    onSchedule: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <RecurringTable
      items={[item(over)]}
      isArchivedSection={isArchivedSection}
      narrow={false}
      nextDueMap={new Map()}
      categoryMap={new Map()}
      {...handlers}
    />,
  );
  return handlers;
}

/** Menu entries in DOM order. */
async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /actions/i }));
  return {
    user,
    labels: screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.trim() ?? '')
      .filter(Boolean),
  };
}

describe('RecurringTable — row actions order', () => {
  it('groups edits, then View Schedule, then Delete', async () => {
    renderTable();
    const { labels } = await openMenu();
    expect(labels).toEqual(['Edit', 'Pause', 'Archive', 'View Schedule', 'Delete']);
  });

  it('swaps Pause for Resume on a paused item, keeping the order', async () => {
    renderTable({ pausedUntil: '2026-12-31' });
    const { labels } = await openMenu();
    expect(labels).toEqual(['Edit', 'Resume', 'Archive', 'View Schedule', 'Delete']);
  });

  it('puts View Schedule after Archive, not before Edit', async () => {
    // The specific regression: it used to sit at the top, so a read-only action
    // led the menu and Delete shared a group boundary with Archive.
    renderTable();
    const { labels } = await openMenu();
    expect(labels.indexOf('View Schedule')).toBeGreaterThan(labels.indexOf('Archive'));
    expect(labels.indexOf('View Schedule')).toBeLessThan(labels.indexOf('Delete'));
  });

  it('still wires each entry to its handler', async () => {
    const handlers = renderTable();
    const { user } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'View Schedule' }));
    expect(handlers.onSchedule).toHaveBeenCalledTimes(1);
  });

  it('offers only Restore in the archived section', async () => {
    renderTable({}, true);
    const { labels } = await openMenu();
    expect(labels).toEqual(['Restore']);
  });
});
