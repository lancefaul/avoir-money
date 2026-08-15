//! `/transactions` — the port of `apps/api/src/routes/transactions.ts`.
//!
//! # Why the filters are one static query and not a query builder
//!
//! The TypeScript builds a Prisma `where` object incrementally, which is the
//! natural shape there. The naive translation is `format!`-ing SQL, and that
//! would forfeit the single property ADR-034 chose sqlx *for*: every query is
//! checked against the live schema at build time. Dynamic SQL is checked
//! against nothing.
//!
//! So every filter is expressed as `(?n IS NULL OR <predicate>)` inside one
//! fixed statement. Binding `NULL` disables a filter. Two cases need more than
//! that and both have static answers:
//!
//! - **`budgetIds`** is a variable-length list. SQLite cannot bind an array,
//!   but it ships JSON1, so the list arrives as a JSON string and the
//!   predicate is `IN (SELECT value FROM json_each(?))` — still static SQL.
//! - **`search`** matches five columns plus, when the term parses as a number,
//!   an amount range. Written out in full rather than assembled.
//!
//! The cost is a longer query than any single request needs. SQLite's planner
//! discards `NULL IS NULL` branches, and the alternative was giving up
//! compile-time verification on the most-called endpoint in the app.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use avoir_core::transaction_rules::{CrossFieldFacts, TransactionType as CrossFieldType};
use avoir_db::ledger::{self, LedgerCreate, LedgerUpdate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// Money as the wire carries it: decimal dollars.
fn dollars(c: Option<i64>) -> Option<f64> {
    c.map(|v| Cents(v).as_dollars_f64())
}

/// The trade detail, as ADR-027's typed table serializes back onto the wire.
///
/// The relation replaced a `tradeMetadata` JSON blob, but the RESPONSE keeps
/// the old nested shape so the frontend needed no changes. `quantity` and
/// `unitPrice` are decimal TEXT on disk (ADR-033 — they measure units and a
/// per-unit price, not money) and parse to f64 only here, for display.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TradeShape {
    direction: String,
    asset_type: Option<String>,
    ticker: Option<String>,
    quantity: Option<f64>,
    unit_price: Option<f64>,
    bitcoin_unit: Option<String>,
    custodian_id: Option<String>,
    wallet_id: Option<String>,
}

/// The bitcoin-payment detail, same story as `TradeShape`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BitcoinShape {
    wallet_id: String,
    quantity: Option<f64>,
    unit_price: Option<f64>,
    bitcoin_unit: Option<String>,
    income_type: Option<String>,
}

/// One transaction as the QUERY returns it — money in cents, booleans as i64,
/// dates as stored. `serialize` turns it into the wire shape below.
struct TxRow {
    id: String,
    r#type: String,
    name: String,
    amount: i64,
    net_amount: i64,
    date: String,
    pay_period_id: Option<String>,
    expense_id: Option<String>,
    income_id: Option<String>,
    account_id: Option<String>,
    to_account_id: Option<String>,
    budget_id: Option<String>,
    note: Option<String>,
    cost_basis_allocated: Option<i64>,
    balance_before: Option<i64>,
    balance_after: Option<i64>,
    to_balance_before: Option<i64>,
    to_balance_after: Option<i64>,
    parent_id: Option<String>,
    purchase_group_id: Option<String>,
    is_cash_back: i64,
    created_at: String,
    child_count: i64,
    is_reconciliation_adjustment: i64,
    trade: Option<TradeShape>,
    bitcoin: Option<BitcoinShape>,
}

/// One row of the list, in `TransactionSchema` shape.
///
/// See `budgets.rs` for the rules these types keep. Money is `Option<f64>`
/// rather than `Option<Cents>` because the wire carries decimal dollars, and
/// the chain columns are genuinely nullable — a NULL `balanceBefore` means the
/// row sits before the chain starts, which ADR-014 treats as a boundary rather
/// than as zero.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TxShape {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    name: String,
    amount: f64,
    net_amount: f64,
    date: String,
    pay_period_id: Option<String>,
    expense_id: Option<String>,
    income_id: Option<String>,
    account_id: Option<String>,
    to_account_id: Option<String>,
    /// Falls back to the linked expense's or income's budget. Not a
    /// convenience: a transaction linked to a recurring item inherits its
    /// category, and dropping the fallback silently recategorises those rows.
    budget_id: Option<String>,
    note: Option<String>,
    trade_metadata: Option<TradeShape>,
    bitcoin_metadata: Option<BitcoinShape>,
    cost_basis_allocated: Option<f64>,
    balance_before: Option<f64>,
    balance_after: Option<f64>,
    to_balance_before: Option<f64>,
    to_balance_after: Option<f64>,
    parent_id: Option<String>,
    child_count: i64,
    purchase_group_id: Option<String>,
    is_reconciliation_adjustment: bool,
    is_cash_back: bool,
    created_at: String,
}

fn serialize(r: &TxRow) -> TxShape {
    TxShape {
        id: r.id.clone(),
        kind: r.r#type.clone(),
        name: r.name.clone(),
        amount: Cents(r.amount).as_dollars_f64(),
        net_amount: Cents(r.net_amount).as_dollars_f64(),
        date: r.date.clone(),
        pay_period_id: r.pay_period_id.clone(),
        expense_id: r.expense_id.clone(),
        income_id: r.income_id.clone(),
        account_id: r.account_id.clone(),
        to_account_id: r.to_account_id.clone(),
        budget_id: r.budget_id.clone(),
        note: r.note.clone(),
        trade_metadata: r.trade.clone(),
        bitcoin_metadata: r.bitcoin.clone(),
        cost_basis_allocated: dollars(r.cost_basis_allocated),
        balance_before: dollars(r.balance_before),
        balance_after: dollars(r.balance_after),
        to_balance_before: dollars(r.to_balance_before),
        to_balance_after: dollars(r.to_balance_after),
        parent_id: r.parent_id.clone(),
        child_count: r.child_count,
        purchase_group_id: r.purchase_group_id.clone(),
        is_reconciliation_adjustment: r.is_reconciliation_adjustment != 0,
        is_cash_back: r.is_cash_back != 0,
        created_at: r.created_at.clone(),
    }
}

/// A budget suggested for a description, and how often it was used for it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuggestionShape {
    budget_id: String,
    budget_name: String,
    count: i64,
}

/// The suggestions envelope.
#[derive(Serialize)]
struct SuggestionsShape {
    suggestions: Vec<SuggestionShape>,
}

/// How many rows a bulk delete removed.
#[derive(Serialize)]
struct DeletedShape {
    deleted: usize,
}

/// The list envelope: a page of rows plus the figures that head the view.
///
/// `anticipations` is absent rather than null when not requested — the frontend
/// spreads it conditionally (`...(anticipations ? { anticipations } : {})`), so
/// this is the ONE place `skip_serializing_if` is correct, and it is correct
/// because the reference omits the key too.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TxListShape {
    transactions: Vec<TxShape>,
    total_count: i64,
    total_spent: f64,
    total_earned: f64,
    next_cursor: Option<String>,
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    anticipations: Option<Vec<Value>>,
}

