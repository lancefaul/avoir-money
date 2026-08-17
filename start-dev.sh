#!/usr/bin/env bash
# Start the dev environment (dev.budget.home)
# API on port 5184, Web on port 5183
# Backed by the dev database (port 5433 / budget_tracker_test)
#
# Usage: ./scripts/dev-env.sh
# Stop:  Ctrl+C

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/pnpm:$PATH"

echo "=== Dev Environment (dev.budget.home) ==="
echo ""

# The dev servers talk to Postgres on 5433 and are reached through Caddy, so
# this environment depends on the same container stack prod does — it just uses
# a different database and different ports. Without this, a missing bridge or an
# untrusted firewalld interface shows up as a database connection error or a
# 502 from dev.budget.home, neither of which points at the real cause.
bash "$ROOT_DIR/scripts/ensure-stack.sh" --wait-db || {
  echo "Stack did not come up. Fix the above and re-run."
  exit 1
}
echo ""

# Start API server (tsx watch from apps/api)
echo "Starting dev API on port 5184..."
cd "$ROOT_DIR/apps/api"
DATABASE_URL="postgresql://budget:budget@localhost:5433/budget_tracker_test" \
API_KEY="budget-tracker-dev-key" \
PORT=5184 \
CORS_ORIGINS="https://dev.budget.home" \
  pnpm exec tsx watch src/index.ts &
API_PID=$!

# Start Web server (vite from apps/web)
echo "Starting dev Web on port 5183..."
cd "$ROOT_DIR/apps/web"
VITE_PORT=5183 \
VITE_API_TARGET="http://localhost:5184" \
VITE_API_KEY="budget-tracker-dev-key" \
VITE_HMR_HOST="dev.budget.home" \
  pnpm exec vite --host &
WEB_PID=$!

sleep 3
echo ""
echo "Dev environment running:"
echo "  Web: https://dev.budget.home"
echo "  API: https://dev.budget.home/api"
echo "  DB:  localhost:5433/budget_tracker_test"
echo ""
echo "PIDs: API=$API_PID, Web=$WEB_PID"
echo "Press Ctrl+C to stop"

trap "kill $API_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
