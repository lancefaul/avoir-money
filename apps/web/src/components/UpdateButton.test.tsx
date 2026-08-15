/**
 * The update mark in the title bar.
 *
 * ADR-039 built the update mechanism and left the in-app surface out: the only
 * thing an update ever showed was a native dialog once the download was already
 * on disk. So an update could be found, downloaded and waiting with the window
 * showing nothing. This is the missing half, and the properties worth pinning
 * are about RESTRAINT as much as visibility — it must be absent when there is
 * nothing to say, and it must not restart the app without asking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

const install = vi.fn().mockResolvedValue(undefined);
let updateState: Record<string, unknown> | null = null;
vi.mock('../hooks/useUpdates.js', () => ({
  useUpdates: () => ({ state: updateState, install }),
}));

const UpdateButton = (await import('./UpdateButton.js')).default;

function withStatus(status: string, over: Record<string, unknown> = {}) {
  updateState = { status, availableVersion: '1.0.5', percent: 0, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateState = null;
});

describe('UpdateButton', () => {
  it.each(['current', 'error', 'unsupported', 'checking'])(
    'renders nothing at status %s',
    (status) => {
      // Absent, not disabled. A permanently greyed control in window chrome is
      // a standing question the user cannot answer.
      withStatus(status);
      const { container } = render(<UpdateButton />);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it('renders nothing before the updater has reported anything', () => {
    updateState = null;
    const { container } = render(<UpdateButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['available', 'downloading', 'ready'])('appears at status %s', (status) => {
    withStatus(status);
    render(<UpdateButton />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('names the version and what a click will do', () => {
    // The tooltip and the accessible name carry the state. Its neighbours have
    // no tooltip on purpose — their meaning is universal and this one's is not.
    withStatus('available');
    render(<UpdateButton />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/1\.0\.5.*available.*details/i);
  });

  it('reports progress while downloading', () => {
    withStatus('downloading', { percent: 42 });
    render(<UpdateButton />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/downloading.*1\.0\.5.*42%/i);
  });

  it('opens the Software Updates pane rather than acting, before it is ready', async () => {
    withStatus('available');
    render(<UpdateButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { tab: 'software-updates' },
    });
    expect(install).not.toHaveBeenCalled();
  });

  it('does NOT restart on the first click when ready — it asks', async () => {
    // The property that matters most. The main process asks before restarting
    // when it initiates; a title-bar click that skipped the question would be
    // the one path into a surprise quit.
    withStatus('ready');
    render(<UpdateButton />);
    await userEvent.click(screen.getByRole('button'));
    expect(install).not.toHaveBeenCalled();
    expect(screen.getByText(/restart to install/i)).toBeInTheDocument();
  });

  it('restarts once confirmed', async () => {
    withStatus('ready');
    render(<UpdateButton />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: /restart now/i }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('does not restart if the confirmation is declined', async () => {
    withStatus('ready');
    render(<UpdateButton />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(install).not.toHaveBeenCalled();
  });

  it('survives a missing version rather than printing "undefined"', () => {
    // `availableVersion` is nullable on the wire.
    withStatus('ready', { availableVersion: null });
    render(<UpdateButton />);
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toMatch(/undefined|null/);
  });
});