/// The filters `ListTransactionsQuerySchema` accepts, already parsed.
#[derive(Default, Clone)]
struct Filters {
    /// Not a query parameter — the single-row read after a write reuses this
    /// same statement so a created row is serialized by exactly the code that
    /// serializes a listed one. Two serializers for one shape is how the two
    /// drift.
    only_id: Option<String>,
    tx_type: Option<String>,
    pay_period_id: Option<String>,
    expense_id: Option<String>,
    income_id: Option<String>,
    purchase_group_id: Option<String>,
    account_id: Option<String>,
    budget_ids_json: Option<String>,
    include_uncategorized: i64,
    search: Option<String>,
    search_num: Option<i64>,
    search_num_upper: Option<i64>,
    linked_to_recurring: Option<bool>,
    date_from: Option<String>,
    date_to: Option<String>,
    oldest_first: bool,
    limit: i64,
    cursor: Option<String>,
}

/// `"963"` finds 963.00–963.99; `"963.59"` finds exactly 963.59.
///
/// Both `amount` and `netAmount` are matched, and that is deliberate: a $40.00
/// basket with $15.00 of rewards is charged $25.00, the bank statement prints
/// $25.00, and searching only `amount` returned nothing. Anyone reconciling
/// works from the bank's numbers, so those have to be findable.
fn parse_search_amount(s: &str) -> (Option<i64>, Option<i64>) {
    let Ok(v) = s.trim().parse::<f64>() else {
        return (None, None);
    };
    let low = Cents::from_dollars_f64(v).0;
    if s.contains('.') {
        (Some(low), Some(low))
    } else {
        (Some(low), Some(low + 99))
    }
}

/// The five transaction types, for query-filter validation.
const TX_TYPES: [&str; 5] = ["EXPENSE", "INCOME", "TRANSFER", "REFUND", "TRADE"];

/// Reject a query parameter that is not one of a fixed set.
///
/// The port accepted anything here and then filtered on it, so
/// `?type=GIFT` returned an empty list rather than an error — indistinguishable
/// from "you have no transactions of this type", which is the worst possible
/// way to be wrong about a filter.
fn check_enum(
    v: Option<String>,
    allowed: &[&str],
    field: &str,
) -> Result<Option<String>, ApiError> {
    match &v {
        Some(s) if !allowed.contains(&s.as_str()) => Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": field,
                "message": format!(
                    "Invalid enum value. Expected {}, received '{s}'",
                    allowed
                        .iter()
                        .map(|a| format!("'{a}'"))
                        .collect::<Vec<_>>()
                        .join(" | ")
                ),
            }])),
        }),
        _ => Ok(v),
    }
}

/// `z.coerce.number().int().positive().max(500).default(100)`.
///
/// The port did `parse().ok().unwrap_or(100)`, which silently swallowed every
/// bad value — but `-1` PARSES, so it reached the query as a negative take.
/// That is the one that matters: SQLite reads a negative `LIMIT` as **no limit
/// at all**, so `?limit=-1` is a request for the entire ledger, and on this
/// user's data that is 2,546 rows in a single response. The reference rejects
/// it, which is why the frontend has never asked for it and nobody noticed the
/// port would honour it.
fn check_limit(v: Option<&str>) -> Result<i64, ApiError> {
    let Some(s) = v else { return Ok(100) };
    let invalid = |msg: &str| ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": "limit", "message": msg }])),
    };
    // Parsed as f64 first so a non-integer is rejected as one, rather than
    // failing to parse and being reported as "not a number".
    let n: f64 = s
        .parse()
        .map_err(|_| invalid("Expected number, received nan"))?;
    if !n.is_finite() || n.fract() != 0.0 {
        return Err(invalid("Expected integer, received float"));
    }
    if n <= 0.0 {
        return Err(invalid("Number must be greater than 0"));
    }
    if n > 500.0 {
        return Err(invalid("Number must be less than or equal to 500"));
    }
    Ok(n as i64)
}

async fn parse_filters(pool: &SqlitePool, p: &Path<'_>) -> Result<Filters, ApiError> {
    let q = |k: &str| p.query(k).filter(|v| !v.is_empty()).map(str::to_string);

    // The Uncategorized system budget also matches rows with a NULL budgetId —
    // "no category" and "the Uncategorized category" are the same thing to the
    // user, and only one of them is a real row.
    let mut include_uncat = 0i64;
    let budget_ids_json = match q("budgetIds") {
        Some(raw) => {
            let ids: Vec<String> = raw
                .split(',')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            if ids.is_empty() {
                None
            } else {
                let uncat = sqlx::query!(
                    r#"SELECT "id" AS "id!" FROM "Budget"
                        WHERE "name" = 'Uncategorized' AND "isSystem" = 1 LIMIT 1"#
                )
                .fetch_optional(pool)
                .await?
                .map(|r| r.id);
                if uncat.is_some_and(|u| ids.contains(&u)) {
                    include_uncat = 1;
                }
                Some(serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()))
            }
        }
        None => None,
    };

    let search = q("search");
    let (search_num, search_num_upper) = match &search {
        Some(s) => parse_search_amount(s),
        None => (None, None),
    };

    Ok(Filters {
        only_id: None,
        tx_type: check_enum(q("type"), &TX_TYPES, "type")?,
        pay_period_id: q("payPeriodId"),
        expense_id: q("expenseId"),
        income_id: q("incomeId"),
        purchase_group_id: q("purchaseGroupId"),
        account_id: q("accountId"),
        budget_ids_json,
        include_uncategorized: include_uncat,
        search,
        search_num,
        search_num_upper,
        linked_to_recurring: p.query_bool("linkedToRecurring"),
        date_from: q("dateFrom"),
        date_to: q("dateTo"),
        oldest_first: {
            // Anything other than "oldest" silently meant "newest", so
            // `?sortOrder=sideways` returned a confidently-ordered page nobody
            // asked for. The reference rejects it.
            let v = check_enum(q("sortOrder"), &["newest", "oldest"], "sortOrder")?;
            v.as_deref() == Some("oldest")
        },
        // 100 to match `TransactionQuerySchema`, not 50. Under cursor pagination
        // the page size is not cosmetic: it decides where `nextCursor` points, so
        // a client walking the ledger with a different page size lands on a
        // different set of boundaries than the reference would have produced.
        limit: check_limit(q("limit").as_deref())?,
        cursor: q("cursor"),
    })
}

// ─── GET / ───

