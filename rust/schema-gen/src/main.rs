//! Generates the SQLite baseline schema from the live Postgres catalog.
//!
//! This is scaffolding, not a permanent component. Its OUTPUT — `sqlite-baseline.sql`
//! — is the durable artifact: it becomes the first `sqlx migrate` migration and
//! thereafter the schema is maintained there, not regenerated (ADR-034: "the new
//! baseline is a single SQLite schema").
//!
//! It exists so that 38 tables and 350+ columns are *derived* rather than
//! transcribed by hand, which is the kind of task that silently loses an index
//! or an ON DELETE rule.
//!
//! Type mapping (ADR-033):
//!   numeric, class money|percentage → INTEGER  (scaled by 100)
//!   numeric, class quantity|unit_price → TEXT  (exact decimal, never SQL-aggregated)
//!   text, timestamp, jsonb, enum, int[] → TEXT
//!   bool, int4, int8 → INTEGER

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use sqlx::{postgres::PgPool, Row};
use std::collections::HashMap;
use std::fmt::Write as _;

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await?;

    let classes = numeric_classes(&pool).await?;
    let enums = enum_values(&pool).await?;
    let tables = table_order(&pool).await?;

    let mut out = String::new();
    writeln!(out, "-- SQLite baseline schema for avoir-finance.")?;
    writeln!(
        out,
        "-- GENERATED from the Postgres catalog by rust/schema-gen. Generated once,"
    )?;
    writeln!(
        out,
        "-- then maintained by hand as the first sqlx migration — do not regenerate"
    )?;
    writeln!(out, "-- over local edits.")?;
    writeln!(out, "--")?;
    writeln!(
        out,
        "-- Money and percentages are INTEGER scaled by 100 (ADR-033). Quantities and"
    )?;
    writeln!(
        out,
        "-- unit prices are TEXT exact decimals and must never be SUM/MIN/MAX/ORDER BY"
    )?;
    writeln!(
        out,
        "-- in SQL — SQLite coerces TEXT to float on aggregation and compares it"
    )?;
    writeln!(out, "-- lexicographically.")?;
    writeln!(out)?;
    writeln!(out, "PRAGMA foreign_keys = ON;")?;
    writeln!(out)?;

    for t in &tables {
        let ddl = table_ddl(&pool, t, &classes, &enums).await?;
        writeln!(out, "{ddl}")?;
    }

    for t in &tables {
        let idx = index_ddl(&pool, t).await?;
        if !idx.is_empty() {
            writeln!(out, "{idx}")?;
        }
    }

    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "sqlite-baseline.sql".into());
    std::fs::write(&path, &out)?;
    eprintln!(
        "wrote {path} ({} tables, {} lines)",
        tables.len(),
        out.lines().count()
    );
    Ok(())
}

/// class per "Table.column", from the same manifest the export embeds.
async fn numeric_classes(pool: &PgPool) -> Result<HashMap<String, String>> {
    let sql = include_str!("../../classify-columns.sql");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_one(pool)
        .await?;
    let v: Option<serde_json::Value> = row.get(0);
    let mut map = HashMap::new();
    for c in v
        .unwrap_or_default()
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let (t, col, class) = (
            c["table"].as_str().unwrap_or_default().to_string(),
            c["column"].as_str().unwrap_or_default().to_string(),
            c["class"]
                .as_str()
                .context("unclassified numeric column")?
                .to_string(),
        );
        map.insert(format!("{t}.{col}"), class);
    }
    Ok(map)
}

async fn enum_values(pool: &PgPool) -> Result<HashMap<String, Vec<String>>> {
    let rows = sqlx::query(
        "SELECT t.typname, e.enumlabel
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
         ORDER BY t.typname, e.enumsortorder",
    )
    .fetch_all(pool)
    .await?;
    let mut m: HashMap<String, Vec<String>> = HashMap::new();
    for r in rows {
        m.entry(r.get::<String, _>(0))
            .or_default()
            .push(r.get::<String, _>(1));
    }
    Ok(m)
}

