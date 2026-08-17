/**
 * The updater's history reconciliation.
 *
 * This is the one piece of updater logic that CANNOT be observed without a real
 * install completing: `quitAndInstall` replaces the binary and exits, so the
 * only moment the new version can confirm it took is its own startup. That is
 * exactly why it shipped inverted and stayed that way — the condition read
 * `last.to !== pending`, the opposite of its own comment, and nothing in CI
 * ever ran a second launch to notice.
 *
 * Found on 2026-08-12 by running the update end-to-end: the page said
 * "Restart to install" about a version that was already running.
 *
 * Runs under plain node — `require('electron')` resolves to a path string
 * outside Electron, so `{ app, dialog }` destructure to undefined without
 * throwing, and `start()` takes an injectable version, dataDir and log. With no
 * APPIMAGE in the environment `canSelfUpdate()` is false, so `start` returns
 * right after the reconciliation, which is the code under test.
 *
 *   node --test electron/updater.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/*
 * Electron is stubbed rather than the production code being softened.
 * `installKind()` reads `app.isPackaged`, which does not exist outside Electron
 * — and guarding that in `updater.js` would hide a genuinely missing `app` in
 * the real shell. Seeding `require.cache` gives the module the two objects it
 * destructures at load time and nothing else.
 *
 * `isPackaged: true` with no APPIMAGE in the environment makes this a "package"
 * install, so `canSelfUpdate()` is false and `start()` returns immediately
 * after the reconciliation — which is precisely the code under test, reached
 * without an updater, a network, or a dialog.
 */
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: { app: { isPackaged: true, getVersion: () => '0.0.0' }, dialog: {} },
};

const silent = { info() {}, warn() {} };

/** A fresh data dir with a seeded history, and a fresh module instance. */
function withHistory(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avoir-updater-'));
  fs.writeFileSync(path.join(dir, 'update-history.json'), JSON.stringify(entries, null, 2));
  // Fresh instance per test: the module keeps `historyPath` in module scope.
  delete require.cache[require.resolve('./updater.js')];
  const updater = require('./updater.js');
  return { dir, updater };
}

const staged = {
  from: '0.9.13',
  to: '0.9.14',
  at: '2026-08-12T20:24:00.000Z',
  status: 'pending-restart',
};

test('a completed install is confirmed on the next launch', () => {
  const { dir, updater } = withHistory([staged]);
  // The new binary is running: its version matches what was staged.
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });

  const history = updater.readHistory();
  assert.equal(history[0].status, 'installed', 'the staged entry should be confirmed');
  assert.equal(history[0].to, '0.9.14');
});

test('confirming replaces the entry rather than adding a second one', () => {
  // Appending would render as "0.9.14 installed" above "0.9.14 downloaded —
  // restart to install": two updates, contradicting each other.
  const { dir, updater } = withHistory([staged]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });

  const history = updater.readHistory();
  assert.equal(history.length, 1, `expected one entry, got ${history.length}`);
});

test('an install that did NOT take is left pending, never marked installed', () => {
  // The dangerous half of the old bug. Still on the old binary, so the update
  // did not apply — and `autoInstallOnAppQuit` means it may yet apply on the
  // next quit, so the entry is genuinely still pending rather than failed.
  const { dir, updater } = withHistory([staged]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.13' });

  const history = updater.readHistory();
  assert.equal(history[0].status, 'pending-restart', 'a failed install must not read as installed');
  assert.equal(history.length, 1);
});

test('an already-confirmed entry is not touched again', () => {
  const done = { ...staged, status: 'installed' };
  const { dir, updater } = withHistory([done]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });

  const history = updater.readHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].at, done.at, 'the timestamp should not be rewritten');
});

test('an empty history is fine', () => {
  const { dir, updater } = withHistory([]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });
  assert.deepEqual(updater.readHistory(), []);
});

/**
 * "Last checked" surviving a restart.
 *
 * `state` is module scope and dies with the process, so this field read empty
 * on every launch however recently a check had run — the page said no check had
 * ever happened. Reported 2026-08-12, after the update pipeline was already
 * proven working.
 */
test('the last check time survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avoir-updater-'));
  fs.writeFileSync(
    path.join(dir, 'update-last-check.json'),
    JSON.stringify({ lastChecked: '2026-08-12T20:24:00.000Z' }),
  );
  delete require.cache[require.resolve('./updater.js')];
  const updater = require('./updater.js');

  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });
  assert.equal(updater.status().lastChecked, '2026-08-12T20:24:00.000Z');
});

