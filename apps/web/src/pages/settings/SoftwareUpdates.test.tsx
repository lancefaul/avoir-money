/**
 * The pane's states, each of which is otherwise unreachable without publishing
 * a real release.
 *
 * These assert what a person can SEE, not which component drew it — the point
 * of moving the status to `Toast` and the history to the backup box was that
 * the pane stops inventing its own elements, and a test naming those elements
 * would have to be rewritten the next time it borrows one. So: the sentence,
 * the raw error, the command, the row.
 *
 * The one exception is the check button's busy state, which is asserted through
 * `disabled` rather than the spinner glyph — a spinner is styling and could be
 * swapped, whereas "you cannot start a second check while one is running" is the
 * behaviour the loading state exists to express.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UpdateState, UpdateHistoryEntry, UseUpdates } from '../../hooks/useUpdates.js';

const mockUseUpdates = vi.fn();
vi.mock('../../hooks/useUpdates.js', () => ({ useUpdates: () => mockUseUpdates() }));

import SoftwareUpdates from './SoftwareUpdates.js';

const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  status: 'current',
  currentVersion: '0.9.11',
  availableVersion: null,
  percent: 0,
  lastChecked: '2026-08-11T18:00:00.000Z',
  error: null,
  installKind: 'appimage',
  ...over,
});

function show(over: Partial<UseUpdates> = {}) {
  mockUseUpdates.mockReturnValue({
    supported: true,
    state: state(),
    history: [] as UpdateHistoryEntry[],
    checking: false,
    check: vi.fn(),
    install: vi.fn(),
    ...over,
  });
  return render(<SoftwareUpdates />);
}

beforeEach(() => vi.clearAllMocks());

describe('SoftwareUpdates — what each state says', () => {
  it('names the available version, and says nothing installs unasked', () => {
    show({ state: state({ status: 'available', availableVersion: '0.10.0' }) });
    expect(screen.getByText('Version 0.10.0 is available.')).toBeInTheDocument();
    expect(screen.getByText(/nothing installs until you restart/i)).toBeInTheDocument();
  });

  it('confirms out loud when there is nothing to do', () => {
    // Silence is what a month of failed checks also looks like, so the boring
    // state has to be stated rather than implied by an empty pane.
    show();
    expect(screen.getByText('You are running the latest version.')).toBeInTheDocument();
  });

  it('shows the failure verbatim, because this is the only place it appears', () => {
    const err = 'HttpError: 404 Not Found — "latest-linux.yml" is missing from the release';
    show({ state: state({ status: 'error', error: err }) });
    expect(screen.getByText('The last check did not succeed.')).toBeInTheDocument();
    expect(screen.getByText(err)).toBeInTheDocument();
  });

  it('offers the restart only once something is downloaded', () => {
    show({ state: state({ status: 'available', availableVersion: '0.10.0' }) });
    expect(screen.queryByRole('button', { name: /restart and install/i })).toBeNull();

    show({ state: state({ status: 'ready', availableVersion: '0.10.0' }) });
    expect(screen.getByRole('button', { name: /restart and install/i })).toBeInTheDocument();
  });
});

describe('SoftwareUpdates — a check in flight', () => {
  /*
   * Two spellings of one fact, and both have to reach the button: `checking` is
   * a manual check this pane started, `status: 'checking'` is one the shell
   * reports on its own. An earlier version only honoured the first, so the
   * shell's own check left the pane looking idle.
   */
  it.each([
    ['a check this pane started', { checking: true }],
    ['a check the shell reports', { state: state({ status: 'checking' }) }],
  ])('refuses a second check during %s', (_label, over) => {
    show(over as Partial<UseUpdates>);
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
  });

  it('leaves the status to the button rather than saying it twice', () => {
    show({ state: state({ status: 'checking' }) });
    // The button says "Checking…"; no second sentence repeats it above.
    expect(screen.queryByText(/checking for updates/i)).toBeNull();
  });

  it('holds the last answer on screen until a new one replaces it', () => {
    // Blanking it would clear the pane and refill it a moment later. What was
    // true before the check is the best available answer until the check says
    // otherwise.
    mockUseUpdates.mockReturnValue({
      supported: true,
      state: state({ status: 'available', availableVersion: '0.10.0' }),
      history: [],
      checking: false,
      check: vi.fn(),
      install: vi.fn(),
    });
    const { rerender } = render(<SoftwareUpdates />);
    expect(screen.getByText('Version 0.10.0 is available.')).toBeInTheDocument();

    mockUseUpdates.mockReturnValue({
      supported: true,
      state: state({ status: 'checking' }),
      history: [],
      checking: true,
      check: vi.fn(),
      install: vi.fn(),
    });
    rerender(<SoftwareUpdates />);
    expect(screen.getByText('Version 0.10.0 is available.')).toBeInTheDocument();

    // …and it IS replaced once the check answers.
    mockUseUpdates.mockReturnValue({
      supported: true,
      state: state({ status: 'current' }),
      history: [],
      checking: false,
      check: vi.fn(),
      install: vi.fn(),
    });
    rerender(<SoftwareUpdates />);
    expect(screen.getByText('You are running the latest version.')).toBeInTheDocument();
    expect(screen.queryByText('Version 0.10.0 is available.')).toBeNull();
  });

  it('says nothing when a check is the first thing that has ever happened', () => {
    // Nothing to hold. The button is already saying a check is running.
    show({ state: state({ status: 'checking', lastChecked: null }) });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SoftwareUpdates — a package install', () => {
  const packaged = { state: state({ installKind: 'package' }) };
  /** pacman and apt. Named so the duplication assertion below reads as intent. */
  const COMMAND_BLOCKS = 2;

  /**
   * Read back what the highlighted spans actually spell.
   *
   * The command is drawn as one coloured span per token, so a plain text query
   * cannot see it — and that is exactly the risk worth testing. Highlighting is
   * where a rendered command silently stops matching the real one: a dropped
   * separator or a mis-ordered token still looks like a command.
   */
  const rendered = (): string[] =>
    Array.from(document.querySelectorAll('code'))
      .map((c) => c.textContent ?? '')
      .filter((t) => !t.startsWith('#'));

  it('hands over both commands, because the shell cannot tell which applies', () => {
    // `installKind()` returns `package` for any non-AppImage Linux and never
    // asks which package manager put it there, so guessing one would fail
    // confusingly on the other.
    show(packaged);
    expect(rendered()).toEqual([
      'sudo pacman -Syu avoir-money',
      'sudo apt update && sudo apt install --only-upgrade avoir-money',
    ]);
  });

  it('labels each command with who it is for, as a comment above it', () => {
    show(packaged);
    expect(screen.getByText('# Arch, Manjaro, EndeavourOS')).toBeInTheDocument();
    expect(screen.getByText('# Debian, Ubuntu, Mint')).toBeInTheDocument();
  });

  it('repeats the paste warning in every block rather than in one of its own', () => {
    // Deliberate duplication: each block is self-contained, so whichever one a
    // person reads carries the warning. A separate note block would be a third
    // item in a list of two commands, and the only one nobody can act on.
    show(packaged);
    expect(screen.getAllByText(/Ctrl\+Shift\+V/)).toHaveLength(COMMAND_BLOCKS);
  });

  it('copies exactly the command that is on screen', async () => {
    // The clipboard text and the highlighted spans are derived from one token
    // list, and this is what holds them together: a command that copies as
    // something other than what it shows is wrong in the worst way, because it
    // only reveals itself when the wrong thing runs.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    show(packaged);

    const onScreen = rendered()[0]!;
    await userEvent.click(screen.getByRole('button', { name: `Copy: ${onScreen}` }));
    expect(writeText).toHaveBeenCalledWith(onScreen);
    expect(onScreen).toBe('sudo pacman -Syu avoir-money');
  });

  it('never offers to check, because the answer could not be acted on', () => {
    show(packaged);
    expect(screen.queryByRole('button', { name: /check for updates/i })).toBeNull();
  });
});

