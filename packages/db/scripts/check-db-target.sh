#!/usr/bin/env bash
# Pre-migration safety check — blocks accidental runs against production.
# Source this before any prisma migrate command, or call it directly.

DB_URL="${DATABASE_URL:-}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  exit 1
fi

if echo "$DB_URL" | grep -q "localhost:5432"; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  BLOCKED: DATABASE_URL points to PRODUCTION (port 5432).   ║"
  echo "║  Migrations and Prisma CLI commands must target the test   ║"
  echo "║  database (port 5433) unless you explicitly opt in.        ║"
  echo "║                                                            ║"
  echo "║  To run against production, set:                           ║"
  echo "║    ALLOW_PROD_MIGRATION=1                                  ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  if [ "${ALLOW_PROD_MIGRATION:-}" != "1" ]; then
    exit 1
  fi
  echo "⚠  ALLOW_PROD_MIGRATION=1 is set — proceeding against production."
fi

echo "✓ Database target: $DB_URL"
