//! The ledger gate — port of `apps/api/src/lib/lifecycle/ledger.ts` (ADR-013).
//!
//! **Every mutation of the Transaction table goes through here.** Four code
//! paths once updated `Transaction.amount` directly without recalculating
//! `netAmount` or firing the lifecycle hooks, and `Account.balance` drifted
//! cumulatively every time a recurring expense was edited — hundreds of dollars on one card
//! before anyone noticed. The gate exists so that bypassing it is not possible
//! rather than merely discouraged.
//!
//! **Hooks are dispatched in explicit priority order** rather than through a
//! registry. The TypeScript registers them at startup, which buys runtime
//! extensibility this application never uses and costs the ability to see the
//! ordering in one place. Here the order IS the function body: balance first,
//! because everything downstream reads the balance it writes.
//!
//! Every operation takes a `&mut SqliteConnection` so callers can pass a
//! transaction. A merge that half-applies is the failure mode ADR-030 named as
//! the prerequisite for payment splitting, and it is prevented by threading the
//! handle rather than by remembering to.

use crate::balance;
use crate::debt_payment;
use crate::holdings::{self, AssetType, Direction, Trade};
use crate::pay_period;
use crate::schedule_matcher;
use crate::snapshot;
use crate::system_budget;
use anyhow::{Context, Result};
use avoir_core::dates::canonical_date;
use avoir_core::money::Cents;
use rust_decimal::Decimal;
use sqlx::SqliteConnection;

/// What a hook is reacting to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerEvent {
    Created,
    Updated,
    Deleted,
}

/// The fields the gate needs to write a row and drive the hooks.
#[derive(Debug, Clone)]
pub struct LedgerCreate {
    pub id: String,
    pub name: String,
    pub amount: Cents,
    pub date: String,
    pub created_at: String,
    pub tx_type: String,
    pub account_id: Option<String>,
    pub to_account_id: Option<String>,
    pub parent_id: Option<String>,
    pub budget_id: Option<String>,
    /// Links the row to a recurring expense. When that expense funds a debt,
    /// the debt-payment hook records a principal/interest split against it.
    pub expense_id: Option<String>,
    /// Free text on the row.
    ///
    /// Load-bearing for reconciliation rather than decorative: an "ignored"
    /// decision is appended here precisely so that "I have already looked at
    /// this" outlives the session that produced it (ADR-029), and a merge
    /// preserves each replaced row's original name and date the same way.
    pub note: Option<String>,
    /// Present on TRADE rows. Written to `TradeDetail` and applied to the
    /// holding — ADR-027 moved this out of a JSON blob into a typed table with
    /// real foreign keys, which is why custodian and wallet are ids here.
    pub trade: Option<TradeInput>,
    /// Present on a bitcoin PAYMENT row. Written to `BitcoinPaymentDetail`
    /// before the hooks run, because the hook that applies it to the wallet
    /// holding reads that row.
    pub bitcoin: Option<BitcoinInput>,
    /// The date the row is FOR, when that differs from the day it was entered.
    /// Mark-as-paid sets it to the original due date so a late payment still
    /// finds its schedule row (ADR-001).
    pub occurrence_date: Option<String>,
    /// Ties a balance-neutral Anchor to the payment legs that funded it
    /// (ADR-030). The Anchor carries the budget and no account; the legs carry
    /// an account each and the system Payment allocation, so a split purchase
    /// is counted once by the budget and once by the balance without either
    /// knowing about the other.
    pub purchase_group_id: Option<String>,
}

/// The bitcoin-payment fields a caller supplies, before they become a
/// `BitcoinPaymentDetail` row (ADR-027).
///
/// Spending or receiving BTC directly, as distinct from buying or selling it —
/// a trade moves dollars into or out of an asset, a payment moves the asset
/// itself. The gate needs this at creation time because the hook that applies
/// it to the wallet holding reads the detail row, and a hook cannot see a row
/// written after it runs.
#[derive(Debug, Clone)]
pub struct BitcoinInput {
    pub wallet_id: String,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub bitcoin_unit_is_sats: bool,
    pub income_type: Option<String>,
}

/// The trade fields a caller supplies, before they become a `TradeDetail` row.
#[derive(Debug, Clone)]
pub struct TradeInput {
    pub direction: Direction,
    pub asset_type: AssetType,
    pub ticker: Option<String>,
    pub quantity: Decimal,
    pub unit_price: Decimal,
    pub bitcoin_unit_is_sats: bool,
    pub custodian_id: Option<String>,
    pub wallet_id: Option<String>,
}

