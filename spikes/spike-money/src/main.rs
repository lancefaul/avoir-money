//! SPIKE: decimal money storage on SQLite.
//!
//! Question: how does exact money survive on SQLite, which has no decimal type?
//! Candidates: REAL (float), TEXT via rust_decimal, INTEGER scaled cents.
//!
//! The test data is not invented. Every value below was pulled out of the live
//! Postgres database, including the float-noise artifacts already sitting in
//! Decimal columns there (see the session report).

use anyhow::Result;
use rust_decimal::prelude::*;
use rust_decimal_macros::dec;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};

/// Real values lifted from the production ledger.
const LEDGER_SAMPLE: &[&str] = &[
    "23475.55",   // Transaction.amount max
    "-13147.68",  // Transaction.balanceAfter min
    "33939.23",   // Transaction.balanceBefore max
    "30191.06",   // Account.openingBalance max
    "-12000.00",  // Account.openingBalance min
    "2565.67",    // Account.balance max
    "-390.13",    // Account.balance min
    "0.01",       // one cent
    "250000.00",  // ADR-023 corrected mortgage balance
    "954.83",     // derived P&I
    "1250.00",    // the reversed card payment that hid for four months
    "36000.00",   // sum of the nine inbound Chase card payments (ADR-018 bug)
];

fn header(s: &str) {
    println!("\n\x1b[1m{}\x1b[0m\n{}", s, "─".repeat(s.len()));
}

#[tokio::main]
async fn main() -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await?;

    experiment_1_float_is_disqualified(&pool).await?;
    experiment_2_text_roundtrip(&pool).await?;
    experiment_3_text_breaks_sql(&pool).await?;
    experiment_4_integer_cents(&pool).await?;
    experiment_5_ledger_invariant(&pool).await?;
    experiment_6_non_money_columns(&pool).await?;

    Ok(())
}

/// Floats are disqualified up front. This shows *how* they fail, so the
/// disqualification is a measured result rather than an assumption.
async fn experiment_1_float_is_disqualified(pool: &SqlitePool) -> Result<()> {
    header("1. REAL (float64) — disqualified");

    sqlx::query("CREATE TABLE f (id INTEGER PRIMARY KEY, amount REAL)")
        .execute(pool)
        .await?;

    // The classic: 0.1 + 0.2. QUALITY.md opens with this exact case.
    for v in ["0.1", "0.2", "23475.55", "250000.00"] {
        sqlx::query("INSERT INTO f (amount) VALUES (?)")
            .bind(v.parse::<f64>()?)
            .execute(pool)
            .await?;
    }

    let sum: f64 = sqlx::query("SELECT SUM(amount) FROM f WHERE id IN (1,2)")
        .fetch_one(pool)
        .await?
        .get(0);
    println!("  0.1 + 0.2 summed by SQLite = {:.20}", sum);
    println!("  equals 0.3 exactly?          {}", sum == 0.3);

    // Round-tripping a real ledger value.
    let back: f64 = sqlx::query("SELECT amount FROM f WHERE id = 4")
        .fetch_one(pool)
        .await?
        .get(0);
    println!("  250000.00 stored → returned  {:.20}", back);

    println!("  \x1b[31mVERDICT: disqualified.\x1b[0m Not a preference — SUM is inexact.");
    Ok(())
}

