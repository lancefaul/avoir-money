//! `/investments/history`, `/investments/portfolio-history`, and the transfers
//! that feed them.
//!
//! Ported from `routes/investments.history.ts`, `routes/investments.transfers.ts`
//! and `lib/investment-history.ts`.
//!
//! # The type filter did not filter
//!
//! The TypeScript decides each source with its own guard:
//! trades run when `type !== 'TRANSFER'`, transfers when `type !== 'TRADE'`,
//! payments when `type !== 'TRADE' && type !== 'TRANSFER'`. Every one of those
//! is true for `type = 'PAYMENT'`, so selecting **Payments** in the history
//! panel returns trades and transfers as well — the filter appears to do
//! nothing. `PAYMENT` is a real option in the UI's `TYPE_OPTIONS`, so this is
//! reachable, not theoretical. Each source here runs when the filter is absent
//! or names it, which is what the guards were reaching for.
//!
//! # The cursor filters every source in SQL, not one
//!
//! The TypeScript applies the cursor's `WHERE` clause only to the source the
//! cursor came from, and relies on `mergeAndSort` to filter the other two in
//! memory. The result is the same — every id is a cuid from one generator, so
//! `(date, id)` is a total order across all three tables — but the database
//! returns rows that are then thrown away. Filtering all three in SQL is the
//! same answer with less work, and it keeps the ordering rule stated once.

use crate::investments::qty_to_f64;
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use base64::Engine;
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use avoir_db::transfers::{
    execute_bitcoin_transfer, execute_stock_transfer, reverse_transfer, BitcoinTransfer, FeeUnit,
    StockTransfer, TransferError,
};

const SATS_PER_BTC: i64 = 100_000_000;

// ═══ History ═══

/// One row of the merged stream, before it becomes JSON.
struct Entry {
    /// The sort key, alongside `id`. Trades and payments carry a UTC-midnight
    /// date; transfers carry a full `createdAt`. Both are ISO-8601 in the same
    /// spelling, so comparing them as strings orders them by time.
    date: String,
    id: String,
    source: &'static str,
    json: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Cursor {
    date: String,
    id: String,
}

/// One point on the portfolio value chart.
///
/// `value` is SUMmed in SQL as integer cents (ADR-033) rather than as a decimal
/// TEXT, which is what makes the total exact. The cost was measured: one cent
/// across 724 rows on an $11.3M chart.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortfolioPointShape {
    date: String,
    total_value: f64,
}

/// The portfolio-history envelope.
#[derive(Serialize)]
struct PortfolioHistoryShape {
    entries: Vec<PortfolioPointShape>,
}

/// What a bitcoin transfer recorded.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BitcoinTransferShape {
    id: String,
    from_wallet_id: String,
    to_wallet_id: String,
    quantity: f64,
    bitcoin_unit: String,
    bitcoin_price: Option<f64>,
    fee_amount: Option<f64>,
    fee_unit: Option<&'static str>,
    fee_btc: Option<f64>,
    created_at: String,
}

/// What a stock transfer recorded.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StockTransferShape {
    id: String,
    from_custodian_id: String,
    to_custodian_id: String,
    holding_id: String,
    ticker: Option<String>,
    quantity: Option<f64>,
    fee_amount: Option<f64>,
    fee_transaction_id: Option<String>,
    created_at: String,
}

/// Live prices, plus what could not be fetched.
///
/// `prices` stays a `Value` because its keys are tickers, not a fixed set.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PricesShape {
    prices: Value,
    stale: Vec<String>,
    stocks_enabled: bool,
    /// Why the stale ones are stale, grouped so the UI can say one sentence.
    ///
    /// `stale` says WHICH symbols have no live price and has always been enough
    /// to avoid implying a stale figure is current. It is not enough to act on:
    /// a refused key and a rate limit produce an identical list, and only one of
    /// them is the user's to fix. Grouped by (service, reason) because that is
    /// the shape of the sentence — "Finnhub rejected your key" covers every
    /// stock at once, and listing each ticker separately would say the same
    /// thing five times.
    problems: Vec<PriceProblem>,
}

/// One service failing one way, and the symbols it took down with it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PriceProblem {
    /// `finnhub` or `coingecko` — which key to go and fix.
    service: &'static str,
    /// `rejected`, `rate-limited`, `unavailable` or `no-quote`.
    reason: &'static str,
    symbols: Vec<String>,
}

