#!/usr/bin/env bash
# Drive the same sequence of WRITES against both backends and diff every
# response. The read-side counterpart is `run.sh`.
#
# ── THE SAFETY PROPERTY, WHICH IS THE WHOLE DIFFERENCE FROM run.sh ──
#
# `run.sh` points the TypeScript backend at PRODUCTION and is safe because it
# only ever issues GETs. This script issues creates, updates and DELETES, so
# that arrangement would be catastrophic. It therefore refuses to start unless
# the TypeScript backend's database is the disposable test one, and it checks
# the URL it is actually going to use rather than trusting a file — an exported
# DATABASE_URL beats `--env-file` (verified, not assumed), which is exactly how
# a "safe" .env can sit next to a process talking to prod.
#
# The Rust side needs no such guard: it gets a fresh throwaway SQLite file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK:-/tmp/avoir-diff-writes}"
TS_PORT="${TS_PORT:-5275}"

# The test database. Hardcoded rather than inherited, so nothing in the
# environment can redirect it.
TEST_DB_URL="postgresql://budget:budget@localhost:5433/budget_tracker_test"

# Kill the process GROUP, not the pid we happen to hold.
#
# `npx tsx …` is three processes deep — npm exec, the tsx CLI, then node — and
# `$!` names only the outermost. Killing that left the node process alive and
# still holding the port, so the NEXT run bound nothing, silently attached to
# the previous run's server, and compared against stale code. That is invisible
# while the TypeScript is unchanged, which is every run until the first one that
# changes it: the `defaultHook` fix looked like it had no effect, and the
# evidence for it having worked was a `curl` against a server started by hand.
#
# `setsid` makes each server a group leader, so `kill -- -PID` takes the tree.
cleanup() {
  [[ -n "${RS_PID:-}" ]] && kill -- -"$RS_PID" 2>/dev/null || true
  [[ -n "${TS_PID:-}" ]] && kill -- -"$TS_PID" 2>/dev/null || true
}

# And refuse to start on an occupied port rather than talking to whoever is
# there. `EADDRINUSE` on the port you are investigating is a liveness signal.
require_free_port() {
  if ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; then
    echo "REFUSING: something is already listening on port $1." >&2
    echo "It is probably a leaked server from an earlier run. Find it with:" >&2
    echo "    ss -ltnp 'sport = :$1'" >&2
    exit 2
  fi
}
trap cleanup EXIT

echo "── 0/5  refuse to write to anything but the test database"
# Parsed rather than pattern-matched: "5433" appearing somewhere in a string is
# not evidence about which port a client will dial.
port="$(node -e "console.log(new URL(process.argv[1]).port)" "$TEST_DB_URL")"
dbname="$(node -e "console.log(new URL(process.argv[1]).pathname.slice(1))" "$TEST_DB_URL")"
if [[ "$port" != "5433" || "$dbname" != *_test ]]; then
  echo "REFUSING: resolved to port=$port db=$dbname; this script only writes to 5433/*_test" >&2
  exit 2
fi
echo "   port=$port  db=$dbname  ✓"

mkdir -p "$WORK"
cd "$ROOT"

echo "── 1/5  empty the test database"
# Rows only. The schema and `_prisma_migrations` are left alone, so this is not
# a migration and nothing is dropped or recreated — the database is emptied,
# which is what `pnpm test` does to it before every run anyway.
#
# The table list is DERIVED from the catalog rather than written down. The
# hand-maintained order in `apps/api/src/test/setup.ts` had already fallen
# behind the schema (no reconciliation, backup or connected-service tables), and
# a reset that silently skips a table leaves the TypeScript side holding rows
# the Rust side does not have — which every later comparison then blames on the
# port.
#
# TRUNCATE rather than that file's deleteMany: its comment explains the choice
# was about ACCESS EXCLUSIVE locks deadlocking against in-flight lifecycle hooks
# on other connections. Nothing is connected here — the API starts in step 4 —
# so the reason does not apply and one statement replaces thirty.
docker exec -i budget-tracker-db-test psql -U budget -d budget_tracker_test -q <<'SQL' \
  > "$WORK/reset.log" 2>&1 || { echo "reset failed:"; tail -20 "$WORK/reset.log"; exit 1; }
DO $$
DECLARE tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO tables
    FROM pg_tables
   WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
  IF tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;
SQL

remaining="$(docker exec -i budget-tracker-db-test psql -U budget -d budget_tracker_test -tA \
  -c "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables WHERE relname <> '_prisma_migrations'")"
echo "   emptied (analyzer reports ${remaining} rows; schema and migrations untouched)"

echo "── 2/5  a fresh empty SQLite for the Rust backend"
# Deleted, not truncated: the migrations run on connect, so an empty directory
# is a complete instruction.
rm -f "$WORK/avoir.db" "$WORK/avoir.db-wal" "$WORK/avoir.db-shm"

echo "── 3/5  build and start the Rust backend"
SQLX_OFFLINE=true cargo build -q --manifest-path rust/Cargo.toml -p avoir-server
RS_TOKEN="diff-$RANDOM$RANDOM"
AVOIR_DATA_DIR="$WORK" AVOIR_TOKEN="$RS_TOKEN" \
  setsid "$ROOT/rust/target/debug/avoir-server" > "$WORK/rs.json" 2> "$WORK/rs.err" &
RS_PID=$!
for _ in $(seq 1 60); do [[ -s "$WORK/rs.json" ]] && break; sleep 0.25; done
RS_PORT="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WORK/rs.json','utf8')).port)")"
echo "   rust on $RS_PORT"

echo "── 4/5  start the TypeScript backend against the TEST database"
TS_KEY="$(grep -m1 '^API_KEY=' "$ROOT/.env" | cut -d= -f2- | tr -d '"')"
# DATABASE_URL is EXPORTED so it wins over the `.env` the app would otherwise
# read, which names production. Verified: an exported variable beats Node's
# --env-file, it is not merely assumed to.
require_free_port "$TS_PORT"
setsid bash -c "cd '$ROOT/apps/api' && DATABASE_URL='$TEST_DB_URL' PORT='$TS_PORT' \
  exec npx tsx --env-file='$ROOT/.env' src/index.ts" > "$WORK/ts.log" 2>&1 &
TS_PID=$!
for _ in $(seq 1 80); do
  curl -sf -o /dev/null -H "Authorization: Bearer $TS_KEY" \
    "http://127.0.0.1:$TS_PORT/api/v1/accounts" && break
  sleep 0.5
done
echo "   typescript on $TS_PORT"

# Belt and braces: ask the server, not the config. An empty accounts list proves
# it is on the freshly-reset database — production has 17.
count="$(curl -s -H "Authorization: Bearer $TS_KEY" \
  "http://127.0.0.1:$TS_PORT/api/v1/accounts" | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
if [[ "$count" != "0" ]]; then
  echo "REFUSING: the TypeScript backend reports $count accounts; a reset database has 0." >&2
  echo "It is talking to something other than the database this script just reset." >&2
  exit 2
fi
echo "   confirmed empty (0 accounts) ✓"

echo "── 5/5  drive the scenario"
TS_BASE="http://127.0.0.1:$TS_PORT/api/v1" TS_KEY="$TS_KEY" \
RS_BASE="http://127.0.0.1:$RS_PORT/api/v1" RS_KEY="$RS_TOKEN" \
DIFF_JSON="${DIFF_JSON:-$WORK/diffs.json}" \
  node "$ROOT/tools/differential/write-diff.mjs"