/// Run the filtered query and map every row to its wire shape.
///
/// Shared by the list endpoint and the read-back after a write, so there is
/// exactly one place that turns a `Transaction` row into JSON.
/// One row of the transaction query: the finished wire shape, plus the handful
/// of fields the list endpoint has to reason about before serving it.
struct Row {
    id: String,
    ty: String,
    amount: i64,
    /// A payment leg (ADR-030) — listed, but never counted or summed.
    is_leg: bool,
    json: TxShape,
}

async fn fetch_rows(pool: &SqlitePool, f: &Filters) -> Result<Vec<Row>, ApiError> {
    let linked = f.linked_to_recurring.map(|v| v as i64);
    let search_like = f.search.as_ref().map(|s| format!("%{s}%"));

    // NOTE: payment legs (ADR-030) are NOT filtered out here, and that is
    // deliberate — see `is_payment_leg` and its use in `list`. This query
    // fetches rows; deciding which of them to COUNT is a separate question with
    // a different answer.

    let rows = sqlx::query!(
        r#"
        SELECT t."id" AS "id!", t."type" AS "type!", t."name" AS "name!",
               t."amount" AS "amount!: i64", t."netAmount" AS "net_amount!: i64",
               t."date" AS "date!", t."payPeriodId" AS "pay_period_id: String",
               t."expenseId" AS "expense_id: String", t."incomeId" AS "income_id: String",
               t."accountId" AS "account_id: String", t."toAccountId" AS "to_account_id: String",
               COALESCE(t."budgetId", e."budgetId", i."budgetId") AS "budget_id?: String",
               t."note" AS "note: String",
               t."costBasisAllocated" AS "cost_basis_allocated: i64",
               t."balanceBefore" AS "balance_before: i64", t."balanceAfter" AS "balance_after: i64",
               t."toBalanceBefore" AS "to_balance_before: i64",
               t."toBalanceAfter" AS "to_balance_after: i64",
               t."parentId" AS "parent_id: String",
               t."purchaseGroupId" AS "purchase_group_id: String",
               t."isCashBack" AS "is_cash_back!: i64", t."createdAt" AS "created_at!",
               (SELECT COUNT(*) FROM "Transaction" c WHERE c."parentId" = t."id") AS "child_count!: i64",
               (SELECT COUNT(*) FROM "ReconciliationSession" s WHERE s."adjustmentTransactionId" = t."id") AS "is_adj!: i64",
               d."direction" AS "d_direction?: String", d."assetType" AS "d_asset?: String",
               d."ticker" AS "d_ticker?: String", d."quantity" AS "d_qty?: String",
               d."unitPrice" AS "d_price?: String", d."bitcoinUnit" AS "d_unit?: String",
               d."custodianId" AS "d_cust?: String", d."walletId" AS "d_wallet?: String",
               b."walletId" AS "b_wallet?: String", b."quantity" AS "b_qty?: String",
               b."unitPrice" AS "b_price?: String", b."bitcoinUnit" AS "b_unit?: String",
               b."incomeType" AS "b_income?: String"
          FROM "Transaction" t
          LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
          LEFT JOIN "BitcoinPaymentDetail" b ON b."transactionId" = t."id"
          LEFT JOIN "Expense" e ON e."id" = t."expenseId"
          LEFT JOIN "Income"  i ON i."id" = t."incomeId"
          LEFT JOIN "Account" a ON a."id" = t."accountId"
         WHERE t."parentId" IS NULL
           AND (?1  IS NULL OR t."type" = ?1)
           AND (?2  IS NULL OR t."payPeriodId" = ?2)
           AND (?3  IS NULL OR t."expenseId" = ?3)
           AND (?4  IS NULL OR t."incomeId" = ?4)
           AND (?5  IS NULL OR t."purchaseGroupId" = ?5)
           AND (?6  IS NULL OR t."accountId" = ?6
                            OR (t."toAccountId" = ?6 AND t."type" = 'TRANSFER'))
           AND (?7  IS NULL OR t."budgetId" IN (SELECT value FROM json_each(?7))
                            OR (?8 = 1 AND t."budgetId" IS NULL))
           AND (?9  IS NULL
                OR t."name" LIKE ?9 OR t."note" LIKE ?9 OR a."name" LIKE ?9
                OR e."name" LIKE ?9 OR i."name" LIKE ?9
                OR (?10 IS NOT NULL AND t."amount"    BETWEEN ?10 AND ?11)
                OR (?10 IS NOT NULL AND t."netAmount" BETWEEN ?10 AND ?11))
           AND (?12 IS NULL
                OR (?12 = 1 AND (t."expenseId" IS NOT NULL OR t."incomeId" IS NOT NULL))
                OR (?12 = 0 AND t."expenseId" IS NULL AND t."incomeId" IS NULL))
           AND (?13 IS NULL OR t."date" >= ?13)
           AND (?14 IS NULL OR t."date" <= ?14)
           AND (?16 IS NULL OR t."id" = ?16)
         ORDER BY
           CASE WHEN ?15 = 1 THEN t."date"      END ASC,
           CASE WHEN ?15 = 1 THEN t."createdAt" END ASC,
           CASE WHEN ?15 = 1 THEN t."id"        END ASC,
           CASE WHEN ?15 = 0 THEN t."date"      END DESC,
           CASE WHEN ?15 = 0 THEN t."createdAt" END DESC,
           CASE WHEN ?15 = 0 THEN t."id"        END DESC
        "#,
        f.tx_type,
        f.pay_period_id,
        f.expense_id,
        f.income_id,
        f.purchase_group_id,
        f.account_id,
        f.budget_ids_json,
        f.include_uncategorized,
        search_like,
        f.search_num,
        f.search_num_upper,
        linked,
        f.date_from,
        f.date_to,
        f.oldest_first,
        f.only_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let trade = r.d_direction.as_ref().map(|dir| TradeShape {
                direction: dir.clone(),
                asset_type: r.d_asset.clone(),
                ticker: r.d_ticker.clone(),
                quantity: r.d_qty.as_deref().and_then(|q| q.parse::<f64>().ok()),
                unit_price: r.d_price.as_deref().and_then(|q| q.parse::<f64>().ok()),
                bitcoin_unit: r.d_unit.clone(),
                custodian_id: r.d_cust.clone(),
                wallet_id: r.d_wallet.clone(),
            });
            let bitcoin = r.b_wallet.as_ref().map(|w| BitcoinShape {
                wallet_id: w.clone(),
                quantity: r.b_qty.as_deref().and_then(|q| q.parse::<f64>().ok()),
                unit_price: r.b_price.as_deref().and_then(|q| q.parse::<f64>().ok()),
                bitcoin_unit: r.b_unit.clone(),
                income_type: r.b_income.clone(),
            });
            let row = TxRow {
                id: r.id.clone(),
                r#type: r.r#type.clone(),
                name: r.name.clone(),
                amount: r.amount,
                net_amount: r.net_amount,
                date: r.date.clone(),
                pay_period_id: r.pay_period_id.clone(),
                expense_id: r.expense_id.clone(),
                income_id: r.income_id.clone(),
                account_id: r.account_id.clone(),
                to_account_id: r.to_account_id.clone(),
                budget_id: r.budget_id.clone(),
                note: r.note.clone(),
                cost_basis_allocated: r.cost_basis_allocated,
                balance_before: r.balance_before,
                balance_after: r.balance_after,
                to_balance_before: r.to_balance_before,
                to_balance_after: r.to_balance_after,
                parent_id: r.parent_id.clone(),
                purchase_group_id: r.purchase_group_id.clone(),
                is_cash_back: r.is_cash_back,
                created_at: r.created_at.clone(),
                child_count: r.child_count,
                is_reconciliation_adjustment: r.is_adj,
                trade,
                bitcoin,
            };
            // ADR-030: a split purchase is a balance-neutral Anchor (full total,
            // no account) plus one leg per funding account, the legs summing to
            // the same total. A leg is the only row with BOTH set.
            let is_leg = row.purchase_group_id.is_some() && row.account_id.is_some();
            let json = serialize(&row);
            Row {
                id: row.id,
                ty: row.r#type,
                amount: row.amount,
                is_leg,
                json,
            }
        })
        .collect())
}

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let f = parse_filters(pool, p).await?;

    // A cursor naming a row that no longer exists is a client holding a stale
    // page, not an empty result — saying so is what lets it recover.
    if let Some(c) = &f.cursor {
        let exists = sqlx::query!(
            r#"SELECT 1 AS "hit!: i64" FROM "Transaction" WHERE "id" = ?"#,
            c
        )
        .fetch_optional(pool)
        .await?
        .is_some();
        if !exists {
            return Err(ApiError::bad_request(
                "Invalid cursor: transaction not found",
            ));
        }
    }

    // Fetched WITHOUT the caller's `type`, then narrowed in memory below.
    //
    // The totals deliberately ignore that one filter and no other. The reference
    // aggregates three times as `{ ...where, type: 'EXPENSE' | 'INCOME' |
    // 'REFUND' }` — spreading the caller's `where` and OVERWRITING its type — so
    // `?type=EXPENSE` still reports what was earned. That reads like a slip and
    // is not: the two figures head a summary bar that describes the period being
    // looked at, so narrowing the list to expenses must not blank out the income
    // beside it. Filtering the totals as well returned `totalEarned: 0` on a
    // period holding $96,272.57 of income.
    //
    // One query rather than two: fetching the unfiltered set once and narrowing
    // in memory keeps a single copy of a 20-line WHERE clause. Two queries would
    // be two clauses that must agree forever, which is the failure mode ADR-014
    // and the balance-chain rebuild are both about.
    let all_types = fetch_rows(
        pool,
        &Filters {
            tx_type: None,
            ..f.clone()
        },
    )
    .await?;

    // A split purchase is counted ONCE and listed in FULL, which sounds
    // contradictory and is not.
    //
    // Counted once: the Anchor and its legs each carry the whole total, so
    // summing both double-counts the purchase. With an account filter the
    // account-less Anchor is already excluded and the legs ARE that account's
    // rows, so the exclusion must not apply — hence the `account_id` condition.
    //
    // Listed in full: `collapsePurchaseGroups` in the web app folds the legs
    // into their Anchor CLIENT-side and reads `legCount` / `legAccountIds` off
    // the legs to render the "Paid from N accounts" badge. Collapsing server-side
    // instead — which is what this did — deletes the badge's only data source.
    // The reference's own comment says it excludes legs "matching the list's
    // collapsed view", and its `findMany` pointedly does not; the exclusion is
    // applied to the count and the three aggregates and nowhere else.
    let counts = |r: &Row| !(r.is_leg && f.account_id.is_none());

    // Spending is EXPENSE net of REFUND. A refund is not income: counting it
    // as one inflates both sides of the period summary at once.
    let mut total_spent = Cents::ZERO;
    let mut total_earned = Cents::ZERO;
    for r in all_types.iter().filter(|r| counts(r)) {
        match r.ty.as_str() {
            "EXPENSE" => total_spent += Cents(r.amount),
            "REFUND" => total_spent -= Cents(r.amount),
            "INCOME" => total_earned += Cents(r.amount),
            _ => {}
        }
    }

    // The page honours the type filter; the totals above deliberately do not.
    let rows: Vec<Row> = match &f.tx_type {
        Some(t) => all_types.into_iter().filter(|r| &r.ty == t).collect(),
        None => all_types,
    };
    let total_count = rows.iter().filter(|r| counts(r)).count() as i64;

    // Cursor pagination (ADR-009): seek past the cursor in the already-ordered
    // set and take the next page. Offset pagination duplicates and drops rows
    // when something is inserted mid-scroll, which on a ledger the user is
    // actively editing is the normal case rather than the exotic one.
    let start = match &f.cursor {
        Some(c) => rows
            .iter()
            .position(|r| &r.id == c)
            .map(|i| i + 1)
            .unwrap_or(0),
        None => 0,
    };
    let take = f.limit.max(1) as usize;
    let slice = &rows[start.min(rows.len())..];
    let has_more = slice.len() > take;
    let page = &slice[..take.min(slice.len())];
    let next_cursor = if has_more {
        page.last().map(|r| r.id.clone())
    } else {
        None
    };

    let out: Vec<TxShape> = page.iter().map(|r| r.json.clone()).collect();

    // Upcoming bills ride along with the FIRST page only (ADR-009). They are not
    // paginated rows: repeating them on every page would duplicate each one down
    // the list as the user scrolls, and a cursor request is asking for more
    // history rather than for the same header again.
    let anticipations = if f.cursor.is_none()
        && !p.query_bool("skipGenerate").unwrap_or(false)
        // Defaults ON, so an absent parameter still shows them.
        && p.query_bool("showAnticipations").unwrap_or(true)
    {
        let mut conn = pool.acquire().await?;
        let today = avoir_core::dates::today();
        let show_snoozed = p.query_bool("showSnoozed").unwrap_or(false);
        Some(crate::anticipations::build(&mut conn, today, show_snoozed).await?)
    } else {
        None
    };

    Ok(Response::ok(TxListShape {
        transactions: out,
        total_count,
        total_spent: total_spent.as_dollars_f64(),
        total_earned: total_earned.as_dollars_f64(),
        next_cursor,
        has_more,
        anticipations,
    }))
}

