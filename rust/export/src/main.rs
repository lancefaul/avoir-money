//! Versioned JSON export — the portable backup format, and the Postgres→SQLite
//! migration path. One mechanism serving both (BACKLOG, Portable Backup System).
//!
//! READ-ONLY BY CONSTRUCTION. Every statement this program issues is a SELECT.
//! It is routinely pointed at the production database and must never write.
//!
//! Decimal policy (ADR-033, Option A): the export is *faithful*. Numerics are
//! emitted exactly as stored, including the 34 known float-noise values, so the
//! file round-trips back into Postgres unchanged and remains a true backup.
//! Conversion to integer cents happens on IMPORT, which is what owns the target
//! schema. The classification manifest travels inside the file so an importer
//! years from now knows how each numeric was meant to be read.

use anyhow::{Context, Result};
use serde_json::{json, Map, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::AssertSqlSafe;
use sqlx::{postgres::PgPool, Row};

/// Bump only when the export *shape* changes, not every release.
const FORMAT_VERSION: u32 = 1;

/// Tables whose rows hold a third-party credential and are never written to the
/// export. Shared with the backup path so the two cannot disagree — see
/// `avoir_db::CREDENTIAL_TABLES`.
use avoir_db::CREDENTIAL_TABLES;

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be set (the database to export FROM)")?;
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "export.json".into());

    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .context("could not connect")?;

    let db: String = sqlx::query("SELECT current_database()")
        .fetch_one(&pool)
        .await?
        .get(0);
    eprintln!("exporting from database `{db}`");

    let tables = table_order(&pool).await?;
    eprintln!("{} tables, in FK dependency order", tables.len());

    let classes = column_classes(&pool).await?;
    eprintln!(
        "{} numeric columns classified",
        classes.as_array().map_or(0, |a| a.len())
    );

    let mut data = Map::new();
    let mut counts = Map::new();
    for t in &tables {
        // Credentials are never exported. This file travels — it is the
        // portable backup format and the migration path — and a third-party API
        // key inside it would leak with every copy. The table is still listed in
        // `tableOrder` and reported with a count of 0, so the import creates it
        // and the user re-enters the key once, rather than the table silently
        // not existing. Backups make the same exclusion, for the same reason.
        if CREDENTIAL_TABLES.contains(&t.as_str()) {
            counts.insert(t.clone(), json!(0));
            data.insert(t.clone(), json!([]));
            eprintln!("  {t:<24} {:>6}  (credentials, never exported)", 0);
            continue;
        }
        let rows = dump_table(&pool, t).await?;
        let n = rows.as_array().map_or(0, |a| a.len());
        counts.insert(t.clone(), json!(n));
        data.insert(t.clone(), rows);
        eprintln!("  {t:<24} {n:>6} rows");
    }

    let envelope = json!({
        "version": FORMAT_VERSION,
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "source": { "engine": "postgresql", "database": db },
        // Self-describing: every numeric is a STRING in `data`, and this says
        // what each one means and how it should land on SQLite.
        "numericPolicy": {
            "encoding": "string",
            "rationale": "JSON numbers are parsed as float64; a ledger cannot survive that round trip",
            "columns": classes
        },
        "tableOrder": tables,
        "rowCounts": counts,
        "data": data
    });

    let text = serde_json::to_string_pretty(&envelope)?;

    // Encrypted when AVOIR_EXPORT_PASSPHRASE is set.
    //
    // Opt-in rather than mandatory, because this file is also the
    // Postgres→SQLite migration path and a required passphrase there would be
    // ceremony around a file that never leaves the machine. The threat this
    // closes is the export that DOES leave — cloud storage, a USB stick,
    // another machine — and that is a decision the person running it makes.
    //
    // The passphrase arrives by environment rather than argument so it does not
    // land in shell history or in `ps` output.
    let (bytes, out, note) = match std::env::var("AVOIR_EXPORT_PASSPHRASE") {
        Ok(p) if !p.is_empty() => {
            let sealed = avoir_db::portable::encrypt(text.as_bytes(), &p)
                .context("could not encrypt the export")?;
            let path = format!("{out}{}", avoir_db::portable::ENCRYPTED_SUFFIX);
            (sealed, path, " (encrypted)")
        }
        _ => (text.into_bytes(), out, ""),
    };

    std::fs::write(&out, &bytes)?;
    eprintln!(
        "\nwrote {out} ({:.1} MB){note}",
        bytes.len() as f64 / 1_048_576.0
    );
    if note.is_empty() {
        eprintln!(
            "  This file holds every transaction in plain text. Set \
AVOIR_EXPORT_PASSPHRASE to encrypt it before it goes anywhere."
        );
    }
    Ok(())
}