/// What a snapshot regeneration did.
#[derive(Serialize)]
struct RegeneratedShape {
    message: String,
    count: usize,
}

/// One entry in the investment history feed.
///
/// Trades, transfers and bitcoin payments are three different events flattened
/// into one list, so every field a variant does not have is emitted as NULL
/// rather than omitted — the client renders one table and reads the same keys
/// for each row. `entryType` is the discriminator.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntryShape {
    id: String,
    entry_type: &'static str,
    date: String,
    description: String,
    asset_type: &'static str,
    ticker: Option<String>,
    quantity: Option<f64>,
    direction: Option<String>,
    from_name: Option<String>,
    to_name: Option<String>,
    custodian_name: Option<String>,
    amount: Option<f64>,
    fee_amount: Option<f64>,
}

/// A trade, which is the base plus its allocated cost basis.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TradeEntryShape {
    #[serde(flatten)]
    base: HistoryEntryShape,
    cost_basis_allocated: Option<f64>,
}

/// A bitcoin payment, which is the base plus one field.
///
/// Composed rather than adding `incomeType` to the base: trades and transfers
/// do NOT emit the key at all, and giving the base an `Option` would start
/// sending them `"incomeType": null` — a new key on two thirds of the feed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaymentEntryShape {
    #[serde(flatten)]
    base: HistoryEntryShape,
    income_type: Option<String>,
}

/// The history envelope.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryShape {
    entries: Vec<Value>,
    next_cursor: Option<String>,
    has_more: bool,
}

/// The cursor as the TypeScript wrote it: base64 of `{date,id,source}`.
///
/// `source` is preserved on the wire even though nothing reads it any more —
/// it was only ever used to pick which query got the `WHERE` clause, and every
/// source is filtered now. Dropping the field would make a cursor minted by one
/// backend unreadable by the other for no gain.
fn encode_cursor(date: &str, id: &str, source: &str) -> String {
    let payload = json!({ "date": date, "id": id, "source": source });
    base64::engine::general_purpose::STANDARD.encode(payload.to_string())
}

fn decode_cursor(raw: &str) -> Result<Cursor, ApiError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|_| ApiError::bad_request("Invalid cursor"))?;
    let v: Value =
        serde_json::from_slice(&bytes).map_err(|_| ApiError::bad_request("Invalid cursor"))?;
    match (
        v.get("date").and_then(Value::as_str),
        v.get("id").and_then(Value::as_str),
    ) {
        (Some(date), Some(id)) => Ok(Cursor {
            date: date.to_string(),
            id: id.to_string(),
        }),
        _ => Err(ApiError::bad_request("Invalid cursor")),
    }
}

/// BTC out of a quantity that may have been entered in sats.
///
/// The frontend always displays BTC, so the unit is resolved here rather than
/// travelling with the row.
fn to_btc(quantity: &str, unit: Option<&str>) -> f64 {
    let q: Decimal = quantity.parse().unwrap_or(Decimal::ZERO);
    let q = if unit == Some("Sats") {
        q / Decimal::from(SATS_PER_BTC)
    } else {
        q
    };
    q.to_f64().unwrap_or(0.0)
}