// ─── POST / ───

/// `tradeMetadata` as the frontend sends it.
///
/// This struct did not exist, and its absence was not a gap in validation —
/// it was the trade feature being **entirely inert**. `CreateTx` did not
/// deserialize the field, so serde discarded it (unknown fields are ignored by
/// default), and `LedgerCreate` was built with a hardcoded `trade: None`.
/// Posting a fully-formed stock purchase returned `201` with a real id, wrote
/// the `Transaction` row, wrote **no** `TradeDetail`, and answered
/// `tradeMetadata: null`. Nothing anywhere reported a problem.
///
/// The gate was never the issue: `ledger.rs` has always inserted both detail
/// tables. Nothing in the application ever asked it to — `trade: Some(..)`
/// appeared only in tests, which is exactly how 834 of them stayed green over a
/// dead feature.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TradeMeta {
    direction: String,
    asset_type: String,
    ticker: Option<String>,
    /// Both are `z.number().positive()` in the reference — required, and
    /// strictly positive. `unit_price` carried a `#[serde(default)]` here,
    /// which made it optional and defaulted a missing one to zero; a zero-price
    /// trade writes a holding with a zero cost basis, and a zero or negative
    /// quantity corrupts the holding outright. Checked in `to_trade_input`.
    quantity: f64,
    unit_price: f64,
    bitcoin_unit: Option<String>,
    custodian_id: Option<String>,
    wallet_id: Option<String>,
}