/// Tables in FK dependency order, so an importer can insert without deferring
/// constraints. Kahn's algorithm over the FK graph; self-references (Transaction
/// .parentId) are ignored as edges since they are satisfied within a table.
async fn table_order(pool: &PgPool) -> Result<Vec<String>> {
    let all: Vec<String> = sqlx::query(
        "SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
         ORDER BY tablename",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|r| r.get::<String, _>(0))
    .collect();

    // child depends on parent
    let edges: Vec<(String, String)> = sqlx::query(
        "SELECT DISTINCT
                c.conrelid::regclass::text  AS child,
                c.confrelid::regclass::text AS parent
         FROM pg_constraint c
         WHERE c.contype = 'f' AND c.conrelid <> c.confrelid",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|r| {
        (
            r.get::<String, _>(0).trim_matches('"').to_string(),
            r.get::<String, _>(1).trim_matches('"').to_string(),
        )
    })
    .collect();

    let mut ordered: Vec<String> = Vec::new();
    let mut remaining: Vec<String> = all.clone();

    while !remaining.is_empty() {
        // A table is ready when every parent it depends on is already emitted.
        let ready: Vec<String> = remaining
            .iter()
            .filter(|t| {
                edges
                    .iter()
                    .filter(|(child, _)| child == *t)
                    .all(|(_, parent)| ordered.contains(parent) || !all.contains(parent))
            })
            .cloned()
            .collect();

        if ready.is_empty() {
            // A cycle. Emit the rest alphabetically rather than looping forever;
            // the importer will need deferred constraints for these.
            eprintln!("  ! FK cycle among {remaining:?} — emitting unordered");
            ordered.extend(remaining.iter().cloned());
            break;
        }
        for t in &ready {
            ordered.push(t.clone());
        }
        remaining.retain(|t| !ready.contains(t));
    }

    Ok(ordered)
}

/// The classification manifest, generated from the live catalog so it can never
/// drift from the schema it describes.
async fn column_classes(pool: &PgPool) -> Result<Value> {
    let sql = include_str!("../../classify-columns.sql");
    let row = sqlx::query(AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await
        .context("classification query failed")?;
    let v: Option<Value> = row.get(0);
    let v = v.unwrap_or(Value::Array(vec![]));

    if let Some(arr) = v.as_array() {
        let unclassified: Vec<&Value> = arr.iter().filter(|c| c["class"].is_null()).collect();
        if !unclassified.is_empty() {
            anyhow::bail!(
                "{} numeric column(s) are not classified in classify-columns.sql: {:?}",
                unclassified.len(),
                unclassified
                    .iter()
                    .map(|c| format!(
                        "{}.{}",
                        c["table"].as_str().unwrap_or("?"),
                        c["column"].as_str().unwrap_or("?")
                    ))
                    .collect::<Vec<_>>()
            );
        }
    }
    Ok(v)
}

/// Dump one table as a JSON array, with every value that JSON cannot hold
/// safely cast to text first.
async fn dump_table(pool: &PgPool, table: &str) -> Result<Value> {
    // Column list straight from the catalog. `numeric` and `int8` both become
    // text: numeric because JSON floats destroy decimals, int8 because values
    // beyond 2^53 lose precision in a JSON number (Backup.sizeBytes is bigint).
    //
    // Numerics go through `trim_scale` first. A bare `::text` pads every value
    // to the column's DECIMAL(65,30) declared scale — 2345.67 becomes
    // 2345.67 — and that 30 is Prisma's default,
    // not a statement about precision (ADR-033). Encoding it would bake an
    // artifact of the engine we are leaving into an engine-independent format.
    // Verified lossless on production: 2534/2534 Transaction.amount values and
    // all 724 InvestmentSnapshot.quantity values compare IS NOT DISTINCT FROM
    // their trimmed form.
    let cols: Vec<(String, String)> = sqlx::query(
        "SELECT column_name, udt_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position",
    )
    .bind(table)
    .fetch_all(pool)
    .await?
    .iter()
    .map(|r| (r.get::<String, _>(0), r.get::<String, _>(1)))
    .collect();

    let select_list = cols
        .iter()
        .map(|(name, udt)| {
            let quoted = format!("\"{}\"", name.replace('"', "\"\""));
            match udt.as_str() {
                "numeric" => format!("trim_scale({quoted})::text AS {quoted}"),
                "int8" => format!("{quoted}::text AS {quoted}"),
                "bytea" => format!("encode({quoted}, 'base64') AS {quoted}"),
                _ => quoted,
            }
        })
        .collect::<Vec<_>>()
        .join(", ");

    // Dynamic SQL, audited: `table` comes from pg_tables and every column name
    // comes from information_schema — both are catalog-derived, never user
    // input, and identifiers are quoted. This is the case AssertSqlSafe exists
    // for. See sqlx 0.9's SqlSafeStr docs.
    let sql = format!(
        "SELECT COALESCE(json_agg(t ORDER BY 1), '[]'::json) FROM (SELECT {select_list} FROM \"{}\") t",
        table.replace('"', "\"\"")
    );

    let row = sqlx::query(AssertSqlSafe(sql))
        .fetch_one(pool)
        .await
        .with_context(|| format!("dumping table {table}"))?;
    Ok(row.get(0))
}
