//! Versioned JSON import — JSON envelope → SQLite.
//!
//! This is where the ADR-033 conversion happens: money and percentages become
//! INTEGER scaled by 100, quantities and unit prices stay exact decimal TEXT.
//! The export stayed faithful precisely so that this step — the lossy one —
//! is explicit, in one place, and testable.
//!
//! The whole import runs in ONE transaction. A partial import of a ledger is
//! worse than no import.

use anyhow::{bail, Context, Result};
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::Value;

use sqlx::{AssertSqlSafe, Row};
use std::collections::HashMap;
use std::str::FromStr;

/// The format version this binary produces after running the transformer chain.
const CURRENT_VERSION: u32 = 1;

/// Money scale: 2 decimal places, stored as integer hundredths.
const SCALE: u32 = 2;

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let json_path = args
        .next()
        .context("usage: avoir-import <export.json> <out.db>")?;
    let db_path = args.next().unwrap_or_else(|| "avoir.db".into());

    // Read as BYTES first, because the file may be encrypted.
    //
    // Detected from the content rather than the extension, so a renamed file
    // still imports and a plain file never prompts for a passphrase it does not
    // need.
    let bytes = std::fs::read(&json_path).with_context(|| format!("reading {json_path}"))?;
    let raw = if avoir_db::portable::is_encrypted(&bytes) {
        let pass = std::env::var("AVOIR_EXPORT_PASSPHRASE").unwrap_or_default();
        if pass.is_empty() {
            anyhow::bail!(
                "{json_path} is encrypted. Set AVOIR_EXPORT_PASSPHRASE to the \
passphrase it was written with."
            );
        }
        let plain = avoir_db::portable::decrypt(&bytes, &pass)?;
        String::from_utf8(plain).context("the decrypted export is not text")?
    } else {
        String::from_utf8(bytes).with_context(|| format!("{json_path} is not text"))?
    };
    let mut env: Value = serde_json::from_str(&raw).context("parsing export JSON")?;

    // ---- transformer chain -------------------------------------------------
    let from = env["version"].as_u64().context("export has no `version`")? as u32;
    let steps = migrate(&mut env, from)?;
    if steps.is_empty() {
        println!("format v{from} — already current");
    } else {
        for s in &steps {
            println!("  transformed {s}");
        }
    }

    // ---- classification ----------------------------------------------------
    // Read from the file, not from this binary. The export embedded it so that
    // a file written years ago still describes itself.
    let mut class: HashMap<String, String> = HashMap::new();
    for c in env["numericPolicy"]["columns"]
        .as_array()
        .context("export has no numericPolicy.columns — cannot type its numerics")?
    {
        class.insert(
            format!(
                "{}.{}",
                c["table"].as_str().unwrap_or(""),
                c["column"].as_str().unwrap_or("")
            ),
            c["class"].as_str().unwrap_or("").to_string(),
        );
    }
    if env["numericPolicy"]["encoding"].as_str() != Some("string") {
        bail!("export does not declare string-encoded numerics; refusing to guess");
    }

    // ---- target ------------------------------------------------------------
    //
    // The schema is built by the APP'S OWN MIGRATIONS, via the same `connect`
    // the desktop shell calls. It used to apply `rust/sqlite-baseline.sql`
    // through `raw_sql`, and that was wrong in two compounding ways:
    //
    //  1. That file is a byte-identical COPY of migration 0001, and it never
    //     receives the later ones. An imported database therefore had the
    //     0001-era schema — no SCHEDULED backup source (0005), the old
    //     ConnectedService cipher columns (0004), `feeAmount` still INTEGER
    //     (0003). Two schema definitions that had to agree, and had already
    //     drifted by four migrations.
    //  2. `raw_sql` leaves `_sqlx_migrations` empty, so `connect` believed
    //     nothing had been applied and tried to run migration 1 against tables
    //     that already existed. The app could not open its own import.
    //
    // Both vanish here rather than being kept in step by hand: there is now one
    // schema, and the bookkeeping is correct by construction.
    let _ = std::fs::remove_file(&db_path);
    let pool = avoir_db::connect(&format!("sqlite:{db_path}"))
        .await
        .context("creating the target database from the app's migrations")?;

    // ---- load --------------------------------------------------------------
    let order: Vec<String> = env["tableOrder"]
        .as_array()
        .context("export has no tableOrder")?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    let mut tx = pool.begin().await?;

    // Two tables self-reference — Account.parentAccountId and Transaction.parentId
    // (the ADR-030 split children). Rows arrive in id order, which says nothing
    // about hierarchy, so a child can precede its parent. Deferring enforcement
    // to COMMIT handles that without topologically sorting rows inside every
    // table. Note this does NOT weaken the check: every FK is still validated,
    // just all at once at commit, so a genuine orphan still aborts the import.
    sqlx::query("PRAGMA defer_foreign_keys = ON")
        .execute(&mut *tx)
        .await?;

    let mut total = 0usize;
    let mut converted = 0usize;
    let mut rounded: Vec<String> = vec![];

    for table in &order {
        let rows = match env["data"][table].as_array() {
            Some(r) if !r.is_empty() => r.clone(),
            _ => continue,
        };
        let cols: Vec<String> = rows[0]
            .as_object()
            .context("row is not an object")?
            .keys()
            .cloned()
            .collect();

        // Dynamic SQL, audited: table and column names come from the export's
        // own catalog-derived structure, and every VALUE is bound. Identifiers
        // are quoted.
        let placeholders = vec!["?"; cols.len()].join(", ");
        let collist = cols
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!("INSERT INTO \"{table}\" ({collist}) VALUES ({placeholders})");

        for row in &rows {
            let mut q = sqlx::query(AssertSqlSafe(sql.clone()));
            for c in &cols {
                let key = format!("{table}.{c}");
                let v = &row[c];
                q = match class.get(&key).map(String::as_str) {
                    Some("money") | Some("percentage") => {
                        let (bound, was_rounded) = to_scaled_int_reporting(v, &key)?;
                        if was_rounded {
                            converted += 1;
                            if rounded.len() < 6 {
                                rounded.push(format!("{key} {}", v.as_str().unwrap_or("?")));
                            }
                        }
                        q.bind(bound)
                    }
                    // quantity / unit_price stay exact decimal text
                    _ => bind_plain(q, v),
                };
            }
            q.execute(&mut *tx)
                .await
                .with_context(|| format!("inserting into {table}"))?;
            total += 1;
        }
        println!("  {table:<24} {:>6} rows", rows.len());
    }

    tx.commit().await?;

    println!("\n{total} rows imported into {db_path}");
    println!("{converted} money values needed rounding to the cent:");
    for r in &rounded {
        println!("    {r}");
    }
    if converted > rounded.len() {
        println!("    … and {} more", converted - rounded.len());
    }

    verify(&pool, &env).await?;
    Ok(())
}