pub async fn history(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let ty = p.query("type").filter(|s| !s.is_empty());
    let asset = p.query("assetType").filter(|s| !s.is_empty());
    let limit: i64 = p
        .query("limit")
        .and_then(|s| s.parse().ok())
        .unwrap_or(20)
        .clamp(1, 100);
    let cursor = match p.query("cursor").filter(|s| !s.is_empty()) {
        Some(c) => Some(decode_cursor(c)?),
        None => None,
    };

    // One row past the page, so `hasMore` is answered by what came back rather
    // than by a second count query.
    let take = limit + 1;
    let (c_date, c_id) = match &cursor {
        Some(c) => (Some(c.date.as_str()), Some(c.id.as_str())),
        None => (None, None),
    };

    let mut all: Vec<Entry> = Vec::new();

    // ─── Trades ───
    if ty.is_none() || ty == Some("TRADE") {
        // The asset filter uses TradeDetail's own spelling ('Stock'/'Bitcoin'),
        // which differs from the query parameter's ('STOCK'/'BITCOIN').
        let asset_detail = match asset {
            Some("STOCK") => Some("Stock"),
            Some("BITCOIN") => Some("Bitcoin"),
            _ => None,
        };
        let rows = sqlx::query!(
            r#"SELECT t."id" AS "id!", t."date" AS "date!", t."amount" AS "amount!: i64",
                      t."costBasisAllocated" AS "basis: i64",
                      a."name" AS account_name,
                      d."direction" AS "direction!", d."assetType" AS "asset_type!",
                      d."ticker", d."quantity" AS "quantity!", d."bitcoinUnit" AS unit
                 FROM "Transaction" t
                 JOIN "TradeDetail" d ON d."transactionId" = t."id"
                 LEFT JOIN "Account" a ON a."id" = t."accountId"
                WHERE t."type" = 'TRADE'
                  AND (?1 IS NULL OR d."assetType" = ?1)
                  AND (?2 IS NULL OR t."date" < ?2 OR (t."date" = ?2 AND t."id" < ?3))
                ORDER BY t."date" DESC, t."id" DESC
                LIMIT ?4"#,
            asset_detail,
            c_date,
            c_id,
            take
        )
        .fetch_all(pool)
        .await?;

        for r in rows {
            let is_stock = r.asset_type == "Stock";
            let ticker = if is_stock { r.ticker.clone() } else { None };
            let verb = if r.direction == "BUY" {
                "Bought"
            } else {
                "Sold"
            };
            let symbol = ticker.clone().unwrap_or_else(|| "BTC".into());
            let description = match &r.account_name {
                Some(a) => format!("{verb} {symbol} on {a}"),
                None => format!("{verb} {symbol}"),
            };
            let quantity = if is_stock {
                qty_to_f64(&r.quantity)
            } else {
                to_btc(&r.quantity, r.unit.as_deref())
            };
            all.push(Entry {
                date: r.date.clone(),
                id: r.id.clone(),
                source: "trade",
                json: crate::to_body(TradeEntryShape {
                    base: HistoryEntryShape {
                        id: r.id.clone(),
                        entry_type: "TRADE",
                        date: r.date.clone(),
                        description,
                        asset_type: if is_stock { "STOCK" } else { "BITCOIN" },
                        ticker,
                        quantity: Some(quantity),
                        direction: Some(r.direction.clone()),
                        from_name: None,
                        to_name: None,
                        custodian_name: r.account_name.clone(),
                        amount: Some(Cents(r.amount).as_dollars_f64()),
                        fee_amount: None,
                    },
                    cost_basis_allocated: r.basis.map(|c| Cents(c).as_dollars_f64()),
                }),
            });
        }
    }

    // ─── Transfers ───
    if ty.is_none() || ty == Some("TRANSFER") {
        let rows = sqlx::query!(
            r#"SELECT t."id" AS "id!", t."type" AS "ty!", t."createdAt" AS "created_at!",
                      t."quantity" AS "quantity!", t."ticker",
                      t."feeAmount" AS fee_amount, t."feeBtc" AS fee_btc,
                      COALESCE(fw."name", fc."name", 'Unknown') AS "from_name!",
                      COALESCE(tw."name", tc."name", 'Unknown') AS "to_name!"
                 FROM "InvestmentTransfer" t
                 LEFT JOIN "InvestmentHolding" fh ON fh."id" = t."fromHoldingId"
                 LEFT JOIN "Wallet" fw ON fw."id" = fh."walletId"
                 LEFT JOIN "Custodian" fc ON fc."id" = fh."custodianId"
                 LEFT JOIN "InvestmentHolding" th ON th."id" = t."toHoldingId"
                 LEFT JOIN "Wallet" tw ON tw."id" = th."walletId"
                 LEFT JOIN "Custodian" tc ON tc."id" = th."custodianId"
                WHERE (?1 IS NULL OR t."type" = ?1)
                  AND (?2 IS NULL OR t."createdAt" < ?2
                       OR (t."createdAt" = ?2 AND t."id" < ?3))
                ORDER BY t."createdAt" DESC, t."id" DESC
                LIMIT ?4"#,
            asset,
            c_date,
            c_id,
            take
        )
        .fetch_all(pool)
        .await?;

        for r in rows {
            let is_btc = r.ty == "BITCOIN";
            let description = if is_btc {
                format!("{} → {}", r.from_name, r.to_name)
            } else {
                format!(
                    "{}: {} → {}",
                    r.ticker.clone().unwrap_or_default(),
                    r.from_name,
                    r.to_name
                )
            };
            // A bitcoin transfer's fee is reported in BTC (the normalised
            // `feeBtc`); a stock transfer's is dollars. Same field, two units,
            // which is why the column is not money — see migration 0003.
            let fee = if is_btc {
                r.fee_btc.as_deref().map(qty_to_f64)
            } else {
                r.fee_amount.as_deref().map(qty_to_f64)
            };
            all.push(Entry {
                date: r.created_at.clone(),
                id: r.id.clone(),
                source: "transfer",
                json: crate::to_body(HistoryEntryShape {
                    id: r.id.clone(),
                    entry_type: "TRANSFER",
                    date: r.created_at.clone(),
                    description,
                    asset_type: if is_btc { "BITCOIN" } else { "STOCK" },
                    ticker: r.ticker.clone(),
                    quantity: Some(qty_to_f64(&r.quantity)),
                    direction: None,
                    from_name: Some(r.from_name.clone()),
                    to_name: Some(r.to_name.clone()),
                    custodian_name: None,
                    amount: None,
                    fee_amount: fee,
                }),
            });
        }
    }

    // ─── Bitcoin payments ───
    // Never for a stock filter: a payment is BTC by definition.
    if (ty.is_none() || ty == Some("PAYMENT")) && asset != Some("STOCK") {
        let rows = sqlx::query!(
            r#"SELECT t."id" AS "id!", t."type" AS "ty!", t."date" AS "date!",
                      t."name" AS "name!", t."amount" AS "amount!: i64",
                      d."quantity" AS "quantity!", d."bitcoinUnit" AS "unit!",
                      d."incomeType" AS income_type,
                      COALESCE(w."name", 'Unknown') AS "wallet_name!"
                 FROM "Transaction" t
                 JOIN "BitcoinPaymentDetail" d ON d."transactionId" = t."id"
                 LEFT JOIN "Wallet" w ON w."id" = d."walletId"
                WHERE t."type" IN ('EXPENSE','INCOME','REFUND')
                  AND t."accountId" IS NULL
                  AND (?1 IS NULL OR t."date" < ?1 OR (t."date" = ?1 AND t."id" < ?2))
                ORDER BY t."date" DESC, t."id" DESC
                LIMIT ?3"#,
            c_date,
            c_id,
            take
        )
        .fetch_all(pool)
        .await?;

        for r in rows {
            let description = match (r.ty.as_str(), r.income_type.as_deref()) {
                ("INCOME", Some("Rewards")) => {
                    format!("Earned BTC rewards on {}", r.wallet_name)
                }
                ("INCOME", _) => format!("Received BTC on {}", r.wallet_name),
                _ => format!("Spent BTC on {}", r.wallet_name),
            };
            all.push(Entry {
                date: r.date.clone(),
                id: r.id.clone(),
                source: "payment",
                json: crate::to_body(PaymentEntryShape {
                    base: HistoryEntryShape {
                        id: r.id.clone(),
                        entry_type: "PAYMENT",
                        date: r.date.clone(),
                        description,
                        asset_type: "BITCOIN",
                        ticker: None,
                        quantity: Some(to_btc(&r.quantity, Some(&r.unit))),
                        direction: None,
                        from_name: None,
                        to_name: None,
                        custodian_name: Some(r.wallet_name.clone()),
                        amount: Some(Cents(r.amount).as_dollars_f64()),
                        fee_amount: None,
                    },
                    income_type: r.income_type.clone(),
                }),
            });
        }
    }

    // Newest first, ties broken by id descending — the same total order the
    // per-source queries and the cursor use, so a page boundary lands in the
    // same place however the rows were split across tables.
    all.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| b.id.cmp(&a.id)));

    let has_more = all.len() as i64 > limit;
    all.truncate(limit as usize);
    let next_cursor = match (has_more, all.last()) {
        (true, Some(last)) => Some(encode_cursor(&last.date, &last.id, last.source)),
        _ => None,
    };

    Ok(Response::ok(HistoryShape {
        entries: all.into_iter().map(|e| e.json).collect(),
        next_cursor,
        has_more,
    }))
}

