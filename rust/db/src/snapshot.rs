//! Investment snapshots — port of the single-holding regeneration from
//! `apps/api/src/lib/snapshot-generator.ts` (snapshot hook, priority 50).
//!
//! **The price is a parameter, not a fetch.** The TypeScript calls CoinGecko
//! from inside this path, which puts a third-party HTTP request in the middle
//! of a database mutation: the write's latency and failure modes become the
//! network's. Here the caller supplies the price, so this layer stays pure
//! database work and is testable without mocking HTTP. The fetch belongs in
//! the service layer that step 4 builds.
//!
//! **Failure is returned, not swallowed.** The TypeScript wraps the regen in a
//! bare `catch {}` because a snapshot failure must not fail the mutation —
//! correct as a requirement, but QUALITY.md's "no silent failures" rule is
//! about exactly this shape. Returning the outcome lets the caller keep the
//! best-effort behaviour while still being able to see it happened.
//!
//! [`regenerate_holding_snapshot`] rewrites today's row, which is all the hook
//! ever needed. [`regenerate_all`] is the full-history rebuild behind
//! `POST /investments/snapshots/regenerate`.

use anyhow::Result;
use avoir_core::money::Cents;
use chrono::NaiveDate;
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

/// Below this the holding is dust and gets no snapshot — the TypeScript's
/// `0.000001` threshold, which keeps a fully-sold wallet off the chart instead
/// of drawing a flat line at ~0.
fn dust_threshold() -> Decimal {
    Decimal::from_str("0.000001").unwrap()
}

/// What a regeneration did, so a best-effort caller can still report it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotOutcome {
    Written {
        quantity: Decimal,
        value: Cents,
    },
    /// The holding is not a wallet-backed BTC holding.
    NotBitcoin,
    /// Holding is empty or below the dust threshold.
    NoQuantity,
    /// No price supplied, so value cannot be computed.
    NoPrice,
}

/// The wallet's BTC quantity as of `as_of`, summed from its movements.
///
/// Trades contribute `+qty` on a BUY and `-qty` on a SELL; bitcoin payments
/// contribute `+qty` on INCOME/REFUND and `-qty` on EXPENSE — the same
/// direction rule `apply_bitcoin_payment_to_holding` uses, restated here rather
/// than shared because the two derive it from different tables and a shared
/// helper would hide a divergence between them.
pub async fn wallet_btc_quantity(
    conn: &mut SqliteConnection,
    wallet_id: &str,
    as_of: NaiveDate,
) -> Result<Decimal> {
    let as_of_s = as_of.to_string();

    let trades = sqlx::query!(
        r#"SELECT d."quantity" AS "quantity!: String", d."direction" AS "direction!: String",
                  d."bitcoinUnit" AS unit
           FROM "TradeDetail" d
           JOIN "Transaction" t ON t."id" = d."transactionId"
           WHERE d."assetType" = 'Bitcoin' AND d."walletId" = ? AND t."date" <= ?"#,
        wallet_id,
        as_of_s
    )
    .fetch_all(&mut *conn)
    .await?;

    let payments = sqlx::query!(
        r#"SELECT d."quantity" AS "quantity!: String", d."bitcoinUnit" AS "unit!: String",
                  t."type" AS "tx_type!: String"
           FROM "BitcoinPaymentDetail" d
           JOIN "Transaction" t ON t."id" = d."transactionId"
           WHERE d."walletId" = ? AND t."date" <= ?"#,
        wallet_id,
        as_of_s
    )
    .fetch_all(&mut *conn)
    .await?;

    let sats = Decimal::from(100_000_000);
    let mut total = Decimal::ZERO;

    for t in trades {
        let mut q: Decimal = t.quantity.parse()?;
        if t.unit.as_deref() == Some("Sats") {
            q /= sats;
        }
        total += if t.direction == "BUY" { q } else { -q };
    }
    for p in payments {
        let mut q: Decimal = p.quantity.parse()?;
        if p.unit == "Sats" {
            q /= sats;
        }
        total += match p.tx_type.as_str() {
            "INCOME" | "REFUND" => q,
            _ => -q,
        };
    }

    Ok(total)
}