/// Applies transformers in sequence, v(N) → v(N+1), until the file is current.
///
/// Transformers are never deleted — a v1 file must still import in ten years.
/// v1 is the baseline so the chain is currently empty; the machinery exists now
/// so that the first schema change has somewhere to go.
fn migrate(env: &mut Value, from: u32) -> Result<Vec<String>> {
    let applied = vec![];
    let v = from;
    if v > CURRENT_VERSION {
        bail!("export is format v{v}, this build understands up to v{CURRENT_VERSION}");
    }
    // Empty for v1 — there is nothing to transform yet. Clippy correctly notes
    // the loop cannot iterate; the shape is deliberate, so the first schema
    // change has somewhere to go rather than needing the machinery invented
    // under pressure.
    #[allow(clippy::never_loop)]
    while v < CURRENT_VERSION {
        // The match is the registry: each future version gets an arm here.
        // Clippy is right that one arm could be inlined today; keeping the
        // shape is the point, so the first schema change adds a line rather
        // than inventing the structure under pressure.
        #[allow(clippy::match_single_binding)]
        match v {
            // 1 => { transform_v1_to_v2(env)?; applied.push("v1→v2".into()); }
            _ => bail!("no transformer registered for v{v}→v{}", v + 1),
        }
        #[allow(unreachable_code)]
        {
            v += 1;
        }
    }
    let _ = env;
    Ok(applied)
}

/// Exact decimal → scaled integer. Never touches f64.
///
/// Rounding is away-from-zero at the midpoint, the conventional choice for
/// money. Measured against production first: the database contains exactly one
/// exact half-cent value (`CategoryBudget.highWaterMark = 180.625`) and it is
/// positive, so every candidate strategy agrees on today's data. The choice
/// governs future behaviour, not this migration.
fn to_scaled_int(v: &Value, key: &str) -> Result<Option<i64>> {
    let s = match v {
        Value::Null => return Ok(None),
        Value::String(s) => s,
        other => bail!("{key}: expected a string-encoded decimal, got {other}"),
    };
    let d = Decimal::from_str(s).with_context(|| format!("{key}: not a decimal: {s}"))?;
    let scaled = d * Decimal::from(10_i64.pow(SCALE));
    let r = scaled.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
    let i = r
        .to_i64()
        .with_context(|| format!("{key}: {s} overflows i64 cents"))?;
    Ok(Some(i))
}

