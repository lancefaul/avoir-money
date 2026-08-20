// Keeping the app current.
//
// # Why this is not a feature
//
// The Tauri shell used the system WebKitGTK, so the OS patched the renderer.
// Electron bundles its own Chromium, which means **this project now owns
// Chromium's security updates**. An installed app that cannot update itself is
// a Chromium CVE with no remedy: the user has to notice, find a download, and
// reinstall by hand. That is why this sits in v0.9 beside the decision that
// created the obligation, rather than in v2.0 with entitlements and licences.
//
// # It must never be in the way
//
// The app is useful offline and must feel that way. Every failure here is
// logged and swallowed: no dialog for a failed check, no blocking on a
// download, nothing that turns "the network is down" into "the app is broken".
// The only thing the user is ever asked is whether to restart, and only once an
// update is already downloaded and verified.

const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** How long after launch the first check runs. */
const FIRST_CHECK_DELAY_MS = 30_000;

/** And how often after that, for a session left open for days. */
const RECHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Whether this installation is ours to replace.
 *
 * An AppImage is a single file the user owns, and electron-updater swaps it in
 * place. A distribution package is NOT: `/opt` belongs to pacman or dpkg, the
 * files are root-owned, and writing there behind the package manager's back
 * leaves it describing a version that is no longer installed. Those users get
 * updates from their package manager, which is the correct answer on Linux.
 *
 * `APPIMAGE` is set by the AppImage runtime itself, so this is a statement of
 * fact about how the app was started rather than a guess.
 */
function canSelfUpdate() {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return true;
}

/**
 * Numeric version compare. `a <= b`?
 *
 * String comparison is wrong here and quietly so: "0.9.9" sorts ABOVE "0.9.15"
 * lexically, which is exactly the range this project is in.
 */
function versionAtMost(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}

/**
 * Confirm every staged install this version proves happened.
 *
 * Running 0.9.15 means 0.9.14 installed, whatever its entry says — you cannot
 * arrive here otherwise. So ANY `pending-restart` whose target is at or below
 * the running version is settled, not just the newest one.
 *
 * Scanning the whole list rather than `history[0]` is the difference between a
 * fix and a heal. The first version of this looked only at the newest entry,
 * which left every record written by the old buggy build stuck at
 * "Restart to install" forever — a fix that corrects the future and abandons
 * the past. Same shape as the balance-chain NULL gap in ERRORS.md: a rule that
 * stops at bad data also stops REPAIR at bad data, so every stop-rule needs a
 * heal path beside it.
 *
 * An entry ABOVE the running version is left alone — that one is genuinely
 * still staged, and `autoInstallOnAppQuit` may yet apply it.
 */
function healHistory(current) {
  if (!historyPath || !current) return;
  const all = readHistory();
  let changed = false;
  const healed = all.map((e) => {
    if (e?.status === 'pending-restart' && e.to && versionAtMost(e.to, current)) {
      changed = true;
      return { ...e, status: 'installed' };
    }
    return e;
  });
  if (!changed) return;
  try {
    fs.writeFileSync(historyPath, JSON.stringify(healed.slice(0, 50), null, 2));
  } catch (err) {
    console.info?.(`[updater] could not heal history (ignored): ${err.message}`);
  }
}

/**
 * Start the update loop. Safe to call unconditionally.
 *
 * Returns without doing anything when updates cannot apply — a development run,
 * or a package-managed install — so the caller has no condition to get wrong.
 */
/**
 * What the UI is allowed to know.
 *
 * `status` is the whole state machine, deliberately flat so the renderer can
 * switch on one field:
 *
 *   unsupported  this install can never self-update (see `installKind`)
 *   idle         nothing has happened yet
 *   checking     a check is in flight
 *   current      the last check found nothing newer
 *   available    a newer version exists and is being fetched
 *   downloading  fetching, with `percent`
 *   ready        downloaded and verified; restarting is all that is left
 *   error        the last check or download failed, with `error`
 *
 * `error` is populated even though the AUTOMATIC path swallows failures,
 * because swallowing is about not interrupting — not about hiding. A user who
 * opens the updates page and asks is owed the answer, and "no update available"
 * is otherwise indistinguishable from "every check has failed for a month".
 */
const state = {
  status: 'idle',
  // NOT `app.getVersion()` at module scope: that requires an Electron runtime,
  // so evaluating it here makes the whole module unloadable — and therefore
  // untestable — outside one. Filled in by `start`.
  currentVersion: null,
  availableVersion: null,
  percent: 0,
  lastChecked: null,
  error: null,
  installKind: 'development',
};

/** Renderers listening for state changes, and the file history is appended to. */
const listeners = new Set();
let historyPath = null;
let lastCheckPath = null;

/**
 * How this copy was installed, which decides whether it can replace itself.
 *
 * The distinction is not cosmetic: an AppImage is a single file the user owns,
 * and a package install lives in `/opt` under pacman or dpkg where writing
 * behind the package manager leaves it describing a version that is not
 * installed. Those users update through their package manager, which is the
 * correct answer on Linux — so the UI has to say that rather than offer a
 * button that silently does nothing.
 */