// ═══ Portfolio history ═══

/// The first day a period covers, or `None` for ALL.
///
/// `checked_sub_months` clamps to the end of a shorter month, so 31 March minus
/// one month is 28 February rather than an invalid date — which is the same
/// answer the TypeScript's `makeDate(year, month - 1, day)` reaches by letting
/// the UTC constructor normalise an overflowing day.
fn period_start(period: &str, today: chrono::NaiveDate) -> Option<chrono::NaiveDate> {
    use chrono::Months;
    match period {
        "1W" => today.checked_sub_signed(chrono::Duration::days(7)),
        "1M" => today.checked_sub_months(Months::new(1)),
        "3M" => today.checked_sub_months(Months::new(3)),
        "6M" => today.checked_sub_months(Months::new(6)),
        "1Y" => today.checked_sub_months(Months::new(12)),
        _ => None,
    }
}

pub async fn portfolio_history(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let period = p.query("period").unwrap_or("ALL");
    let start =
        period_start(period, avoir_core::dates::today()).map(crate::id::date_at_utc_midnight);

    // `value` is INTEGER cents, so this SUM is exact — ADR-033's whole reason
    // for putting money in an integer column rather than a TEXT decimal, since
    // SQLite coerces TEXT to float under aggregation.
    let rows = sqlx::query!(
        r#"SELECT "date" AS "date!", SUM("value") AS "total!: i64"
             FROM "InvestmentSnapshot"
            WHERE "value" IS NOT NULL AND (?1 IS NULL OR "date" >= ?1)
            GROUP BY "date" ORDER BY "date" ASC"#,
        start
    )
    .fetch_all(pool)
    .await?;

    Ok(Response::ok(PortfolioHistoryShape {
        entries: rows
            .into_iter()
            .map(|r| PortfolioPointShape {
                date: r.date,
                total_value: Cents(r.total).as_dollars_f64(),
            })
            .collect(),
    }))
}

