/**
 * Settings → Software Updates.
 *
 * # Layout follows the other settings panes, and did not at first
 *
 * `contentHeader` (pinned, `DisplayHeading size="sm"` plus a one-line subtitle)
 * over the scroll body — which is what `BackupSettings` and `ConnectedServices`
 * both do. The first version of this file invented its own wrapper and a
 * `size="lg"` heading, rendering a giant serif title nothing else in Settings
 * has. Written from imagination instead of from the pane next door, which is
 * the same mistake as inventing a response shape rather than reading the
 * schema.
 *
 * That lesson applied twice: the status message, the error block and the
 * history rows were all bespoke elements built here, when the app already has a
 * component for "a short message with a severity" (`Toast`, which carries
 * `flat`/`fullWidth` for exactly this) and a shape for "a list of past events"
 * (the backup history box). Both are now borrowed rather than re-drawn.
 *
 * # The three states, and why the least interesting one matters most
 *
 * How the app was installed decides whether it can replace itself:
 *
 *   appimage      a file the user owns; it can be replaced. Everything works.
 *   package       installed by pacman or dpkg into `/opt`, which belongs to the
 *                 package manager. Writing there behind it would leave it
 *                 describing a version that is not installed, so the app
 *                 refuses — correctly. These users update through their package
 *                 manager, and the pane hands them the command.
 *   no shell      opened in a browser or over the LAN. There is no updater at
 *                 all, because there is no binary here to update.
 *
 * The middle one is what the author's machine runs, which makes it the state
 * seen every day and the one worth getting right first.
 *
 * # Why a failure is visible here and nowhere else
 *
 * `updater.js` swallows every automatic failure so that a dead network never
 * reads as a broken app. That is about not interrupting, not about hiding —
 * and without somewhere to look, "no update available" is indistinguishable
 * from "every check has failed for a month". This is that somewhere.
 */

import { useRef, useState } from 'react';
import { RefreshCw, Loader2, Package, Globe, Copy, Check, Clock, Download } from 'lucide-react';
import {
  buttonStyles,
  badgeStyles,
  spinnerStyles,
  DisplayHeading,
  ProgressBar,
  Toast,
  IconButton,
} from '@budget-tracker/ui';
import type { ToastSeverity } from '@budget-tracker/ui';
import { vars } from '@budget-tracker/ui/theme/contract.css.js';
import { contentHeader } from '../../components/settings-modal.css.js';
import {
  consoleBlock,
  consoleLines,
  consoleLine,
  syntax,
  type SyntaxKind,
} from '../../components/console.css.js';
import { cn } from '../../lib/utils.js';
import { useToastStore } from '../../store/toast.js';
import { useUpdates } from '../../hooks/useUpdates.js';
import type { UpdateState } from '../../hooks/useUpdates.js';
import EmptyState from '../../components/EmptyState.js';
import * as s from './software-updates.css.js';

/** A timestamp as something a person reads, or a dash. */
function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface Notice {
  severity: ToastSeverity;
  title: string;
  description?: string;
}

/**
 * What the pane says about the current state, as a severity and a sentence.
 *
 * Every status that has something to report gets one, including the boring
 * ones: "you are up to date" has to be said out loud, because the alternative —
 * saying nothing — is exactly what a silent failure also looks like.
 *
 * `checking` returns null, and the caller holds the previous answer on screen
 * while it does. Two places describing one in-flight check is one more than the
 * fact deserves — the control that started it is the honest place to say so —
 * but blanking the sentence would ALSO throw away the last thing known, so a
 * check would clear the pane and then refill it. The status a check is about to
 * replace is the best available answer until it is replaced.
 */
function notice(state: UpdateState): Notice | null {
  switch (state.status) {
    case 'available':
      return {
        severity: 'info',
        title: `Version ${state.availableVersion} is available.`,
        description: 'Download it when you are ready. Nothing installs until you restart.',
      };
    case 'downloading':
      return { severity: 'info', title: `Downloading version ${state.availableVersion}…` };
    case 'ready':
      return {
        severity: 'success',
        title: `Version ${state.availableVersion} is ready.`,
        description: 'Restart to finish installing.',
      };
    case 'current':
      return { severity: 'success', title: 'You are running the latest version.' };
    case 'error':
      return {
        severity: 'error',
        title: 'The last check did not succeed.',
        /*
         * Verbatim. This is the only place any of it is visible — every
         * automatic failure is swallowed by design — so paraphrasing it into
         * something friendlier would remove the one piece of evidence a person
         * has.
         */
        description: state.error ?? undefined,
      };
    case 'checking':
      return null;
    default:
      return { severity: 'info', title: 'No check has run yet.' };
  }
}

/**
 * A `Toast` rendered in the page rather than floating over it.
 *
 * `flat` drops the shadow (an inline notice has no elevation) and `fullWidth`
 * releases the 22rem stack width that only exists to align a corner stack —
 * both props were added to the DS for this case.
 *
 * `customActions` is an empty fragment rather than omitted, which suppresses the
 * dismiss and expand buttons: this toast IS the pane's status, so a control that
 * removed it would leave the page saying nothing at all — the silence the pane
 * exists to break. With no expand button the description is always open, which
 * is what makes it safe to put the raw error there.
 */
