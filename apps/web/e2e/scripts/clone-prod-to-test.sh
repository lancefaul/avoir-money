#!/usr/bin/env bash
# Clone reference data from production DB to test DB for e2e tests.
#
# This script:
# 1. Ensures the test DB schema is up to date (prisma migrate deploy)
# 2. Truncates all tables in the test DB
# 3. Copies reference/lookup data from prod → test
#
# Reference tables (copied in full):
#   Account, BudgetGroup, Budget, Custodian, Wallet,
#   PaySchedule, PayPeriod, UtilityProvider, UtilityService
#
# Transactional tables (left empty — tests create their own):
#   Transaction, Expense, Income, Debt, DebtPayment,
#   InvestmentHolding, InvestmentSnapshot, InvestmentTransfer,
#   UtilityReading, HealthcareYear, BudgetGoal, BalanceSnapshot, Snooze

set -euo pipefail

PROD_URL="postgresql://budget:budget@localhost:5432/budget_tracker"
TEST_URL="postgresql://budget:budget@localhost:5433/budget_tracker_test"

# Container names
PROD_CONTAINER="budget-tracker-db"
TEST_CONTAINER="budget-tracker-db-test"

# Internal URLs (from inside Docker containers, port is always 5432)
PROD_INTERNAL="postgresql://budget:budget@localhost:5432/budget_tracker"
TEST_INTERNAL="postgresql://budget:budget@localhost:5432/budget_tracker_test"

echo "=== E2E Test DB Setup ==="

# 1. Run migrations against test DB
echo "→ Running prisma migrate deploy on test DB..."
DATABASE_URL="$TEST_URL" npx prisma migrate deploy --schema=prisma/schema.prisma 2>&1 | tail -3

# Helper: run psql on the test container
psql_test() {
  docker exec -i "$TEST_CONTAINER" psql "$TEST_INTERNAL" "$@"
}

# Helper: run psql on the prod container
psql_prod() {
  docker exec -i "$PROD_CONTAINER" psql "$PROD_INTERNAL" "$@"
}

# Helper: run pg_dump on the prod container
pg_dump_prod() {
  docker exec -i "$PROD_CONTAINER" pg_dump "$PROD_INTERNAL" "$@"
}

# 2. Truncate all tables in test DB
echo "→ Truncating test DB tables..."
psql_test -q -c "
DO \$body\$
BEGIN
  EXECUTE (
    SELECT string_agg('TRUNCATE TABLE \"' || tablename || '\" CASCADE;', ' ')
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma%'
  );
END \$body\$;
"

# 3. Copy reference tables from prod to test
echo "→ Copying reference data from prod → test..."

TABLES=(
  "BudgetGroup"
  "Budget"
  "Account"
  "Custodian"
  "Wallet"
  "PaySchedule"
  "PayPeriod"
  "UtilityProvider"
  "UtilityService"
)

for TABLE in "${TABLES[@]}"; do
  COUNT=$(psql_prod -t -A -c "SELECT count(*) FROM \"$TABLE\";" 2>/dev/null || echo "0")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  if [ "$COUNT" -gt 0 ] 2>/dev/null; then
    pg_dump_prod \
      --data-only \
      --table="\"$TABLE\"" \
      --no-owner \
      --no-privileges \
      --disable-triggers \
      | psql_test -q 2>/dev/null
    echo "  ✓ $TABLE ($COUNT rows)"
  else
    echo "  · $TABLE (empty or not found, skipped)"
  fi
done

echo "=== Done. Test DB ready for e2e tests. ==="
