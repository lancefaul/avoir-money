#!/bin/bash

# If not running in a terminal, relaunch inside Konsole
if [ ! -t 1 ]; then
  exec konsole -e bash -c "\"$0\"; exec bash"
fi

cd "$(dirname "$0")"
export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.local/share/pnpm:$PATH"

echo "Starting Prod..."

# Docker daemon, stale-network healing, firewalld trust for the current bridge,
# and a real readiness check instead of `sleep 5`. See scripts/ensure-stack.sh
# for why each of those is needed — all three failure modes were hit in one
# afternoon and every one of them presents as "the app is down".
bash scripts/ensure-stack.sh --wait-db || {
  echo "Stack did not come up. Fix the above and re-run."
  exit 1
}

docker compose ps

pnpm dev
echo "Prod started!"