/// Create a transaction and run its side effects.
///
/// `netAmount` is set from `amount`, never accepted from the caller — the two
/// disagreeing is the drift ADR-013 was written about. (They are equal today:
/// the `rewardsApplied` discount was retired when rewards redemption became a
/// payment leg rather than a per-purchase reduction. The assignment stays
/// explicit so the invariant is visible rather than incidental.)
/// The id of the `TransactionDescription` for `name`, creating it if new.
///
/// Matching is CASE-INSENSITIVE, following the reference's
/// `{ name: { equals, mode: 'insensitive' } }`. Without that, "Amazon" and
/// "amazon" become two descriptions and the merge UI has to clean up after
/// every typo. `NOCASE` is used rather than `LOWER(...)` on both sides so the
/// unique index on `name` can still serve the lookup.
///
/// An empty name yields no description rather than one named "", which is not
/// a thing anyone would want to merge or rename.
async fn resolve_description(
    conn: &mut SqliteConnection,
    name: &str,
    created_at: &str,
) -> Result<Option<String>> {
    if name.is_empty() {
        return Ok(None);
    }

    if let Some(row) = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "TransactionDescription" WHERE "name" = ? COLLATE NOCASE"#,
        name
    )
    .fetch_optional(&mut *conn)
    .await
    .context("description lookup")?
    {
        return Ok(Some(row.id));
    }

    let id = avoir_core::ids::cuid();
    sqlx::query!(
        r#"INSERT INTO "TransactionDescription" ("id","name","createdAt") VALUES (?, ?, ?)"#,
        id,
        name,
        created_at,
    )
    .execute(&mut *conn)
    .await
    .context("description insert")?;
    Ok(Some(id))
}

pub async fn ledger_create(conn: &mut SqliteConnection, data: &LedgerCreate) -> Result<String> {
    let net = data.amount;

    // Dates are normalised HERE rather than at each route, for the same reason
    // `netAmount` is: this is the one gate every write passes through, so a
    // rule applied here cannot be forgotten by a caller. A bare `YYYY-MM-DD`
    // from a date input sorts below every full timestamp in TEXT comparison,
    // which misorders the list and — worse — feeds the balance chain a
    // sequence that is not the real one.
    let date = canonical_date(&data.date)
        .with_context(|| format!("transaction date is not a date: {:?}", data.date))?;
    let occurrence_date = match &data.occurrence_date {
        Some(d) => Some(
            canonical_date(d).with_context(|| format!("occurrenceDate is not a date: {d:?}"))?,
        ),
        None => None,
    };

    // Every named transaction is filed under a `TransactionDescription`,
    // creating one the first time a name is seen. This is the /descriptions
    // feature's only writer — the merge and rename UI operates on these rows —
    // and the port had no equivalent at all, so every transaction it created
    // carried a NULL `descriptionId` and the feature was quietly dead.
    //
    // The read harness could not see it: the imported production rows arrived
    // with their descriptions already attached, so the lists matched. It took
    // CREATING a transaction to show the gap, which is the write harness's
    // whole reason for existing.
    //
    // Here rather than in the routes for the reason above the date normalisation:
    // this is the one gate every write passes through.
    let description_id = resolve_description(&mut *conn, &data.name, &data.created_at).await?;

    sqlx::query!(
        r#"INSERT INTO "Transaction"
             ("id","amount","date","createdAt","type","name","imported","netAmount",
              "isCashBack","accountId","toAccountId","parentId","budgetId","expenseId",
              "occurrenceDate","purchaseGroupId","note","descriptionId")
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        data.id,
        data.amount.0,
        date,
        data.created_at,
        data.tx_type,
        data.name,
        net.0,
        data.account_id,
        data.to_account_id,
        data.parent_id,
        data.budget_id,
        data.expense_id,
        occurrence_date,
        data.purchase_group_id,
        data.note,
        description_id,
    )
    .execute(&mut *conn)
    .await
    .context("ledger_create insert")?;

    if let Some(t) = &data.trade {
        let detail_id = format!("td_{}", data.id);
        let direction = match t.direction {
            Direction::Buy => "BUY",
            Direction::Sell => "SELL",
        };
        let asset_type = match t.asset_type {
            AssetType::Stock => "Stock",
            AssetType::Bitcoin => "Bitcoin",
        };
        let bitcoin_unit = if t.bitcoin_unit_is_sats {
            Some("Sats")
        } else {
            None
        };
        let qty = t.quantity.to_string();
        let price = t.unit_price.to_string();
        sqlx::query!(
            r#"INSERT INTO "TradeDetail"
                 ("id","transactionId","direction","assetType","ticker","quantity",
                  "unitPrice","bitcoinUnit","custodianId","walletId")
               VALUES (?,?,?,?,?,?,?,?,?,?)"#,
            detail_id,
            data.id,
            direction,
            asset_type,
            t.ticker,
            qty,
            price,
            bitcoin_unit,
            t.custodian_id,
            t.wallet_id,
        )
        .execute(&mut *conn)
        .await
        .context("writing TradeDetail")?;
    }

    if let Some(b) = &data.bitcoin {
        let detail_id = format!("bpd_{}", data.id);
        let unit = if b.bitcoin_unit_is_sats {
            "Sats"
        } else {
            "Bitcoin"
        };
        let qty = b.quantity.to_string();
        let price = b.unit_price.to_string();
        sqlx::query!(
            r#"INSERT INTO "BitcoinPaymentDetail"
                 ("id","transactionId","walletId","quantity","unitPrice","bitcoinUnit","incomeType")
               VALUES (?,?,?,?,?,?,?)"#,
            detail_id,
            data.id,
            b.wallet_id,
            qty,
            price,
            unit,
            b.income_type,
        )
        .execute(&mut *conn)
        .await
        .context("writing BitcoinPaymentDetail")?;
    }

    dispatch(conn, LedgerEvent::Created, &data.id).await?;
    Ok(data.id.clone())
}

