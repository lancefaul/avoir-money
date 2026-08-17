//! The per-transaction balance chain — port of
//! `apps/api/src/lib/lifecycle/hooks/balance.hook.ts`.
//!
//! Every row carries the account balance immediately before and after it. Two
//! ADRs and two ERRORS.md entries are about getting this right, and all of them
//! reduce to the same three rules:
//!
//! 1. **`balanceBefore` comes from the previous row's `balanceAfter`**, not from
//!    the account's current total (ADR-014). The account total includes every
//!    transaction, not the ones up to this point.
//! 2. **Inbound transfers are part of the chain** (ADR-018). A transfer is
//!    outbound for one account and inbound for another, so which column pair it
//!    owns depends on whose chain is being walked. Omitting the inbound leg is
//!    the bug that put a card's ledger tens of thousands out.
//! 3. **A NULL predecessor stops propagation** — except when healing, where a
//!    mid-chain NULL is corruption rather than a boundary. One transient NULL
//!    row otherwise poisons every row after it, permanently and invisibly.
//!
//! Child rows (`parentId` set) are excluded throughout. They carry an
//! `accountId` but do not move the account balance, and including them makes a
//! correct chain look broken — 50 false discontinuities in one 2026-08-02
//! investigation, then 2, before the filter was right.

use anyhow::Result;
use avoir_core::money::Cents;
use sqlx::{Acquire, Row, SqliteConnection};

/// One row participating in an account's chain.
#[derive(Debug, Clone)]
pub struct ChainRow {
    pub id: String,
    pub date: String,
    pub created_at: String,
    /// True when this account is the transfer's DESTINATION, which decides
    /// whether it owns `balanceBefore/After` or `toBalanceBefore/After`.
    pub is_inbound: bool,
    /// Signed cents this row applies to the account being walked.
    pub delta: Cents,
    /// The chain value currently stored, or `None` at a boundary.
    pub existing_before: Option<Cents>,
}

/// The signed effect of a row on its SOURCE account, as SQL.
///
/// Deliberately written out here rather than shared with the ledger-integrity
/// check: QUALITY.md requires the sign rules to be independent restatements, so
/// that a bug in one cannot make the other agree with it.
const SOURCE_DELTA: &str = r#"
    CASE t."type"
        WHEN 'INCOME'   THEN  t."netAmount"
        WHEN 'REFUND'   THEN  t."netAmount"
        WHEN 'EXPENSE'  THEN -t."netAmount"
        WHEN 'TRANSFER' THEN -t."netAmount"
        WHEN 'TRADE'    THEN CASE d."direction"
                                 WHEN 'BUY'  THEN -t."netAmount"
                                 WHEN 'SELL' THEN  t."netAmount"
                                 ELSE 0 END
        ELSE 0
    END
"#;

/// Every chain row for an account strictly after the given position, in order.
///
/// One `UNION ALL` rather than two queries and an in-memory merge. That merge
/// is where ADR-018's bug lived, and `account-balance.ts` repeated the omission
/// months later — expressing it as a single ordered statement removes the shape
/// the defect needs.
pub async fn chain_after(
    conn: &mut SqliteConnection,
    account_id: &str,
    after_date: &str,
    after_created_at: &str,
    after_id: &str,
) -> Result<Vec<ChainRow>> {
    let sql = format!(
        r#"
        SELECT t."id" AS id, t."date" AS date, t."createdAt" AS created_at,
               0 AS is_inbound, {SOURCE_DELTA} AS delta,
               t."balanceBefore" AS existing_before
        FROM "Transaction" t
        LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
        WHERE t."accountId" = ?1 AND t."parentId" IS NULL
          AND (t."date" > ?2
               OR (t."date" = ?2 AND t."createdAt" > ?3)
               OR (t."date" = ?2 AND t."createdAt" = ?3 AND t."id" > ?4))

        UNION ALL

        SELECT t."id", t."date", t."createdAt",
               1, t."netAmount",
               t."toBalanceBefore"
        FROM "Transaction" t
        WHERE t."toAccountId" = ?1 AND t."type" = 'TRANSFER' AND t."parentId" IS NULL
          AND (t."date" > ?2
               OR (t."date" = ?2 AND t."createdAt" > ?3)
               OR (t."date" = ?2 AND t."createdAt" = ?3 AND t."id" > ?4))

        ORDER BY date, created_at, id
        "#
    );

    // Audited dynamic SQL: the only interpolation is SOURCE_DELTA, a private
    // const in this file. Every value is bound.
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(account_id)
        .bind(after_date)
        .bind(after_created_at)
        .bind(after_id)
        .fetch_all(&mut *conn)
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| ChainRow {
            id: r.get("id"),
            date: r.get("date"),
            created_at: r.get("created_at"),
            is_inbound: r.get::<i64, _>("is_inbound") == 1,
            delta: Cents(r.get::<i64, _>("delta")),
            existing_before: r.get::<Option<i64>, _>("existing_before").map(Cents),
        })
        .collect())
}

