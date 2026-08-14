// Avoir Money desktop shell.
//
// The shell owns exactly two things: the lifetime of the backend process, and
// the window that talks to it. Everything else lives in `avoir-server`, which is
// a plain HTTP server with no Electron in it — so the whole backend is still
// testable with `cargo test`, no display server involved.
//
// # Why a sidecar and not a native module
//
// The backend stays a standalone binary, which is what lets the same process
// serve the app to a phone on the LAN. A napi module would be tidier at runtime
// and would end that.
//
// # Why Electron at all
//
// The previous shell was Tauri, which uses the *system* WebKitGTK. That made
// rendering depend on the host: on this machine the app would not start without
// disabling the DMABUF renderer, which meant it ran on software rasterisation,
// and the design system is OKLCH-only where WebKitGTK's colour management is
// weakest. Electron bundles a pinned Chromium — the same engine the design was
// built against — so what we test is what ships.

// ─────────────────────────────────────────────────────────────────────────────
// Survive a hostile environment before anything else runs.
//
// `ELECTRON_RUN_AS_NODE=1` makes the Electron binary behave as plain Node:
// `require('electron')` returns a PATH STRING instead of the module, so `app`
// is undefined and the process dies on the first property access. From the
// outside that is an icon bounce and no window — no error, no log, nothing to
// search for.
//
// This is not hypothetical and it is not rare. VS Code exports the variable
// into its integrated terminal, and anything started from that terminal
// inherits it — including, on 2026-08-10, a `kstart plasmashell`. Plasma then
// handed the variable to every application launched from the KDE menu, which
// broke this app, and would equally have broken Discord or VS Code itself. The
// app was fine; its environment was not.
//
// So the shell refuses to depend on the variable being unset. If it is set, we
// re-exec ourselves once with it removed and let the child be the real app. The
// `AVOIR_REEXEC` guard makes that exactly once — a loop here would be a fork
// bomb wearing an icon.
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.ELECTRON_RUN_AS_NODE && !process.env.AVOIR_REEXEC) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env, AVOIR_REEXEC: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  // `execPath` is the Electron binary itself. Re-running it with the variable
  // gone gives a normal Electron process, and the arguments are passed through
  // so a file association or a flag is not lost on the way.
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env,
    stdio: 'inherit',
  });
  process.exit(r.status ?? 0);
}

const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// If we are still running as Node here, the re-exec above did not take and
// every later line would fail on `app` being undefined. Say so, rather than
// exiting silently — a startup failure with no message is what made the
// original take an evening to find.
if (!app) {
  process.stderr.write(
    'Avoir Money cannot start: the Electron runtime is running as Node ' +
      '(ELECTRON_RUN_AS_NODE is set in this environment).\n',
  );
  process.exit(1);
}

/** Where the database lives. */
function dataDir() {
  // Deliberately NOT Electron's `userData`. That directory is Chromium's — it
  // fills with Cache, Cookies, GPUCache, blob_storage — and the database should
  // not live inside something whose contents are safe to delete.
  //
  // The path is also load-bearing for continuity: the Tauri build wrote to
  // `com.avoir.finance`, and that database has real financial history in it.
  // Changing the location here would silently start a brand new empty ledger
  // and look like data loss.
  //
  // It therefore stays `com.avoir.finance` even though the app is now called
  // Avoir Money and its appId is `com.avoir.money`. The mismatch is
  // deliberate and the trade is one-sided: renaming the directory buys
  // tidiness in a path nobody looks at, and costs a migration that can lose
  // a ledger if it half-succeeds. A stale-looking folder name is the
  // cheapest thing here by a wide margin.
  if (process.platform === 'linux') {
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'com.avoir.finance');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'com.avoir.finance');
  }
  return path.join(process.env.APPDATA || os.homedir(), 'com.avoir.finance');
}

/** The backend binary, dev tree or packaged. */
function serverBinary() {
  const exe = process.platform === 'win32' ? 'avoir-server.exe' : 'avoir-server';
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', exe);
  return path.join(__dirname, '..', 'rust', 'target', 'debug', exe);
}

/** The built frontend the backend serves. */
function webDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'web');
  return path.join(__dirname, '..', 'apps', 'web', 'dist');
}

