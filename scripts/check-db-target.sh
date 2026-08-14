#!/usr/bin/env bash
# Prints which database a Prisma CLI command is about to hit, and fails if that
# is production.
#
# Why it exists: test data leaked into production twice in April 2026 — once
# ~2,200 records from an unisolated DATABASE_URL, once 7 PBT_WALLET_* rows from
# packages/db/.env pointing at prod. Both needed manual cleanup. The response was
# to pin packages/db/.env to 5433 and write a rule saying "verify the target
# before any Prisma CLI command" — a rule that named this script, which until now
# did not exist. The guard was documented for months and never actually ran.
#
# Read-only. Opens no connection; it only resolves configuration.
#
# Run:  bash scripts/check-db-target.sh
#       ALLOW_PROD_MIGRATION=1 bash scripts/check-db-target.sh   # deliberate prod work
#
# Exit 0 = safe to proceed. Exit 1 = production, or the target could not be
# determined. An unknown target is treated as unsafe, never as fine.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/packages/db/.env"

# Prisma's port for production. The test database lives on 5433.
PROD_PORT="5432"
# Postgres' own default, used when a URL omits the port. Omitting it means 5432,
# which means production — the most dangerous value is also the invisible one.
DEFAULT_PORT="5432"

fail() {
  echo "✗ Database target: $1"
  exit 1
}

# ── Resolve the URL exactly the way Prisma will ──
#
# Prisma loads packages/db/.env through dotenv, which does NOT overwrite a
# variable already present in the environment. So an exported DATABASE_URL wins
# over the file. A check that only ever read the file would report "5433, safe"
# while the CLI connected to prod — precisely the leak this script guards.
if [ -n "${DATABASE_URL:-}" ]; then
  URL="$DATABASE_URL"
  SOURCE="exported DATABASE_URL (overrides packages/db/.env)"
  REMEDY="unset DATABASE_URL so packages/db/.env applies"
else
  [ -f "$ENV_FILE" ] || fail "packages/db/.env not found at $ENV_FILE — cannot tell where Prisma will connect."

  # Last assignment wins, matching dotenv. Tolerates leading whitespace, optional
  # `export`, and single or double quotes around the value.
  URL=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" \
    | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
  SOURCE="packages/db/.env"
  REMEDY="point packages/db/.env at port 5433"
fi

[ -n "$URL" ] || fail "DATABASE_URL is empty or unset in $SOURCE."

# postgresql://user:password@host:port/database?params — port and credentials optional.
if [[ ! "$URL" =~ ^postgres(ql)?://([^@/]*@)?([^:/?]+)(:([0-9]+))?/([^?]+) ]]; then
  fail "could not parse DATABASE_URL from $SOURCE. Expected postgresql://…@host:port/database."
fi

HOST="${BASH_REMATCH[3]}"
PORT="${BASH_REMATCH[5]:-$DEFAULT_PORT}"
DB_NAME="${BASH_REMATCH[6]}"

echo "  source:   $SOURCE"
echo "  host:     $HOST"
echo "  port:     $PORT"
echo "  database: $DB_NAME"
echo ""

# ── Classify ──
#
# Two independent signals, because either one alone can be wrong: the port can be
# tunnelled and the name can be reused. Anything that is not unambiguously the
# test database is treated as production.
REASONS=()
[ "$PORT" = "$PROD_PORT" ] && REASONS+=("port $PORT is the production port")
[[ "$DB_NAME" != *_test ]] && REASONS+=("database '$DB_NAME' is not a _test database")
[[ "$HOST" != "localhost" && "$HOST" != "127.0.0.1" ]] && REASONS+=("host '$HOST' is not local")

if [ ${#REASONS[@]} -eq 0 ]; then
  echo "✓ Database target: test database. Safe to run Prisma commands."
  exit 0
fi

if [ "${ALLOW_PROD_MIGRATION:-}" = "1" ]; then
  echo "⚠ Database target: PRODUCTION, allowed by ALLOW_PROD_MIGRATION=1."
  for r in "${REASONS[@]}"; do echo "  – $r"; done
  echo ""
  echo "Take a backup before writing. Stop the dev server before schema changes —"
  echo "prisma generate hot-reloads tsx watch into code the database cannot serve."
  exit 0
fi

echo "✗ Database target: PRODUCTION. Refusing to proceed."
for r in "${REASONS[@]}"; do echo "  – $r"; done
echo ""
echo "Prisma writes here would hit real data. Either $REMEDY,"
echo "or, if this is deliberate and approved, re-run with ALLOW_PROD_MIGRATION=1."
exit 1
