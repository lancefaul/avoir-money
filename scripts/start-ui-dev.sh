#!/usr/bin/env bash
# The UI development loop: a browser with hot reload, and no packaging.
#
# ── Why this exists ──
#
# Every UI change was being verified by building a release binary, packaging an
# AppImage AND a pacman package, bumping the version, and installing it — about
# four minutes per iteration, and a version number burned each time. For a
# layout that took three attempts to get right, that is three installs to learn
# something a browser refresh answers instantly.
#
# ── The two things that make it possible ──
#
# **A fixed backend port.** The packaged app binds `127.0.0.1:0` and tells the
# shell which port it got, deliberately — see the note in `rust/server`. Vite,
# though, is configured with a proxy target before anything starts, so it cannot
# discover a port later. `AVOIR_PORT` exists for this and nothing else.
#
# **No token.** The desktop app mints a per-launch bearer token and passes it
# through the preload bridge; a browser has no preload, so `request.ts` falls
# back to `VITE_API_KEY`. Starting the backend without `AVOIR_TOKEN` makes it
# accept that. The server prints its own warning about being open to every local
# process, which is correct and is why this is a development script.
#
# ── What you will NOT see here ──
#
# Anything behind `window.__AVOIR__`. There is no Electron shell, so
# Settings → Software Updates renders its "you are viewing this in a browser"
# state rather than the real thing. That is not a limitation to work around —
# it is one of the three states that pane has, and this is the only convenient
# way to look at it.
#
# Ports are this repo's (5273/5274), never budget-tracker's (5173/5174), which
# is a different, frozen application that must keep working.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${AVOIR_DEV_API_PORT:-5274}"
WEB_PORT="${AVOIR_DEV_WEB_PORT:-5273}"

# A scratch database by default. The real one is a single file holding real
# financial history, and a development server is the last thing that should be
# writing to it by accident — point `AVOIR_DEV_DATA` at it deliberately if you
# want real data on screen.
DATA_DIR="${AVOIR_DEV_DATA:-/tmp/avoir-ui-dev}"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill -- -"$API_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

for port in "$API_PORT" "$WEB_PORT"; do
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    echo "REFUSING: something is already listening on $port." >&2
    echo "  ss -ltnp 'sport = :$port'" >&2
    exit 2
  fi
done

mkdir -p "$DATA_DIR"
echo "── backend"
echo "   data:  $DATA_DIR"
SQLX_OFFLINE=true cargo build -q --manifest-path "$ROOT/rust/Cargo.toml" -p avoir-server || exit 1

# `setsid` so the whole tree can be killed as a group. `$!` names only the
# outermost process, which has bitten this repo before.
AVOIR_DATA_DIR="$DATA_DIR" AVOIR_PORT="$API_PORT" \
  setsid "$ROOT/rust/target/debug/avoir-server" &
API_PID=$!

for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/api/v1/accounts" && break
  sleep 0.25
done
echo "   api:   http://127.0.0.1:$API_PORT"

echo "── frontend (hot reload)"
echo "   open:  http://localhost:$WEB_PORT"
echo
cd "$ROOT/apps/web"
VITE_PORT="$WEB_PORT" VITE_API_TARGET="http://127.0.0.1:$API_PORT" exec npx vite