/// Marker so the caller can report which values lost precision.
fn to_scaled_int_reporting(v: &Value, key: &str) -> Result<(Option<i64>, bool)> {
    let before = v.as_str().and_then(|s| Decimal::from_str(s).ok());
    let out = to_scaled_int(v, key)?;
    let changed = match (before, out) {
        (Some(b), Some(i)) => b != Decimal::new(i, SCALE),
        _ => false,
    };
    Ok((out, changed))
}

fn bind_plain<'q>(
    q: sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments>,
    v: &Value,
) -> sqlx::query::Query<'q, sqlx::Sqlite, sqlx::sqlite::SqliteArguments> {
    match v {
        Value::Null => q.bind(None::<String>),
        Value::Bool(b) => q.bind(if *b { 1_i64 } else { 0_i64 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                q.bind(i)
            } else {
                // Should not occur: the export string-encodes everything that
                // cannot survive as a JSON number.
                q.bind(n.to_string())
            }
        }
        // A timestamp is rewritten into the app's ONE canonical spelling.
        //
        // Postgres hands these over as `2026-01-07T00:00:00`, and the app writes
        // `2026-01-07T00:00:00.000Z` (`id::now_iso`). SQLite has no date type,
        // so the string IS the value and every comparison is lexicographic —
        // which makes two spellings of the same instant genuinely different
        // values. `'2026-01-07T00:00:00' >= '2026-01-07T00:00:00.000Z'` is
        // FALSE, because the shorter string sorts first.
        //
        // Measured, not theorised: with the raw import, 19 real transactions
        // dated 2026-01-07 were returned by ZERO of the API's own range queries
        // for that day. Every dashboard window, transaction filter and
        // reconciliation period silently dropped the rows on its first day.
        Value::String(s) => match canonical_timestamp(s) {
            Some(t) => q.bind(t),
            None => q.bind(s.clone()),
        },
        // jsonb columns and int[] keep their JSON text form.
        other => q.bind(other.to_string()),
    }
}

/// Rewrite a timestamp into `%Y-%m-%dT%H:%M:%S%.3fZ`, or `None` if the string
/// is not one.
///
/// **Requires a time component.** A bare `2026-01-07` is left alone: date-only
/// columns do not occur here, and the cost of being wrong is asymmetric — a note
/// or a description that merely looks like a date would be silently rewritten,
/// which is worse than leaving a format alone that nothing compares against.
///
/// Offsets are honoured and converted to UTC rather than truncated, so a value
/// carrying `+02:00` lands on the correct instant instead of two hours early.
fn canonical_timestamp(s: &str) -> Option<String> {
    use chrono::{DateTime, NaiveDateTime, Utc};
    const OUT: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc).format(OUT).to_string());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.format(OUT).to_string());
        }
    }
    None
}

