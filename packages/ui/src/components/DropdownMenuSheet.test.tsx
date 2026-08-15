import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './DropdownMenu.js';

/**
 * Sheet mode (<540px): the menu is presented like a modal window — scrim,
 * bottom-anchored panel, an appended Cancel, and click-to-drill sub-menus that
 * replace the root page rather than flying out.
 *
 * The shared test setup stubs matchMedia at `matches: false`, so each test here
 * installs its own width-aware stub.
 */

function mockViewportWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      const m = /\(max-width:\s*([\d.]+)px\)/.exec(query);
      const max = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
      return {
        matches: width <= max,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
}

async function flushRAF() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
}

/** Wait out the 100ms closing animation before asserting the menu is gone. */
async function flushClose() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 150));
  });
}

/** A tx-style menu with one drill-down, mirroring the real actions menu. */
function TxMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger />
      <DropdownMenuContent>
        <DropdownMenuItem>Mark as paid</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Snooze</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>1 day</DropdownMenuItem>
            <DropdownMenuItem>2 days</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More options' }));
  await flushRAF();
}

describe('DropdownMenu — sheet mode below 540px', () => {
  beforeEach(() => {
    mockViewportWidth(400);
  });

  it('appends a Cancel item to the menu', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    expect(screen.getByText('Cancel')).toBeInTheDocument();
    // Cancel comes last, after the menu's own items.
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(items[items.length - 1]).toBe('Cancel');
  });

  it('renders a scrim behind the sheet', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    expect(document.querySelector('[data-dropdown-scrim]')).toBeInTheDocument();
  });

  it('Cancel closes the menu', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.click(screen.getByText('Cancel'));
    await flushClose();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does NOT open a sub-menu on hover', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.hover(screen.getByText('Snooze'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(screen.queryByText('1 day')).not.toBeInTheDocument();
  });

  it('clicking a sub-trigger drills in, replacing the root page', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.click(screen.getByText('Snooze'));
    await flushRAF();

    // Sub-menu items and a Back affordance are shown…
    expect(screen.getByText('1 day')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
    // …and the root page is hidden (kept mounted, so the drill survives).
    expect(screen.getByText('Delete')).not.toBeVisible();
  });

  it('pins Cancel outside the scrolling region on the root page', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    // A regular item scrolls…
    expect(
      screen.getByRole('menuitem', { name: 'Delete' }).closest('[data-sheet-scroll]'),
    ).not.toBeNull();
    // …but Cancel sits outside the scroll region, so it never scrolls away.
    expect(
      screen.getByRole('menuitem', { name: 'Cancel' }).closest('[data-sheet-scroll]'),
    ).toBeNull();
  });

  it('pins both Back and Cancel outside the scrolling region when drilled in', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.click(screen.getByText('Snooze'));
    await flushRAF();

    // The sub-menu's own items scroll…
    expect(
      screen.getByRole('menuitem', { name: '1 day' }).closest('[data-sheet-scroll]'),
    ).not.toBeNull();
    // …while both escapes stay pinned.
    expect(
      screen.getByRole('menuitem', { name: 'Back' }).closest('[data-sheet-scroll]'),
    ).toBeNull();
    expect(
      screen.getByRole('menuitem', { name: 'Cancel' }).closest('[data-sheet-scroll]'),
    ).toBeNull();
  });

  it('Back returns to the root page', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.click(screen.getByText('Snooze'));
    await flushRAF();
    await user.click(screen.getByText('Back'));
    await flushRAF();

    expect(screen.getByText('Delete')).toBeVisible();
    expect(screen.queryByText('1 day')).not.toBeInTheDocument();
  });

  it('keeps a Cancel escape inside a drilled sub-menu, which closes everything', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.click(screen.getByText('Snooze'));
    await flushRAF();

    // The drilled page carries its own Cancel. Queried by role, which follows
    // the accessibility tree and so excludes the hidden root page's copy.
    const cancel = screen.getByRole('menuitem', { name: 'Cancel' });

    await user.click(cancel);
    await flushClose();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('DropdownMenu — above 540px (regression guard)', () => {
  beforeEach(() => {
    mockViewportWidth(1280);
  });

  it('adds no Cancel item and no scrim', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(document.querySelector('[data-dropdown-scrim]')).not.toBeInTheDocument();
  });

  it('still opens sub-menus on hover', async () => {
    const user = userEvent.setup();
    render(<TxMenu />);
    await openMenu(user);

    await user.hover(screen.getByText('Snooze'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await flushRAF();

    expect(screen.getByText('1 day')).toBeInTheDocument();
  });
});

describe('DropdownMenuContent — sheetOnNarrow opt-out', () => {
  beforeEach(() => {
    mockViewportWidth(400);
  });

  it('stays anchored (no sheet chrome) when sheetOnNarrow is false', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent sheetOnNarrow={false}>
          <DropdownMenuItem>Suggestion</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await openMenu(user);

    expect(screen.getByText('Suggestion')).toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(document.querySelector('[data-dropdown-scrim]')).not.toBeInTheDocument();
  });
});