/// `bitcoinMetadata` — a purchase paid in BTC rather than from a bank account.
///
/// Dropped in exactly the same way and with a sharper consequence: the balance
/// hook writes `balanceBefore`/`balanceAfter` in **BTC quantity** for these
/// rows and in cents for account rows, and the two are told apart by the
/// presence of `bitcoinPaymentDetail`. A bitcoin payment with no detail row is
/// not a row missing an attribute — it is a row the ledger cannot classify.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BitcoinMeta {
    wallet_id: String,
    quantity: f64,
    bitcoin_unit: Option<String>,
    unit_price: f64,
    income_type: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateTx {
    name: Option<String>,
    amount: f64,
    date: String,
    r#type: String,
    #[serde(rename = "accountId")]
    account_id: Option<String>,
    #[serde(rename = "toAccountId")]
    to_account_id: Option<String>,
    #[serde(rename = "budgetId")]
    budget_id: Option<String>,
    #[serde(rename = "expenseId")]
    expense_id: Option<String>,
    #[serde(rename = "incomeId")]
    income_id: Option<String>,
    note: Option<String>,
    #[serde(rename = "occurrenceDate")]
    occurrence_date: Option<String>,
    #[serde(rename = "tradeMetadata")]
    trade_metadata: Option<TradeMeta>,
    #[serde(rename = "bitcoinMetadata")]
    bitcoin_metadata: Option<BitcoinMeta>,
}

/// Deserialize a body, reporting the FIELD that failed rather than "body".
///
/// The reference's validation errors are Zod's, so each one names the field it
/// belongs to and the frontend renders the message against that input. The port
/// reported `field: "body"` for every one of them: `serde_json::Error` knows
/// the line and column, which means nothing for a value assembled in memory,
/// and not the path. `serde_path_to_error` threads the path through the
/// deserializer, so `{"balance": "100"}` now points at `balance`.
///
/// The message stays serde's own. It reads differently from Zod's — "invalid
/// type: string, expected f64" against "Expected number, received string" — and
/// matching the wording would mean maintaining a translation table for every
/// type in the API. The field name is what the interface positions by; the
/// sentence is what the user reads, and both are accurate.
fn deserialize_named<T: serde::de::DeserializeOwned>(raw: &Value) -> Result<T, ApiError> {
    let text = raw.to_string();
    let de = &mut serde_json::Deserializer::from_str(&text);
    serde_path_to_error::deserialize(de).map_err(|e| {
        let path = e.path().to_string();
        ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                // An error at the very top (a body that is not an object at
                // all) has an empty path, and "body" is the honest name for it.
                "field": if path.is_empty() || path == "." { "body".to_string() } else { path },
                "message": e.into_inner().to_string(),
            }])),
        }
    })
}

/// Parse the wire's `type` into the enum the shared rules speak.
///
/// `Transaction.type` carries no CHECK constraint, so an unrecognised type
/// inserts cleanly and then matches no branch of the balance rule's `CASE` —
/// the `ELSE 0` arm — producing a row that appears in the ledger and moves no
/// money. The port accepted `"GIFT"` and, more quietly, `"expense"`, which is
/// the same defect wearing the right letters.
///
/// The message reproduces Zod's, because the frontend surfaces `details`
/// verbatim under the field it names.
fn parse_tx_type(raw: &str) -> Result<CrossFieldType, ApiError> {
    match raw {
        "EXPENSE" => Ok(CrossFieldType::Expense),
        "INCOME" => Ok(CrossFieldType::Income),
        "TRANSFER" => Ok(CrossFieldType::Transfer),
        "REFUND" => Ok(CrossFieldType::Refund),
        "TRADE" => Ok(CrossFieldType::Trade),
        other => Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": "type",
                "message": format!(
                    "Invalid enum value. Expected 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'REFUND' | 'TRADE', received '{other}'"
                ),
            }])),
        }),
    }
}

/// `isCashBack` is not a field on `CreateTx`, so it is read from the raw body.
///
/// It is deliberately not added to the struct: nothing downstream of here
/// writes it, and a field on the struct that the ledger ignores would read as
/// supported. The rule still has to see it, because "cash back on a
/// non-INCOME row" is a thing a caller can assert and the reference rejects.
fn is_cash_back(raw: &Value) -> bool {
    raw.get("isCashBack")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Run the shared rules and turn any issues into the validation envelope.
fn cross_field_check(facts: &CrossFieldFacts) -> Result<(), ApiError> {
    let issues = avoir_core::transaction_rules::cross_field_issues(facts);
    if issues.is_empty() {
        return Ok(());
    }
    Err(ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(Value::Array(
            issues
                .iter()
                .map(|i| json!({ "field": i.path, "message": i.message }))
                .collect(),
        )),
    })
}

/// Sats when the caller says so, BTC otherwise — the reference's rule, which
/// treats any value other than the literal `"Sats"` as Bitcoin.
fn is_sats(unit: Option<&str>) -> bool {
    unit == Some("Sats")
}

fn to_btc(quantity: f64, unit: Option<&str>) -> f64 {
    if is_sats(unit) {
        quantity / 100_000_000.0
    } else {
        quantity
    }
}

/// The current holding quantity for a custodian/wallet, or zero.
///
/// `ticker IS NULL` for bitcoin and the given ticker for stock, matching the
/// reference's `...(ticker ? { ticker } : { ticker: null })`.
async fn holding_quantity(
    pool: &SqlitePool,
    holding_type: &str,
    custodian_id: Option<&str>,
    wallet_id: Option<&str>,
    ticker: Option<&str>,
) -> Result<f64, ApiError> {
    let row = sqlx::query!(
        r#"SELECT "quantity" AS "quantity!: String" FROM "InvestmentHolding"
            WHERE "type" = ?
              AND ("custodianId" IS ?)
              AND ("walletId" IS ?)
              AND ("ticker" IS ?)
            LIMIT 1"#,
        holding_type,
        custodian_id,
        wallet_id,
        ticker,
    )
    .fetch_optional(pool)
    .await?;
    Ok(row
        .and_then(|r| r.quantity.parse::<f64>().ok())
        .unwrap_or(0.0))
}

