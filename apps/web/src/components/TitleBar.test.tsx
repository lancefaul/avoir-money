/**
 * The title bar, and the window it is standing in for.
 *
 * Worth covering carefully despite being three buttons: the window is frameless,
 * so these are the ONLY way to minimise, maximise or close it. A regression here
 * is not a cosmetic one — it is a window the user cannot close without reaching
 * for a keyboard shortcut or a task manager.
 *
 * The assertions are on accessible names rather than on icons, because the icon
 * is the thing most likely to be swapped and the label is the contract. The one
 * exception is the maximise/restore pair, where the label IS the state being
 * tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TitleBar from './TitleBar.js';

interface Bridge {
  minimize: ReturnType<typeof vi.fn>;
  toggleMaximize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  onMaximizeChange: ReturnType<typeof vi.fn>;
}

/** The listener the hook subscribed with, so a test can push a change at it. */
let pushMaximized: ((m: boolean) => void) | undefined;
let unsubscribe: ReturnType<typeof vi.fn>;

function shell(startMaximized = false): Bridge {
  unsubscribe = vi.fn();
  const bridge: Bridge = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(!startMaximized),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(startMaximized),
    onMaximizeChange: vi.fn((fn: (m: boolean) => void) => {
      pushMaximized = fn;
      return unsubscribe;
    }),
  };
  (globalThis as { __AVOIR__?: unknown }).__AVOIR__ = { windowControls: bridge };
  return bridge;
}

afterEach(() => {
  delete (globalThis as { __AVOIR__?: unknown }).__AVOIR__;
  pushMaximized = undefined;
});

beforeEach(() => vi.clearAllMocks());

describe('TitleBar — without a shell', () => {
  it('draws nothing at all, rather than dead buttons', () => {
    // A browser tab has no window to minimise, and the browser is already
    // drawing its own chrome. Anything here would be decoration over controls
    // that cannot work.
    const { container } = render(<TitleBar />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('TitleBar — with a shell', () => {
  it('carries the brand and every window control', async () => {
    shell();
    render(<TitleBar />);

    expect(screen.getByText('Avoir Money')).toBeInTheDocument();
    for (const name of [/refresh/i, /minimise/i, /maximise/i, /close window/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('keeps close flush to the corner, with refresh at the far end', () => {
    // Order is muscle memory, not taste: close has to stay in the corner so it
    // can be hit by throwing the pointer at it without aiming, which is why
    // refresh was added on the left rather than beside it.
    shell();
    render(<TitleBar />);
    const labels = Array.from(document.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Refresh', 'Minimise', 'Maximise', 'Close window']);
  });

  it('refreshes without going through the shell bridge', async () => {
    // Reload is the one control that is NOT IPC: a page can already reload
    // itself, so a named channel for it would widen the preload surface and buy
    // nothing. This asserts the bridge stays uninvolved.
    const bridge = shell();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    render(<TitleBar />);

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(bridge.minimize).not.toHaveBeenCalled();
    expect(bridge.toggleMaximize).not.toHaveBeenCalled();
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it.each([
    ['minimise', /minimise/i, 'minimize'],
    ['close', /close window/i, 'close'],
  ] as const)('asks the shell to %s', async (_label, name, method) => {
    const bridge = shell();
    render(<TitleBar />);
    await userEvent.click(screen.getByRole('button', { name }));
    expect(bridge[method]).toHaveBeenCalledTimes(1);
  });

  it('reports the window it is standing on, not the last button pressed', async () => {
    // The initial read matters: a window restored from a maximised session
    // paints before any maximise event has had cause to fire, so without it the
    // button would claim "maximise" on an already-maximised window.
    shell(true);
    render(<TitleBar />);
    await waitFor(() => expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy());
  });

  it('follows a maximise the app did not cause', async () => {
    // A keyboard shortcut, a tiling shortcut or a double-click on the drag
    // region all maximise the window without this component being asked. The
    // pushed event is the only thing that keeps the glyph honest.
    shell(false);
    render(<TitleBar />);
    await waitFor(() => expect(screen.getByRole('button', { name: /maximise/i })).toBeTruthy());

    pushMaximized!(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy());
  });

  it('applies the resolved state too, in case no event arrives', async () => {
    // Belt and braces, and not redundant: whether a compositor emits `maximize`
    // varies by desktop, and a missing event would otherwise leave the glyph
    // pointing the wrong way with no other symptom.
    const bridge = shell(false);
    render(<TitleBar />);
    await waitFor(() => expect(screen.getByRole('button', { name: /maximise/i })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: /maximise/i }));
    expect(bridge.toggleMaximize).toHaveBeenCalledTimes(1);
    // Resolved `true`, and no event was pushed.
    await waitFor(() => expect(screen.getByRole('button', { name: /restore/i })).toBeTruthy());
  });

  it('unsubscribes on unmount, so a closed window stops being listened to', () => {
    shell();
    const { unmount } = render(<TitleBar />);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