// ═══ Transfers ═══

#[derive(Deserialize, Default)]
#[serde(default)]
struct BitcoinTransferBody {
    #[serde(rename = "fromWalletId")]
    from_wallet_id: String,
    #[serde(rename = "toWalletId")]
    to_wallet_id: String,
    quantity: f64,
    #[serde(rename = "bitcoinUnit")]
    bitcoin_unit: String,
    #[serde(rename = "bitcoinPrice")]
    bitcoin_price: Option<f64>,
    #[serde(rename = "feeAmount")]
    fee_amount: Option<f64>,
    #[serde(rename = "feeUnit")]
    fee_unit: Option<String>,
}

/// A JSON number as an exact decimal, via its shortest spelling.
///
/// Same reasoning as `investments::f64_to_qty` — going through the f64's bits
/// writes the binary expansion instead of the number the user typed.
fn dec(v: f64) -> Decimal {
    Decimal::from_str(&format!("{v}")).unwrap_or(Decimal::ZERO)
}

/// Turn a transfer failure into the status the frontend expects.
///
/// "No such holding" is a 404 and "not enough of it" is a 400: the first says
/// the thing being transferred from does not exist, the second says the request
/// was understood and refused.
fn transfer_error(e: anyhow::Error) -> ApiError {
    match e.downcast_ref::<TransferError>() {
        Some(TransferError::NoSourceHolding) => ApiError::new(404, e.to_string()),
        Some(TransferError::Insufficient { .. }) => ApiError::bad_request(e.to_string()),
        None => ApiError::from(e),
    }
}

