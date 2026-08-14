import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from './DropdownMenu.js';

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

/* ── Tests ── */

describe('DropdownMenu', () => {
  it('clicking trigger makes content visible', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('clicking item fires onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Action</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    await user.click(screen.getByText('Action'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('Escape key closes menu', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // Wait for the closing animation timeout (100ms) to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('outside click closes menu', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <span data-testid="outside">Outside</span>
        <DropdownMenu>
          <DropdownMenuTrigger />
          <DropdownMenuContent>
            <DropdownMenuItem>Item 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByTestId('outside'));
    // Wait for the closing animation timeout (100ms) to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('separator renders with role="separator"', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Item 2</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('label text is visible', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuLabel>Group Label</DropdownMenuLabel>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    expect(screen.getByText('Group Label')).toBeInTheDocument();
  });

  it('checked={true} with checkStyle="check" shows check indicator', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem checked={true} checkStyle="check">
            Checked Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    const item = screen.getByRole('menuitemcheckbox', { name: 'Checked Item' });
    expect(item).toHaveAttribute('aria-checked', 'true');
    // The check indicator (Check icon from lucide-react) should be rendered as an SVG
    const svg = item.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('disabled={true} item does not fire onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger />
        <DropdownMenuContent>
          <DropdownMenuItem disabled onSelect={onSelect}>
            Disabled Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByRole('button', { name: 'More options' }));
    await flushRAF();

    await user.click(screen.getByText('Disabled Item'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
