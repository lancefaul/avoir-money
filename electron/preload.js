// What the renderer learns from the shell.
//
// `contextIsolation` is on and `nodeIntegration` off, so the page cannot reach
// Node at all. This bridge is the entire surface, and it stays deliberately
// small: the per-launch bearer token, plus a narrow updates channel.
//
// The base URL is NOT passed. The page is served by the backend itself, so it is
// already same-origin with the API — a relative `/api/v1` resolves correctly,
// which is exactly what the browser build does. Keeping the two identical is
// what stops the desktop and the web app drifting apart.
//
// ── Why `updates` is here and is not API traffic ──
//
// ADR-036 removed IPC as the API transport precisely so the browser and the
// desktop run identical client code, and that is untouched: none of this is API
// traffic. The updater runs in the shell — it is the shell that owns the binary
// on disk — and the browser has no equivalent to expose. So `updates` is simply
// ABSENT in a browser, and the page checks for it and renders something honest
// instead of a button that cannot work.
//
// ── Why `windowControls` is here ──
//
// The window is frameless (`frame: false`), so minimise, maximise and close are
// the app's job. Those are shell operations on a native window and the renderer
// has no other way to reach them. Like `updates`, this is absent in a browser —
// a browser tab has no window to minimise — and the page checks before drawing
// a title bar that could not work.
//
// Named operations only. No general `invoke`, no channel name from the page: a
// compromised renderer can ask about updates and move its own window, and
// nothing else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__AVOIR__', {
  token: process.env.AVOIR_TOKEN,

  updates: {
    /** Current updater state — see `updater.js` for the status values. */
    status: () => ipcRenderer.invoke('updates:status'),

    /** Every update this installation has applied. Empty until one has. */
    history: () => ipcRenderer.invoke('updates:history'),

    /**
     * A MANUAL check, which is the one that reports its failures.
     *
     * The automatic loop stays silent on purpose — nagging about a failed
     * background check is what that silence exists to prevent. This one was
     * asked for, so it resolves with the resulting state including any error.
     */
    check: () => ipcRenderer.invoke('updates:check'),

    /**
     * Fetch an update that a check has already found.
     *
     * Deliberately not part of `check`: finding out whether an update exists
     * costs a request, and fetching it costs ~140 MB. Bundling them spends the
     * second on someone who only asked the first.
     */
    download: () => ipcRenderer.invoke('updates:download'),

    /** Restart into the downloaded update. Only meaningful at status `ready`. */
    install: () => ipcRenderer.invoke('updates:install'),

    /**
     * Subscribe to state changes. Returns an unsubscribe.
     *
     * The listener is wrapped rather than passed through, so the page never
     * receives the Electron `event` object — which carries `sender` and is a
     * reference back into the shell that nothing in the renderer should hold.
     */
    onChange: (fn) => {
      const handler = (_event, state) => fn(state);
      ipcRenderer.on('updates:changed', handler);
      return () => ipcRenderer.removeListener('updates:changed', handler);
    },
  },

  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),

    /** Maximise or restore, whichever applies. Resolves with the state after. */
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),

    close: () => ipcRenderer.invoke('window:close'),

    /** The state at first paint, before any event has had cause to fire. */
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

    /**
     * Subscribe to maximise/restore. Returns an unsubscribe.
     *
     * Needed because the button is not the only thing that maximises a window:
     * a keyboard shortcut, a double-click on the drag region, a tiling
     * shortcut, or a restored session all do it without the app being asked.
     *
     * Wrapped rather than passed through, for the same reason as `onChange`
     * above — the page never receives the Electron `event`, which carries
     * `sender` and is a reference back into the shell.
     */
    onMaximizeChange: (fn) => {
      const handler = (_event, maximized) => fn(maximized);
      ipcRenderer.on('window:maximize-changed', handler);
      return () => ipcRenderer.removeListener('window:maximize-changed', handler);
    },
  },
});