function installKind() {
  if (!app.isPackaged) return 'development';
  if (process.platform !== 'linux') return 'appimage';
  return process.env.APPIMAGE ? 'appimage' : 'package';
}

/**
 * When the last check happened, persisted.
 *
 * `state` is module scope and dies with the process, so "Last checked" read
 * empty on every launch no matter how recently a check had run — the page
 * claimed nothing had ever happened. History was already on disk; this was the
 * one field that was not.
 *
 * Written in `emit` rather than at each call site because there are four of
 * them (two success paths, two error paths) and a fifth would forget.
 */
function writeLastChecked(iso) {
  if (!lastCheckPath) return;
  try {
    fs.writeFileSync(lastCheckPath, JSON.stringify({ lastChecked: iso }, null, 2));
  } catch (err) {
    console.info?.(`[updater] could not record last check (ignored): ${err.message}`);
  }
}

function readLastChecked() {
  if (!lastCheckPath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lastCheckPath, 'utf8'));
    return typeof parsed?.lastChecked === 'string' ? parsed.lastChecked : null;
  } catch {
    // Absent is the normal case on a first run.
    return null;
  }
}

function emit(patch) {
  Object.assign(state, patch);
  if (patch.lastChecked) writeLastChecked(patch.lastChecked);
  for (const send of listeners) {
    try {
      send({ ...state });
    } catch {
      // A renderer that has gone away is not an error worth propagating into
      // the updater, which must never fail loudly.
    }
  }
}

/** Subscribe a renderer. Returns an unsubscribe. */
function subscribe(send) {
  listeners.add(send);
  send({ ...state });
  return () => listeners.delete(send);
}

function status() {
  return { ...state };
}

/**
 * Every update this installation has applied.
 *
 * A JSON file in the data directory rather than a table: the updater runs in
 * the shell and the database belongs to the Rust backend, so recording history
 * in SQLite would mean a migration plus an API round-trip for something the
 * backend has no opinion about. The file sits beside the database so it travels
 * with the user's data.
 */