/// The fields an update may change.
///
/// `None` means "leave alone"; `Some(None)` on a nullable field means "clear
/// it". That distinction matters — unlinking a transaction from its expense is
/// a real operation, and a plain `Option` cannot express it.
///
/// `netAmount` is deliberately absent. It is derived from `amount` and never
/// accepted from a caller: the two disagreeing is precisely the drift ADR-013
/// was written about, and four code paths once caused it by updating one
/// without the other.
#[derive(Debug, Clone, Default)]
pub struct LedgerUpdate {
    pub amount: Option<Cents>,
    pub name: Option<String>,
    pub date: Option<String>,
    pub tx_type: Option<String>,
    pub account_id: Option<Option<String>>,
    pub to_account_id: Option<Option<String>>,
    pub expense_id: Option<Option<String>>,
    pub income_id: Option<Option<String>>,
    pub budget_id: Option<Option<String>>,
    pub note: Option<Option<String>>,
    pub occurrence_date: Option<Option<String>>,
    /// The shared description a row is filed under. Renaming or merging one
    /// rewrites every transaction that points at it, and that goes through the
    /// gate rather than a bare UPDATE — not because a hook reads it, but
    /// because `name` moves with it, and a gate that some name-changes skip is
    /// a gate with an exception nobody will remember.
    pub description_id: Option<Option<String>>,
}

