//! Database layer — sqlx over SQLite (ADR-034).
//!
//! The schema is `migrations/0001_baseline.sql`, generated once from the
//! Postgres catalog and thereafter maintained by hand. It has been proven
//! against a full production dataset by the JSON import.

pub mod backup;
pub mod balance;
pub mod budget_links;
pub mod bulk_delete;
pub mod debt_payment;
pub mod holdings;
pub mod ledger;
pub mod pay_period;
pub mod portable;
pub mod reconciliation;
pub mod schedule_generator;
pub mod schedule_matcher;
pub mod snapshot;
pub mod system_budget;
pub mod transfers;
pub mod upload_staging;

use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

/// Open a pool and apply migrations.
///
/// `foreign_keys` is ON deliberately: SQLite defaults it OFF per connection,
/// and the schema's 51 foreign keys are worth nothing without it. The one place
/// that must relax it is a bulk import, which defers rather than disables.
pub async fn connect(url: &str) -> Result<SqlitePool> {
    let opts = SqliteConnectOptions::from_str(url)?
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// An in-memory database with the schema applied — for tests.
///
/// `max_connections(1)` matters more than it looks: each connection to
/// `sqlite::memory:` gets its OWN database, so a pool of several would hand
/// different callers different empty databases and the failures would look
/// like phantom data loss.
pub async fn connect_in_memory() -> Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::from_str("sqlite::memory:")?.foreign_keys(true))
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;
    Ok(pool)
}

/// Tables whose rows hold a third-party credential.
///
/// **One list, because two rules that must agree will not.** Both routes out of
/// this machine consult it: `backup::create` clears these tables from the copy
/// and vacuums the freed pages, and `avoir-export` writes them out empty. ADR-035
/// removed the encryption on the strength of both holding, so a table that is
/// credential-shaped and missing from here silently undoes that decision.
///
/// `credential_tables_cover_the_schema` in `db/tests/credentials.rs` scans the
/// migrations for credential-shaped columns and fails if one turns up in a table
/// that is not listed. That test is the actual guard — this constant is only
/// where the answer is written down.
pub const CREDENTIAL_TABLES: [&str; 1] = ["ConnectedService"];

/// The current instant in the only timestamp spelling this database holds.
///
/// Must match `api::id::now_iso` exactly. `createdAt` is not decoration here —
/// the balance chain orders on it, and SQLite has no date type, so two
/// spellings in one column would be compared as strings and sort wrongly.
pub fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// A monotonically-unique suffix for generated primary keys.
///
/// The API layer owns real cuid generation; the db layer only needs
/// uniqueness, and a counter plus the clock gives that without pulling an id
/// crate into this layer.
pub fn next_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    format!("{ms:x}{n:x}")
}
