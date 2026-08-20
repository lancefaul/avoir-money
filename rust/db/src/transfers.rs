//! Moving a holding between wallets or custodians.
//!
//! Port of `apps/api/src/lib/transfers.ts`.
//!
//! # The stock-transfer fee goes through the ledger gate, and did not before
//!
//! The TypeScript creates the fee's `Transaction` row with
//! `tx.transaction.create(...)` and then decrements `Account.balance` by hand,
//! inside a `prisma.$transaction` callback. Both halves are the defect ADR-013
//! and ADR-014 exist to prevent: a balance-visible row written without the
//! balance hook has no `balanceBefore`/`balanceAfter`, and the ADR-014 null
//! boundary makes one such row poison every later row on that account (the
//! ERRORS.md entry "One NULL row silently poisons the chain forever"); and a
//! second, hand-rolled writer for `Account.balance` is the two-writers shape
//! logged twice in one day on 2026-07-19.
//!
//! `scripts/check-ledger-gate.sh` does not see it. Its pattern is
//! `prisma\.transaction\.(create|…)`, and inside an interactive transaction the
//! client is rebound to `tx`, so the literal prefix never matches. `transfers.ts`
//! is the only non-test file in the API that writes the ledger that way, and it
//! is not on the approved list — the gate reports clean because it is looking
//! for a spelling that cannot occur there.
//!
//! Nothing has been corrupted by it: `InvestmentTransfer` has zero rows in
//! production, so no stock transfer has ever run. The defect is latent, which
//! is exactly the moment to not carry it across. Here the fee goes through
//! `ledger_create`, so the balance hook maintains both the chain and the
//! account total, and there is only one writer.
//!
//! # Cost basis moves in proportion, and the residual stays with the source
//!
//! Splitting a cost basis is a division, which under ADR-033 is the one
//! operation that can lose a cent — so it must say where the remainder goes.
//! The transferred basis is computed once, rounded once, and the *same* value
//! is subtracted from the source and added to the destination. The pair
//! therefore always sums to what it did before, and any rounding remainder
//! stays in the source holding, which is the position that still exists.

use anyhow::{bail, Context, Result};
use avoir_core::money::Cents;
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};
use sqlx::SqliteConnection;

use crate::ledger::{ledger_create, ledger_delete, LedgerCreate};
use crate::next_id;

const SATS_PER_BTC: i64 = 100_000_000;

/// The unit a fee was entered in.
///
/// The reason this exists as a type rather than a string: `feeAmount` means a
/// different quantity in each case, and storing it as integer cents — which the
/// column classification originally said — rounds a 5,000-sat fee to nothing.
/// See migration `0003_transfer_fee_amount_is_not_money.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeeUnit {
    Bitcoin,
    Sats,
    Usd,
}

impl FeeUnit {
    pub fn from_stored(s: &str) -> Option<FeeUnit> {
        match s {
            "Bitcoin" => Some(FeeUnit::Bitcoin),
            "Sats" => Some(FeeUnit::Sats),
            "USD" => Some(FeeUnit::Usd),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FeeUnit::Bitcoin => "Bitcoin",
            FeeUnit::Sats => "Sats",
            FeeUnit::Usd => "USD",
        }
    }
}

/// A fee in BTC, whatever unit it was entered in.
///
/// A USD fee needs the bitcoin price to convert, and the request schema already
/// requires one whenever the fee is bitcoin-denominated. Without a price a USD
/// fee cannot be expressed in BTC at all, so it contributes nothing rather than
/// guessing.
fn fee_to_btc(amount: Decimal, unit: FeeUnit, price: Option<Decimal>) -> Decimal {
    match unit {
        FeeUnit::Bitcoin => amount,
        FeeUnit::Sats => amount / Decimal::from(SATS_PER_BTC),
        FeeUnit::Usd => match price {
            Some(p) if !p.is_zero() => amount / p,
            _ => Decimal::ZERO,
        },
    }
}

/// The share of a cost basis that moves with `moved` out of `total`.
///
/// Rounds half away from zero to the cent. Returns zero when there is nothing
/// to apportion, which is the honest answer for a holding with no recorded
/// basis or no quantity — not an error, because a transfer of an
/// unknown-basis position is still a transfer.
fn proportional_basis(moved: Decimal, total: Decimal, basis: Cents) -> Cents {
    if total <= Decimal::ZERO || basis.0 == 0 {
        return Cents::ZERO;
    }
    let share = Decimal::from(basis.0) * moved / total;
    Cents(
        share
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
            .to_i64()
            .unwrap_or(0),
    )
}

