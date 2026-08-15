//! SPIKE arm A: the balance chain and an interactive transaction, in sqlx.
//!
//! Deliberately uses the compile-time-checked macros (`query!`, `query_as!`)
//! rather than the runtime `query()` API, because criterion 2 of the spike is
//! whether a wrong column name is actually caught at build time.

use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Acquire, SqlitePool};
use std::str::FromStr;

fn header(s: &str) {
    println!("\n\x1b[1m[sqlx] {}\x1b[0m\n{}", s, "─".repeat(s.len() + 7));
}

/// One row participating in an account's balance chain. A transfer appears
/// here twice — once as the source account's outbound row, once as the
/// destination's inbound row — with different columns owned each time (ADR-018).
#[derive(Debug)]
struct ChainEntry {
    id: String,
    date: String,
    created_at: String,
    is_inbound: bool,
    /// Signed cents this row applies to the account being walked.
    delta: i64,
    /// The chain value currently stored, or None at a NULL boundary.
    existing_before: Option<i64>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let db_path = std::env::var("SPIKE_DB").unwrap_or_else(|_| "/tmp/spike-sqlx.db".into());
    let _ = std::fs::remove_file(&db_path);

    let opts = SqliteConnectOptions::from_str(&format!("sqlite:{db_path}"))?
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await?;

    sqlx::raw_sql(include_str!("../../schema.sql")).execute(&pool).await?;

    seed(&pool).await?;
    show_chain(&pool, "before").await?;

    // The real operation: something changed at the head of the chain, walk forward.
    let rewritten = recalculate_chain_forward(&pool, "acct-checking", "1970-01-01", "1970-01-01", "", 100_000, true).await?;
    println!("  rows rewritten: {rewritten}");
    show_chain(&pool, "after").await?;

    interactive_transaction_commit(&pool).await?;
    interactive_transaction_rollback(&pool).await?;
    compile_time_verification_notes();

    Ok(())
}

async fn seed(pool: &SqlitePool) -> Result<()> {
    header("seed");
    // Two accounts; checking opens at $1,000.00, savings at $0.
    for (id, name, opening) in [
        ("acct-checking", "Checking", 100_000i64),
        ("acct-savings", "Savings", 0i64),
    ] {
        sqlx::query!(
            "INSERT INTO account (id, name, opening_balance, balance) VALUES (?, ?, ?, ?)",
            id,
            name,
            opening,
            opening
        )
        .execute(pool)
        .await?;
    }

    // Chronology on Checking:
    //   1. paycheck      INCOME   +2,500.00
    //   2. rent          EXPENSE  -1,200.00
    //   3. inbound xfer  TRANSFER   +471.47  (savings → checking; ADR-018 row)
    //   4. groceries     EXPENSE     -84.32
    //   5. child row     EXPENSE     -50.00  (parent_id set — must be EXCLUDED)
    let rows: &[(&str, &str, Option<&str>, Option<&str>, &str, &str, i64)] = &[
        ("tx1", "acct-checking", None, None, "INCOME", "2026-01-05", 250_000),
        ("tx2", "acct-checking", None, None, "EXPENSE", "2026-01-06", 120_000),
        ("tx3", "acct-savings", Some("acct-checking"), None, "TRANSFER", "2026-01-07", 47_147),
        ("tx4", "acct-checking", None, None, "EXPENSE", "2026-01-08", 8_432),
        ("tx5", "acct-checking", None, Some("tx4"), "EXPENSE", "2026-01-08", 5_000),
    ];

    for (i, (id, acct, to_acct, parent, ty, date, net)) in rows.iter().enumerate() {
        let created = format!("2026-01-01T00:00:{:02}", i);
        sqlx::query!(
            "INSERT INTO txn (id, account_id, to_account_id, parent_id, type, date, created_at, net_amount)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            id,
            acct,
            to_acct,
            parent,
            ty,
            date,
            created,
            net
        )
        .execute(pool)
        .await?;
    }
    println!("  2 accounts, 5 transactions (1 inbound transfer, 1 child row)");
    Ok(())
}