/**
 * The window icon.
 *
 * Set explicitly, because the `.desktop` entry does NOT cover this. That file
 * gives the launcher its icon; the running window carries its own, and with no
 * `icon` here Electron falls back to a stock image — which is why the taskbar
 * showed something that had nothing to do with this app while the menu entry
 * was correct.
 *
 * On Wayland the match is by app id, so `setDesktopName` below has to agree
 * with the installed `.desktop` filename or the compositor cannot pair the
 * window with its entry at all.
 */
function iconPath() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, 'icons');
  return path.join(dir, '512x512.png');
}

// 256 bits of OS randomness, new every launch. A localhost port is reachable by
// any process on the machine and by any page the user has open in a browser; a
// cross-origin page can send a request but cannot read this token, so it cannot
// forge an authorised one.
const TOKEN = crypto.randomBytes(32).toString('hex');

let server = null;
let quitting = false;

/**
 * Start the backend and resolve once it reports its port.
 *
 * The port is chosen by the OS, not by us. A fixed port is how a desktop app
 * ends up refusing to start because something else already holds it — and on
 * this machine 5173/5174 belong to a different application entirely.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const bin = serverBinary();
    if (!fs.existsSync(bin)) {
      reject(new Error(`Backend not found at ${bin}`));
      return;
    }

    server = spawn(bin, [], {
      env: {
        ...process.env,
        AVOIR_DATA_DIR: dataDir(),
        AVOIR_WEB_DIR: webDir(),
        AVOIR_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let settled = false;

    server.stdout.on('data', (chunk) => {
      out += chunk.toString();
      const line = out.split('\n').find((l) => l.trim().startsWith('{'));
      if (!line || settled) return;
      try {
        const { port } = JSON.parse(line);
        if (port) {
          settled = true;
          resolve(port);
        }
      } catch {
        // Partial line; wait for the rest.
      }
    });

    // The backend's own diagnostics, not noise: a staged restore being applied
    // and a failed scheduled backup both report here, and both matter.
    server.stderr.on('data', (c) => process.stderr.write(`[backend] ${c}`));

    server.on('exit', (code, signal) => {
      server = null;
      if (settled || quitting) {
        // A backend that dies while the app is open leaves a window that can
        // load but cannot do anything. Failing loudly beats a UI where every
        // action times out.
        if (!quitting) {
          dialog.showErrorBox(
            'Avoir Money',
            `The backend stopped unexpectedly (${signal || `code ${code}`}).\n\nThe app will close.`,
          );
          app.quit();
        }
        return;
      }
      reject(new Error(`Backend exited before reporting a port (${signal || `code ${code}`})`));
    });

    server.on('error', reject);
  });
}

/** Stop the backend. Called on every path out of the app. */
function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  // SIGTERM lets it close the database cleanly. It is a local process we
  // spawned, so there is no case where it deserves to outlive the window.
  s.kill('SIGTERM');
  setTimeout(() => {
    try {
      s.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }, 3000).unref();
}

/**
 * Prove the backend answers an AUTHENTICATED request before showing a window.
 *
 * A window that loads but cannot read anything is the worst failure this app
 * has: every page renders its empty state, which is indistinguishable from a
 * genuinely empty database. That is precisely what a missing token produced —
 * silently, over a database with thousands of rows in it.
 *
 * So the check is deliberately end-to-end rather than a ping. It uses the same
 * token the renderer will use and asserts a 200, which means a 401 from a
 * mismatched token fails the launch loudly instead of looking like "no data".
 */
