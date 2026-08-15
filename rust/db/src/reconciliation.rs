//! The residual — the number a reconciliation exists to drive to zero.
//!
//! ```text
//! expected = openingBalance + SUM(signed netAmount of transactions ≤ periodEnd)
//! residual = statementEndingBalance − expected
//! ```
//!
//! `statementEndingBalance` is the only figure in the system that comes from
//! outside the app. Everything else is derived from the app's own data, so the
//! residual is the app's total disagreement with reality, for one account and
//! one period, as a single number.
//!
//! # The epsilon is gone, and that is the point of integer cents
//!
//! The TypeScript carried `RESIDUAL_EPSILON = 0.005` and asked whether
//! `|residual| < epsilon`, because two independently-derived float sums cannot
//! be compared for equality. Both sides here are `i64` sums of the same
//! integers, so **balanced means `residual == 0`** — exactly, with no tolerance
//! to choose and therefore none to get wrong. That matters more than it looks:
//! a tolerance wide enough to absorb float noise is also wide enough to hide a
//! genuine half-cent disagreement, which is precisely what a reconciliation is
//! for.

use anyhow::Result;
use avoir_core::money::Cents;
use sqlx::SqliteConnection;

/// What the app believes, what the bank says, and the gap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Residual {
    pub opening_balance: Cents,
    /// Signed sum of every transaction touching the account on or before
    /// `periodEnd`.
    pub transaction_sum: Cents,
    /// `opening_balance + transaction_sum` — what the app believes it held.
    pub expected_balance: Cents,
    /// The bank's figure, as entered by the user.
    pub statement_ending_balance: Cents,
    /// `statement_ending_balance − expected_balance`.
    pub residual: Cents,
    /// Exact: both sides are integer sums of the same integers.
    pub is_balanced: bool,
    /// Signed sum of everything dated AFTER `periodEnd`.
    ///
    /// Deliberately **not** subtracted from the residual. It is context, not an
    /// explanation: netting it out would let an error inside the period cancel
    /// an equal and opposite error outside it, and both would vanish from the
    /// one number this feature exists to keep honest.
    ///
    /// It is reported because the commonest reason a residual will not close is
    /// that the export and the ending balance were taken at different moments —
    /// an export through the 17th against a balance read on the 20th. When this
    /// figure equals the residual, that is exactly what happened, and the screen
    /// can say so instead of calling the gap unexplained.
    pub activity_after_period_end: Cents,
}

/// The signed contribution of one transaction to an account's balance.
///
/// **A deliberate independent restatement of the sign rules.** The same
/// expression exists in `scripts/check-ledger-integrity.sh`, the ledger-invariant
/// property test, and the `openingBalance` backfill migration. Sharing a helper
/// would let a bug in the production sign rules make this check agree with it,
/// which is the one thing a check must not do. Four copies; if the sign rules
/// change, all four change.
///
/// Note it is NOT `balance::SOURCE_DELTA` for exactly that reason, even though
/// the two say the same thing today.
const SIGNED: &str = r#"
    CASE
      WHEN t."type" IN ('INCOME', 'REFUND') THEN t."netAmount"
      WHEN t."type" = 'EXPENSE' THEN -t."netAmount"
      WHEN t."type" = 'TRANSFER' AND t."toAccountId" = ?1 THEN t."netAmount"
      WHEN t."type" = 'TRANSFER' THEN -t."netAmount"
      WHEN t."type" = 'TRADE' AND d."direction" = 'BUY' THEN -t."netAmount"
      WHEN t."type" = 'TRADE' AND d."direction" = 'SELL' THEN t."netAmount"
      ELSE 0
    END
"#;

/// Signed sums of everything touching an account, split at `period_end`.
///
/// One query with two `FILTER`s rather than two queries with two copies of the
/// CASE. The independence that matters is from the checking scripts, not from
/// ourselves — and a second copy here could disagree with this one, which is the
/// defect class that produced the tens of thousands chain drift.
///
/// `parentId IS NULL` excludes split children, which carry an account but are
/// invisible to every balance query by construction.
pub async fn sums_around(
    conn: &mut SqliteConnection,
    account_id: &str,
    period_end: &str,
) -> Result<(Cents, Cents)> {
    let sql = format!(
        r#"SELECT
             COALESCE(SUM({SIGNED}) FILTER (WHERE t."date" <= ?2), 0) AS through,
             COALESCE(SUM({SIGNED}) FILTER (WHERE t."date" > ?2), 0) AS after
           FROM "Transaction" t
           LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
          WHERE t."parentId" IS NULL
            AND (t."accountId" = ?1 OR (t."toAccountId" = ?1 AND t."type" = 'TRANSFER'))"#
    );
    let row: (i64, i64) = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(account_id)
        .bind(period_end)
        .fetch_one(&mut *conn)
        .await?;
    Ok((Cents(row.0), Cents(row.1)))
}

/// The signed sum of **every** transaction on an account, with no date bound.
///
/// Not the same question as `sums_around`: that one splits at a period end and
/// answers "what does the app believe this account held on that date", while
/// this answers "does the account's stored balance agree with its whole
/// history". A period can balance perfectly on an account whose stored balance
/// is wrong, which is the state the close endpoint refuses to certify.
///
/// Shares the `SIGNED` expression with `sums_around` deliberately. The
/// independence that matters is from the checking scripts and the property test
/// — a second copy *here* could disagree with the one three functions up, which
/// is the defect class that produced the tens of thousands chain drift.
pub async fn account_signed_sum(conn: &mut SqliteConnection, account_id: &str) -> Result<Cents> {
    let sql = format!(
        r#"SELECT COALESCE(SUM({SIGNED}), 0) AS total
             FROM "Transaction" t
             LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
            WHERE t."parentId" IS NULL
              AND (t."accountId" = ?1 OR (t."toAccountId" = ?1 AND t."type" = 'TRANSFER'))"#
    );
    let total: (i64,) = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(account_id)
        .fetch_one(&mut *conn)
        .await?;
    Ok(Cents(total.0))
}

/// Compute a session's residual from live data.
///
/// **Always recomputed, never taken from the caller.** The close endpoint's
/// entire guarantee rests on this being read from the database at the moment of
/// the decision — a client-supplied residual would let a stale screen close a
/// session that no longer balances.
pub async fn compute(conn: &mut SqliteConnection, session_id: &str) -> Result<Option<Residual>> {
    let session = sqlx::query!(
        r#"SELECT s."accountId" AS "account_id!", s."periodEnd" AS "period_end!",
                  s."statementEndingBalance" AS "statement!: i64",
                  a."openingBalance" AS "opening!: i64"
             FROM "ReconciliationSession" s
             JOIN "Account" a ON a."id" = s."accountId"
            WHERE s."id" = ?"#,
        session_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(s) = session else { return Ok(None) };

    let (through, after) = sums_around(conn, &s.account_id, &s.period_end).await?;
    let opening = Cents(s.opening);
    let expected = opening + through;
    let statement = Cents(s.statement);
    let residual = statement - expected;

    Ok(Some(Residual {
        opening_balance: opening,
        transaction_sum: through,
        expected_balance: expected,
        statement_ending_balance: statement,
        residual,
        is_balanced: residual.0 == 0,
        activity_after_period_end: after,
    }))
}