/// The spike's target query: `recalculateChainForward`.
///
/// Merges the account's own rows with inbound transfers, orders the union by
/// (date, created_at, id), then walks it writing each row's chain values in
/// sequence — stopping at a NULL boundary or on convergence.
async fn recalculate_chain_forward(
    pool: &SqlitePool,
    account_id: &str,
    after_date: &str,
    after_created_at: &str,
    after_id: &str,
    starting_balance_after: i64,
    fill_nulls: bool,
) -> Result<usize> {
    header("recalculateChainForward");

    // Both legs in ONE statement. Prisma needed two queries plus an in-memory
    // merge-sort because it cannot express a UNION; SQL can order the union
    // directly, which is also what the composite index is built for.
    let entries = sqlx::query_as!(
        ChainEntry,
        r#"
        SELECT
            id                          AS "id!: String",
            date                        AS "date!: String",
            created_at                  AS "created_at!: String",
            0                           AS "is_inbound!: bool",
            CASE type
                WHEN 'INCOME'   THEN  net_amount
                WHEN 'REFUND'   THEN  net_amount
                WHEN 'EXPENSE'  THEN -net_amount
                WHEN 'TRANSFER' THEN -net_amount
                WHEN 'TRADE'    THEN CASE trade_direction
                                        WHEN 'BUY'  THEN -net_amount
                                        WHEN 'SELL' THEN  net_amount
                                        ELSE 0 END
                ELSE 0
            END                         AS "delta!: i64",
            balance_before              AS "existing_before: i64"
        FROM txn
        WHERE account_id = ?1 AND parent_id IS NULL
          AND (date > ?2 OR (date = ?2 AND created_at > ?3)
               OR (date = ?2 AND created_at = ?3 AND id > ?4))

        UNION ALL

        SELECT
            id                          AS "id!: String",
            date                        AS "date!: String",
            created_at                  AS "created_at!: String",
            1                           AS "is_inbound!: bool",
            net_amount                  AS "delta!: i64",
            to_balance_before           AS "existing_before: i64"
        FROM txn
        WHERE to_account_id = ?1 AND type = 'TRANSFER' AND parent_id IS NULL
          AND (date > ?2 OR (date = ?2 AND created_at > ?3)
               OR (date = ?2 AND created_at = ?3 AND id > ?4))

        ORDER BY date, created_at, id
        "#,
        account_id,
        after_date,
        after_created_at,
        after_id
    )
    .fetch_all(pool)
    .await?;

    println!("  merged chain: {} rows (source + inbound, child rows excluded)", entries.len());

    // The write-back walk runs inside one transaction: a partial rewrite is
    // exactly the NULL-cascade corruption in ERRORS.md.
    let mut tx = pool.begin().await?;
    let mut running = starting_balance_after;
    let mut written = 0usize;

    for e in &entries {
        match e.existing_before {
            None if !fill_nulls => break,               // NULL boundary — stop
            Some(v) if v == running => break,           // converged — stop
            _ => {}
        }
        let after = running + e.delta;

        if e.is_inbound {
            sqlx::query!(
                "UPDATE txn SET to_balance_before = ?, to_balance_after = ? WHERE id = ?",
                running,
                after,
                e.id
            )
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query!(
                "UPDATE txn SET balance_before = ?, balance_after = ? WHERE id = ?",
                running,
                after,
                e.id
            )
            .execute(&mut *tx)
            .await?;
        }
        running = after;
        written += 1;
    }

    sqlx::query!("UPDATE account SET balance = ? WHERE id = ?", running, account_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(written)
}

async fn show_chain(pool: &SqlitePool, label: &str) -> Result<()> {
    let rows = sqlx::query!(
        r#"SELECT id AS "id!", type AS "type!", date AS "date!", net_amount AS "net_amount!",
                  balance_before, balance_after, to_balance_before, to_balance_after, parent_id
           FROM txn ORDER BY date, created_at, id"#
    )
    .fetch_all(pool)
    .await?;

    println!("  chain {label}:");
    for r in rows {
        let (b, a) = if r.to_balance_after.is_some() || r.to_balance_before.is_some() {
            (r.to_balance_before, r.to_balance_after)
        } else {
            (r.balance_before, r.balance_after)
        };
        let fmt = |v: Option<i64>| v.map(|c| format!("{:.2}", c as f64 / 100.0)).unwrap_or_else(|| "—".into());
        println!(
            "    {:4} {:9} {} net {:>10.2}  before {:>10}  after {:>10}{}",
            r.id,
            r.r#type,
            r.date,
            r.net_amount as f64 / 100.0,
            fmt(b),
            fmt(a),
            if r.parent_id.is_some() { "   (child — not in chain)" } else { "" }
        );
    }
    let acct = sqlx::query!(r#"SELECT balance AS "balance!" FROM account WHERE id = 'acct-checking'"#)
        .fetch_one(pool)
        .await?;
    println!("    Account.balance = {:.2}", acct.balance as f64 / 100.0);
    Ok(())
}

/// The ledger gate threads one client through every hook so a merge is
/// all-or-nothing. In sqlx that client is `&mut *tx`, passed by reference.
async fn interactive_transaction_commit(pool: &SqlitePool) -> Result<()> {
    header("interactive transaction — commit path");
    let mut tx = pool.begin().await?;

    // Simulating the ledger gate calling three hooks, each taking the same handle.
    hook_insert_row(&mut tx, "tx-merge-1", 1_000).await?;
    hook_insert_row(&mut tx, "tx-merge-2", 2_000).await?;
    hook_bump_balance(&mut tx, 3_000).await?;

    tx.commit().await?;
    let n = sqlx::query!(r#"SELECT COUNT(*) AS "n!: i64" FROM txn WHERE id LIKE 'tx-merge-%'"#)
        .fetch_one(pool)
        .await?;
    println!("  committed → {} rows present", n.n);
    Ok(())
}

async fn interactive_transaction_rollback(pool: &SqlitePool) -> Result<()> {
    header("interactive transaction — rollback path");
    let before = sqlx::query!(r#"SELECT balance AS "balance!: i64" FROM account WHERE id='acct-checking'"#)
        .fetch_one(pool)
        .await?
        .balance;

    let mut tx = pool.begin().await?;
    hook_insert_row(&mut tx, "tx-doomed-1", 5_000).await?;
    hook_bump_balance(&mut tx, 5_000).await?;

    // A later hook fails — e.g. an FK violation on a custodian that no longer exists.
    let failed = hook_insert_row(&mut tx, "tx-doomed-2", 9_999)
        .await
        .and(sqlx::query!("INSERT INTO txn (id, account_id, type, date, created_at, net_amount) VALUES ('bad','NO-SUCH-ACCOUNT','EXPENSE','2026-01-09','2026-01-09T00:00:00',1)")
            .execute(&mut *tx)
            .await
            .map(|_| ())
            .map_err(anyhow::Error::from));

    println!("  hook 3 failed as designed: {}", failed.is_err());
    tx.rollback().await?;

    let after = sqlx::query!(r#"SELECT balance AS "balance!: i64" FROM account WHERE id='acct-checking'"#)
        .fetch_one(pool)
        .await?
        .balance;
    let leaked = sqlx::query!(r#"SELECT COUNT(*) AS "n!: i64" FROM txn WHERE id LIKE 'tx-doomed-%'"#)
        .fetch_one(pool)
        .await?
        .n;

    println!("  balance before {} / after {} → {}", before, after,
             if before == after { "\x1b[32munchanged\x1b[0m" } else { "\x1b[31mDRIFTED\x1b[0m" });
    println!("  doomed rows surviving: {} → {}", leaked,
             if leaked == 0 { "\x1b[32mall-or-nothing holds\x1b[0m" } else { "\x1b[31mpartial write\x1b[0m" });
    Ok(())
}

/// Note the signature: a hook takes the transaction handle, not the pool.
/// This is the direct analogue of threading `Prisma.TransactionClient`.
async fn hook_insert_row(
    tx: &mut sqlx::SqliteTransaction<'_>,
    id: &str,
    net: i64,
) -> Result<()> {
    let conn = tx.acquire().await?;
    sqlx::query!(
        "INSERT INTO txn (id, account_id, type, date, created_at, net_amount)
         VALUES (?, 'acct-checking', 'EXPENSE', '2026-02-01', '2026-02-01T00:00:00', ?)",
        id,
        net
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn hook_bump_balance(tx: &mut sqlx::SqliteTransaction<'_>, delta: i64) -> Result<()> {
    let conn = tx.acquire().await?;
    sqlx::query!("UPDATE account SET balance = balance - ? WHERE id = 'acct-checking'", delta)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

fn compile_time_verification_notes() {
    header("compile-time verification");
    println!("  Every query above is checked against the live schema at BUILD time.");
    println!("  See spikes/README.md for the exact compiler output when a column");
    println!("  name is wrong — the build fails, the binary is never produced.");
}