/// Proves the import rather than trusting it: row counts, and the ledger
/// invariant that ADR-033 exists to protect — computed in SQL, on integers.
async fn verify(pool: &sqlx::SqlitePool, env: &Value) -> Result<()> {
    println!("\nverification");

    let mut bad = 0;
    for (table, want) in env["rowCounts"].as_object().context("no rowCounts")? {
        let got: i64 = sqlx::query(AssertSqlSafe(format!("SELECT count(*) FROM \"{table}\"")))
            .fetch_one(pool)
            .await?
            .get(0);
        let want = want.as_i64().unwrap_or(-1);
        if got != want {
            println!("  ROW COUNT MISMATCH {table}: sqlite {got}, export {want}");
            bad += 1;
        }
    }
    println!(
        "  row counts: {} tables, {bad} mismatches",
        env["rowCounts"].as_object().map_or(0, |m| m.len())
    );

    // openingBalance + SUM(signed transactions) == balance, in integer cents.
    // Deliberately a restatement of the sign rules rather than a shared helper
    // (QUALITY.md: the three restatements must be independent).
    let rows = sqlx::query(
        r#"
        SELECT a.id, a.name, a."openingBalance" AS opening, a.balance AS balance,
               COALESCE((
                 SELECT SUM(CASE t.type
                        WHEN 'INCOME'   THEN  t."netAmount"
                        WHEN 'REFUND'   THEN  t."netAmount"
                        WHEN 'EXPENSE'  THEN -t."netAmount"
                        WHEN 'TRANSFER' THEN -t."netAmount"
                        WHEN 'TRADE'    THEN CASE d.direction
                                                 WHEN 'BUY'  THEN -t."netAmount"
                                                 WHEN 'SELL' THEN  t."netAmount"
                                                 ELSE 0 END
                        ELSE 0 END)
                 FROM "Transaction" t
                 LEFT JOIN "TradeDetail" d ON d."transactionId" = t.id
                 WHERE t."accountId" = a.id AND t."parentId" IS NULL
               ), 0) AS outbound,
               COALESCE((
                 SELECT SUM(t."netAmount") FROM "Transaction" t
                 WHERE t."toAccountId" = a.id AND t.type = 'TRANSFER' AND t."parentId" IS NULL
               ), 0) AS inbound
        FROM "Account" a ORDER BY a.name
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut off = 0;
    for r in &rows {
        let (opening, balance, out_, in_): (i64, i64, i64, i64) = (
            r.get("opening"),
            r.get("balance"),
            r.get("outbound"),
            r.get("inbound"),
        );
        let residual = opening + out_ + in_ - balance;
        if residual != 0 {
            off += 1;
            println!(
                "    {:<28} residual {:>12}",
                r.get::<String, _>("name"),
                format_cents(residual)
            );
        }
    }
    println!(
        "  ledger invariant: {} accounts, {} with a non-zero residual",
        rows.len(),
        off
    );
    if off > 0 {
        bail!("ledger invariant violated on {off} account(s) after import");
    }
    Ok(())
}

fn format_cents(c: i64) -> String {
    format!("{}.{:02}", c / 100, (c % 100).abs())
}

#[cfg(test)]
mod tests {
    use super::canonical_timestamp;

    const CANON: &str = "2026-01-07T00:00:00.000Z";

    #[test]
    fn postgres_spelling_becomes_the_apps_spelling() {
        // The actual defect: Postgres exports this, the app writes CANON, and
        // SQLite compares them as strings — so the same instant was two values
        // and range queries dropped whole days.
        assert_eq!(
            canonical_timestamp("2026-01-07T00:00:00").as_deref(),
            Some(CANON)
        );
        assert_eq!(
            canonical_timestamp("2026-01-07 00:00:00").as_deref(),
            Some(CANON)
        );
    }

    #[test]
    fn an_already_canonical_value_is_unchanged() {
        assert_eq!(canonical_timestamp(CANON).as_deref(), Some(CANON));
    }

    #[test]
    fn fractional_seconds_are_normalised_to_milliseconds() {
        assert_eq!(
            canonical_timestamp("2026-01-07T00:00:00.123456").as_deref(),
            Some("2026-01-07T00:00:00.123Z")
        );
    }

    #[test]
    fn an_offset_is_converted_rather_than_truncated() {
        // Dropping the offset would land two hours early — the ADR-003 bug in a
        // new coat.
        assert_eq!(
            canonical_timestamp("2026-01-07T02:00:00+02:00").as_deref(),
            Some(CANON)
        );
    }

    #[test]
    fn a_bare_date_is_left_alone() {
        // Date-only columns do not occur, and the cost of being wrong is
        // asymmetric: a note that merely looks like a date must not be rewritten.
        assert_eq!(canonical_timestamp("2026-01-07"), None);
    }

    #[test]
    fn ordinary_text_is_never_touched() {
        for s in [
            "Coffee shop",
            "",
            "2026",
            "not a date",
            "COSTCO WHSE #1234",
            "2026-13-45T99:99:99",
        ] {
            assert_eq!(canonical_timestamp(s), None, "{s:?}");
        }
    }

    #[test]
    fn every_output_sorts_against_every_other_the_way_the_dates_do() {
        // The property the whole fix exists for: after normalisation,
        // lexicographic order IS chronological order.
        let mut got: Vec<String> = [
            "2026-01-07 00:00:00",
            "2025-12-31T23:59:59",
            "2026-01-07T00:00:00.500",
        ]
        .iter()
        .map(|s| canonical_timestamp(s).unwrap())
        .collect();
        let expected = vec![
            "2025-12-31T23:59:59.000Z".to_string(),
            "2026-01-07T00:00:00.000Z".to_string(),
            "2026-01-07T00:00:00.500Z".to_string(),
        ];
        got.sort();
        assert_eq!(got, expected);
    }
}