struct Holding {
    id: String,
    ticker: Option<String>,
    ty: String,
    quantity: Decimal,
    cost_basis: Cents,
}

async fn read_holding(conn: &mut SqliteConnection, id: &str) -> Result<Holding> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "ticker", "type" AS "ty!", "quantity" AS "quantity!",
                  "costBasis" AS "cost_basis: i64"
             FROM "InvestmentHolding" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?
    .with_context(|| format!("holding {id} not found"))?;
    Ok(Holding {
        id: r.id,
        ticker: r.ticker,
        ty: r.ty,
        quantity: r
            .quantity
            .parse()
            .context("holding quantity is not a number")?,
        cost_basis: Cents(r.cost_basis.unwrap_or(0)),
    })
}

/// Write a holding's quantity and basis, keeping the quantity exact.
///
/// The arithmetic happened in `Decimal` before this call, deliberately: an
/// `UPDATE … SET quantity = quantity - ?` would make SQLite coerce the TEXT
/// column to a float and hand back drift the representation exists to prevent.
async fn write_holding(
    conn: &mut SqliteConnection,
    id: &str,
    quantity: Decimal,
    basis: Cents,
) -> Result<()> {
    let q = quantity.normalize().to_string();
    let now = crate::now_iso();
    sqlx::query!(
        r#"UPDATE "InvestmentHolding"
              SET "quantity" = ?1, "costBasis" = ?2, "updatedAt" = ?3 WHERE "id" = ?4"#,
        q,
        basis.0,
        now,
        id
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ═══ Bitcoin ═══

pub struct BitcoinTransfer {
    pub from_wallet_id: String,
    pub to_wallet_id: String,
    /// As entered — sats when `unit_is_sats`, whole BTC otherwise.
    pub quantity: Decimal,
    pub unit_is_sats: bool,
    pub bitcoin_price: Option<Decimal>,
    pub fee_amount: Option<Decimal>,
    pub fee_unit: Option<FeeUnit>,
}

pub struct TransferRecord {
    pub id: String,
    pub created_at: String,
    pub ticker: Option<String>,
    /// The BTC that moved, or the shares.
    pub quantity: Decimal,
    pub fee_amount: Option<Decimal>,
    pub fee_unit: Option<FeeUnit>,
    pub fee_btc: Option<Decimal>,
    pub fee_transaction_id: Option<String>,
    pub from_holding_id: String,
    pub to_holding_id: String,
}

/// The error cases the route turns into a 400 or 404.
#[derive(Debug)]
pub enum TransferError {
    NoSourceHolding,
    Insufficient { have: Decimal, need: Decimal },
}

impl std::fmt::Display for TransferError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TransferError::NoSourceHolding => write!(f, "Source wallet has no bitcoin holding"),
            TransferError::Insufficient { have, need } => {
                write!(f, "Insufficient balance: have {have}, need {need}")
            }
        }
    }
}

impl std::error::Error for TransferError {}

