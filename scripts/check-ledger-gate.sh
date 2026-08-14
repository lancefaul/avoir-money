#!/usr/bin/env bash
# Checks that no file outside the approved list uses direct prisma.transaction mutations.
# Run: bash scripts/check-ledger-gate.sh

set -euo pipefail

SEARCH_DIR="apps/api/src"
PATTERN='prisma\.transaction\.(create|update|updateMany|delete|deleteMany)\('

# Files allowed to use direct prisma.transaction calls
ALLOWED_FILES=(
  "apps/api/src/lib/lifecycle/ledger.ts"
  "apps/api/src/lib/lifecycle/hooks/balance.hook.ts"
  "apps/api/src/lib/lifecycle/hooks/system-budget.hook.ts"
  "apps/api/src/lib/lifecycle/hooks/trade-holding.hook.ts"
  "apps/api/src/lib/lifecycle/hooks/bitcoin-holding.hook.ts"
  "apps/api/src/routes/transactions.children.ts"
  "apps/api/src/routes/transactions.ts"
  "apps/api/src/routes/accounts.ts"
  # Full-wipe bulk delete: deleteMany() is followed by an explicit reset of every
  # transaction-derived value (resetTransactionDerivedState), so bypassing the hooks is safe.
  "apps/api/src/routes/data-management.ts"
  "apps/api/src/db-cleanup.ts"
  # Writes only balanceBefore/balanceAfter metadata — same rationale as balance.hook.ts.
  "apps/api/src/scripts/rebuild-balance-chain-backward.ts"
  # Recalculate-balance / rebuild-balance-chain logic extracted from routes/accounts.ts.
  # Writes only balanceBefore/balanceAfter metadata — same rationale as balance.hook.ts.
  "apps/api/src/lib/account-balance.ts"
  # Stamps reconciledAt on matched transactions when a reconciliation closes.
  # Metadata only: it touches no amount, netAmount, account, or date, so no
  # lifecycle hook has anything to react to. The adjustment transaction that the
  # same file can create DOES go through ledgerCreate.
  "apps/api/src/routes/reconciliations.close.ts"
  # Merge on combine: creates child allocations directly (parentId != null → no
  # balance effect, as in transactions.children.ts). The balance-visible parent
  # and the deletes go through ledgerCreate / ledgerDelete inside one transaction.
  "apps/api/src/routes/reconciliations.merge.ts"
)

# Search for all matches (exclude test files)
ALL_MATCHES=$(grep -rEn "$PATTERN" "$SEARCH_DIR" \
  --include='*.ts' \
  --exclude='*.test.ts' \
  --exclude='*.property.test.ts' \
  --exclude-dir='test' \
  --exclude-dir='__tests__' \
  2>/dev/null || true)

if [ -z "$ALL_MATCHES" ]; then
  echo "✓ Ledger gate: no prisma.transaction mutations found."
  exit 0
fi

# Filter out allowed files
VIOLATIONS=""
while IFS= read -r line; do
  FILE_PATH=$(echo "$line" | cut -d: -f1)
  IS_ALLOWED=false
  for allowed in "${ALLOWED_FILES[@]}"; do
    if [ "$FILE_PATH" = "$allowed" ]; then
      IS_ALLOWED=true
      break
    fi
  done
  if [ "$IS_ALLOWED" = false ]; then
    VIOLATIONS="${VIOLATIONS}${line}"$'\n'
  fi
done <<< "$ALL_MATCHES"

if [ -n "$VIOLATIONS" ]; then
  echo "✗ LEDGER GATE VIOLATION"
  echo ""
  echo "Direct prisma.transaction mutations found outside approved files."
  echo "Use ledgerCreate/ledgerUpdate/ledgerDelete from lib/lifecycle/ledger.ts"
  echo ""
  echo "$VIOLATIONS"
  exit 1
fi

echo "✓ Ledger gate: all prisma.transaction mutations in approved files."