/// Rewrite the chain forward from a known-good position.
///
/// Returns how many rows were written. Stops at the first row that already
/// agrees (convergence) so an edit deep in history does not rewrite everything
/// after it, and at the first NULL unless `fill_nulls` is set.
///
/// `fill_nulls` is the self-heal path. ADR-014's boundary rule means a NULL
/// predecessor stops propagation — which also stops REPAIR at bad data, so one
/// transient NULL row leaves every later row permanently blank. Writing through
/// the gap is how that heals on the next entry.
pub async fn recalculate_chain_forward(
    conn: &mut SqliteConnection,
    account_id: &str,
    after_date: &str,
    after_created_at: &str,
    after_id: &str,
    starting_balance_after: Cents,
    fill_nulls: bool,
) -> Result<usize> {
    let rows = chain_after(conn, account_id, after_date, after_created_at, after_id).await?;

    let mut running = starting_balance_after;
    let mut written = 0usize;

    for r in &rows {
        match r.existing_before {
            None if !fill_nulls => break,
            // Convergence: once a row's stored `balanceBefore` already equals
            // the running balance, every row after it is consistent too, so the
            // walk stops. This is what makes the incremental path affordable —
            // ADR-014 rejected recomputing the whole chain on every mutation.
            //
            // A FULL REBUILD must not take this exit. `fill_nulls` doubles as
            // "this is a rebuild": a repair that stops at the first healthy row
            // cannot reach a broken one further down, which is exactly what
            // happened to a transaction stranded at the end of its account with
            // NULL chain fields — `rebuild_chain` reported success, wrote the
            // correct account total, and left the row untouched.
            Some(v) if v == running && !fill_nulls => break,
            _ => {}
        }
        let after = running + r.delta;

        if r.is_inbound {
            sqlx::query!(
                r#"UPDATE "Transaction" SET "toBalanceBefore" = ?, "toBalanceAfter" = ? WHERE "id" = ?"#,
                running.0,
                after.0,
                r.id
            )
            .execute(&mut *conn)
            .await?;
        } else {
            sqlx::query!(
                r#"UPDATE "Transaction" SET "balanceBefore" = ?, "balanceAfter" = ? WHERE "id" = ?"#,
                running.0,
                after.0,
                r.id
            )
            .execute(&mut *conn)
            .await?;
        }

        running = after;
        written += 1;
    }

    Ok(written)
}

/// Rebuild an account's whole chain from its opening balance, and write the
/// resulting total back to `Account.balance`.
///
/// **One walk, not two.** The TypeScript's `rebuildBalanceChain` walked the
/// account twice — once over source rows to write per-row values, once over
/// source *and* inbound rows to write the account total — so the total included
/// the card payments and every row's chain did not. Computing both from a single
/// pass is what makes them agree by construction rather than by comment.
pub async fn rebuild_chain(conn: &mut SqliteConnection, account_id: &str) -> Result<Cents> {
    let opening: i64 = sqlx::query!(
        r#"SELECT "openingBalance" AS "opening!: i64" FROM "Account" WHERE "id" = ?"#,
        account_id
    )
    .fetch_one(&mut *conn)
    .await?
    .opening;
    let opening = Cents(opening);

    // Seed from openingBalance, never from zero. Summing from zero is what
    // silently erased the starting figure before `openingBalance` existed.
    recalculate_chain_forward(conn, account_id, "", "", "", opening, true).await?;

    let rows = chain_after(conn, account_id, "", "", "").await?;
    let total = rows.iter().fold(opening, |acc, r| acc + r.delta);

    sqlx::query!(
        r#"UPDATE "Account" SET "balance" = ? WHERE "id" = ?"#,
        total.0,
        account_id
    )
    .execute(&mut *conn)
    .await?;

    Ok(total)
}

/// `openingBalance + SUM(signed transactions) == balance`, per account.
///
/// The independent restatement of the invariant, computed in SQL on integers.
/// Returns the accounts whose residual is non-zero — empty means the ledger is
/// sound.
pub async fn check_invariant(conn: &mut SqliteConnection) -> Result<Vec<(String, Cents)>> {
    let conn = conn.acquire().await?;
    let sql = format!(
        r#"
        SELECT a."id" AS id, a."name" AS name,
               (a."openingBalance"
                + COALESCE((SELECT SUM({SOURCE_DELTA}) FROM "Transaction" t
                            LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
                            WHERE t."accountId" = a."id" AND t."parentId" IS NULL), 0)
                + COALESCE((SELECT SUM(t."netAmount") FROM "Transaction" t
                            WHERE t."toAccountId" = a."id" AND t."type" = 'TRANSFER'
                              AND t."parentId" IS NULL), 0)
                - a."balance") AS residual
        FROM "Account" a
        "#
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .fetch_all(&mut *conn)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let residual: i64 = r.get("residual");
            (residual != 0).then(|| (r.get::<String, _>("name"), Cents(residual)))
        })
        .collect())
}

/// Every row's `netAmount` still equals its `amount`.
///
/// **The ledger invariant is structurally blind to this**, which mutation
/// testing demonstrated rather than argued: `Account.balance` is rebuilt FROM
/// `netAmount` and the invariant SUMS `netAmount`, so a row whose net has
/// drifted from its amount moves both sides together and nets out. The check
/// passes while the ledger is wrong in exactly the way ADR-013 exists to
/// prevent — four code paths once updated `amount` without recalculating
/// `netAmount`, and a card drifted hundreds of dollars.
///
/// This is the ERRORS.md warning made concrete: "an invariant that compares two
/// derived numbers can be satisfied by matching errors". It needs a second,
/// independent check, and this is it.
///
/// (They are equal today because the `rewardsApplied` discount was retired. If
/// a future feature makes net legitimately differ from gross, this becomes a
/// rule about the relationship rather than equality — but it must remain a
/// check the balance invariant cannot absorb.)
pub async fn check_amount_matches_net(
    conn: &mut SqliteConnection,
) -> Result<Vec<(String, Cents, Cents)>> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "amount" AS "amount!: i64", "netAmount" AS "net!: i64"
           FROM "Transaction" WHERE "amount" <> "netAmount""#
    )
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| (r.id, Cents(r.amount), Cents(r.net)))
        .collect())
}