test('a check writes the time to disk, not only to memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avoir-updater-'));
  delete require.cache[require.resolve('./updater.js')];
  const updater = require('./updater.js');
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });

  // Reaches `emit` the same way every check path does — that is the point of
  // persisting there rather than at the four call sites.
  updater.__emitForTest({ status: 'idle', lastChecked: '2026-08-12T21:00:00.000Z' });

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'update-last-check.json'), 'utf8'));
  assert.equal(onDisk.lastChecked, '2026-08-12T21:00:00.000Z');
});

test('a first run with no file is not an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avoir-updater-'));
  delete require.cache[require.resolve('./updater.js')];
  const updater = require('./updater.js');
  updater.start({ dataDir: dir, log: silent, version: '0.9.14' });
  assert.equal(updater.status().lastChecked, null);
});

/**
 * Healing entries the OLD build left behind.
 *
 * The first fix looked only at `history[0]`, so every record written by the
 * buggy build stayed at "Restart to install" forever — visible in production on
 * 2026-08-12 as a 0.9.14 entry still nagging while 0.9.15 was running.
 */
test('older stuck entries are healed too, not just the newest', () => {
  const { dir, updater } = withHistory([
    { from: '0.9.14', to: '0.9.15', at: 'b', status: 'installed' },
    { from: '0.9.13', to: '0.9.14', at: 'a', status: 'pending-restart' },
  ]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.15' });

  const h = updater.readHistory();
  assert.equal(h.length, 2, 'healing must not add entries');
  assert.equal(h[1].status, 'installed', 'the older stuck entry should be settled');
});

test('an entry above the running version stays pending', () => {
  // Genuinely staged: autoInstallOnAppQuit may still apply it.
  const { dir, updater } = withHistory([
    { from: '0.9.15', to: '0.9.16', at: 'c', status: 'pending-restart' },
  ]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.15' });
  assert.equal(updater.readHistory()[0].status, 'pending-restart');
});

test('versions compare numerically, not as strings', () => {
  // "0.9.9" sorts ABOVE "0.9.15" lexically — the exact range this project is
  // in, so a string compare would leave 0.9.15 stuck while running 0.9.9.
  const { dir, updater } = withHistory([
    { from: '0.9.8', to: '0.9.9', at: 'd', status: 'pending-restart' },
  ]);
  updater.start({ dataDir: dir, log: silent, version: '0.9.15' });
  assert.equal(updater.readHistory()[0].status, 'installed');
});

/*
 * The download action, asserted against the SOURCE rather than a stub.
 *
 * `start()` returns early for a package install — which is what makes the rest
 * of this file runnable without Electron — so the `update-available` handler is
 * never registered here and cannot be invoked. The first version of these tests
 * worked around that by registering a handler in the test and then asserting on
 * it, which measured nothing but itself.
 *
 * Reading the source is weaker than exercising it, and it is TRUE, which the
 * alternative was not. Each assertion below was checked by reverting the change
 * it guards and confirming it fails.
 */
const SRC = fs.readFileSync(new URL('./updater.js', import.meta.url), 'utf8');

/** The body of a named `autoUpdater.on(...)` handler. */
function handlerBody(event) {
  const start = SRC.indexOf(`autoUpdater.on('${event}'`);
  assert.notEqual(start, -1, `no handler registered for ${event}`);
  const next = SRC.indexOf('autoUpdater.on(', start + 10);
  return SRC.slice(start, next === -1 ? SRC.length : next);
}

test('finding an update reports it and does not fetch it', () => {
  // Downloading on discovery answers "install one" when the user asked "is
  // there one?" — different questions, and the second costs ~140 MB.
  assert.ok(
    !handlerBody('update-available').includes('downloadUpdate'),
    'update-available must not start a download',
  );
  assert.ok(SRC.includes('autoUpdater.autoDownload = false'), 'auto-download must stay off');
});

test('downloadNow exists and reaches downloadUpdate', () => {
  // The other direction. Without this, "does not download" is satisfied by a
  // feature that can never download at all.
  const fn = SRC.slice(SRC.indexOf('downloadNow = () =>'));
  assert.ok(fn.includes('autoUpdater.downloadUpdate()'), 'downloadNow must fetch');
});

test('a completed download shows no OS dialog', () => {
  // The regression: a native dialog seized the window the moment a background
  // download finished — a moment the user never chose.
  assert.ok(
    !handlerBody('update-downloaded').includes('showMessageBox'),
    'the update-downloaded handler must not open a native dialog',
  );
});