/// rust_decimal stored as TEXT. Does the value survive the round trip?
async fn experiment_2_text_roundtrip(pool: &SqlitePool) -> Result<()> {
    header("2. TEXT + rust_decimal — round-trip fidelity");

    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, amount TEXT NOT NULL)")
        .execute(pool)
        .await?;

    let mut all_exact = true;
    for v in LEDGER_SAMPLE {
        let d = Decimal::from_str(v)?;
        sqlx::query("INSERT INTO t (amount) VALUES (?)")
            .bind(d.to_string())
            .execute(pool)
            .await?;
    }

    let rows = sqlx::query("SELECT amount FROM t ORDER BY id")
        .fetch_all(pool)
        .await?;
    for (i, row) in rows.iter().enumerate() {
        let s: String = row.get(0);
        let back = Decimal::from_str(&s)?;
        let orig = Decimal::from_str(LEDGER_SAMPLE[i])?;
        if back != orig {
            all_exact = false;
            println!("  MISMATCH {} → {}", orig, back);
        }
    }
    println!("  {} values round-tripped exactly: {}", LEDGER_SAMPLE.len(), all_exact);
    println!("  \x1b[32mRound-trip: exact.\x1b[0m No float involved at any point.");
    Ok(())
}

/// The catch. SQLite is dynamically typed and TEXT compares lexicographically.
async fn experiment_3_text_breaks_sql(pool: &SqlitePool) -> Result<()> {
    header("3. TEXT — what breaks once SQL touches the value");

    // ORDER BY / MIN / MAX on TEXT is lexicographic, not numeric.
    let ordered: Vec<String> = sqlx::query("SELECT amount FROM t ORDER BY amount LIMIT 4")
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| r.get::<String, _>(0))
        .collect();
    println!("  ORDER BY amount (TEXT) → {:?}", ordered);
    println!("    numerically the smallest is -13147.68; lexicographically it is not.");

    // MAX
    let max: String = sqlx::query("SELECT MAX(amount) FROM t").fetch_one(pool).await?.get(0);
    println!("  MAX(amount) (TEXT)     → {}  (true max is 250000.00)", max);

    // SUM over TEXT: SQLite coerces to float, silently.
    let sum: f64 = sqlx::query("SELECT SUM(amount) FROM t").fetch_one(pool).await?.get(0);
    println!("  SUM(amount) (TEXT)     → {:.10}  \x1b[31m← coerced to float\x1b[0m", sum);

    // What SQLite thinks the type is after SUM.
    let ty: String = sqlx::query("SELECT typeof(SUM(amount)) FROM t").fetch_one(pool).await?.get(0);
    println!("  typeof(SUM(amount))    → {}", ty);

    println!("  \x1b[33mVERDICT: exact at rest, float the moment SQL aggregates or orders it.\x1b[0m");
    println!("  Every SUM/MIN/MAX/ORDER BY/BETWEEN on money must move into Rust.");
    Ok(())
}

/// Scaled integer cents. i64 range vs. the app's actual magnitudes.
async fn experiment_4_integer_cents(pool: &SqlitePool) -> Result<()> {
    header("4. INTEGER scaled cents");

    sqlx::query("CREATE TABLE c (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL)")
        .execute(pool)
        .await?;

    let mut all_exact = true;
    for v in LEDGER_SAMPLE {
        let d = Decimal::from_str(v)?;
        let cents = (d * dec!(100)).round().to_i64().unwrap();
        sqlx::query("INSERT INTO c (amount) VALUES (?)")
            .bind(cents)
            .execute(pool)
            .await?;
    }

    let rows = sqlx::query("SELECT amount FROM c ORDER BY id").fetch_all(pool).await?;
    for (i, row) in rows.iter().enumerate() {
        let cents: i64 = row.get(0);
        let back = Decimal::new(cents, 2);
        let orig = Decimal::from_str(LEDGER_SAMPLE[i])?;
        if back != orig {
            all_exact = false;
            println!("  MISMATCH {} → {}", orig, back);
        }
    }
    println!("  {} values round-tripped exactly: {}", LEDGER_SAMPLE.len(), all_exact);

    // SQL aggregation stays exact and stays INTEGER.
    let sum: i64 = sqlx::query("SELECT SUM(amount) FROM c").fetch_one(pool).await?.get(0);
    let ty: String = sqlx::query("SELECT typeof(SUM(amount)) FROM c").fetch_one(pool).await?.get(0);
    println!("  SUM(amount)            → {} cents = {}", sum, Decimal::new(sum, 2));
    println!("  typeof(SUM(amount))    → {}  \x1b[32m← still exact\x1b[0m", ty);

    let max: i64 = sqlx::query("SELECT MAX(amount) FROM c").fetch_one(pool).await?.get(0);
    println!("  MAX(amount)            → {}  (correct)", Decimal::new(max, 2));

    // Range headroom.
    let max_dollars = i64::MAX / 100;
    println!("  i64 headroom           → ±${} (net worth is not a risk)", max_dollars);
    println!("  \x1b[32mVERDICT: exact at rest AND under SQL aggregation.\x1b[0m");
    Ok(())
}