describe('SoftwareUpdates — history', () => {
  it('names the version each row arrived at, newest first', () => {
    // Not the `from → to` pair it used to show: `from` is the row below's `to`,
    // so a column of pairs prints every version twice and makes the reader
    // follow a chain to learn one fact.
    show({
      history: [
        { from: '0.9.0', to: '0.9.11', at: '2026-08-10T12:00:00.000Z', status: 'installed' },
        { from: '0.8.0', to: '0.9.0', at: '2026-07-01T12:00:00.000Z', status: 'installed' },
      ],
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Installed version 0.9.11');
    expect(rows[1]).toHaveTextContent('Installed version 0.9.0');
    expect(rows[0]).not.toHaveTextContent('→');
  });

  it('does not claim an upgrade is installed while it is waiting for a restart', () => {
    show({
      history: [
        { from: '0.9.11', to: '0.10.0', at: '2026-08-11T12:00:00.000Z', status: 'pending-restart' },
      ],
    });
    expect(screen.getByText('Version 0.10.0 downloaded')).toBeInTheDocument();
    expect(screen.queryByText(/installed version/i)).toBeNull();
    expect(screen.getByText(/restart to install/i)).toBeInTheDocument();
  });

  it('says the list is empty rather than showing an empty box', () => {
    show({ history: [] });
    expect(screen.getByText(/no updates yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

describe('SoftwareUpdates — no shell at all', () => {
  it('distinguishes a browser from an install that cannot update itself', () => {
    // Two states that look alike and mean different things: here there is no
    // updater, there the updater exists and has refused. Different words.
    show({ supported: false, state: state({ installKind: 'development' }) });
    expect(screen.getByText(/viewing this in a browser/i)).toBeInTheDocument();
    expect(screen.queryByText(/package manager/i)).toBeNull();
  });
});