function InlineNotice({ severity, title, description }: Notice) {
  return (
    <Toast
      id="update-status"
      severity={severity}
      title={title}
      description={description}
      variant="filled"
      flat
      fullWidth
      autoDismiss={false}
      customActions={<></>}
      onDismiss={() => {}}
    />
  );
}

/** The pinned header, present in all three states so the pane never jumps. */
function Header({ subtitle }: { subtitle: React.ReactNode }) {
  return (
    <div className={contentHeader}>
      <DisplayHeading size="sm" as="h1">
        Software Updates
      </DisplayHeading>
      {/* `base`, one token up from `sm` — the size help text is set at on the
          other settings panes. */}
      <p style={{ fontSize: vars.font.base, color: vars.color.textSecondary, margin: 0 }}>
        {subtitle}
      </p>
    </div>
  );
}

type Token = readonly [text: string, kind: SyntaxKind];

interface CommandBlockData {
  /** The `# …` lines above the command: who it is for, and how to paste it. */
  comments: readonly string[];
  parts: readonly Token[];
}

/**
 * How to paste, repeated in every block on purpose.
 *
 * It was its own third block, which made the page a list of three things where
 * only two are commands. Each block is now self-contained: whichever one a
 * person reads is the one carrying the warning, and neither has to be read in
 * order to make sense of the other. The repetition costs a line and removes a
 * block nobody can act on.
 */
const PASTE_NOTE = '# Ctrl+V does nothing here — paste with Ctrl+Shift+V or middle-click.';

/**
 * The commands a package-managed install actually needs.
 *
 * Both are offered because the shell cannot tell them apart: `installKind()`
 * returns `package` for any non-AppImage Linux and does not ask which package
 * manager put it there. Guessing would be worse than listing — a wrong command
 * fails with a confusing error, whereas two labelled ones cost a moment's
 * reading.
 *
 * Held as tokens rather than a string plus a highlighter, for two reasons. A
 * shell tokeniser good enough to be trusted is a real parser, and these are two
 * fixed strings. And the copied text is DERIVED from the same tokens that are
 * drawn, so what lands on the clipboard cannot drift from what is on screen —
 * the failure mode of every highlight-the-string approach, and a silent one,
 * since a wrong command looks exactly like a right one until it runs.
 */
const COMMANDS: readonly CommandBlockData[] = [
  {
    comments: ['# Arch, Manjaro, EndeavourOS', PASTE_NOTE],
    parts: [
      ['sudo', 'priv'],
      ['pacman', 'program'],
      ['-Syu', 'flag'],
      ['avoir-money', 'arg'],
    ],
  },
  {
    comments: ['# Debian, Ubuntu, Mint', PASTE_NOTE],
    parts: [
      ['sudo', 'priv'],
      ['apt', 'program'],
      ['update', 'sub'],
      ['&&', 'op'],
      ['sudo', 'priv'],
      ['apt', 'program'],
      ['install', 'sub'],
      ['--only-upgrade', 'flag'],
      ['avoir-money', 'arg'],
    ],
  },
];

/** The text a token list puts on the clipboard — the single source for both. */
const textOf = (parts: readonly Token[]): string => parts.map(([t]) => t).join(' ');

function CommandBlock({ comments, parts }: CommandBlockData) {
  const addToast = useToastStore((st) => st.addToast);
  const [copied, setCopied] = useState(false);
  const command = textOf(parts);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /*
       * The clipboard is refused without a secure context or a user-gesture the
       * browser believes in, and a copy button that silently does nothing is
       * worse than one that is absent — the command is on screen and can be
       * selected by hand, so say that rather than swallowing it.
       */
      addToast('error', 'Could not copy — select the command and copy it by hand.');
    }
  }

  return (
    <pre className={consoleBlock}>
      <div className={consoleLines}>
        {comments.map((line) => (
          <code key={line} className={cn(consoleLine, syntax.comment)}>
            {line}
          </code>
        ))}
        <code className={consoleLine}>
          {parts.map(([text, kind], i) => (
            <span key={`${text}-${i}`} className={syntax[kind]}>
              {i > 0 ? ' ' : ''}
              {text}
            </span>
          ))}
        </code>
      </div>
      {/*
       * Inside the block and outside the scrolling lines: `onDark` is the DS
       * variant for a control on a dark card, so no theme class has to be
       * borrowed to get it there — borrowing one is what put a phantom
       * scrollbar gutter inside a credit card (ERRORS.md).
       */}
      <IconButton
        icon={copied ? <Check size={14} /> : <Copy size={14} />}
        tooltip={copied ? 'Copied' : `Copy: ${command}`}
        size="sm"
        variant="onDark"
        onClick={() => void copy()}
      />
    </pre>
  );
}