async function verifyBackend(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/accounts`, {
    headers: { Authorization: `Bearer ${process.env.AVOIR_TOKEN}` },
  });
  if (res.status === 401) {
    throw new Error(
      "The backend rejected the app's own credentials.\n\n" +
        'This is a bug in the shell, not a problem with your data.',
    );
  }
  if (!res.ok) {
    throw new Error(`The backend answered ${res.status} on startup.`);
  }
}

/**
 * The one channel between the shell and the window.
 *
 * The updater runs here, in the main process; the dot, the toast and the
 * updates page render over there. Until now the only thing crossing that line
 * was the backend auth token, so this is a new surface and worth being narrow:
 * three reads and two actions, no arbitrary access to anything.
 *
 * It does NOT reintroduce what ADR-036 removed. That decision took IPC out of
 * the API TRANSPORT so the browser and the desktop run identical client code —
 * and it stays true, because none of this is API traffic. It is shell state,
 * which a browser has no equivalent of at all; `window.__AVOIR__.updates` is
 * simply absent there, and the page renders a different, honest thing.
 *
 * Registered ONCE, and unconditionally. An install that cannot self-update
 * still answers — with `status: 'unsupported'` — because a handler that is
 * missing makes the renderer throw, and "this cannot update" is information the
 * page needs rather than an error.
 */
function registerUpdateBridge() {
  const updater = require('./updater.js');
  ipcMain.handle('updates:status', () => updater.status());
  ipcMain.handle('updates:history', () => updater.readHistory());
  ipcMain.handle('updates:check', async () => {
    // A MANUAL check, so a failure is reported rather than swallowed. The
    // renderer gets the message; the automatic loop keeps its silence.
    try {
      await updater.checkNow();
    } catch {
      // `checkNow` already recorded the failure in the state it returns; the
      // rejection is not re-thrown across IPC because an Error crossing that
      // boundary arrives as a string with a mangled stack, and the state is
      // the better answer.
    }
    return updater.status();
  });
  ipcMain.handle('updates:install', () => {
    updater.installNow();
  });
}

/**
 * The three buttons a frameless window has to provide for itself.
 *
 * Each acts on the window that ASKED — `BrowserWindow.fromWebContents(sender)` —
 * rather than on a window captured when the bridge was registered. With one
 * window today the two are the same; they stop being the same the moment a
 * second window exists, and at that point a captured reference means the child
 * window's close button closes the parent. Deriving it from the sender cannot
 * develop that bug.
 *
 * Registered BEFORE the window is created, for the reason given at the call
 * site: `ipcMain.handle` for an unregistered channel REJECTS rather than
 * waiting, so a renderer that asks during first paint would get an error on a
 * perfectly healthy install.
 */
function registerWindowBridge() {
  const asking = (event) => BrowserWindow.fromWebContents(event.sender);

  ipcMain.handle('window:minimize', (event) => {
    asking(event)?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = asking(event);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    // Answer with the resulting state so the caller never has to guess which
    // way the toggle went, and the button's glyph is right even if the
    // `maximize`/`unmaximize` event were somehow missed.
    return win.isMaximized();
  });

  ipcMain.handle('window:close', (event) => {
    asking(event)?.close();
  });

  ipcMain.handle('window:is-maximized', (event) => asking(event)?.isMaximized() ?? false);
}

/**
 * Keep the renderer's maximise/restore glyph honest.
 *
 * The button is not the only thing that maximises a window — a keyboard
 * shortcut, a titlebar double-click, tiling, or the compositor restoring a
 * session all do it without the app being asked. Pushing the state means the
 * glyph follows the window rather than following the last click on the button.
 */
function pipeWindowStateTo(win) {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send('window:maximize-changed', win.isMaximized());
  };
  win.on('maximize', send);
  win.on('unmaximize', send);
}

/** Push updater state at a window for as long as it lives. */
function pipeUpdatesTo(win) {
  const updater = require('./updater.js');
  const stop = updater.subscribe((s) => {
    if (!win.isDestroyed()) win.webContents.send('updates:changed', s);
  });
  win.on('closed', stop);
}

function createWindow(port) {
  const win = new BrowserWindow({
    icon: iconPath(),
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1b1a17',
    /*
     * No system title bar. The app draws its own, and owns the three buttons.
     *
     * The reason is not that KWin's bar is ugly — it is that there were TWO
     * bars. KWin drew one and `Layout.tsx` drew a second immediately below it,
     * so the window spent ~100px on chrome before any content. A frameless
     * window collapses that to one bar that is ours, themed with everything
     * else, and carrying the brand.
     *
     * What this makes the app responsible for, none of which the system does
     * for us any more: minimise, maximise/restore and close (`registerWindowBridge`
     * below), the drag region (`-webkit-app-region` in `title-bar.css.ts`), and
     * double-click-to-maximise. Chromium still draws the resize edges.
     */
    frame: false,
    /*
     * Square corners, explicitly.
     *
     * Electron 43 changed the default for frameless windows on Linux to rounded
     * wherever the desktop supports client-side decorations — KWin does — so
     * the upgrade that fixed the text-selection freeze also rounded the window
     * without anything here changing. Stated rather than left to the default,
     * because the default has now moved once and the title bar's own corners
     * are square: a rounded window clipping a square bar shows the mismatch
     * along the top edge, which is the one part of the chrome we draw.
     */
    roundedCorners: false,
    // Nothing is drawn until the first frame is ready, so the window never
    // appears as a white rectangle before the theme loads.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer is our own build served from localhost, but it is still
      // treated as untrusted: it gets the token and nothing else.
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  pipeWindowStateTo(win);
  pipeUpdatesTo(win);
  win.loadURL(`http://127.0.0.1:${port}/`);

  // A link to somewhere else is a link to the user's browser, not a second
  // window with no chrome and no way back.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// Wayland + NVIDIA. Baked into the binary, never asked of the user: the whole
// point of this move is that the app is a double-click, and an app that needs an
// environment variable to render properly is a terminal command wearing an icon.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  // Must match the installed `.desktop` filename (avoir-money.desktop).
  // Under Wayland this is how the compositor pairs a window with its launcher
  // entry — and therefore with its icon. Without it the window is unmatched and
  // shows whatever the shell picks as a fallback.
  app.setDesktopName('avoir-money.desktop');
}

