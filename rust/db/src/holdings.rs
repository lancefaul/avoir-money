//! Investment holdings — port of `applyTradeToHolding` from
//! `apps/api/src/lib/holdings.ts` (trade-holding hook, priority 10).
//!
//! **This is where ADR-033's two representations meet**, and the reason the
//! decision was to have two rather than one:
//!
//! - `InvestmentHolding.quantity` is a QUANTITY — TEXT holding an exact decimal.
//!   BTC needs 8 places and `InvestmentSnapshot.quantity` reaches 20 in
//!   production; cents would round `0.00000001` BTC to zero. It is added and
//!   subtracted HERE, in Rust, never in SQL: SQLite coerces TEXT to float on
//!   arithmetic, which would silently reintroduce the drift the representation
//!   exists to avoid.
//! - `InvestmentHolding.costBasis` is MONEY — INTEGER cents, exact under
//!   addition.
//!
//! The proportional cost basis on a sell is the one division in this module,
//! and per ADR-033's surviving rule it states its policy: round half away from
//! zero to the cent, with the residual left in the holding rather than
//! distributed, because the holding is the running figure and the allocation is
//! derived from it.

use anyhow::{Context, Result};
use avoir_core::money::Cents;
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use sqlx::SqliteConnection;

const SATS_PER_BTC: i64 = 100_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetType {
    Stock,
    Bitcoin,
}

/// The trade as stored in `TradeDetail`.
#[derive(Debug, Clone)]
pub struct Trade {
    pub direction: Direction,
    pub asset_type: AssetType,
    pub ticker: Option<String>,
    /// As entered — in sats when `bitcoin_unit_is_sats`, otherwise whole units.
    pub quantity: Decimal,
    pub bitcoin_unit_is_sats: bool,
    pub custodian_id: Option<String>,
    pub wallet_id: Option<String>,
}

impl Trade {
    /// Quantity in whole units. Sats are converted here so everything below
    /// this point is in one unit — the conversion is exact in `Decimal`, where
    /// dividing by 100,000,000 loses nothing.
    fn units(&self) -> Decimal {
        if self.asset_type == AssetType::Bitcoin && self.bitcoin_unit_is_sats {
            self.quantity / Decimal::from(SATS_PER_BTC)
        } else {
            self.quantity
        }
    }

    fn holding_type(&self) -> &'static str {
        match self.asset_type {
            AssetType::Stock => "STOCK",
            AssetType::Bitcoin => "BITCOIN",
        }
    }
}

/// Apply a trade to its holding, or reverse it with `multiplier = -1`.
///
/// Returns `Some(cost_basis_allocated)` for a sell — the portion of the
/// holding's basis this sale consumed, which the caller writes back onto the
/// transaction. `None` for a buy, which allocates nothing.
///
/// **The multiplier inverts the direction, it does not negate the amounts.** A
/// BUY reversal behaves exactly like a SELL and vice versa; that is what makes
/// a reversal restore the holding rather than merely subtract from it.
pub async fn apply_trade_to_holding(
    conn: &mut SqliteConnection,
    trade: &Trade,
    usd_amount: Cents,
    multiplier: i8,
) -> Result<Option<Cents>> {
    let quantity = trade.units();
    let holding_type = trade.holding_type();

    let existing = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "quantity" AS "quantity!: String",
                  "costBasis" AS "cost_basis: i64"
           FROM "InvestmentHolding"
           WHERE "type" = ?
             AND ("custodianId" IS ? OR (?  IS NULL AND "custodianId" IS NULL))
             AND ("walletId" IS ? OR (? IS NULL AND "walletId" IS NULL))
             AND ("ticker" IS ?)
           LIMIT 1"#,
        holding_type,
        trade.custodian_id,
        trade.custodian_id,
        trade.wallet_id,
        trade.wallet_id,
        trade.ticker,
    )
    .fetch_optional(&mut *conn)
    .await
    .context("looking up holding")?;

    let is_buy = matches!(
        (trade.direction, multiplier),
        (Direction::Buy, 1) | (Direction::Sell, -1)
    );

    if is_buy {
        match existing {
            Some(h) => {
                // Quantity arithmetic in Rust, deliberately. `SET quantity =
                // quantity + ?` would make SQLite coerce the TEXT to a float.
                let current = Decimal::from_str(&h.quantity).context("holding quantity")?;
                let updated = (current + quantity).normalize().to_string();
                let basis = Cents(h.cost_basis.unwrap_or(0)) + usd_amount;
                sqlx::query!(
                    r#"UPDATE "InvestmentHolding" SET "quantity" = ?, "costBasis" = ? WHERE "id" = ?"#,
                    updated,
                    basis.0,
                    h.id
                )
                .execute(&mut *conn)
                .await?;
            }
            None => {
                let name = entity_name(conn, trade).await?;
                let id = format!("hold_{}", uuid_like(&name, trade));
                let qty = quantity.normalize().to_string();
                sqlx::query!(
                    r#"INSERT INTO "InvestmentHolding"
                         ("id","name","ticker","type","quantity","costBasis",
                          "createdAt","updatedAt","custodianId","walletId")
                       VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'),?,?)"#,
                    id,
                    name,
                    trade.ticker,
                    holding_type,
                    qty,
                    usd_amount.0,
                    trade.custodian_id,
                    trade.wallet_id,
                )
                .execute(&mut *conn)
                .await?;
            }
        }
        return Ok(None);
    }

    // Sell (or a buy being reversed).
    let Some(h) = existing else {
        // Nothing to decrement. Reachable only if validation upstream let a
        // sell through for an asset that was never held.
        return Ok(None);
    };

    let current_qty = Decimal::from_str(&h.quantity).context("holding quantity")?;
    let current_basis = Cents(h.cost_basis.unwrap_or(0));

    // Proportional: (sold / held) × basis. The one division here.
    let proportion = if current_qty > Decimal::ZERO {
        quantity / current_qty
    } else {
        Decimal::ZERO
    };
    let reduction_exact = Decimal::from(current_basis.0) * proportion;
    let reduction = Cents(
        reduction_exact
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            .to_i64()
            .context("cost basis reduction overflows i64 cents")?,
    );

    let new_qty = (current_qty - quantity).normalize().to_string();
    let new_basis = current_basis - reduction;

    sqlx::query!(
        r#"UPDATE "InvestmentHolding" SET "quantity" = ?, "costBasis" = ? WHERE "id" = ?"#,
        new_qty,
        new_basis.0,
        h.id
    )
    .execute(&mut *conn)
    .await?;

    Ok(Some(reduction))
}