async fn table_order(pool: &PgPool) -> Result<Vec<String>> {
    let all: Vec<String> = sqlx::query(
        "SELECT tablename FROM pg_tables
         WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
    )
    .fetch_all(pool)
    .await?
    .iter()
    .map(|r| r.get::<String, _>(0))
    .collect();

    let edges: Vec<(String, String)> = sqlx::query(
        "SELECT DISTINCT c.conrelid::regclass::text, c.confrelid::regclass::text
         FROM pg_constraint c WHERE c.contype='f' AND c.conrelid <> c.confrelid",
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

    let mut ordered: Vec<String> = vec![];
    let mut remaining = all.clone();
    while !remaining.is_empty() {
        let ready: Vec<String> = remaining
            .iter()
            .filter(|t| {
                edges
                    .iter()
                    .filter(|(c, _)| c == *t)
                    .all(|(_, p)| ordered.contains(p) || !all.contains(p))
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            ordered.extend(remaining.iter().cloned());
            break;
        }
        ordered.extend(ready.iter().cloned());
        remaining.retain(|t| !ready.contains(t));
    }
    Ok(ordered)
}

fn sqlite_type(
    table: &str,
    col: &str,
    udt: &str,
    classes: &HashMap<String, String>,
) -> (&'static str, Option<String>) {
    match udt {
        "numeric" => match classes.get(&format!("{table}.{col}")).map(String::as_str) {
            Some("money") | Some("percentage") => ("INTEGER", None),
            _ => ("TEXT", None),
        },
        "bool" | "int4" | "int8" => ("INTEGER", None),
        _ => ("TEXT", None),
    }
}

async fn table_ddl(
    pool: &PgPool,
    table: &str,
    classes: &HashMap<String, String>,
    enums: &HashMap<String, Vec<String>>,
) -> Result<String> {
    let cols = sqlx::query(
        "SELECT column_name, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
    )
    .bind(table)
    .fetch_all(pool)
    .await?;

    let pk: Vec<String> = sqlx::query(
        "SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary",
    )
    .bind(format!("\"{table}\""))
    .fetch_all(pool)
    .await?
    .iter()
    .map(|r| r.get::<String, _>(0))
    .collect();

    let fks = sqlx::query(
        "SELECT kcu.column_name, ccu.table_name, ccu.column_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = tc.constraint_name
         WHERE tc.table_schema='public' AND tc.table_name=$1
           AND tc.constraint_type='FOREIGN KEY'",
    )
    .bind(table)
    .fetch_all(pool)
    .await?;

    let mut s = String::new();
    writeln!(s, "CREATE TABLE \"{table}\" (")?;
    let mut parts: Vec<String> = vec![];

    for c in &cols {
        let name: String = c.get(0);
        let udt: String = c.get(1);
        let nullable: String = c.get(2);
        let (ty, _) = sqlite_type(table, &name, &udt, classes);

        let mut line = format!("    \"{name}\" {ty}");
        if nullable == "NO" {
            line.push_str(" NOT NULL");
        }
        // Enums keep their domain as a CHECK — SQLite has no enum type, and
        // losing the constraint would let any string into a status column.
        if let Some(vals) = enums.get(&udt) {
            let list = vals
                .iter()
                .map(|v| format!("'{v}'"))
                .collect::<Vec<_>>()
                .join(", ");
            line.push_str(&format!(" CHECK (\"{name}\" IN ({list}))"));
        }
        if udt == "bool" {
            line.push_str(&format!(" CHECK (\"{name}\" IN (0, 1))"));
        }
        parts.push(line);
    }

    if !pk.is_empty() {
        let cols = pk
            .iter()
            .map(|c| format!("\"{c}\""))
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!("    PRIMARY KEY ({cols})"));
    }

    for f in &fks {
        let (col, rt, rc, rule): (String, String, String, String) =
            (f.get(0), f.get(1), f.get(2), f.get(3));
        parts.push(format!(
            "    FOREIGN KEY (\"{col}\") REFERENCES \"{rt}\"(\"{rc}\") ON DELETE {rule}"
        ));
    }

    write!(s, "{}", parts.join(",\n"))?;
    writeln!(s, "\n);")?;
    Ok(s)
}

/// Removes Postgres `::type` casts, including quoted enum names.
/// `status = 'DRAFT'::"ReconciliationStatus"` → `status = 'DRAFT'`
fn strip_casts(s: &str) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < b.len() {
        if i + 1 < b.len() && b[i] == ':' && b[i + 1] == ':' {
            i += 2;
            if i < b.len() && b[i] == '"' {
                i += 1;
                while i < b.len() && b[i] != '"' {
                    i += 1;
                }
                i += 1; // closing quote
            } else {
                while i < b.len() && (b[i].is_alphanumeric() || b[i] == '_') {
                    i += 1;
                }
            }
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    out
}

async fn index_ddl(pool: &PgPool, table: &str) -> Result<String> {
    let rows = sqlx::query(
        "SELECT indexdef FROM pg_indexes
         WHERE schemaname='public' AND tablename=$1 ORDER BY indexname",
    )
    .bind(table)
    .fetch_all(pool)
    .await?;

    let mut s = String::new();
    for r in rows {
        let def: String = r.get(0);
        // Primary keys arrive as implicit indexes; they are already in the DDL.
        if def.contains("_pkey") {
            continue;
        }
        // Postgres index DDL is close enough to SQLite's that only the schema
        // qualifier, the USING clause and any type casts need removing.
        // The cast matters: partial indexes carry them, e.g. the "one draft
        // session per account" constraint compares against
        // 'DRAFT'::"ReconciliationStatus". SQLite supports the partial index
        // but cannot parse `::`, and dropping the whole index would silently
        // lose a real uniqueness guarantee.
        let d = strip_casts(
            &def.replace("public.", "")
                .replace(" USING btree", "")
                .replace(" USING hash", ""),
        );
        writeln!(s, "{d};")?;
    }
    Ok(s)
}
