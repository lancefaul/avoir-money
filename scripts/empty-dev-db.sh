#!/usr/bin/env bash
# Truncate all tables in the dev/test database (port 5433).
# This gives you a fully empty app at dev.budget.home for testing empty states.
# Production (port 5432) is NEVER touched.

set -euo pipefail

DB_HOST="localhost"
DB_PORT="5433"
DB_NAME="budget_tracker_test"
DB_USER="budget"
DB_PASS="budget"

echo "=== Emptying dev database (port $DB_PORT) ==="
echo ""

# Truncate all application tables in dependency-safe order
PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q <<'SQL'
DO $$
DECLARE
  tbl text;
BEGIN
  -- Disable FK checks for the truncation
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '_prisma_migrations'
  LOOP
    EXECUTE format('TRUNCATE TABLE %I CASCADE', tbl);
  END LOOP;
END $$;
SQL

echo "✓ All tables truncated (migrations preserved)"
echo ""
echo "Browse empty states at: https://dev.budget.home"
echo ""
