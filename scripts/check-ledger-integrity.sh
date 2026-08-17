#!/usr/bin/env bash
# Asserts the ledger invariant on live data, per account:
#
#     openingBalance + SUM(transactions) == balance
#
# This is the data-side companion to check-ledger-gate.sh (which is a static scan).
# The gate proves every mutation went through the ledger; this proves the numbers
# those mutations produced still add up.
#
# Why it exists: for months the app carried two contradictory balance models — the
# account's stored running total, and the sum of its transactions — with nothing
# comparing them. A reversed four-figure card payment sat undetected because the
# backward chain rebuild parked the difference in the earliest row's balanceBefore,
# silently reclassifying "wrong balance" as "pre-tracking history."
#
# Read-only. Runs SELECTs and writes nothing.
#
# ── PORTED TO SQLITE (2026-08-14) ──
#
# This script targeted Postgres in a Docker container, and production moved to
# SQLite months ago. It did not fail when pointed at the new world — it printed
# "Docker is not running, skipping (data unchecked)" and **exited 0**, so it read
# as a pass in every pipeline that ran it. QUALITY.md lists it in the enforcement
# stack; it had been enforcing nothing since the port.
#
# That is the same shape as the husky hook that was never wired (ERRORS.md): a
# guardrail whose absence is silent looks exactly like a guardrail that is
# satisfied. Hence the rule this script now follows — **it never prints a ✓ for
# a database it did not read**, and the skip path says NOTHING WAS CHECKED in
# those words.
#
# Run:  bash scripts/check-ledger-integrity.sh
#       AVOIR_DB=rust/avoir.db bash scripts/check-ledger-integrity.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Defaults target production — that is where the data worth checking lives, and a
# SELECT cannot violate the "never write to prod" rule. This is the path the
# Electron shell passes as AVOIR_DATA_DIR; the server appends `avoir.db` to it.
DB="${AVOIR_DB:-$HOME/.local/share/com.avoir.finance/avoir.db}"

if ! command -v sqlite3 > /dev/null 2>&1; then
  echo "– Ledger integrity: sqlite3 is not installed. NOTHING WAS CHECKED."
  exit 0
fi

if [ ! -f "$DB" ]; then
  # A fresh clone that has never run the app has no database, which is not a
  # failure. It is also not a pass, and must not read as one.
  echo "– Ledger integrity: no database at $DB. NOTHING WAS CHECKED."
  exit 0
fi

echo "── Ledger integrity: $DB"

# ── The signed-sum expression ──
#
# Money is integer cents (ADR-033), so this is exact i64 arithmetic and there is
# **no tolerance**. The old script allowed 0.005 because Postgres DECIMAL columns
# were carrying float noise from JavaScript — 769 values in production were
# stored with more than two decimals. Cents removed the noise, so any residual at
# all is now a real discrepancy rather than something to round away.
#
# This is deliberately its OWN restatement of the sign rules, not a shared helper
# and not a copy of `rust/db/src/balance.rs`. QUALITY.md requires the
# restatements to be independent so that a bug in the production sign rules
# cannot make the check agree with it. Note the shape differs on purpose: this
# one resolves inbound transfers inside a single correlated subquery, where
# balance.rs uses two. If the sign rules change, all restatements change.
read -r -d '' SQL <<'EOSQL'
WITH sums AS (
  SELECT
    a."name"           AS name,
    a."openingBalance" AS opening,
    a."balance"        AS stored,
    COALESCE((
      SELECT SUM(
        CASE
          WHEN t."type" IN ('INCOME', 'REFUND') THEN t."netAmount"
          WHEN t."type" = 'EXPENSE' THEN -t."netAmount"
          WHEN t."type" = 'TRANSFER' AND t."toAccountId" = a."id" THEN t."netAmount"
          WHEN t."type" = 'TRANSFER' THEN -t."netAmount"
          WHEN t."type" = 'TRADE' AND td."direction" = 'BUY' THEN -t."netAmount"
          WHEN t."type" = 'TRADE' AND td."direction" = 'SELL' THEN t."netAmount"
          ELSE 0
        END
      )
      FROM "Transaction" t
      LEFT JOIN "TradeDetail" td ON td."transactionId" = t."id"
      -- `parentId IS NULL` is load-bearing: a split child carries an accountId
      -- but is not part of the balance chain, and including children makes a
      -- correct ledger report discontinuities (ERRORS.md, 2026-08-02).
      WHERE t."parentId" IS NULL
        AND (t."accountId" = a."id"
             OR (t."toAccountId" = a."id" AND t."type" = 'TRANSFER'))
    ), 0) AS total
  FROM "Account" a
)
SELECT name, opening, total, stored, opening + total, stored - (opening + total)
FROM sums
WHERE stored <> opening + total
ORDER BY ABS(stored - (opening + total)) DESC;
EOSQL