/// Port of `validateTradeMetadata`.
///
/// A BUY validates nothing at all in the reference, and that asymmetry is
/// deliberate rather than an omission: buying creates the holding it needs.
async fn validate_trade(pool: &SqlitePool, m: &TradeMeta) -> Result<(), ApiError> {
    if m.direction != "SELL" {
        return Ok(());
    }
    let is_stock = m.asset_type == "Stock";

    if is_stock {
        let found = sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM "Custodian" WHERE "id" = ?"#,
            m.custodian_id
        )
        .fetch_one(pool)
        .await?;
        if found == 0 {
            return Err(ApiError::new(400, "Custodian not found"));
        }
    } else {
        let found = sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM "Wallet" WHERE "id" = ?"#,
            m.wallet_id
        )
        .fetch_one(pool)
        .await?;
        if found == 0 {
            return Err(ApiError::new(400, "Wallet not found"));
        }
    }

    let ticker = if is_stock { m.ticker.as_deref() } else { None };
    let current = holding_quantity(
        pool,
        if is_stock { "STOCK" } else { "BITCOIN" },
        if is_stock {
            m.custodian_id.as_deref()
        } else {
            None
        },
        if is_stock {
            None
        } else {
            m.wallet_id.as_deref()
        },
        ticker,
    )
    .await?;

    let sell_qty = if is_stock {
        m.quantity
    } else {
        to_btc(m.quantity, m.bitcoin_unit.as_deref())
    };
    if sell_qty > current {
        return Err(ApiError::new(
            400,
            format!("Insufficient holdings: have {current}, trying to sell {sell_qty}"),
        ));
    }
    Ok(())
}

/// Port of `validateBitcoinPayment`. Returns the USD amount it computes, which
/// **replaces** the caller's `amount` exactly as the reference does.
async fn validate_bitcoin(
    pool: &SqlitePool,
    m: &BitcoinMeta,
    tx_type: &str,
) -> Result<f64, ApiError> {
    let found = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "Wallet" WHERE "id" = ?"#,
        m.wallet_id
    )
    .fetch_one(pool)
    .await?;
    if found == 0 {
        return Err(ApiError::new(400, "Wallet not found"));
    }

    if tx_type == "EXPENSE" {
        let current = holding_quantity(pool, "BITCOIN", None, Some(&m.wallet_id), None).await?;
        let spend = to_btc(m.quantity, m.bitcoin_unit.as_deref());
        if spend > current {
            return Err(ApiError::new(
                400,
                format!("Insufficient holdings: have {current}, trying to spend {spend}"),
            ));
        }
    }

    Ok(to_btc(m.quantity, m.bitcoin_unit.as_deref()) * m.unit_price)
}

/// Wire shape → ledger input.
///
/// `quantity` and `unitPrice` become `Decimal` rather than `f64`, which is
/// ADR-033's split: money is integer cents, but a quantity or a unit rate keeps
/// its decimal scale. Production holds BTC quantities out to 20 places, and
/// cents would round `0.00000001` BTC to nothing.
///
/// The conversion goes through the decimal string rather than
/// `Decimal::from_f64_retain`, so a quantity arrives with the digits the user
/// typed instead of the nearest binary approximation of them.
/// Both callers pass `z.number().positive()` fields, so zero and negative are
/// rejected here rather than at each call site. A zero unit price writes a
/// holding with no cost basis; a zero or negative quantity corrupts the holding
/// arithmetic outright, and neither is recoverable from the row afterwards.
fn dec(v: f64, field: &str) -> Result<rust_decimal::Decimal, ApiError> {
    let invalid = |msg: &str| ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": field, "message": msg }])),
    };
    if !v.is_finite() {
        return Err(invalid("must be a finite number"));
    }
    if v <= 0.0 {
        return Err(invalid("Number must be greater than 0"));
    }
    // `Decimal` has a far smaller range than `f64`, so a value like 1e30 parses
    // as an error rather than saturating. That must fail the request: the
    // alternative found by this checklist was `unwrap_or_default()`, which
    // turned an out-of-range quantity into a silent ZERO on a holding.
    v.to_string()
        .parse::<rust_decimal::Decimal>()
        .map_err(|_| invalid("is out of range"))
}

fn to_trade_input(m: &TradeMeta) -> Result<ledger::TradeInput, ApiError> {
    use avoir_db::holdings::{AssetType, Direction};
    Ok(ledger::TradeInput {
        direction: if m.direction == "SELL" {
            Direction::Sell
        } else {
            Direction::Buy
        },
        asset_type: if m.asset_type == "Stock" {
            AssetType::Stock
        } else {
            AssetType::Bitcoin
        },
        ticker: m.ticker.clone(),
        quantity: dec(m.quantity, "tradeMetadata.quantity")?,
        unit_price: dec(m.unit_price, "tradeMetadata.unitPrice")?,
        bitcoin_unit_is_sats: is_sats(m.bitcoin_unit.as_deref()),
        custodian_id: m.custodian_id.clone(),
        wallet_id: m.wallet_id.clone(),
    })
}

fn to_bitcoin_input(m: &BitcoinMeta) -> Result<ledger::BitcoinInput, ApiError> {
    Ok(ledger::BitcoinInput {
        wallet_id: m.wallet_id.clone(),
        quantity: dec(m.quantity, "bitcoinMetadata.quantity")?,
        unit_price: dec(m.unit_price, "bitcoinMetadata.unitPrice")?,
        bitcoin_unit_is_sats: is_sats(m.bitcoin_unit.as_deref()),
        income_type: m.income_type.clone(),
    })
}

