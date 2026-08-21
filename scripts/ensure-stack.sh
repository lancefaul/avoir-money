#!/usr/bin/env bash
#
# Bring the Docker stack up and make it actually reachable.
#
# `docker compose up -d` on its own is not enough, because three things break
# it in ways that look like "the app is down" and have nothing to do with the
# app. All three were hit on 2026-08-08 and cost an afternoon:
#
#   1. The Docker daemon is not running (after a reboot).
#
#   2. A compose network survives in Docker's metadata while its bridge
#      interface is gone from the host — a firewalld or NetworkManager reload
#      does exactly this. `docker network ls` cheerfully lists the network,
#      and every container then fails to start with "network <id> does not
#      exist". Even `--force-recreate` fails, because the containers hold an
#      endpoint pinned to the dead id. The fix is to delete the stale network
#      object so compose builds a fresh bridge.
#
#   3. firewalld drops container -> host traffic unless the bridge is in the
#      trusted zone. The bridge is named after the network id, so recreating
#      the network in step 2 renames it and silently invalidates the existing
#      rule. Caddy then answers with 502 for every host-proxied route while
#      the dev servers are running perfectly — the failure points at the app
#      and the cause is a firewall rule naming an interface that no longer
#      exists.
#
# Nothing here touches a volume: no `-v`, no `down`. Postgres data lives in the
# named volume `budget-tracker_postgres_data` and is untouched by any of it.
#
# Usage: bash scripts/ensure-stack.sh [--wait-db]

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_NETWORK="budget-tracker_default"
DB_CONTAINER="budget-tracker-db"
TEST_DB_CONTAINER="budget-tracker-db-test"

info() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

# ── 1. Docker daemon ────────────────────────────────────────────────────────

ensure_daemon() {
  if docker info >/dev/null 2>&1; then
    info "Docker daemon: running"
    return 0
  fi

  info "Docker daemon: starting…"
  if command -v systemctl >/dev/null 2>&1; then
    pkexec systemctl start docker || {
      warn "Could not start Docker. Start it and re-run."
      return 1
    }
  fi

  # Poll rather than sleep: the daemon takes an unpredictable moment, and a
  # fixed sleep is either too short (flaky) or too long (annoying).
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && {
      info "Docker daemon: running"
      return 0
    }
    sleep 3
  done

  warn "Docker daemon did not come up within 90s."
  return 1
}

# ── 2. Stale network whose bridge no longer exists ──────────────────────────

bridge_for_network() {
  local id
  id="$(docker network inspect "$COMPOSE_NETWORK" --format '{{.Id}}' 2>/dev/null)" || return 1
  [ -n "$id" ] || return 1
  printf 'br-%s' "${id:0:12}"
}

heal_stale_network() {
  local bridge
  bridge="$(bridge_for_network)" || {
    info "Network: absent, compose will create it"
    return 0
  }

  if ip -o link show "$bridge" >/dev/null 2>&1; then
    info "Network: healthy ($bridge)"
    return 0
  fi

  warn "Network '$COMPOSE_NETWORK' exists but its bridge $bridge is gone — recreating."

  # Containers pinned to the dead network have to go first, or the network
  # cannot be removed. `rm -sf` stops and removes containers ONLY; volumes are
  # never in scope for it. Deliberately not `down`, which is broader than the
  # problem.
  docker compose rm -sf >/dev/null 2>&1
  docker network rm "$COMPOSE_NETWORK" >/dev/null 2>&1 || {
    warn "Could not remove the stale network. Try: docker network rm $COMPOSE_NETWORK"
    return 1
  }
  info "Network: stale object removed"
}

# ── 3. firewalld must trust the CURRENT bridge ──────────────────────────────

ensure_firewall() {
  command -v firewall-cmd >/dev/null 2>&1 || return 0
  systemctl is-active --quiet firewalld 2>/dev/null || return 0

  local bridge
  bridge="$(bridge_for_network)" || {
    warn "No network yet; skipping firewall check."
    return 0
  }

  local current
  current="$(firewall-cmd --zone=trusted --list-interfaces 2>/dev/null)"

  if printf '%s' "$current" | tr ' ' '\n' | grep -qx "$bridge"; then
    info "firewalld: $bridge already trusted"
    return 0
  fi

  warn "firewalld: $bridge is not trusted — container-to-host traffic will 502."
  info "Requesting privileges to add it…"
  if pkexec firewall-cmd --zone=trusted --add-interface="$bridge" >/dev/null 2>&1; then
    info "firewalld: $bridge trusted"
  else
    warn "Could not update firewalld. Run this yourself:"
    warn "    sudo firewall-cmd --zone=trusted --add-interface=$bridge"
  fi

  # Old bridges linger in the zone after every recreate and mean nothing once
  # the interface is gone. Harmless, but they make the zone unreadable when
  # you are trying to work out which rule is live.
  local stale
  for stale in $(printf '%s' "$current" | tr ' ' '\n' | grep -E '^br-' || true); do
    [ "$stale" = "$bridge" ] && continue
    ip -o link show "$stale" >/dev/null 2>&1 && continue
    pkexec firewall-cmd --zone=trusted --remove-interface="$stale" >/dev/null 2>&1 &&
      info "firewalld: removed stale $stale"
  done
}

# ── 4. Wait for Postgres to actually accept connections ─────────────────────

wait_for_db() {
  local container="$1" label="$2"
  for _ in $(seq 1 30); do
    if docker exec "$container" pg_isready -U budget >/dev/null 2>&1; then
      info "$label: ready"
      return 0
    fi
    sleep 1
  done
  warn "$label: not ready after 30s"
  return 1
}

# ── Run ─────────────────────────────────────────────────────────────────────

echo "Checking the Docker stack…"
ensure_daemon || exit 1
heal_stale_network

docker compose up -d >/dev/null 2>&1 || {
  warn "docker compose up failed; retrying once after healing the network."
  heal_stale_network
  docker compose up -d || exit 1
}
info "Containers: up"

ensure_firewall

if [ "${1:-}" = "--wait-db" ]; then
  wait_for_db "$DB_CONTAINER" "Production DB (5432)"
  wait_for_db "$TEST_DB_CONTAINER" "Test DB (5433)"
fi

echo "Stack ready."