if ! VIOLATIONS=$(sqlite3 -separator '|' "$DB" "$SQL" 2>&1); then
  echo "✗ Ledger integrity: query failed against $DB"
  echo "$VIOLATIONS"
  exit 1
fi
VIOLATIONS=$(echo "$VIOLATIONS" | sed '/^$/d')

# ── The second check the invariant is structurally blind to ──
#
# `Account.balance` is rebuilt FROM `netAmount` and the invariant SUMS
# `netAmount`, so a row whose net has drifted from its amount moves both sides
# together and cancels. Mutation testing demonstrated this rather than arguing
# it: breaking `ledger_update_amount` so netAmount drifts — the exact defect
# ADR-013 exists to prevent, which once drifted a card by a four-figure sum — did NOT fail
# the ledger-invariant property test.
#
# The Rust side has carried `check_amount_matches_net` since. The shell script
# did not, so the two disagreed about what "integrity" means.
#
# Children are excluded: a split child's `netAmount` is its own allocation and
# is not required to equal the parent's amount.
read -r -d '' SQL_NET <<'EOSQL'
SELECT t."id", t."name", t."amount", t."netAmount"
FROM "Transaction" t
WHERE t."parentId" IS NULL AND t."netAmount" <> t."amount"
ORDER BY ABS(t."netAmount" - t."amount") DESC
LIMIT 20;
EOSQL

if ! NET_DRIFT=$(sqlite3 -separator '|' "$DB" "$SQL_NET" 2>&1); then
  echo "✗ Ledger integrity: netAmount query failed against $DB"
  echo "$NET_DRIFT"
  exit 1
fi
NET_DRIFT=$(echo "$NET_DRIFT" | sed '/^$/d')

# Cents → dollars, for reading only. Every comparison above was on integers.
money() { awk -v c="$1" 'BEGIN { printf "%.2f", c / 100 }'; }

fail=0

if [ -n "$VIOLATIONS" ]; then
  fail=1
  echo ""
  echo "✗ LEDGER INTEGRITY VIOLATION"
  echo ""
  echo "These accounts' stored balance disagrees with their own transactions."
  echo "A drift here means either a transaction is wrong, or the balance is."
  echo ""
  printf '%-28s %14s %14s %14s %14s %12s\n' "ACCOUNT" "OPENING" "TX SUM" "STORED" "EXPECTED" "DRIFT"
  while IFS='|' read -r name opening total stored expected drift; do
    [ -z "$name" ] && continue
    printf '%-28s %14s %14s %14s %14s %12s\n' \
      "$name" "$(money "$opening")" "$(money "$total")" \
      "$(money "$stored")" "$(money "$expected")" "$(money "$drift")"
  done <<< "$VIOLATIONS"
  echo ""
  echo "Do NOT correct a transaction without correcting the opening that was absorbing"
  echo "it — otherwise a currently-correct balance becomes wrong."
fi

if [ -n "$NET_DRIFT" ]; then
  fail=1
  echo ""
  echo "✗ NETAMOUNT DRIFT — the invariant above cannot see this"
  echo ""
  echo "These rows' netAmount no longer equals their amount, which means something"
  echo "wrote the ledger without recalculating it (ADR-013). The balance invariant"
  echo "passes anyway, because it sums the same drifted netAmount the balance was"
  echo "built from."
  echo ""
  printf '%-26s %-24s %14s %14s\n' "ID" "NAME" "AMOUNT" "NETAMOUNT"
  while IFS='|' read -r id name amount net; do
    [ -z "$id" ] && continue
    printf '%-26s %-24s %14s %14s\n' "$id" "${name:0:24}" "$(money "$amount")" "$(money "$net")"
  done <<< "$NET_DRIFT"
fi

if [ "$fail" -eq 1 ]; then
  exit 1
fi

ACCOUNTS=$(sqlite3 "$DB" 'SELECT count(*) FROM "Account";' 2>/dev/null || echo '?')
TXNS=$(sqlite3 "$DB" 'SELECT count(*) FROM "Transaction";' 2>/dev/null || echo '?')
echo "✓ openingBalance + SUM(transactions) == balance for all $ACCOUNTS accounts."
echo "✓ netAmount == amount on every one of $TXNS transactions."
exit 0