/// The reference's `z.number().nonnegative().max(999999999)`, as one function so
/// create and update cannot drift apart on it.
fn check_amount(amount: f64, field: &str) -> Result<(), ApiError> {
    // NaN is checked explicitly rather than relying on `!(amount >= 0.0)`.
    // The negated form is correct — NaN fails every comparison, so it falls
    // into the reject branch — but clippy is right that it reads as a typo, and
    // a guard whose correctness depends on noticing the `!` is a guard someone
    // will "simplify" to `amount < 0.0` and silently let NaN through to
    // `from_dollars_f64`.
    if amount.is_nan() || amount < 0.0 {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": field, "message": "must be nonnegative" }])),
        });
    }
    if amount > 999_999_999.0 {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(
                json!([{ "field": field, "message": "must be less than or equal to 999999999" }]),
            ),
        });
    }
    Ok(())
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let raw = body.unwrap_or(Value::Null);
    // Before `deserialize_named`, which would turn a missing `amount` into 0.0
    // and write a transaction for nothing into the master ledger.
    crate::require_present(&Some(raw.clone()), &["amount"])?;
    let b: CreateTx = deserialize_named(&raw)?;

    // `#[serde(default)]` means a missing `type` or `date` arrives as an empty
    // string. `Transaction.type` carries NO CHECK constraint, so an empty one
    // would insert cleanly — and the balance rule's `ELSE 0` branch matches no
    // known type, producing a row that exists, shows in the ledger, and moves
    // no balance. A silently weightless transaction is far worse than a
    // rejected request, so these are checked before anything is written.
    if b.r#type.is_empty() {
        return Err(crate::recurring::required("type"));
    }
    if b.date.is_empty() {
        return Err(crate::recurring::required("date"));
    }
    // `z.coerce.date()` in the reference, and unvalidated here — so an
    // unparseable date travelled all the way to the ledger gate, which does
    // catch it (`transaction date is not a date`) but as an internal error. The
    // caller got a 500 and "Internal server error" where the reference names
    // the field. The gate's check stays: reaching it means a route forgot to
    // validate, and that IS a programming error rather than a bad request.
    if avoir_core::dates::canonical_date(&b.date).is_none() {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "date", "message": "Invalid date" }])),
        });
    }

    let tx_type = parse_tx_type(&b.r#type)?;

    // The TRANSFER rules are inline in the reference's route handler rather
    // than in the shared rule set, and they are checked BEFORE it, so a
    // transfer with no destination reports that rather than something further
    // down. Order is preserved because the message the user sees depends on it.
    if b.r#type == "TRANSFER" {
        if b.to_account_id.is_none() {
            return Err(ApiError::new(400, "Transfers require a toAccountId"));
        }
        if b.account_id == b.to_account_id {
            return Err(ApiError::new(400, "From and to accounts must be different"));
        }
    }

    // And the seven shared rules. This function was ported in full, is checked
    // against the TypeScript by `crossfield_differential.rs`, and until now was
    // called by nothing but that test — the rules existed, were correct, and
    // ran on no request.
    //
    // They arrive as `{ error: "Validation failed", details: [...] }` because
    // in the reference they are a Zod `superRefine` on the create schema, so
    // they surface through the validation hook rather than as a bare `{ error }`
    // the way the two inline TRANSFER checks above do.
    cross_field_check(&CrossFieldFacts {
        transaction_type: tx_type,
        has_funding_account: b.account_id.is_some(),
        has_trade_metadata: b.trade_metadata.is_some(),
        has_bitcoin_metadata: b.bitcoin_metadata.is_some(),
        is_cash_back: is_cash_back(&raw),
    })?;
    // `amount: z.number().nonnegative().max(999999999)` in the reference, and
    // the port had NO bound at all — it accepted -50.00 and wrote it.
    //
    // Direction is carried by `type`, never by the sign of `amount`: the balance
    // rule subtracts an EXPENSE and adds an INCOME. So a negative EXPENSE is not
    // "a refund entered oddly", it is a row that displays as spending and moves
    // the balance UP, and it corrupts every total that sums by type. The upper
    // bound is ADR-002's, added with the other input bounds during the security
    // pass.
    check_amount(b.amount, "amount")?;

    // A transaction linked to a recurring item inherits that item's budget and
    // name when the caller did not set them. Without this the row lands in
    // Uncategorized despite being unambiguously categorised by what it pays.
    let mut budget_id = b.budget_id.clone();
    let mut name = b.name.clone();
    if let Some(eid) = &b.expense_id {
        if let Some(e) = sqlx::query!(
            r#"SELECT "budgetId" AS "budget_id!", "name" AS "name!" FROM "Expense" WHERE "id" = ?"#,
            eid
        )
        .fetch_optional(pool)
        .await?
        {
            if budget_id.is_none() {
                budget_id = Some(e.budget_id);
            }
            if name.is_none() {
                name = Some(e.name);
            }
        }
    }
    if let Some(iid) = &b.income_id {
        if name.is_none() {
            if let Some(i) = sqlx::query!(
                r#"SELECT "name" AS "name!" FROM "Income" WHERE "id" = ?"#,
                iid
            )
            .fetch_optional(pool)
            .await?
            {
                name = Some(i.name);
            }
        }
    }

    // Trade and bitcoin detail, validated then converted. Both were previously
    // hardcoded `None` — see `TradeMeta` for what that cost.
    let mut amount = b.amount;
    let mut account_id = b.account_id.clone();

    let trade = match &b.trade_metadata {
        Some(m) => {
            validate_trade(pool, m).await?;
            Some(to_trade_input(m)?)
        }
        None => None,
    };

    let bitcoin = match &b.bitcoin_metadata {
        Some(m) => {
            // The reference OVERWRITES the caller's amount with the computed
            // USD value and clears `accountId`, because a bitcoin payment moves
            // BTC out of a wallet and no cash out of any account. Leaving
            // `accountId` set would put the row in an account's balance chain
            // *and* give it BTC-denominated chain metadata, which is the one
            // combination the cross-field rules exist to make impossible.
            amount = validate_bitcoin(pool, m, &b.r#type).await?;
            account_id = None;
            Some(to_bitcoin_input(m)?)
        }
        None => None,
    };

    let id = cuid();
    let data = LedgerCreate {
        id: id.clone(),
        name: name.unwrap_or_default(),
        amount: Cents::from_dollars_f64(amount),
        date: b.date.clone(),
        created_at: now_iso(),
        tx_type: b.r#type.clone(),
        account_id,
        to_account_id: b.to_account_id.clone(),
        parent_id: None,
        budget_id,
        expense_id: b.expense_id.clone(),
        trade,
        bitcoin,
        occurrence_date: b.occurrence_date.clone(),
        note: b.note.clone(),
        purchase_group_id: None,
    };

    let mut conn = pool.acquire().await?;
    ledger::ledger_create(&mut conn, &data).await?;
    drop(conn);

    let created = fetch_serialized(pool, &id).await?;
    Ok(Response::created(created))
}

/// Read one row back through the list query, so a created or updated row is
/// serialized by exactly the same code that serializes a listed one.
/// The same read, for sibling route modules that create a transaction and
/// must report it in the identical shape (mark-as-paid, for one).
pub async fn fetch_serialized_pub(pool: &SqlitePool, id: &str) -> Result<Value, ApiError> {
    // `Value` for the sibling modules that embed this inside their own
    // response (mark-as-paid, the children routes) rather than returning it
    // whole.
    Ok(crate::to_body(fetch_serialized(pool, id).await?))
}

async fn fetch_serialized(pool: &SqlitePool, id: &str) -> Result<TxShape, ApiError> {
    let f = Filters {
        only_id: Some(id.to_string()),
        limit: 1,
        ..Default::default()
    };
    fetch_rows(pool, &f)
        .await?
        .into_iter()
        .next()
        .map(|r| r.json)
        .ok_or_else(|| ApiError::not_found("Transaction"))
}