/// Move BTC from one wallet to another.
///
/// The fee leaves the source but never arrives anywhere — it is paid to the
/// network. So the source is debited `quantity + fee` while the destination is
/// credited `quantity`, and the basis that moves is apportioned on the transfer
/// alone. This creates no `Transaction` row: an on-chain fee is not a cash
/// movement and there is no account for it to leave.
pub async fn execute_bitcoin_transfer(
    conn: &mut SqliteConnection,
    input: &BitcoinTransfer,
) -> Result<TransferRecord> {
    let transfer_btc = if input.unit_is_sats {
        input.quantity / Decimal::from(SATS_PER_BTC)
    } else {
        input.quantity
    };

    let fee_btc = match (input.fee_amount, input.fee_unit) {
        (Some(a), Some(u)) if a > Decimal::ZERO => fee_to_btc(a, u, input.bitcoin_price),
        _ => Decimal::ZERO,
    };
    let total_out = transfer_btc + fee_btc;

    let source = sqlx::query_scalar!(
        r#"SELECT "id" FROM "InvestmentHolding"
            WHERE "walletId" = ? AND "type" = 'BITCOIN' ORDER BY "createdAt" ASC LIMIT 1"#,
        input.from_wallet_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(source_id) = source else {
        bail!(TransferError::NoSourceHolding);
    };
    let source = read_holding(conn, &source_id).await?;

    if source.quantity < total_out {
        bail!(TransferError::Insufficient {
            have: source.quantity.normalize(),
            need: total_out.normalize(),
        });
    }

    let moved_basis = proportional_basis(transfer_btc, source.quantity, source.cost_basis);
    write_holding(
        conn,
        &source.id,
        source.quantity - total_out,
        source.cost_basis - moved_basis,
    )
    .await?;

    let dest_id = match sqlx::query_scalar!(
        r#"SELECT "id" FROM "InvestmentHolding"
            WHERE "walletId" = ? AND "type" = 'BITCOIN' ORDER BY "createdAt" ASC LIMIT 1"#,
        input.to_wallet_id
    )
    .fetch_optional(&mut *conn)
    .await?
    {
        Some(id) => {
            let dest = read_holding(conn, &id).await?;
            write_holding(
                conn,
                &dest.id,
                dest.quantity + transfer_btc,
                dest.cost_basis + moved_basis,
            )
            .await?;
            id
        }
        None => {
            let name = sqlx::query_scalar!(
                r#"SELECT "name" FROM "Wallet" WHERE "id" = ?"#,
                input.to_wallet_id
            )
            .fetch_optional(&mut *conn)
            .await?
            .context("destination wallet not found")?;
            create_holding(
                conn,
                &name,
                None,
                "BITCOIN",
                transfer_btc,
                moved_basis,
                None,
                Some(&input.to_wallet_id),
            )
            .await?
        }
    };

    let fee_btc_opt = (fee_btc > Decimal::ZERO).then_some(fee_btc);
    let id = record_transfer(
        conn,
        "BITCOIN",
        &source.id,
        &dest_id,
        transfer_btc,
        input.bitcoin_price,
        input.fee_amount.filter(|a| *a > Decimal::ZERO),
        input.fee_unit,
        fee_btc_opt,
        None,
        None,
    )
    .await?;

    Ok(TransferRecord {
        created_at: read_created_at(conn, &id).await?,
        id,
        ticker: None,
        quantity: transfer_btc,
        fee_amount: input.fee_amount.filter(|a| *a > Decimal::ZERO),
        fee_unit: input.fee_unit,
        fee_btc: fee_btc_opt,
        fee_transaction_id: None,
        from_holding_id: source.id,
        to_holding_id: dest_id,
    })
}

// ═══ Stock ═══

pub struct StockTransfer {
    pub from_custodian_id: String,
    pub to_custodian_id: String,
    pub holding_id: String,
    /// Absent means the whole position.
    pub quantity: Option<Decimal>,
    pub fee_amount: Option<Cents>,
    pub fee_budget_id: Option<String>,
    pub fee_account_id: Option<String>,
    /// The day the fee transaction is dated.
    pub today: String,
}

/// Move shares from one custodian to another, optionally charging a fee.
pub async fn execute_stock_transfer(
    conn: &mut SqliteConnection,
    input: &StockTransfer,
) -> Result<TransferRecord> {
    let owner = sqlx::query_scalar!(
        r#"SELECT "custodianId" FROM "InvestmentHolding" WHERE "id" = ?"#,
        input.holding_id
    )
    .fetch_optional(&mut *conn)
    .await?
    .flatten();
    if owner.as_deref() != Some(input.from_custodian_id.as_str()) {
        bail!(TransferError::NoSourceHolding);
    }
    let source = read_holding(conn, &input.holding_id).await?;

    if source.quantity <= Decimal::ZERO {
        bail!(TransferError::Insufficient {
            have: source.quantity.normalize(),
            need: Decimal::ONE,
        });
    }
    let moved = input.quantity.unwrap_or(source.quantity);
    if moved > source.quantity {
        bail!(TransferError::Insufficient {
            have: source.quantity.normalize(),
            need: moved.normalize(),
        });
    }

    let moved_basis = proportional_basis(moved, source.quantity, source.cost_basis);
    write_holding(
        conn,
        &source.id,
        source.quantity - moved,
        source.cost_basis - moved_basis,
    )
    .await?;

    // Matched on ticker at the destination custodian, which is how the same
    // stock held in two places stays one position per custodian.
    let dest_id = match sqlx::query_scalar!(
        r#"SELECT "id" FROM "InvestmentHolding"
            WHERE "ticker" IS ? AND "custodianId" = ? ORDER BY "createdAt" ASC LIMIT 1"#,
        source.ticker,
        input.to_custodian_id
    )
    .fetch_optional(&mut *conn)
    .await?
    {
        Some(id) => {
            let dest = read_holding(conn, &id).await?;
            write_holding(
                conn,
                &dest.id,
                dest.quantity + moved,
                dest.cost_basis + moved_basis,
            )
            .await?;
            id
        }
        None => {
            let custodian = sqlx::query_scalar!(
                r#"SELECT "name" FROM "Custodian" WHERE "id" = ?"#,
                input.to_custodian_id
            )
            .fetch_optional(&mut *conn)
            .await?
            .context("destination custodian not found")?;
            let ticker = source.ticker.clone().unwrap_or_default();
            let name = format!("{custodian} ${ticker}");
            create_holding(
                conn,
                &name,
                source.ticker.as_deref(),
                &source.ty,
                moved,
                moved_basis,
                Some(&input.to_custodian_id),
                None,
            )
            .await?
        }
    };

    // The fee, through the gate. `ledger_create` runs the balance hook, which
    // owns both the row's chain metadata and the account total — the two things
    // the TypeScript wrote by hand and separately.
    let fee_tx_id = match (
        input.fee_amount,
        &input.fee_budget_id,
        &input.fee_account_id,
    ) {
        (Some(fee), Some(budget), Some(account)) if fee.0 > 0 => {
            let id = next_id();
            let ticker = source.ticker.clone().unwrap_or_default();
            ledger_create(
                conn,
                &LedgerCreate {
                    id: format!("c{id}"),
                    name: format!("Stock transfer fee: {ticker}"),
                    amount: fee,
                    date: input.today.clone(),
                    created_at: crate::now_iso(),
                    tx_type: "EXPENSE".into(),
                    account_id: Some(account.clone()),
                    to_account_id: None,
                    parent_id: None,
                    budget_id: Some(budget.clone()),
                    expense_id: None,
                    trade: None,
                    bitcoin: None,
                    occurrence_date: None,
                    note: None,
                    purchase_group_id: None,
                },
            )
            .await
            .map(Some)?
        }
        _ => None,
    };

    let id = record_transfer(
        conn,
        "STOCK",
        &source.id,
        &dest_id,
        moved,
        None,
        input
            .fee_amount
            .map(|c| Decimal::from(c.0) / Decimal::ONE_HUNDRED),
        input.fee_amount.map(|_| FeeUnit::Usd),
        None,
        source.ticker.as_deref(),
        fee_tx_id.as_deref(),
    )
    .await?;

    Ok(TransferRecord {
        created_at: read_created_at(conn, &id).await?,
        id,
        ticker: source.ticker.clone(),
        quantity: moved,
        fee_amount: input
            .fee_amount
            .map(|c| Decimal::from(c.0) / Decimal::ONE_HUNDRED),
        fee_unit: input.fee_amount.map(|_| FeeUnit::Usd),
        fee_btc: None,
        fee_transaction_id: fee_tx_id,
        from_holding_id: source.id,
        to_holding_id: dest_id,
    })
}

// ═══ Reversal ═══

/// Undo a transfer, then the caller deletes it.
///
/// The basis that comes back is apportioned against the **destination's**
/// current state, not the amount originally moved. That is deliberate: the
/// destination may have been traded since, so its basis per unit is no longer
/// what arrived, and returning the original figure would invent value. The
/// reversal returns the destination's own proportion of what it holds now.
pub async fn reverse_transfer(conn: &mut SqliteConnection, transfer_id: &str) -> Result<()> {
    let t = sqlx::query!(
        r#"SELECT "type" AS "ty!", "fromHoldingId" AS "from_id!", "toHoldingId" AS "to_id!",
                  "quantity" AS "quantity!", "feeBtc" AS fee_btc,
                  "feeTransactionId" AS fee_tx_id
             FROM "InvestmentTransfer" WHERE "id" = ?"#,
        transfer_id
    )
    .fetch_optional(&mut *conn)
    .await?
    .context("transfer not found")?;

    let moved: Decimal = t.quantity.parse().context("transfer quantity")?;
    let fee_btc: Decimal = match t.fee_btc.as_deref() {
        Some(s) => s.parse().context("transfer feeBtc")?,
        None => Decimal::ZERO,
    };

    let dest = read_holding(conn, &t.to_id).await?;
    let returned_basis = proportional_basis(moved, dest.quantity, dest.cost_basis);

    // The fee comes back to the source with the transfer, because the source is
    // what paid it.
    let back = moved
        + if t.ty == "BITCOIN" {
            fee_btc
        } else {
            Decimal::ZERO
        };
    let source = read_holding(conn, &t.from_id).await?;
    write_holding(
        conn,
        &source.id,
        source.quantity + back,
        source.cost_basis + returned_basis,
    )
    .await?;
    write_holding(
        conn,
        &dest.id,
        dest.quantity - moved,
        dest.cost_basis - returned_basis,
    )
    .await?;

    // Through the gate again. Deleting the fee row is what restores the account
    // balance and re-walks the chain; the TypeScript incremented the balance by
    // hand *and* deleted the row, which double-counts the moment the hook it
    // bypassed is ever added.
    if let Some(fee_tx) = t.fee_tx_id {
        ledger_delete(conn, &fee_tx).await?;
    }

    Ok(())
}

// ═══ Shared writes ═══

#[allow(clippy::too_many_arguments)]
async fn create_holding(
    conn: &mut SqliteConnection,
    name: &str,
    ticker: Option<&str>,
    ty: &str,
    quantity: Decimal,
    basis: Cents,
    custodian_id: Option<&str>,
    wallet_id: Option<&str>,
) -> Result<String> {
    let id = format!("c{}", next_id());
    let now = crate::now_iso();
    let q = quantity.normalize().to_string();
    sqlx::query!(
        r#"INSERT INTO "InvestmentHolding"
             ("id","name","ticker","type","quantity","costBasis","custodianId","walletId",
              "createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?,?)"#,
        id,
        name,
        ticker,
        ty,
        q,
        basis.0,
        custodian_id,
        wallet_id,
        now,
        now
    )
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
async fn record_transfer(
    conn: &mut SqliteConnection,
    ty: &str,
    from_id: &str,
    to_id: &str,
    quantity: Decimal,
    bitcoin_price: Option<Decimal>,
    fee_amount: Option<Decimal>,
    fee_unit: Option<FeeUnit>,
    fee_btc: Option<Decimal>,
    ticker: Option<&str>,
    fee_tx_id: Option<&str>,
) -> Result<String> {
    let id = format!("c{}", next_id());
    let now = crate::now_iso();
    let q = quantity.normalize().to_string();
    let price = bitcoin_price.map(|d| d.normalize().to_string());
    let fee = fee_amount.map(|d| d.normalize().to_string());
    let unit = fee_unit.map(|u| u.as_str());
    let btc = fee_btc.map(|d| d.normalize().to_string());
    sqlx::query!(
        r#"INSERT INTO "InvestmentTransfer"
             ("id","type","fromHoldingId","toHoldingId","quantity","bitcoinPrice",
              "feeAmount","feeUnit","feeBtc","ticker","feeTransactionId","createdAt")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"#,
        id,
        ty,
        from_id,
        to_id,
        q,
        price,
        fee,
        unit,
        btc,
        ticker,
        fee_tx_id,
        now
    )
    .execute(&mut *conn)
    .await?;
    Ok(id)
}

async fn read_created_at(conn: &mut SqliteConnection, id: &str) -> Result<String> {
    Ok(sqlx::query_scalar!(
        r#"SELECT "createdAt" AS "created_at!" FROM "InvestmentTransfer" WHERE "id" = ?"#,
        id
    )
    .fetch_one(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn a_sats_fee_survives_the_conversion_that_cents_would_have_erased() {
        // 5,000 sats is 0.00005 BTC. As integer cents this is zero, which is
        // what migration 0003 exists to prevent.
        assert_eq!(fee_to_btc(d("5000"), FeeUnit::Sats, None), d("0.00005"));
    }

    #[test]
    fn a_usd_fee_without_a_price_contributes_nothing_rather_than_guessing() {
        assert_eq!(fee_to_btc(d("10"), FeeUnit::Usd, None), Decimal::ZERO);
        assert_eq!(
            fee_to_btc(d("10"), FeeUnit::Usd, Some(d("50000"))),
            d("0.0002")
        );
    }

    #[test]
    fn a_basis_split_rounds_once_and_the_pair_still_sums() {
        // A third of a position whose basis is an odd number of cents. Rounding
        // the same value into both sides is what makes the sum survive.
        let moved = proportional_basis(d("1"), d("3"), Cents(1_00));
        assert_eq!(moved, Cents(33));
        let source_keeps = Cents(1_00) - moved;
        assert_eq!(
            source_keeps + moved,
            Cents(1_00),
            "no cent invented or lost"
        );
        assert_eq!(
            source_keeps,
            Cents(67),
            "the remainder stays with the source"
        );
    }

    #[test]
    fn a_position_with_no_recorded_basis_transfers_without_inventing_one() {
        assert_eq!(proportional_basis(d("1"), d("3"), Cents::ZERO), Cents::ZERO);
        assert_eq!(
            proportional_basis(d("1"), Decimal::ZERO, Cents(500)),
            Cents::ZERO
        );
    }
}