function readHistory() {
  if (!historyPath) return [];
  try {
    const raw = fs.readFileSync(historyPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Absent is the normal case — nothing has been installed yet. Corrupt is
    // treated the same way, because an unreadable history is not worth failing
    // an update over.
    return [];
  }
}

function appendHistory(entry) {
  if (!historyPath) return;
  try {
    const all = readHistory();
    all.unshift(entry);
    // Bounded: this is a curiosity, not an audit log, and an unbounded file
    // that only ever grows is a slow leak nobody looks at.
    fs.writeFileSync(historyPath, JSON.stringify(all.slice(0, 50), null, 2));
  } catch (err) {
    console.info?.(`[updater] could not record history (ignored): ${err.message}`);
  }
}

/**
 * Overwrite the most recent entry.
 *
 * Separate from `appendHistory`, which unshifts: confirming a staged install is
 * a correction to the record already there, not a second event. Appending would
 * leave the page showing "0.9.14 installed" directly above "0.9.14 downloaded —
 * restart to install", which reads as two updates and contradicts itself.
 */
function replaceLatestHistory(entry) {
  if (!historyPath) return;
  try {
    const all = readHistory();
    if (all.length === 0) return;
    all[0] = entry;
    fs.writeFileSync(historyPath, JSON.stringify(all.slice(0, 50), null, 2));
  } catch (err) {
    console.info?.(`[updater] could not record history (ignored): ${err.message}`);
  }
}

/**
 * Start the update loop. Safe to call unconditionally.
 *
 * `dataDir` is where history is kept. `log` is injectable for tests.
 */
function start({ dataDir, log = console, version } = {}) {
  if (dataDir) {
    historyPath = path.join(dataDir, 'update-history.json');
    lastCheckPath = path.join(dataDir, 'update-last-check.json');
  }
  // Restored before anything else so the page shows the real time even if this
  // launch never gets as far as a check.
  state.lastChecked = readLastChecked();
  state.currentVersion = version ?? app.getVersion();
  state.installKind = installKind();

  // An update that completed on the previous launch is recorded here rather
  // than at install time: `quitAndInstall` replaces the binary and exits, so
  // the only moment the NEW version can confirm it actually took is its own
  // startup.
  /*
   * The running version MATCHING the one that was staged is the proof it took.
   *
   * This read `last.to !== pending` until 2026-08-12, which is the opposite of
   * the sentence above and wrong in both directions: a successful update never
   * cleared, so the page said "Restart to install" about a version already
   * running; and a FAILED update — still on the old binary — was recorded as
   * `installed`, which is the dangerous half, since the one thing this record
   * exists to answer is whether the install happened.
   *
   * Found by running the update end-to-end (v1.0's last item) rather than by
   * any test: both halves are invisible until a real install completes.
   *
   * A mismatch is deliberately left alone. `autoInstallOnAppQuit` means a
   * staged update may still apply on the next quit, so the entry is still
   * genuinely pending rather than failed.
   */
  healHistory(state.currentVersion);

  if (!canSelfUpdate()) {
    log.info?.('[updater] not a self-updating install; skipping');
    emit({ status: 'unsupported' });
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    log.warn?.(`[updater] unavailable: ${err.message}`);
    emit({ status: 'unsupported' });
    return;
  }

  // The download is ours to trigger, not the library's: an update that arrives
  // unannounced and swaps the binary under a running app is a surprise, and the
  // app holds a database open.
  autoUpdater.autoDownload = false;
  // Applied on quit rather than forced, so an update never interrupts work in
  // progress.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('error', (err) => {
    // Offline, no release published, a DNS failure — none of these are the
    // user's problem and none of them get a dialog. They DO reach the updates
    // page, which is the difference between not interrupting and hiding.
    const message = err?.message ?? String(err);
    log.info?.(`[updater] check failed (ignored): ${message}`);
    emit({ status: 'error', error: message, lastChecked: new Date().toISOString() });
  });

  autoUpdater.on('update-available', (info) => {
    /*
     * Report, do not fetch.
     *
     * Downloading on discovery treats "is there an update?" as "install one",
     * which are different questions — it spends ~140 MB of someone's connection
     * on a decision they have not made, possibly on a tether. The download is
     * now an explicit action; `startDownload` below is what performs it.
     */
    log.info?.(`[updater] ${info.version} available`);
    emit({
      status: 'available',
      availableVersion: info.version,
      error: null,
      lastChecked: new Date().toISOString(),
    });
  });

  autoUpdater.on('download-progress', (p) => {
    emit({ status: 'downloading', percent: Math.round(p?.percent ?? 0) });
  });

  autoUpdater.on('update-not-available', () => {
    log.info?.('[updater] already current');
    emit({
      status: 'current',
      availableVersion: null,
      error: null,
      lastChecked: new Date().toISOString(),
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    emit({ status: 'ready', availableVersion: info.version, percent: 100 });
    appendHistory({
      from: state.currentVersion,
      to: info.version,
      at: new Date().toISOString(),
      status: 'pending-restart',
    });

    /*
     * Nothing is shown here on purpose.
     *
     * A native dialog seizes the window the moment a background download
     * finishes, which is never a moment the user chose — and it asks a question
     * the app can already ask in its own chrome. The title-bar mark turns
     * `ready` and Settings offers "Restart and install"; both wait for the user
     * rather than interrupting them.
     *
     * `autoInstallOnAppQuit` still applies it on the next ordinary quit, so
     * doing nothing at all here is not doing nothing overall.
     */
    log.info?.(`[updater] ${info.version} downloaded; waiting for the user`);
  });

  /**
   * A check.
   *
   * `manual` decides only what happens on FAILURE, and that is the whole rule:
   * an automatic check that fails is swallowed, because nagging about a
   * background failure is what the swallowing exists to prevent; a manual check
   * that fails reports, because the user asked and is owed an answer. The check
   * itself is identical.
   */
  const check = (manual = false) => {
    emit({ status: 'checking', error: manual ? null : state.error });
    return autoUpdater.checkForUpdates().catch((err) => {
      const message = err?.message ?? String(err);
      log.info?.(`[updater] check failed${manual ? '' : ' (ignored)'}: ${message}`);
      emit({ status: 'error', error: message, lastChecked: new Date().toISOString() });
      if (manual) throw err;
    });
  };

  checkNow = () => check(true);
  /**
   * Fetch the update the user has been told about.
   *
   * Separate from the check because they are separate decisions: one costs a
   * request, the other costs ~140 MB. `update-available` no longer downloads,
   * so nothing reaches the disk until this is called.
   */
  downloadNow = () => {
    emit({ status: 'downloading', percent: 0, error: null });
    return autoUpdater.downloadUpdate().catch((err) => {
      const message = err?.message ?? String(err);
      log.info?.(`[updater] download failed: ${message}`);
      emit({ status: 'error', error: message });
      throw err;
    });
  };
  installNow = () => autoUpdater.quitAndInstall();

  // Deliberately after a delay: launch is the one moment the app should be
  // doing nothing but opening.
  setTimeout(() => check(false), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => check(false), RECHECK_EVERY_MS).unref();
}

/**
 * Replaced by `start` once the updater is live.
 *
 * Defined as no-ops so the IPC handlers can be registered unconditionally and
 * the renderer never has to ask whether the updater came up — an install that
 * cannot self-update answers "unsupported" rather than throwing.
 */
let checkNow = async () => status();
let downloadNow = async () => status();
let installNow = () => {};

module.exports = {
  start,
  /** Test-only: drive `emit` directly, so the persistence funnel is reachable
   *  without an updater, a network or a real check. */
  __emitForTest: emit,
  canSelfUpdate,
  installKind,
  status,
  subscribe,
  readHistory,
  checkNow: (...a) => checkNow(...a),
  downloadNow: (...a) => downloadNow(...a),
  installNow: (...a) => installNow(...a),
};