export default function SoftwareUpdates() {
  const { supported, state, history, checking, check, download, install } = useUpdates();
  /*
   * The last thing the pane had to say, kept across a check.
   *
   * Declared here rather than beside its use further down, because three of the
   * four states return early and a hook after an early return is called in a
   * different order on different renders. It is only a container at this point;
   * what goes in it is decided below.
   */
  const held = useRef<Notice | null>(null);

  if (!state) {
    return (
      <>
        <Header subtitle="Keeping Avoir Money current." />
        <div className={s.scroll} />
      </>
    );
  }

  // ── No shell: a browser, or the LAN. Nothing here can update anything. ──
  if (!supported) {
    return (
      <>
        <Header subtitle="Keeping Avoir Money current." />
        <div className={s.scroll}>
          <div className={s.notice}>
            <div className={s.noticeHead}>
              <Globe size={16} aria-hidden />
              You are viewing this in a browser
            </div>
            <p className={s.muted}>
              Updates are handled by the desktop app, which is what owns the program files. Open
              Avoir Money on the machine it is installed on to check for updates.
            </p>
          </div>
        </div>
      </>
    );
  }

  // ── A package install: correct, permanent, and not a failure. ──
  if (state.installKind === 'package') {
    return (
      <>
        <Header subtitle={`Version ${state.currentVersion ?? '—'}`} />
        <div className={s.scroll}>
          <div className={s.body}>
            <div className={s.notice}>
              <div className={s.noticeHead}>
                <Package size={16} aria-hidden />
                Installed with your system package manager
              </div>
              <p className={s.muted}>
                Avoir Money will not update itself here, on purpose. The program files live in a
                system folder your package manager owns, and replacing them behind its back would
                leave it describing a version that is no longer installed. Update it the same way
                you update everything else on this machine.
              </p>
            </div>

            <div className={s.commandStack}>
              {COMMANDS.map((c) => (
                <CommandBlock key={c.comments[0]} {...c} />
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  /*
   * Written during render rather than in an effect: an effect runs after paint,
   * so the toast would blink out for a frame every time a check started, which
   * is the flicker this exists to prevent. The write is idempotent — the same
   * render always derives the same notice — so React's double-invoke under
   * StrictMode is harmless.
   */
  const fresh = notice(state);
  if (fresh) held.current = fresh;
  // Null only until the very first answer arrives, where there is genuinely
  // nothing to hold and the button already says a check is running.
  const status = fresh ?? held.current;

  // Both spellings of the same fact: `checking` is a manual check this pane
  // started, `status === 'checking'` is one the shell reports on its own.
  const busy = checking || state.status === 'checking';

  return (
    <>
      <Header
        subtitle={
          <>
            Version {state.currentVersion ?? '—'}
            <span className={s.bullet}>•</span>
            Last checked {when(state.lastChecked)}
          </>
        }
      />

      <div className={s.scroll}>
        <div className={s.body}>
          {status && <InlineNotice {...status} />}

          {state.status === 'downloading' && (
            <ProgressBar
              value={state.percent}
              variant="success"
              striped
              ariaLabel="Download progress"
              valueLabel={`${state.percent}%`}
            />
          )}

          <div className={s.actions}>
            <button
              type="button"
              className={cn(buttonStyles.btnBase, buttonStyles.btnMd, buttonStyles.btnSecondary)}
              onClick={() => void check()}
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={16} className={spinnerStyles.spinIcon} aria-hidden />
              ) : (
                <RefreshCw size={16} aria-hidden />
              )}
              {busy ? 'Checking…' : 'Check for updates'}
            </button>
            {state.status === 'available' && (
              <button
                type="button"
                className={cn(buttonStyles.btnBase, buttonStyles.btnMd, buttonStyles.btnPrimary)}
                onClick={() => void download()}
              >
                <Download size={16} aria-hidden />
                Download update
              </button>
            )}
            {state.status === 'ready' && (
              <button
                type="button"
                className={cn(buttonStyles.btnBase, buttonStyles.btnMd, buttonStyles.btnPrimary)}
                onClick={() => void install()}
              >
                Restart and install
              </button>
            )}
          </div>

          <div className={s.historySection}>
            <DisplayHeading size="sm" as="h1">
              Update history
            </DisplayHeading>
            {history.length === 0 ? (
              <EmptyState message="No updates yet — versions you install will be listed here." />
            ) : (
              <ul className={s.historyList}>
                {history.map((h) => {
                  const pending = h.status === 'pending-restart';
                  return (
                    <li key={`${h.at}-${h.to}`} className={s.historyItem}>
                      <span
                        className={cn(
                          badgeStyles.badge,
                          badgeStyles.badgeXl,
                          badgeStyles.badgeIconOnly,
                          pending ? badgeStyles.badgeWarning : badgeStyles.badgePositive,
                        )}
                      >
                        {pending ? <Clock size={16} /> : <Check size={16} />}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/*
                          The version it arrived AT, not the pair it moved
                          between. `from` is what the app was running before,
                          which the row above already says — a column of
                          `0.8.0 → 0.9.0` repeats every version twice and asks
                          the reader to follow a chain to learn one fact.
                        */}
                        <div className={s.historyPrimary}>
                          {pending ? `Version ${h.to} downloaded` : `Installed version ${h.to}`}
                        </div>
                        <div className={s.historySecondary}>
                          {when(h.at)}
                          {pending && ' · Restart to install'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