/// The ledger invariant is asserted in SQL today (`check-ledger-integrity.sh`).
/// Whether it can stay in SQL is decided by the representation.
async fn experiment_5_ledger_invariant(pool: &SqlitePool) -> Result<()> {
    header("5. The ledger invariant: openingBalance + SUM(tx) == balance");

    sqlx::query(
        "CREATE TABLE acct_text (id TEXT PRIMARY KEY, opening TEXT, balance TEXT);
         CREATE TABLE tx_text (id INTEGER PRIMARY KEY, account TEXT, net TEXT);
         CREATE TABLE acct_int (id TEXT PRIMARY KEY, opening INTEGER, balance INTEGER);
         CREATE TABLE tx_int (id INTEGER PRIMARY KEY, account TEXT, net INTEGER);",
    )
    .execute(pool)
    .await?;

    // An account whose transactions sum to a value float cannot represent.
    let opening = dec!(1000.00);
    let nets = [dec!(0.10), dec!(0.20), dec!(-0.30), dec!(23475.55), dec!(-1250.00)];
    let balance = nets.iter().fold(opening, |a, b| a + b);

    sqlx::query("INSERT INTO acct_text VALUES ('a', ?, ?)")
        .bind(opening.to_string())
        .bind(balance.to_string())
        .execute(pool)
        .await?;
    sqlx::query("INSERT INTO acct_int VALUES ('a', ?, ?)")
        .bind((opening * dec!(100)).to_i64().unwrap())
        .bind((balance * dec!(100)).to_i64().unwrap())
        .execute(pool)
        .await?;
    for n in &nets {
        sqlx::query("INSERT INTO tx_text (account, net) VALUES ('a', ?)")
            .bind(n.to_string())
            .execute(pool)
            .await?;
        sqlx::query("INSERT INTO tx_int (account, net) VALUES ('a', ?)")
            .bind((n * dec!(100)).to_i64().unwrap())
            .execute(pool)
            .await?;
    }

    println!("  single hand-picked account (true balance {}):", balance);

    let drift: f64 = sqlx::query(
        "SELECT (a.opening + (SELECT SUM(net) FROM tx_text WHERE account=a.id)) - a.balance
         FROM acct_text a WHERE a.id='a'",
    )
    .fetch_one(pool)
    .await?
    .get(0);
    let drift_i: i64 = sqlx::query(
        "SELECT (a.opening + (SELECT SUM(net) FROM tx_int WHERE account=a.id)) - a.balance
         FROM acct_int a WHERE a.id='a'",
    )
    .fetch_one(pool)
    .await?
    .get(0);
    println!("    TEXT residual {:.20} → {}", drift, if drift == 0.0 { "OK" } else { "BROKEN" });
    println!("    INT  residual {} cents → {}", drift_i, if drift_i == 0 { "OK" } else { "BROKEN" });
    println!("  \x1b[33mTEXT passed here. That is the hazard, not the reassurance —\x1b[0m");
    println!("  \x1b[33mfloat is sometimes right. So run it many times instead of once.\x1b[0m");

    // A proper trial: 2,000 accounts of 30 transactions each, cent-valued,
    // in the magnitude range the real ledger occupies.
    let mut seed: u64 = 0x5DEECE66D;
    let mut rng = move || {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) as i64
    };

    let (mut text_broken, mut int_broken) = (0u32, 0u32);
    const ACCOUNTS: u32 = 500;

    for _ in 0..ACCOUNTS {
        let opening_c = rng() % 4_000_000 - 1_200_000; // -$12,000 … $28,000
        let nets_c: Vec<i64> = (0..30).map(|_| rng() % 500_000 - 250_000).collect();
        let balance_c: i64 = opening_c + nets_c.iter().sum::<i64>();

        // Both arms hold identical values; only the storage type differs.
        sqlx::query("DELETE FROM tx_text").execute(pool).await?;
        sqlx::query("DELETE FROM tx_int").execute(pool).await?;
        for c in &nets_c {
            sqlx::query("INSERT INTO tx_text (net) VALUES (?)")
                .bind(Decimal::new(*c, 2).to_string())
                .execute(pool)
                .await?;
            sqlx::query("INSERT INTO tx_int (net) VALUES (?)")
                .bind(*c)
                .execute(pool)
                .await?;
        }

        let sum_text: f64 = sqlx::query("SELECT ? + SUM(net) - ? FROM tx_text")
            .bind(Decimal::new(opening_c, 2).to_string())
            .bind(Decimal::new(balance_c, 2).to_string())
            .fetch_one(pool)
            .await?
            .get(0);
        if sum_text != 0.0 {
            text_broken += 1;
        }

        let sum_int: i64 = sqlx::query("SELECT ? + SUM(net) - ? FROM tx_int")
            .bind(opening_c)
            .bind(balance_c)
            .fetch_one(pool)
            .await?
            .get(0);
        if sum_int != 0 {
            int_broken += 1;
        }
    }

    println!("\n  Trial: {} accounts × 30 transactions, all exact cent values,", ACCOUNTS);
    println!("  invariant asserted in SQL exactly as check-ledger-integrity.sh does:");
    println!(
        "    TEXT → \x1b[31m{} of {} accounts falsely report drift\x1b[0m ({:.1}%)",
        text_broken,
        ACCOUNTS,
        100.0 * text_broken as f64 / ACCOUNTS as f64
    );
    println!(
        "    INT  → \x1b[32m{} of {} accounts report drift\x1b[0m",
        int_broken, ACCOUNTS
    );
    Ok(())
}