/// Distinguish "field absent" from "field explicitly null".
///
/// A bare `Option<Option<T>>` CANNOT do this. Serde deserializes a JSON
/// `null` into the *outer* `None`, exactly as it does for a missing key, so
/// `Some(None)` is unreachable and every "clear this field" request silently
/// becomes "leave it alone". Wrapping the inner result in `Some` is what makes
/// the two distinguishable: `#[serde(default)]` supplies `None` when the key
/// is absent, and this runs only when it is present.
///
/// Caught by a test asserting `{"note": null}` clears a note. It did not.
fn present<'de, T, D>(de: D) -> Result<Option<T>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(de).map(Some)
}

// ─── PUT /:id ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct UpdateTx {
    name: Option<String>,
    amount: Option<f64>,
    date: Option<String>,
    r#type: Option<String>,
    #[serde(deserialize_with = "present", rename = "accountId")]
    account_id: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "toAccountId")]
    to_account_id: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "budgetId")]
    budget_id: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "expenseId")]
    expense_id: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "incomeId")]
    income_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    note: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "occurrenceDate")]
    occurrence_date: Option<Option<String>>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateTx =
        serde_json::from_value(body.unwrap_or(Value::Null)).map_err(|e| ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "body", "message": e.to_string() }])),
        })?;

    // The reference's `UpdateTransactionSchema` is a `.partial()` of the create
    // schema, so `amount` keeps its bounds when present. Checked here as well as
    // on create for the reason the cross-field comment in `transaction.ts`
    // gives: a rule enforced on create and skipped on update is a rule with a
    // second, unguarded way in.
    if let Some(a) = b.amount {
        check_amount(a, "amount")?;
    }

    let exists = sqlx::query!(
        r#"SELECT 1 AS "hit!: i64" FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if !exists {
        return Err(ApiError::not_found("Transaction"));
    }

    let patch = LedgerUpdate {
        amount: b.amount.map(Cents::from_dollars_f64),
        name: b.name,
        date: b.date,
        tx_type: b.r#type,
        account_id: b.account_id,
        to_account_id: b.to_account_id,
        budget_id: b.budget_id,
        expense_id: b.expense_id,
        income_id: b.income_id,
        note: b.note,
        occurrence_date: b.occurrence_date,
        // Not settable here. A transaction's description is changed by the
        // /descriptions routes, which move every row filed under it together.
        description_id: None,
    };

    let mut conn = pool.acquire().await?;
    ledger::ledger_update(&mut conn, id, &patch).await?;
    drop(conn);

    Ok(Response::ok(fetch_serialized(pool, id).await?))
}

// ─── DELETE /:id ───

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let exists = sqlx::query!(
        r#"SELECT 1 AS "hit!: i64" FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if !exists {
        return Err(ApiError::not_found("Transaction"));
    }

    // A parent with line items is refused, not cascaded.
    //
    // `Transaction.parentId` is ON DELETE CASCADE, so without this the children
    // go silently — and those children are the user's budget categorisation of
    // a receipt, several deliberate decisions destroyed by one click on the
    // parent. The reference refuses for the same reason ADR-004 refuses to
    // delete an archived expense: the destructive step should be a separate,
    // explicit act rather than a side effect of another one.
    //
    // Found by the write harness only after its scenario learned to CREATE a
    // child. The route was already exercised; the case was not.
    let children = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Transaction" WHERE "parentId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if children > 0 {
        // 409, not 400: the request is well-formed and the state refuses it.
        return Err(ApiError::conflict(
            "Cannot delete transaction with child line items. Remove children first.",
        ));
    }

    let mut conn = pool.acquire().await?;
    ledger::ledger_delete(&mut conn, id).await?;
    Ok(Response::no_content())
}

// ─── GET /suggest-budget ───

/// Which budgets this description has been filed under before.
///
/// Ranked by how often, capped at five. The suggestion is a shortcut, not a
/// decision — nothing here writes anything, and a wrong guess costs one click.
pub async fn suggest_budget(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let description = p
        .query("description")
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::bad_request("description is required"))?;

    // Case-insensitive on the name, folded in Rust rather than SQL for the
    // reason `descriptions.rs` records: SQLite folds ASCII only, and Postgres
    // folded the whole of Unicode. Filtering here keeps "CAFÉ" and "café" one
    // merchant, which is the entire point of a suggestion.
    let wanted = description.to_lowercase();
    let rows = sqlx::query!(
        r#"SELECT t."name" AS "name!", t."budgetId" AS "budget_id!", b."name" AS "budget_name!"
             FROM "Transaction" t
             JOIN "Budget" b ON b."id" = t."budgetId"
            WHERE t."budgetId" IS NOT NULL"#
    )
    .fetch_all(pool)
    .await?;

    let mut tally: std::collections::HashMap<(String, String), i64> =
        std::collections::HashMap::new();
    for r in rows {
        if r.name.to_lowercase() == wanted {
            *tally.entry((r.budget_id, r.budget_name)).or_insert(0) += 1;
        }
    }

    let mut ranked: Vec<((String, String), i64)> = tally.into_iter().collect();
    // Count descending, then budget id, so equal counts come back in a stable
    // order rather than whatever the hash map happened to iterate.
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0 .0.cmp(&b.0 .0)));
    ranked.truncate(5);

    Ok(Response::ok(SuggestionsShape {
        suggestions: ranked
            .into_iter()
            .map(|((budget_id, budget_name), count)| SuggestionShape {
                budget_id,
                budget_name,
                count,
            })
            .collect(),
    }))
}

// ─── DELETE /imported ───

/// Remove every imported transaction, reversing each one's side effects.
///
/// `?confirm=true` is required. This is the one endpoint that can delete
/// thousands of rows from a single click, and a confirmation the caller has to
/// spell out is cheaper than the restore that follows getting it wrong.
///
/// Each row goes through `ledger_delete` rather than a bulk `DELETE` + rebuild.
/// The TypeScript deleted in bulk and then recomputed every account balance
/// from the survivors — which is the "delete and rebuild derived state in a
/// parallel routine" shape ADR-028 rejected, because that routine has to
/// duplicate every hook's logic and must never drift from it.
pub async fn delete_imported(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    if p.query("confirm") != Some("true") {
        return Err(ApiError::bad_request(
            "Mass delete requires ?confirm=true query parameter",
        ));
    }

    // Top-level rows only — children cascade with their parents, and deleting a
    // child on its own would leave the parent's split short of its total.
    let ids = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "Transaction"
            WHERE "imported" = 1 AND "parentId" IS NULL"#
    )
    .fetch_all(pool)
    .await?;

    let mut tx = pool.begin().await?;
    for id in &ids {
        ledger::ledger_delete(&mut tx, id).await?;
    }
    tx.commit().await?;

    Ok(Response::ok(DeletedShape { deleted: ids.len() }))
}