/// Apply a patch to a transaction and re-run its side effects.
///
/// The accounts a row touched BEFORE the change are rebuilt as well as the ones
/// it touches after. Moving a transaction between accounts otherwise leaves the
/// old account's chain describing a row it no longer contains — the balance
/// stays wrong until something else happens to rebuild it.
pub async fn ledger_update(
    conn: &mut SqliteConnection,
    id: &str,
    changes: &LedgerUpdate,
) -> Result<()> {
    let before = sqlx::query!(
        r#"SELECT "accountId" AS account_id, "toAccountId" AS to_account_id
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_one(&mut *conn)
    .await
    .context("ledger_update: row not found")?;

    // One statement, with COALESCE picking the incoming value or keeping the
    // stored one. Building SQL per patch shape would be the obvious
    // alternative and is how a column gets forgotten.
    //
    // Nullable fields need a second parameter: COALESCE cannot distinguish
    // "not supplied" from "set to NULL", so a `clear_*` flag carries the
    // difference explicitly.
    let (acct, clear_acct) = split_nullable(&changes.account_id);
    let (to_acct, clear_to_acct) = split_nullable(&changes.to_account_id);
    let (expense, clear_expense) = split_nullable(&changes.expense_id);
    let (income, clear_income) = split_nullable(&changes.income_id);
    let (budget, clear_budget) = split_nullable(&changes.budget_id);
    let (note, clear_note) = split_nullable(&changes.note);
    let (occ, clear_occ) = split_nullable(&changes.occurrence_date);
    // Same normalisation as create, for the same reason — an edit that moved a
    // date could otherwise reintroduce the mixed format the insert prevents.
    let occ = match occ {
        Some(d) => Some(
            canonical_date(&d).with_context(|| format!("occurrenceDate is not a date: {d:?}"))?,
        ),
        None => None,
    };
    let date = match &changes.date {
        Some(d) => Some(
            canonical_date(d).with_context(|| format!("transaction date is not a date: {d:?}"))?,
        ),
        None => None,
    };
    let (desc, clear_desc) = split_nullable(&changes.description_id);
    let amount = changes.amount.map(|c| c.0);

    sqlx::query!(
        r#"UPDATE "Transaction" SET
             "amount"     = COALESCE(?1, "amount"),
             "netAmount"  = COALESCE(?1, "netAmount"),
             "name"       = COALESCE(?2, "name"),
             "date"       = COALESCE(?3, "date"),
             "type"       = COALESCE(?4, "type"),
             "accountId"      = CASE WHEN ?6  THEN NULL ELSE COALESCE(?5,  "accountId")      END,
             "toAccountId"    = CASE WHEN ?8  THEN NULL ELSE COALESCE(?7,  "toAccountId")    END,
             "expenseId"      = CASE WHEN ?10 THEN NULL ELSE COALESCE(?9,  "expenseId")      END,
             "incomeId"       = CASE WHEN ?12 THEN NULL ELSE COALESCE(?11, "incomeId")       END,
             "budgetId"       = CASE WHEN ?14 THEN NULL ELSE COALESCE(?13, "budgetId")       END,
             "note"           = CASE WHEN ?16 THEN NULL ELSE COALESCE(?15, "note")           END,
             "occurrenceDate" = CASE WHEN ?18 THEN NULL ELSE COALESCE(?17, "occurrenceDate") END,
             "descriptionId"  = CASE WHEN ?20 THEN NULL ELSE COALESCE(?19, "descriptionId")  END
           WHERE "id" = ?21"#,
        amount,
        changes.name,
        date,
        changes.tx_type,
        acct,
        clear_acct,
        to_acct,
        clear_to_acct,
        expense,
        clear_expense,
        income,
        clear_income,
        budget,
        clear_budget,
        note,
        clear_note,
        occ,
        clear_occ,
        desc,
        clear_desc,
        id,
    )
    .execute(&mut *conn)
    .await
    .context("ledger_update")?;

    dispatch(conn, LedgerEvent::Updated, id).await?;

    // Rebuild whatever the row USED to touch, if it moved away.
    for old in [before.account_id, before.to_account_id]
        .into_iter()
        .flatten()
    {
        balance::rebuild_chain(conn, &old).await?;
    }
    Ok(())
}

/// Splits a patch field into (value, clear-flag) so SQL can tell "not supplied"
/// from "set to NULL".
fn split_nullable(field: &Option<Option<String>>) -> (Option<String>, bool) {
    match field {
        None => (None, false),      // leave alone
        Some(None) => (None, true), // clear it
        Some(Some(v)) => (Some(v.clone()), false),
    }
}

/// Change only the amount. A thin wrapper kept because it is by far the most
/// common update and reads better at call sites than a mostly-empty patch.
pub async fn ledger_update_amount(
    conn: &mut SqliteConnection,
    id: &str,
    amount: Cents,
) -> Result<()> {
    ledger_update(
        conn,
        id,
        &LedgerUpdate {
            amount: Some(amount),
            ..Default::default()
        },
    )
    .await
}

/// Delete a transaction and reverse its side effects.
///
/// The row is read BEFORE the delete: the hooks need to know what they are
/// reversing, and several foreign keys are `ON DELETE SET NULL`, so reading
/// afterwards finds the links already gone.
pub async fn ledger_delete(conn: &mut SqliteConnection, id: &str) -> Result<()> {
    let row = sqlx::query!(
        r#"SELECT "accountId" AS account_id, "toAccountId" AS to_account_id
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_one(&mut *conn)
    .await
    .context("ledger_delete: row not found")?;

    // MUST be read before the delete: DebtPayment.transactionId is
    // ON DELETE SET NULL, so afterwards the link is gone and the reversal
    // silently does nothing while the debt keeps a reduction it should not.
    let payment = debt_payment::read_for_reversal(&mut *conn, id).await?;
    // Same constraint as the payment: TradeDetail is ON DELETE CASCADE, so the
    // trade must be read while the transaction still exists.
    let trade = read_trade(&mut *conn, id).await?;
    // Read before the row goes: BitcoinPaymentDetail is ON DELETE CASCADE, so
    // by the time the transaction is gone there is nothing left to reverse
    // from — the same reason the trade is read here.
    let bitcoin = read_bitcoin_payment(&mut *conn, id).await?;
    // Release the scheduled occurrence while the link still exists. Leaving it
    // PAID is how a deleted payment stays "done" and the bill never resurfaces.
    schedule_matcher::on_deleted(&mut *conn, id).await?;

    sqlx::query!(r#"DELETE FROM "Transaction" WHERE "id" = ?"#, id)
        .execute(&mut *conn)
        .await?;

    if let Some(p) = payment {
        debt_payment::reverse(&mut *conn, p).await?;
    }
    if let Some((trade, amount)) = trade {
        // multiplier -1 inverts the direction, so a BUY reversal behaves as a
        // SELL and restores the holding rather than merely subtracting.
        holdings::apply_trade_to_holding(&mut *conn, &trade, amount, -1).await?;
    }
    if let Some(p) = bitcoin {
        // Same inversion for a bitcoin payment: deleting a BTC spend must give
        // the coin back to the wallet, not take more away.
        holdings::apply_bitcoin_payment_to_holding(
            &mut *conn,
            &p.wallet_id,
            p.quantity,
            p.unit_is_sats,
            &p.tx_type,
            p.amount,
            -1,
        )
        .await?;
    }

    // Rebuild whichever accounts the row touched. Reading first is what makes
    // this possible at all.
    for acct in [row.account_id, row.to_account_id].into_iter().flatten() {
        balance::rebuild_chain(conn, &acct).await?;
    }
    Ok(())
}

/// Run every side effect for one transaction, in priority order.
///
/// **The order is taken from the `priority:` field of each hook file, not from
/// OPERATIONS.md** — that table was wrong when this was written, and nearly
/// inverted (it had balance first and system-budget last; the source has the
/// reverse). It has since been corrected, but the source remains the authority.
///
/// **What the ordering actually buys, verified rather than assumed:** only the
/// balance and bitcoin-holding hooks touch balance columns, and they are
/// mutually exclusive — balance requires `accountId`, bitcoin-holding requires
/// `bitcoinPaymentDetail`, and the cross-field rules forbid both on one row. So
/// no hook consumes another's output today. The order is independence rather
/// than dependency, and the one real constraint is that the snapshot hook runs
/// last because it observes everything else's result.
///
/// | Priority | Hook | Status |
/// |---|---|---|
/// | 5  | system budget auto-assign | **done** |
/// | 10 | balance chain + account total | **done** |
/// | 15 | schedule matching | **done** |
/// | 20 | trade holdings | **done** |
/// | 20 | bitcoin payment holdings | logic **done**, not yet dispatched |
/// | 30 | debt payment create/reverse | **done** |
/// | 40 | pay period extension | **done** |
/// | 50 | balance snapshot | not ported |
async fn dispatch(conn: &mut SqliteConnection, event: LedgerEvent, id: &str) -> Result<()> {
    system_budget_hook(conn, event, id).await?; // 5
    balance_hook(conn, event, id).await?; // 10
    schedule_matcher_hook(conn, event, id).await?; // 15
    trade_holding_hook(conn, event, id).await?; // 20
    bitcoin_holding_hook(conn, event, id).await?; // 20
    debt_payment_hook(conn, event, id).await?; // 30
    pay_period_hook(conn, event, id).await?; // 40
    snapshot_hook(conn, event, id).await?; // 50
    Ok(())
}

/// Priority 20 — apply a bitcoin PAYMENT to its wallet holding, and record the
/// wallet's BTC balance either side of it.
///
/// **This was ported and then not wired**, which is worse than not porting it:
/// `apply_bitcoin_payment_to_holding` existed, had tests, and was called by
/// nothing, so spending BTC moved no holding at all. Distinct from a trade —
/// this is spending or receiving bitcoin directly rather than buying or
/// selling it — and it lives in its own detail table (ADR-027).
///
/// The before/after quantities go in `btcBalanceBefore`/`btcBalanceAfter`, not
/// in `balanceBefore`/`balanceAfter`. Those are INTEGER cents under ADR-033
/// and cannot represent 8-decimal BTC: `0.00000001` would store as `0`. The
/// TypeScript writes the cash columns, which is only harmless because that
/// code has never executed.
async fn bitcoin_holding_hook(
    conn: &mut SqliteConnection,
    event: LedgerEvent,
    id: &str,
) -> Result<()> {
    if event != LedgerEvent::Created {
        return Ok(());
    }
    let Some(payment) = read_bitcoin_payment(conn, id).await? else {
        return Ok(());
    };

    // Measured BEFORE the movement is applied, so the pair brackets this row.
    //
    // The holding's STORED quantity, not a recomputation from movement history
    // (`wallet_btc_quantity`). Those answer two different questions: the stored
    // figure is the running total the holdings code maintains and the one the
    // Investments page shows, while the recomputation asks "what did the
    // recorded movements add up to as of a date" — which reads 0 for a wallet
    // whose balance predates movement tracking. Bracketing THIS row needs the
    // running total, which is also what the TypeScript reads.
    let before = holding_btc_quantity(&mut *conn, &payment.wallet_id).await?;

    holdings::apply_bitcoin_payment_to_holding(
        &mut *conn,
        &payment.wallet_id,
        payment.quantity,
        payment.unit_is_sats,
        &payment.tx_type,
        payment.amount,
        1,
    )
    .await?;

    let after = holding_btc_quantity(&mut *conn, &payment.wallet_id).await?;

    let before_s = before.to_string();
    let after_s = after.to_string();
    sqlx::query!(
        r#"UPDATE "Transaction" SET "btcBalanceBefore" = ?, "btcBalanceAfter" = ? WHERE "id" = ?"#,
        before_s,
        after_s,
        id
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Priority 50 — refresh today's snapshot for a BTC holding the row touched.
///
/// Runs last, so it captures the holding state every earlier hook has finished
/// producing. **The price is deliberately not fetched here**: the TypeScript
/// calls CoinGecko from inside the mutation, which puts a third-party HTTP
/// request in the middle of a database write. With no price the regen reports
/// `NoPrice` and writes nothing, which is the correct resting state until the
/// service layer supplies one.
///
/// A snapshot failure must never fail the mutation that triggered it — the
/// money movement is the real work and the snapshot is derived — so the
/// outcome is logged rather than propagated. Unlike the TypeScript's bare
/// `catch {}`, the error is still visible.
async fn snapshot_hook(conn: &mut SqliteConnection, event: LedgerEvent, id: &str) -> Result<()> {
    if event == LedgerEvent::Deleted {
        return Ok(());
    }
    let wallet_id = match read_bitcoin_payment(conn, id).await? {
        Some(p) => Some(p.wallet_id),
        None => read_trade(conn, id)
            .await?
            .and_then(|(t, _)| match t.asset_type {
                holdings::AssetType::Bitcoin => t.wallet_id,
                _ => None,
            }),
    };
    let Some(wallet_id) = wallet_id else {
        return Ok(());
    };

    let holding = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "InvestmentHolding"
            WHERE "type" = 'BITCOIN' AND "walletId" = ? LIMIT 1"#,
        wallet_id
    )
    .fetch_optional(&mut *conn)
    .await?
    .map(|r| r.id);

    if let Some(holding_id) = holding {
        let today = avoir_core::dates::today();
        if let Err(e) = snapshot::regenerate_holding_snapshot(conn, &holding_id, None, today).await
        {
            eprintln!("[ledger] snapshot regeneration failed for {holding_id}: {e:#}");
        }
    }
    Ok(())
}

/// A wallet's BTC holding as currently recorded.
///
/// Zero when the wallet has no holding row yet — the first payment into a new
/// wallet legitimately starts from nothing.
async fn holding_btc_quantity(conn: &mut SqliteConnection, wallet_id: &str) -> Result<Decimal> {
    let row = sqlx::query!(
        r#"SELECT "quantity" AS "quantity!: String" FROM "InvestmentHolding"
            WHERE "type" = 'BITCOIN' AND "walletId" = ? AND "ticker" IS NULL LIMIT 1"#,
        wallet_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    // A malformed quantity is an error, not a zero. Defaulting would apply a
    // silent no-op movement and leave the holding quietly wrong — the exact
    // class of failure QUALITY.md forbids. Production spells these as plain
    // 30-decimal strings which rust_decimal parses fine (verified against the
    // real values); this guards the case where that stops being true.
    match row {
        Some(r) => r.quantity.parse().with_context(|| {
            format!(
                "unparseable BTC quantity on holding for wallet {wallet_id}: {}",
                r.quantity
            )
        }),
        None => Ok(Decimal::ZERO),
    }
}

/// The bitcoin-payment fields a hook needs.
struct BitcoinPayment {
    wallet_id: String,
    quantity: rust_decimal::Decimal,
    unit_is_sats: bool,
    tx_type: String,
    amount: Cents,
}

async fn read_bitcoin_payment(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<BitcoinPayment>> {
    let row = sqlx::query!(
        r#"SELECT b."walletId" AS "wallet_id!", b."quantity" AS "quantity!: String",
                  b."bitcoinUnit" AS "unit!: String", t."type" AS "tx_type!",
                  t."amount" AS "amount!: i64"
             FROM "BitcoinPaymentDetail" b
             JOIN "Transaction" t ON t."id" = b."transactionId"
            WHERE b."transactionId" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    match row {
        None => Ok(None),
        Some(r) => {
            let quantity = r.quantity.parse().with_context(|| {
                format!(
                    "unparseable quantity on BitcoinPaymentDetail for {id}: {}",
                    r.quantity
                )
            })?;
            Ok(Some(BitcoinPayment {
                wallet_id: r.wallet_id,
                quantity,
                unit_is_sats: r.unit == "Sats",
                tx_type: r.tx_type,
                amount: Cents(r.amount),
            }))
        }
    }
}

/// Priority 20 — apply a trade to its holding, and record what basis it used.
///
/// Only on create; the reversal runs from `ledger_delete`, because
/// `TradeDetail` is `ON DELETE CASCADE` and is gone by the time the row is.
async fn trade_holding_hook(
    conn: &mut SqliteConnection,
    event: LedgerEvent,
    id: &str,
) -> Result<()> {
    if event != LedgerEvent::Created {
        return Ok(());
    }
    let Some((trade, amount)) = read_trade(conn, id).await? else {
        return Ok(());
    };

    if let Some(allocated) = holdings::apply_trade_to_holding(conn, &trade, amount, 1).await? {
        // A sell consumes part of the holding's basis; recording it on the row
        // is what lets a later reversal know how much to give back.
        sqlx::query!(
            r#"UPDATE "Transaction" SET "costBasisAllocated" = ? WHERE "id" = ?"#,
            allocated.0,
            id
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Read a row's trade detail, if it has one. Used both by the hook and by
/// `ledger_delete`, which must call it BEFORE the cascade removes the row.
async fn read_trade(conn: &mut SqliteConnection, id: &str) -> Result<Option<(Trade, Cents)>> {
    let row = sqlx::query!(
        r#"SELECT d."direction" AS "direction!: String", d."assetType" AS "asset_type!: String",
                  d."ticker" AS ticker, d."quantity" AS "quantity!: String",
                  d."bitcoinUnit" AS bitcoin_unit, d."custodianId" AS custodian_id,
                  d."walletId" AS wallet_id, t."amount" AS "amount!: i64"
           FROM "TradeDetail" d
           JOIN "Transaction" t ON t."id" = d."transactionId"
           WHERE d."transactionId" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(r) = row else { return Ok(None) };
    Ok(Some((
        Trade {
            direction: if r.direction == "SELL" {
                Direction::Sell
            } else {
                Direction::Buy
            },
            asset_type: if r.asset_type == "Bitcoin" {
                AssetType::Bitcoin
            } else {
                AssetType::Stock
            },
            ticker: r.ticker,
            quantity: r.quantity.parse::<Decimal>().context("trade quantity")?,
            bitcoin_unit_is_sats: r.bitcoin_unit.as_deref() == Some("Sats"),
            custodian_id: r.custodian_id,
            wallet_id: r.wallet_id,
        },
        Cents(r.amount),
    )))
}

/// Priority 30 — record a principal/interest split when the row funds a debt.
///
/// Only on create. The reversal is driven from `ledger_delete` rather than from
/// here, because it has to read the payment BEFORE the transaction row is
/// removed — see `debt_payment::read_for_reversal`.
async fn debt_payment_hook(
    conn: &mut SqliteConnection,
    event: LedgerEvent,
    id: &str,
) -> Result<()> {
    if event != LedgerEvent::Created {
        return Ok(());
    }
    let row = sqlx::query!(
        r#"SELECT "expenseId" AS expense_id, "amount" AS "amount!: i64", "date" AS "date!: String"
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(row) = row else { return Ok(()) };
    let Some(expense_id) = row.expense_id else {
        return Ok(());
    };

    debt_payment::on_created(conn, id, &expense_id, Cents(row.amount), &row.date).await?;
    Ok(())
}

/// Priority 5 — put INCOME, TRADE and TRANSFER rows in their system budget.
///
/// Runs before everything else so later hooks see the final `budgetId`. Create
/// only here; the TypeScript also fires on update when the TYPE changes, which
/// `ledger_update_amount` cannot do — it changes only the amount.
async fn system_budget_hook(
    conn: &mut SqliteConnection,
    event: LedgerEvent,
    id: &str,
) -> Result<()> {
    if event != LedgerEvent::Created {
        return Ok(());
    }
    let row = sqlx::query!(
        r#"SELECT "type" AS "tx_type!: String", "budgetId" AS budget_id
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(row) = row else { return Ok(()) };
    // An explicit budget wins: the hook fills a gap, it does not override a
    // choice the caller made.
    if row.budget_id.is_some() {
        return Ok(());
    }
    system_budget::assign(conn, id, &row.tx_type).await?;
    Ok(())
}

/// Priority 40 — push the pay-period horizon one further on recurring activity.
///
/// Only for rows linked to a RECURRING income or expense. A ONE_TIME source
/// does not extend anything — the horizon should track the schedule, not
/// one-off entries.
async fn pay_period_hook(conn: &mut SqliteConnection, event: LedgerEvent, id: &str) -> Result<()> {
    if event != LedgerEvent::Created {
        return Ok(());
    }
    let row = sqlx::query!(
        r#"SELECT "incomeId" AS income_id, "expenseId" AS expense_id
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else { return Ok(()) };

    let mut recurring = false;
    if let Some(iid) = row.income_id {
        let f = sqlx::query!(
            r#"SELECT "frequency" AS "frequency!: String" FROM "Income" WHERE "id" = ?"#,
            iid
        )
        .fetch_optional(&mut *conn)
        .await?;
        recurring |= f.map(|r| r.frequency != "ONE_TIME").unwrap_or(false);
    }
    if let Some(eid) = row.expense_id {
        let f = sqlx::query!(
            r#"SELECT "frequency" AS "frequency!: String" FROM "Expense" WHERE "id" = ?"#,
            eid
        )
        .fetch_optional(&mut *conn)
        .await?;
        recurring |= f.map(|r| r.frequency != "ONE_TIME").unwrap_or(false);
    }

    if recurring {
        pay_period::extend_by_one(conn).await?;
    }
    Ok(())
}

/// Priority 15 — link the row to the scheduled occurrence it satisfies.
///
/// Fires on create and update. The DELETE side runs from `ledger_delete`
/// instead: `ScheduledTransaction.transactionId` must be released while the
/// row still exists, the same read-before-delete constraint the debt payment
/// and trade detail have.
async fn schedule_matcher_hook(
    conn: &mut SqliteConnection,
    event: LedgerEvent,
    id: &str,
) -> Result<()> {
    let row = sqlx::query!(
        r#"SELECT "expenseId" AS expense_id, "incomeId" AS income_id,
                  "amount" AS "amount!: i64", "date" AS "date!: String",
                  "occurrenceDate" AS occurrence_date
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else { return Ok(()) };
    if row.expense_id.is_none() && row.income_id.is_none() {
        return Ok(());
    }

    match event {
        LedgerEvent::Created => {
            schedule_matcher::on_created(
                conn,
                id,
                row.expense_id.as_deref(),
                row.income_id.as_deref(),
                Cents(row.amount),
                &row.date,
                row.occurrence_date.as_deref(),
            )
            .await?;
        }
        LedgerEvent::Updated => {
            schedule_matcher::on_updated(
                conn,
                id,
                row.expense_id.as_deref(),
                row.income_id.as_deref(),
                Cents(row.amount),
                &row.date,
                row.occurrence_date.as_deref(),
            )
            .await?;
        }
        LedgerEvent::Deleted => {}
    }
    Ok(())
}

/// Priority 10 — maintain the per-row chain and the account total.
///
/// Rebuilds from the account's opening balance rather than patching the single
/// row. Patching is what the TypeScript does, and it is correct only when the
/// row is the newest; an insert in the middle of history leaves every later row
/// stale. A rebuild is O(rows-in-account) rather than O(rows-after), which for
/// a personal ledger is a few thousand integer additions and not worth the
/// class of bug the incremental version keeps producing.
async fn balance_hook(conn: &mut SqliteConnection, _event: LedgerEvent, id: &str) -> Result<()> {
    let row = sqlx::query!(
        r#"SELECT "accountId" AS account_id, "toAccountId" AS to_account_id
           FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let Some(row) = row else { return Ok(()) };

    for acct in [row.account_id, row.to_account_id].into_iter().flatten() {
        balance::rebuild_chain(conn, &acct).await?;
    }
    Ok(())
}