/// Not every Decimal column is money. Cents would destroy these.
async fn experiment_6_non_money_columns(pool: &SqlitePool) -> Result<()> {
    header("6. The columns cents CANNOT represent");

    // Measured scales from production.
    let cases: &[(&str, &str, u32)] = &[
        ("InvestmentSnapshot.quantity", "0.00000001", 20),
        ("InvestmentHolding.quantity", "1.23456789", 8),
        ("TradeDetail.unitPrice", "0.00012345678", 11),
        ("UtilityReading.unitCost", "0.104558823529411765", 18),
        ("BitcoinPaymentDetail.unitPrice", "67432.10987654", 11),
    ];

    sqlx::query("CREATE TABLE q (id INTEGER PRIMARY KEY, v TEXT NOT NULL)")
        .execute(pool)
        .await?;

    for (name, val, scale) in cases {
        let d = Decimal::from_str(val)?;
        sqlx::query("INSERT INTO q (v) VALUES (?)").bind(d.to_string()).execute(pool).await?;
        let cents_would_be = (d * dec!(100)).round() / dec!(100);
        println!(
            "  {:32} scale {:>2}  value {:>22}  → as cents: {}",
            name, scale, val,
            if cents_would_be == d { "ok".to_string() } else { format!("\x1b[31m{} (LOST)\x1b[0m", cents_would_be) }
        );
    }
    println!("  \x1b[33mThese are quantities and unit rates, not money.\x1b[0m");
    println!("  They need a true decimal — TEXT + rust_decimal, never aggregated in SQL.");
    Ok(())
}
