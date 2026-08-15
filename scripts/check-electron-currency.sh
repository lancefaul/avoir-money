#!/usr/bin/env bash
# How far behind is the Electron we ship?
#
# ── WHY THIS EXISTS ──
#
# On 2026-08-13 v1.0.0 froze permanently whenever text was selected with the
# mouse. Eight hours went into diagnosis — six of our own settings changed, a
# window rebuilt with `frame: true`, two Chromium switches removed, both display
# backends tested. None of it was the cause. The cause was Chromium 140, shipped
# inside Electron 38, and rebuilding on Electron 43 (Chromium 150) fixed it
# without touching a line of our code.
#
# Everything on that machine that behaved was on modern Chromium: Brave 150,
# Discord on Electron 42, VS Code's browser. We were ten majors behind.
#
# The failure was not "we forgot to upgrade". It is that NOTHING in this project
# could say the runtime was stale. Every gate looks inward — typecheck, lint,
# tests, the ledger invariant, the update manifest. Not one of them can observe
# the engine we bundle. ADR-036 made this project the owner of Chromium's
# behaviour as well as its security updates; this is the check that makes that
# ownership visible instead of theoretical.
#
# ── THE THRESHOLDS, AND WHY THESE NUMBERS ──
#
# Electron ships a major roughly every 8 weeks and supports the latest THREE.
# Falling outside that window means no security backports for a browser engine
# we ship to users, which is the obligation ADR-036 took on.
#
#   warn at 2 behind   — still supported, but the gap is now worth a decision
#   fail at 4 behind   — outside upstream support; unshipped security fixes
#
# Four is deliberately not three: it leaves room to skip one major you do not
# want without the build going red, while still failing before support lapses
# by much.
#
# ── WHAT THIS DOES NOT DO ──
#
# It does not upgrade anything, and it does not read a changelog. Being current
# is not the same as being correct: 43 changed the frameless-window corner
# default on Linux, which needed its own fix. This check answers one question —
# how far behind are we — and leaves the judgement where it belongs.

set -uo pipefail

WARN_BEHIND=2
FAIL_BEHIND=4

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/electron/package.json"

[[ -f "$PKG" ]] || {
  echo "── electron/package.json not found at $PKG"
  exit 1
}

# The DECLARED range is what a fresh clone installs, so it is what ships — not
# whatever happens to be sitting in this machine's node_modules.
declared="$(grep -oP '"electron"\s*:\s*"\K[^"]+' "$PKG" | head -1)"
ours="${declared#^}"; ours="${ours#~}"; ours="${ours#>=}"
our_major="${ours%%.*}"

echo "── the Electron this project ships"
echo "   declared: $declared  (major $our_major)"

latest="$(npm view electron version 2>/dev/null)"
if [[ -z "$latest" ]]; then
  # Offline is not a failure. A check that breaks the build when the network
  # hiccups gets disabled, and a disabled check is worse than a missing one.
  echo "   could not reach the npm registry — skipping (this is not a failure)"
  exit 0
fi
latest_major="${latest%%.*}"
behind=$(( latest_major - our_major ))

echo "   latest:   $latest  (major $latest_major)"
echo "   behind:   $behind major(s)"
echo

if (( behind >= FAIL_BEHIND )); then
  echo "✗ $behind majors behind — past the point where upstream still backports"
  echo "  security fixes for the browser engine this app bundles."
  echo
  echo "  Upgrading is usually small: bump electron/package.json, read the"
  echo "  breaking changes for each major in between, run the gates. What is"
  echo "  expensive is NOT doing it — see the ERRORS.md entry \"Selecting text"
  echo "  froze the app\", which cost eight hours of diagnosis for a one-line fix."
  exit 1
fi

if (( behind >= WARN_BEHIND )); then
  echo "⚠ $behind majors behind. Still within upstream support, but worth a"
  echo "  decision now rather than at $FAIL_BEHIND, when it becomes a blocker."
  exit 0
fi

echo "✓ current enough ($behind behind; warn at $WARN_BEHIND, fail at $FAIL_BEHIND)."