/// The holding's display name comes from the custodian or wallet it sits in.
async fn entity_name(conn: &mut SqliteConnection, trade: &Trade) -> Result<String> {
    match trade.asset_type {
        AssetType::Stock => {
            let id = trade
                .custodian_id
                .as_deref()
                .context("stock trade needs a custodian")?;
            let r = sqlx::query!(
                r#"SELECT "name" AS "name!: String" FROM "Custodian" WHERE "id" = ?"#,
                id
            )
            .fetch_one(&mut *conn)
            .await
            .context("custodian not found")?;
            Ok(r.name)
        }
        AssetType::Bitcoin => {
            let id = trade
                .wallet_id
                .as_deref()
                .context("bitcoin trade needs a wallet")?;
            let r = sqlx::query!(
                r#"SELECT "name" AS "name!: String" FROM "Wallet" WHERE "id" = ?"#,
                id
            )
            .fetch_one(&mut *conn)
            .await
            .context("wallet not found")?;
            Ok(r.name)
        }
    }
}

/// A stable id for a new holding. Deterministic rather than random so a test
/// can assert on it; the uniqueness that matters is enforced by the lookup
/// above, which finds any existing holding before one is created.
fn uuid_like(name: &str, trade: &Trade) -> String {
    format!(
        "{}_{}_{}",
        trade.holding_type().to_lowercase(),
        trade.ticker.as_deref().unwrap_or("na"),
        name.to_lowercase().replace(' ', "_")
    )
}

/// Apply a Bitcoin PAYMENT to its wallet holding — port of
/// `applyBitcoinToHolding` (bitcoin-holding hook, priority 10).
///
/// Distinct from a trade: spending or receiving BTC directly, rather than
/// buying or selling it. `BitcoinPaymentDetail` is its own table (ADR-027).
///
/// **It is the same operation as a trade with the direction derived
/// differently**, which is not obvious and is worth the truth table:
///
/// | tx type          | multiplier | effect    | equivalent trade |
/// |------------------|-----------:|-----------|------------------|
/// | EXPENSE          |         +1 | decrement | Sell +1          |
/// | EXPENSE          |         -1 | increment | Sell -1          |
/// | INCOME / REFUND  |         +1 | increment | Buy  +1          |
/// | INCOME / REFUND  |         -1 | decrement | Buy  -1          |
///
/// So spending maps to `Sell` and receiving maps to `Buy`, and the existing
/// multiplier logic then produces the right answer in all four cases. Sharing
/// the implementation means the proportional cost-basis rule and the decimal
/// quantity handling cannot drift between the two hooks — which is the whole
/// reason `classifyLeftovers` was centralised on the reconcile side too.
///
/// Returns the cost basis released on a decrement. The TypeScript discards it
/// (the function returns void); it is surfaced here because the caller may want
/// it and throwing information away is harder to undo than ignoring it.
pub async fn apply_bitcoin_payment_to_holding(
    conn: &mut SqliteConnection,
    wallet_id: &str,
    quantity: Decimal,
    unit_is_sats: bool,
    tx_type: &str,
    usd_amount: Cents,
    multiplier: i8,
) -> Result<Option<Cents>> {
    let direction = match tx_type {
        // Spending BTC reduces the holding, exactly as a sale does.
        "EXPENSE" => Direction::Sell,
        // Receiving BTC increases it.
        "INCOME" | "REFUND" => Direction::Buy,
        other => anyhow::bail!("bitcoin payment on an unsupported transaction type: {other}"),
    };

    let trade = Trade {
        direction,
        asset_type: AssetType::Bitcoin,
        ticker: None,
        quantity,
        bitcoin_unit_is_sats: unit_is_sats,
        custodian_id: None,
        wallet_id: Some(wallet_id.to_string()),
    };

    apply_trade_to_holding(conn, &trade, usd_amount, multiplier).await
}