/// Rewrite today's snapshot for a wallet-backed BTC holding.
///
/// `price_per_btc` is the current market price. `value = quantity × price`,
/// rounded to the cent — ADR-033 assigned `InvestmentSnapshot.value` to money
/// deliberately, and measured the cost: rounding per row rather than at the end
/// moves an $11.3M portfolio chart by one cent across 724 rows.
pub async fn regenerate_holding_snapshot(
    conn: &mut SqliteConnection,
    holding_id: &str,
    price_per_btc: Option<Cents>,
    today: NaiveDate,
) -> Result<SnapshotOutcome> {
    let holding = sqlx::query!(
        r#"SELECT "walletId" AS wallet_id, "type" AS "holding_type!: String"
           FROM "InvestmentHolding" WHERE "id" = ?"#,
        holding_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(h) = holding else {
        return Ok(SnapshotOutcome::NotBitcoin);
    };
    if h.holding_type != "BITCOIN" {
        return Ok(SnapshotOutcome::NotBitcoin);
    }
    let Some(wallet_id) = h.wallet_id else {
        return Ok(SnapshotOutcome::NotBitcoin);
    };

    let quantity = wallet_btc_quantity(conn, &wallet_id, today).await?;
    if quantity <= dust_threshold() {
        return Ok(SnapshotOutcome::NoQuantity);
    }
    let Some(price) = price_per_btc else {
        return Ok(SnapshotOutcome::NoPrice);
    };

    let value = Cents(
        (quantity * Decimal::from(price.0))
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            .to_i64()
            .unwrap_or(i64::MAX),
    );

    // Replace rather than upsert: one snapshot per holding per day, and the
    // newest computation wins.
    let date_s = today.to_string();
    sqlx::query!(
        r#"DELETE FROM "InvestmentSnapshot" WHERE "holdingId" = ? AND "date" = ?"#,
        holding_id,
        date_s
    )
    .execute(&mut *conn)
    .await?;

    let id = format!("snap_{holding_id}_{date_s}");
    let qty_s = quantity.normalize().to_string();
    sqlx::query!(
        r#"INSERT INTO "InvestmentSnapshot" ("id","holdingId","date","quantity","value","createdAt")
           VALUES (?,?,?,?,?,?)"#,
        id,
        holding_id,
        date_s,
        qty_s,
        value.0,
        date_s,
    )
    .execute(&mut *conn)
    .await?;

    Ok(SnapshotOutcome::Written { quantity, value })
}

// ═══ Full-history rebuild ═══

/// One movement of BTC into or out of a holding.
struct Event {
    date: NaiveDate,
    holding_id: String,
    delta: Decimal,
}

/// Every BTC movement in the database, per holding.
///
/// A holding is identified by its wallet, because that is what trades and
/// payments reference — `TradeDetail.walletId` and `BitcoinPaymentDetail.walletId`
/// are real foreign keys since ADR-027, so this is a join rather than a JSON
/// path lookup.
async fn all_events(pool: &SqlitePool) -> Result<Vec<Event>> {
    let holdings = sqlx::query!(
        r#"SELECT "id" AS "id!", "walletId" AS wallet_id, "quantity" AS "quantity!"
             FROM "InvestmentHolding" WHERE "type" = 'BITCOIN'"#
    )
    .fetch_all(pool)
    .await?;

    let mut by_wallet: HashMap<String, String> = HashMap::new();
    let mut actual: HashMap<String, Decimal> = HashMap::new();
    for h in &holdings {
        if let Some(w) = &h.wallet_id {
            by_wallet.insert(w.clone(), h.id.clone());
        }
        actual.insert(h.id.clone(), h.quantity.parse().unwrap_or(Decimal::ZERO));
    }

    let sats = Decimal::from(100_000_000);
    let mut events: Vec<Event> = Vec::new();

    let trades = sqlx::query!(
        r#"SELECT t."date" AS "date!", d."walletId" AS wallet_id,
                  d."quantity" AS "quantity!", d."direction" AS "direction!",
                  d."bitcoinUnit" AS unit
             FROM "Transaction" t
             JOIN "TradeDetail" d ON d."transactionId" = t."id"
            WHERE t."type" = 'TRADE' AND d."assetType" = 'Bitcoin'
            ORDER BY t."date" ASC"#
    )
    .fetch_all(pool)
    .await?;
    for r in trades {
        let Some(wallet) = r.wallet_id else { continue };
        let Some(holding_id) = by_wallet.get(&wallet) else {
            continue;
        };
        let Some(date) = crate::snapshot::day(&r.date) else {
            continue;
        };
        let mut q: Decimal = r.quantity.parse().unwrap_or(Decimal::ZERO);
        if r.unit.as_deref() == Some("Sats") {
            q /= sats;
        }
        events.push(Event {
            date,
            holding_id: holding_id.clone(),
            delta: if r.direction == "BUY" { q } else { -q },
        });
    }

    // Income only, matching the TypeScript. A BTC *expense* moves the wallet
    // too, and is deliberately not here: this rebuild is reconciled against the
    // holding's stored quantity below, so an omitted outflow is absorbed by the
    // correction rather than left to drift.
    let incomes = sqlx::query!(
        r#"SELECT t."date" AS "date!", d."walletId" AS "wallet_id!",
                  d."quantity" AS "quantity!", d."bitcoinUnit" AS "unit!"
             FROM "Transaction" t
             JOIN "BitcoinPaymentDetail" d ON d."transactionId" = t."id"
            WHERE t."type" = 'INCOME'
            ORDER BY t."date" ASC"#
    )
    .fetch_all(pool)
    .await?;
    for r in incomes {
        let Some(holding_id) = by_wallet.get(&r.wallet_id) else {
            continue;
        };
        let Some(date) = crate::snapshot::day(&r.date) else {
            continue;
        };
        let mut q: Decimal = r.quantity.parse().unwrap_or(Decimal::ZERO);
        if r.unit == "Sats" {
            q /= sats;
        }
        events.push(Event {
            date,
            holding_id: holding_id.clone(),
            delta: q,
        });
    }

    let transfers = sqlx::query!(
        r#"SELECT "createdAt" AS "created_at!", "fromHoldingId" AS "from_id!",
                  "toHoldingId" AS "to_id!", "quantity" AS "quantity!"
             FROM "InvestmentTransfer" WHERE "type" = 'BITCOIN'
            ORDER BY "createdAt" ASC"#
    )
    .fetch_all(pool)
    .await?;
    for r in transfers {
        let Some(date) = crate::snapshot::day(&r.created_at) else {
            continue;
        };
        let q: Decimal = r.quantity.parse().unwrap_or(Decimal::ZERO);
        events.push(Event {
            date,
            holding_id: r.from_id,
            delta: -q,
        });
        events.push(Event {
            date,
            holding_id: r.to_id,
            delta: q,
        });
    }

    // Reconciliation. The events above are what the database recorded; the
    // holding's stored quantity is what it actually holds. Anything unrecorded
    // — a manual adjustment, a BTC expense, an import gap — shows up as the
    // difference, and is placed on the holding's last event date so the chart
    // ends at the truth instead of at the sum of what happened to be logged.
    let mut computed: HashMap<String, Decimal> = HashMap::new();
    for e in &events {
        *computed.entry(e.holding_id.clone()).or_default() += e.delta;
    }
    let threshold = Decimal::from_str("0.000001").unwrap();
    let mut corrections: Vec<Event> = Vec::new();
    for (holding_id, computed_qty) in &computed {
        let diff = actual.get(holding_id).copied().unwrap_or(Decimal::ZERO) - computed_qty;
        if diff.abs() > threshold {
            let last = events
                .iter()
                .filter(|e| &e.holding_id == holding_id)
                .map(|e| e.date)
                .max();
            if let Some(date) = last {
                corrections.push(Event {
                    date,
                    holding_id: holding_id.clone(),
                    delta: diff,
                });
            }
        }
    }
    events.extend(corrections);

    events.sort_by_key(|e| e.date);
    Ok(events)
}

/// The calendar day of a stored date or timestamp.
fn day(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

/// Delete every snapshot and rebuild from the movement history.
///
/// `prices` maps `YYYY-MM-DD` to that day's BTC price. A day with no price
/// gets no snapshot — the chart shows a gap rather than a fabricated value.
///
/// Returns how many snapshots were written.
pub async fn regenerate_all(
    pool: &SqlitePool,
    prices: &HashMap<String, Cents>,
    today: NaiveDate,
) -> Result<usize> {
    let events = all_events(pool).await?;

    let mut tx = pool.begin().await?;
    sqlx::query!(r#"DELETE FROM "InvestmentSnapshot""#)
        .execute(&mut *tx)
        .await?;

    if events.is_empty() {
        tx.commit().await?;
        return Ok(0);
    }

    let threshold = Decimal::from_str("0.000001").unwrap();
    let mut running: HashMap<String, Decimal> = HashMap::new();
    let mut idx = 0usize;
    let mut current = events[0].date;
    let mut written = 0usize;

    while current <= today {
        while idx < events.len() && events[idx].date <= current {
            *running.entry(events[idx].holding_id.clone()).or_default() += events[idx].delta;
            idx += 1;
        }

        let key = current.format("%Y-%m-%d").to_string();
        if let Some(price) = prices.get(&key) {
            // Rounded per row, which ADR-033 measured rather than assumed: one
            // cent across 724 rows on an $11.3M chart.
            let date_s = format!("{key}T00:00:00.000Z");
            for (holding_id, qty) in running.iter().filter(|(_, q)| **q > threshold) {
                let value = (*qty * Decimal::from(price.0))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                    .to_i64()
                    .unwrap_or(0);
                let id = format!("snap_{holding_id}_{key}");
                let q = qty.normalize().to_string();
                sqlx::query!(
                    r#"INSERT INTO "InvestmentSnapshot"
                         ("id","holdingId","date","quantity","value","createdAt")
                       VALUES (?,?,?,?,?,?)"#,
                    id,
                    holding_id,
                    date_s,
                    q,
                    value,
                    date_s
                )
                .execute(&mut *tx)
                .await?;
                written += 1;
            }
        }

        let Some(next) = current.succ_opt() else {
            break;
        };
        current = next;
    }

    tx.commit().await?;
    Ok(written)
}