// One instance. A second launch focuses the window that exists rather than
// starting a second backend against the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;

    // `focus()` alone is not enough, and the failure is invisible.
    //
    // Wayland compositors refuse focus requests from a process that is not
    // already the active one — focus-stealing prevention, and KDE enforces it.
    // So a second launch would quit (correctly, the lock is held) while the
    // existing window stayed exactly where it was, possibly on another virtual
    // desktop. Clicking the launcher did nothing observable, which reads as
    // "the app will not open" rather than "the app is already open".
    //
    // `show()` maps and raises it, which the compositor does honour, and the
    // brief always-on-top is what actually brings it forward when focus is
    // declined. Released immediately so the window does not become sticky.
    if (win.isMinimized()) win.restore();
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
    win.focus();
  });

  app.whenReady().then(async () => {
    try {
      const port = await startServer();

      // The preload reads these from OUR environment to hand to the renderer.
      // Setting AVOIR_TOKEN only in the spawn options above puts it in the
      // CHILD's environment and nowhere else — which is exactly the bug this
      // line fixes: the preload read `undefined`, the frontend fell back to its
      // development key, and every request came back 401. Nothing errored
      // loudly; the app simply rendered empty pages over a database with 2,546
      // transactions in it.
      process.env.AVOIR_TOKEN = TOKEN;
      process.env.AVOIR_PORT = String(port);

      await verifyBackend(port);
      // BEFORE the window, and the only part of this that is. Registering
      // handlers is synchronous and instant; the renderer starts asking as
      // soon as it loads, and an `ipcMain.handle` that is not yet registered
      // REJECTS rather than waiting. Doing this after `createWindow` leaves a
      // race whose losing side is an updates page showing an error on a
      // perfectly healthy install.
      registerUpdateBridge();
      // Same reasoning, and a worse losing side: the window has no system
      // title bar, so if these handlers are not up the three buttons the user
      // has instead of one are all dead and the window cannot be closed.
      registerWindowBridge();

      createWindow(port);

      // After the window, never before: an update check must not be able to
      // delay the app opening, and it has nothing to say until it has already
      // downloaded something.
      require('./updater.js').start({ dataDir: dataDir() });
    } catch (err) {
      dialog.showErrorBox('Avoir Money', `Could not start.\n\n${err.message}`);
      app.quit();
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
  stopServer();
});
// Belt and braces: `before-quit` does not run on every exit path, and an
// orphaned backend holding the database open is worse than no backend.
app.on('will-quit', stopServer);
process.on('exit', stopServer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