pub async fn bitcoin_transfer(
    pool: &SqlitePool,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: BitcoinTransferBody = crate::body_of(body)?;
    if b.from_wallet_id.is_empty() || b.to_wallet_id.is_empty() {
        return Err(ApiError::bad_request("Both wallets are required"));
    }
    if b.from_wallet_id == b.to_wallet_id {
        return Err(ApiError::bad_request(
            "Source and destination wallets must be different",
        ));
    }
    if b.quantity <= 0.0 {
        return Err(ApiError::bad_request("quantity must be positive"));
    }
    let unit_is_sats = b.bitcoin_unit == "Sats";
    if unit_is_sats && b.quantity.fract() != 0.0 {
        return Err(ApiError::bad_request(
            "Sats quantity must be a whole number",
        ));
    }
    let fee_unit = match &b.fee_unit {
        Some(u) => Some(
            FeeUnit::from_stored(u)
                .ok_or_else(|| ApiError::bad_request(format!("Unknown fee unit: {u}")))?,
        ),
        None => None,
    };
    if b.fee_amount.is_some_and(|a| a > 0.0) && fee_unit.is_none() {
        return Err(ApiError::bad_request(
            "Fee unit is required when fee amount is provided",
        ));
    }
    // A bitcoin-denominated fee needs a price only so the audit row can record
    // what it was worth; a USD fee needs one to be expressible in BTC at all.
    if b.fee_amount.is_some_and(|a| a > 0.0)
        && fee_unit == Some(FeeUnit::Usd)
        && !b.bitcoin_price.is_some_and(|p| p > 0.0)
    {
        return Err(ApiError::bad_request(
            "Bitcoin price is required to convert a USD fee",
        ));
    }

    let input = BitcoinTransfer {
        from_wallet_id: b.from_wallet_id.clone(),
        to_wallet_id: b.to_wallet_id.clone(),
        quantity: dec(b.quantity),
        unit_is_sats,
        bitcoin_price: b.bitcoin_price.map(dec),
        fee_amount: b.fee_amount.map(dec),
        fee_unit,
    };

    // One transaction around the whole move: the source debit, the destination
    // credit and the audit row are one fact, and a partial application would
    // create bitcoin out of nothing or destroy it.
    let mut tx = pool.begin().await?;
    let rec = execute_bitcoin_transfer(&mut tx, &input)
        .await
        .map_err(transfer_error)?;
    tx.commit().await?;

    Ok(Response::ok(BitcoinTransferShape {
        id: rec.id,
        from_wallet_id: b.from_wallet_id,
        to_wallet_id: b.to_wallet_id,
        quantity: b.quantity,
        bitcoin_unit: b.bitcoin_unit,
        bitcoin_price: b.bitcoin_price,
        fee_amount: rec.fee_amount.and_then(|d| d.to_f64()),
        fee_unit: rec.fee_unit.map(|u| u.as_str()),
        fee_btc: rec.fee_btc.and_then(|d| d.to_f64()),
        created_at: rec.created_at,
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct StockTransferBody {
    #[serde(rename = "fromCustodianId")]
    from_custodian_id: String,
    #[serde(rename = "toCustodianId")]
    to_custodian_id: String,
    #[serde(rename = "holdingId")]
    holding_id: String,
    quantity: Option<f64>,
    #[serde(rename = "feeAmount")]
    fee_amount: Option<f64>,
    #[serde(rename = "feeBudgetId")]
    fee_budget_id: Option<String>,
    #[serde(rename = "feeAccountId")]
    fee_account_id: Option<String>,
}

pub async fn stock_transfer(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: StockTransferBody = crate::body_of(body)?;
    if b.from_custodian_id.is_empty() || b.to_custodian_id.is_empty() || b.holding_id.is_empty() {
        return Err(ApiError::bad_request(
            "Both custodians and a holding are required",
        ));
    }
    if b.from_custodian_id == b.to_custodian_id {
        return Err(ApiError::bad_request(
            "Source and destination custodians must be different",
        ));
    }
    if b.quantity.is_some_and(|q| q <= 0.0) {
        return Err(ApiError::bad_request("quantity must be positive"));
    }
    let charging = b.fee_amount.is_some_and(|a| a > 0.0);
    if charging && (b.fee_budget_id.is_none() || b.fee_account_id.is_none()) {
        return Err(ApiError::bad_request(
            "Fee budget and account are required when fee is provided",
        ));
    }

    let input = StockTransfer {
        from_custodian_id: b.from_custodian_id.clone(),
        to_custodian_id: b.to_custodian_id.clone(),
        holding_id: b.holding_id.clone(),
        quantity: b.quantity.map(dec),
        fee_amount: charging.then(|| Cents::from_dollars_f64(b.fee_amount.unwrap_or(0.0))),
        fee_budget_id: b.fee_budget_id.clone(),
        fee_account_id: b.fee_account_id.clone(),
        today: crate::id::date_at_utc_midnight(avoir_core::dates::today()),
    };

    let mut tx = pool.begin().await?;
    let rec = execute_stock_transfer(&mut tx, &input)
        .await
        .map_err(transfer_error)?;
    tx.commit().await?;

    Ok(Response::ok(StockTransferShape {
        id: rec.id,
        from_custodian_id: b.from_custodian_id,
        to_custodian_id: b.to_custodian_id,
        holding_id: b.holding_id,
        ticker: rec.ticker,
        quantity: rec.quantity.to_f64(),
        fee_amount: rec.fee_amount.and_then(|d| d.to_f64()),
        fee_transaction_id: rec.fee_transaction_id,
        created_at: rec.created_at,
    }))
}

pub async fn delete_transfer(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let exists = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "InvestmentTransfer" WHERE "id" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        return Err(ApiError::not_found("Investment transfer"));
    }

    let mut tx = pool.begin().await?;
    reverse_transfer(&mut tx, id).await?;
    sqlx::query!(r#"DELETE FROM "InvestmentTransfer" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Response::no_content())
}

// ═══ Prices and snapshot regeneration ═══

/// Live prices for everything held, plus what could not be priced.
pub async fn prices(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(r#"SELECT "ticker", "type" AS "ty!" FROM "InvestmentHolding""#)
        .fetch_all(pool)
        .await?;

    let has_bitcoin = rows.iter().any(|r| r.ty == "BITCOIN");
    let mut tickers: Vec<String> = rows
        .into_iter()
        .filter(|r| r.ty == "STOCK")
        .filter_map(|r| r.ticker)
        .filter(|t| !t.is_empty())
        .collect();
    tickers.sort();
    tickers.dedup();

    let finnhub =
        crate::connected_services::service_key(pool, crate::connected_services::FINNHUB).await?;
    let coingecko =
        crate::connected_services::service_key(pool, crate::connected_services::COINGECKO).await?;

    let mut prices = serde_json::Map::new();
    let mut stale: Vec<String> = Vec::new();
    // Insertion-ordered so the grouped output is stable run to run: BTC first
    // if it failed, then tickers in the order they were queried. A map that
    // reordered would make the response differ from itself for no reason, which
    // the differential harness would report as a mismatch every time.
    let mut failures: Vec<(&'static str, crate::prices::PriceFailure, String)> = Vec::new();

    // `Stale` carries a real figure AND lands in `stale` — the two are not in
    // tension. `stale` has always meant "not a live number", and a price from
    // ten minutes ago is a far better answer than the null this used to emit,
    // which the frontend then had to guess the meaning of.
    fn record(
        prices: &mut serde_json::Map<String, Value>,
        stale: &mut Vec<String>,
        failures: &mut Vec<(&'static str, crate::prices::PriceFailure, String)>,
        service: &'static str,
        symbol: &str,
        p: crate::prices::Priced,
    ) {
        match p {
            crate::prices::Priced::Live(v) => {
                prices.insert(symbol.to_string(), json!(v));
            }
            crate::prices::Priced::Stale { price, why } => {
                prices.insert(symbol.to_string(), json!(price));
                stale.push(symbol.to_string());
                failures.push((service, why, symbol.to_string()));
            }
            crate::prices::Priced::Failed(why) => {
                prices.insert(symbol.to_string(), Value::Null);
                stale.push(symbol.to_string());
                failures.push((service, why, symbol.to_string()));
            }
        }
    }

    if has_bitcoin {
        let p = crate::prices::bitcoin_price_cached(coingecko.as_deref()).await;
        record(
            &mut prices,
            &mut stale,
            &mut failures,
            "coingecko",
            "BTC",
            p,
        );
    }

    if let Some(key) = finnhub.as_deref().filter(|k| !k.is_empty()) {
        for t in &tickers {
            let p = crate::prices::stock_price_cached(t, key).await;
            record(&mut prices, &mut stale, &mut failures, "finnhub", t, p);
        }
    }

    // Grouped by (service, reason), preserving first-seen order. A refused key
    // fails every stock identically, so this collapses five rows into the one
    // sentence a person can act on.
    let mut problems: Vec<PriceProblem> = Vec::new();
    for (service, why, symbol) in failures {
        match problems
            .iter_mut()
            .find(|p| p.service == service && p.reason == why.as_str())
        {
            Some(existing) => existing.symbols.push(symbol),
            None => problems.push(PriceProblem {
                service,
                reason: why.as_str(),
                symbols: vec![symbol],
            }),
        }
    }

    // Only what was actually attempted. Listing unattempted stocks here would
    // double-report the missing-key case, which has its own message, and bury a
    // real outage among rows that were never going to have a price.
    Ok(Response::ok(PricesShape {
        prices: Value::Object(prices),
        stale,
        problems,
        stocks_enabled: finnhub.is_some_and(|k| !k.is_empty()),
    }))
}

/// Rebuild every BTC holding's snapshot history.
///
/// The price history is fetched HERE and handed to the rebuild, so the database
/// work stays free of the network's failure modes — the same separation
/// `avoir_db::snapshot` makes for the single-holding path. A day CoinGecko could
/// not price simply has no snapshot.
pub async fn regenerate_snapshots(pool: &SqlitePool) -> Result<Response, ApiError> {
    let earliest = sqlx::query_scalar!(
        r#"SELECT MIN("date") AS "earliest: String"
             FROM "Transaction" WHERE "type" IN ('TRADE','INCOME')"#
    )
    .fetch_one(pool)
    .await?;

    // 365 is CoinGecko's free-tier ceiling, and asking for more is refused
    // rather than truncated.
    let days = earliest
        .as_deref()
        .and_then(crate::id::parse_date)
        .map(|d| (avoir_core::dates::today() - d).num_days().max(0) as u32 + 1)
        .unwrap_or(365)
        .min(365);

    let key =
        crate::connected_services::service_key(pool, crate::connected_services::COINGECKO).await?;

    // A failed fetch must NOT reach `regenerate_all`, which deletes every
    // snapshot before writing and would therefore erase the whole history to
    // rebuild it from nothing. This is not hypothetical: it is exactly what
    // emptied the `InvestmentSnapshot` table on 2026-08-13, while the button
    // reported success. Refusing costs the user a retry; proceeding costs them
    // the record, and the operation that destroys it is the one they press when
    // something already looks wrong.
    let history = match crate::prices::bitcoin_history(days, key.as_deref()).await {
        Ok(h) => h,
        Err(why) => {
            return Err(ApiError::new(
                503,
                match why {
                    crate::prices::PriceFailure::RateLimited => {
                        "The price service is rate-limiting requests. Nothing was changed — \
                         wait about a minute and try again."
                    }
                    crate::prices::PriceFailure::Rejected => {
                        "The price service refused the CoinGecko key. Nothing was changed — \
                         check the key in Settings."
                    }
                    _ => {
                        "Could not reach the price service. Nothing was changed — \
                         the existing history is intact."
                    }
                },
            ));
        }
    };

    // An empty history from a SUCCESSFUL fetch is a different thing again, and
    // still not a reason to wipe: it means the service had nothing for this
    // window, not that the holdings never existed.
    if history.is_empty() {
        return Err(ApiError::new(
            503,
            "The price service returned no history for this period. Nothing was changed.",
        ));
    }

    let count = avoir_db::snapshot::regenerate_all(pool, &history, avoir_core::dates::today())
        .await
        .map_err(ApiError::from)?;

    Ok(Response::ok(RegeneratedShape {
        message: format!("Regenerated {count} snapshots"),
        count,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cursor_round_trips() {
        let c = encode_cursor("2026-08-01T00:00:00.000Z", "cabc", "trade");
        let back = decode_cursor(&c).unwrap();
        assert_eq!(back.date, "2026-08-01T00:00:00.000Z");
        assert_eq!(back.id, "cabc");
    }

    #[test]
    fn a_malformed_cursor_is_a_400_not_a_panic() {
        assert_eq!(decode_cursor("not base64!!").unwrap_err().status, 400);
        // Valid base64, but not the payload — this is the case a naive
        // `unwrap` after decoding would miss.
        let junk = base64::engine::general_purpose::STANDARD.encode("{}");
        assert_eq!(decode_cursor(&junk).unwrap_err().status, 400);
    }

    #[test]
    fn a_month_step_lands_on_a_real_day() {
        // 31 March minus one month has no 31st to land on.
        let d = chrono::NaiveDate::from_ymd_opt(2026, 3, 31).unwrap();
        assert_eq!(
            period_start("1M", d),
            chrono::NaiveDate::from_ymd_opt(2026, 2, 28)
        );
        assert_eq!(period_start("ALL", d), None);
    }

    #[test]
    fn sats_become_btc_and_bitcoin_stays_put() {
        assert_eq!(to_btc("5000", Some("Sats")), 0.00005);
        assert_eq!(to_btc("0.5", Some("Bitcoin")), 0.5);
        assert_eq!(to_btc("0.5", None), 0.5);
    }
}
