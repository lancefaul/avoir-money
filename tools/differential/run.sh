#!/usr/bin/env bash
# Stand both backends up on the same data and diff every route.
#
# The two speak to different databases by construction — the TypeScript to
# Postgres, the Rust to SQLite — so "the same data" means exporting the former
# and importing it into the latter first. That path already exists and is the
# same one a user's migration takes, which is a second reason to run this: it
# exercises the importer against real data every time.
#
# Read-only on Postgres. The export issues zero write statements, and nothing
# here touches the live SQLite database the app uses.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK:-/tmp/avoir-diff}"
TS_PORT="${TS_PORT:-5274}"

# Kill the process GROUP — see the long note in `run-writes.sh`. `npx tsx …` is
# three processes deep and `$!` names only the outermost, so killing it leaves
# node holding the port and the next run silently attaches to the previous
# run's server.
cleanup() {
  [[ -n "${RS_PID:-}" ]] && kill -- -"$RS_PID" 2>/dev/null || true
  [[ -n "${TS_PID:-}" ]] && kill -- -"$TS_PID" 2>/dev/null || true
}

require_free_port() {
  if ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; then
    echo "REFUSING: something is already listening on port $1 (a leaked server?)." >&2
    echo "    ss -ltnp 'sport = :$1'" >&2
    exit 2
  fi
}
trap cleanup EXIT

mkdir -p "$WORK"
cd "$ROOT"

echo "── 1/5  export Postgres (read-only)"
DATABASE_URL="${DATABASE_URL:-postgresql://budget:budget@localhost:5432/budget_tracker}" \
  cargo run -q --manifest-path rust/Cargo.toml -p avoir-export -- "$WORK/prod.json"

echo "── 2/5  import into a throwaway SQLite"
rm -f "$WORK/avoir.db"
# The target is POSITIONAL. Passing DATABASE_URL instead writes to ./avoir.db in
# the current directory and still reports success — which is how an earlier run
# "verified" a database nobody was looking at.
cargo run -q --manifest-path rust/Cargo.toml -p avoir-import -- "$WORK/prod.json" "$WORK/avoir.db"

echo "── 3/5  build and start the Rust backend"
# Built here, not assumed. Running a stale binary makes the harness report the
# defects you just fixed, which is worse than not running it: it says the fix
# did not work when the fix was never loaded.
SQLX_OFFLINE=true cargo build -q --manifest-path rust/Cargo.toml -p avoir-server
RS_TOKEN="diff-$RANDOM$RANDOM"
AVOIR_DATA_DIR="$WORK" AVOIR_TOKEN="$RS_TOKEN" \
  setsid "$ROOT/rust/target/debug/avoir-server" > "$WORK/rs.json" 2> "$WORK/rs.err" &
RS_PID=$!
for _ in $(seq 1 60); do [[ -s "$WORK/rs.json" ]] && break; sleep 0.25; done
RS_PORT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK/rs.json','utf8')).port)")"
echo "   rust on $RS_PORT"

echo "── 4/5  start the TypeScript backend"
# On its own port: 5174 belongs to a different application on this machine, and
# starting a second server there would either fail or, worse, succeed against
# something else's expectations.
require_free_port "$TS_PORT"
setsid bash -c "cd '$ROOT/apps/api' && PORT='$TS_PORT' \
  exec npx tsx --env-file='$ROOT/.env' src/index.ts" > "$WORK/ts.log" 2>&1 &
TS_PID=$!
TS_KEY="$(grep -m1 '^API_KEY=' "$ROOT/.env" | cut -d= -f2- | tr -d '"')"
for _ in $(seq 1 80); do
  curl -sf -o /dev/null -H "Authorization: Bearer $TS_KEY" \
    "http://127.0.0.1:$TS_PORT/api/v1/accounts" && break
  sleep 0.5
done
echo "   typescript on $TS_PORT"

echo "── 5/5  collect the route list, then diff"
# The Rust acceptance test resolves per-record routes against ids that really
# exist — hitting /accounts/{id} with a made-up id proves only that 404 works —
# so its dump is reused as the route list rather than maintaining a second one.
ACCEPTANCE_DB="$WORK/avoir.db" ACCEPTANCE_DUMP="$WORK/routes.json" \
  cargo test -q --manifest-path rust/Cargo.toml -p avoir-api --test acceptance \
  -- --ignored every_read_endpoint > /dev/null 2>&1 || true

TS_BASE="http://127.0.0.1:$TS_PORT/api/v1" TS_KEY="$TS_KEY" \
RS_BASE="http://127.0.0.1:$RS_PORT/api/v1" RS_KEY="$RS_TOKEN" \
ROUTES="$WORK/routes.json" DIFF_JSON="${DIFF_JSON:-$WORK/diffs.json}" \
  node "$ROOT/tools/differential/diff.mjs"
status=$?

# The diff matches array elements by identity, so it is BLIND to ordering and
# would report "identical" with the tie-breaks removed. Ordering gets its own
# check.
echo
echo "── ordering"
TS_BASE="http://127.0.0.1:$TS_PORT/api/v1" TS_KEY="$TS_KEY" \
RS_BASE="http://127.0.0.1:$RS_PORT/api/v1" RS_KEY="$RS_TOKEN" \
  node "$ROOT/tools/differential/check-order.mjs" || status=1

exit $status
