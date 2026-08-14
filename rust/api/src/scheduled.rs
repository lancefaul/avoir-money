//! `/scheduled-transactions` — fulfilling, deferring and dismissing an
//! expected occurrence.
//!
//! Ported from `routes/scheduled-transactions.ts`. The three write endpoints
//! are here; **`GET /` is deliberately absent** — see the note at the bottom
//! of this file. It needs the lazy generator, which needs the utilities
//! domain, and a GET that silently returned only pre-existing rows would look
//! like a working endpoint while never producing an occurrence.
//!
//! # Why paying writes `occurrenceDate` and not just `date`
//!
//! A late payment is entered on the day it is actually paid, but it fulfils
//! the occurrence that was due earlier. `date` is when money moved;
//! `occurrenceDate` is which expected occurrence it satisfies (ADR-001).
//! Without the second field a payment made on the 5th cannot be matched to a
//! bill due on the 1st, and mark-as-paid on anything overdue silently fails
//! to link.

use crate::id::now_iso;
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use avoir_db::ledger::{self, LedgerCreate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// One generated occurrence, in `ScheduledTransactionSchema` shape.
///
/// ADR-024: the `id` is STABLE across regenerations — rows are inserted only
/// when genuinely new and refreshed in place while PENDING — because the client
/// holds it between render and click, and churning it made mark-as-paid 404.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledShape {
    id: String,
    source_type: String,
    source_id: String,
    due_date: String,
    expected_amount: f64,
    actual_amount: Option<f64>,
    status: String,
    transaction_id: Option<String>,
    snoozed_until: Option<String>,
    note: Option<String>,
    expense_id: Option<String>,
    income_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[allow(clippy::too_many_arguments)]
fn serialize(
    id: &str,
    source_type: &str,
    source_id: &str,
    due_date: &str,
    expected: i64,
    actual: Option<i64>,
    status: &str,
    transaction_id: &Option<String>,
    snoozed_until: &Option<String>,
    note: &Option<String>,
    expense_id: &Option<String>,
    income_id: &Option<String>,
    created_at: &str,
    updated_at: &str,
) -> ScheduledShape {
    ScheduledShape {
        id: id.to_string(),
        source_type: source_type.to_string(),
        source_id: source_id.to_string(),
        due_date: due_date.to_string(),
        expected_amount: Cents(expected).as_dollars_f64(),
        actual_amount: actual.map(|a| Cents(a).as_dollars_f64()),
        status: status.to_string(),
        transaction_id: transaction_id.clone(),
        snoozed_until: snoozed_until.clone(),
        note: note.clone(),
        expense_id: expense_id.clone(),
        income_id: income_id.clone(),
        created_at: created_at.to_string(),
        updated_at: updated_at.to_string(),
    }
}

async fn one(pool: &SqlitePool, id: &str) -> Result<ScheduledShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "sourceType" AS "source_type!", "sourceId" AS "source_id!",
                  "dueDate" AS "due_date!", "expectedAmount" AS "expected!: i64",
                  "actualAmount" AS "actual: i64", "status" AS "status!",
                  "transactionId" AS "transaction_id: String",
                  "snoozedUntil" AS "snoozed_until: String", "note" AS "note: String",
                  "expenseId" AS "expense_id: String", "incomeId" AS "income_id: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "ScheduledTransaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Scheduled transaction"))?;

    Ok(serialize(
        &r.id,
        &r.source_type,
        &r.source_id,
        &r.due_date,
        r.expected,
        r.actual,
        &r.status,
        &r.transaction_id,
        &r.snoozed_until,
        &r.note,
        &r.expense_id,
        &r.income_id,
        &r.created_at,
        &r.updated_at,
    ))
}

/// The status and the amount, which every write path needs before deciding
/// whether it is allowed to proceed.
async fn status_of(pool: &SqlitePool, id: &str) -> Result<(String, i64, String, String), ApiError> {
    let r = sqlx::query!(
        r#"SELECT "status" AS "status!", "expectedAmount" AS "expected!: i64",
                  "sourceType" AS "source_type!", "sourceId" AS "source_id!",
                  "dueDate" AS "due_date!"
             FROM "ScheduledTransaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Scheduled transaction"))?;
    Ok((r.status, r.expected, r.source_type, r.due_date))
}

// ─── POST /:id/pay ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct PayBody {
    amount: Option<f64>,
    date: Option<String>,
    #[serde(rename = "accountId")]
    account_id: Option<String>,
}

pub async fn pay(pool: &SqlitePool, id: &str, body: Option<Value>) -> Result<Response, ApiError> {
    // `unwrap_or(json!({}))` rather than `Null`: every field of `PayBody` is
    // optional, so an absent body is a valid "pay it as scheduled".
    let b: PayBody = crate::body_of(Some(body.unwrap_or(json!({}))))?;

    let (status, expected, source_type, due_date) = status_of(pool, id).await?;
    // Paying twice would create a second fulfilling transaction and move the
    // balance again, so this is a conflict rather than an idempotent no-op.
    if status == "PAID" {
        return Err(ApiError::conflict("Scheduled transaction is already paid"));
    }

    // The source supplies the defaults: what to call it, which budget it
    // belongs to, and which account it normally comes from.
    let (name, budget_id, source_account) = if source_type == "EXPENSE" {
        let e = sqlx::query!(
            r#"SELECT "name" AS "name!", "budgetId" AS "budget_id!",
                      "accountId" AS "account_id: String"
                 FROM "Expense" WHERE "id" = (SELECT "sourceId" FROM "ScheduledTransaction" WHERE "id" = ?)"#,
            id
        )
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Source expense"))?;
        (e.name, e.budget_id, e.account_id)
    } else {
        let i = sqlx::query!(
            r#"SELECT "name" AS "name!", "budgetId" AS "budget_id!",
                      "accountId" AS "account_id: String"
                 FROM "Income" WHERE "id" = (SELECT "sourceId" FROM "ScheduledTransaction" WHERE "id" = ?)"#,
            id
        )
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("Source income"))?;
        (i.name, i.budget_id, i.account_id)
    };

    let amount = b
        .amount
        .map(Cents::from_dollars_f64)
        .unwrap_or(Cents(expected));
    let date = b
        .date
        .unwrap_or_else(|| crate::id::date_at_utc_midnight(avoir_core::dates::today()));
    let account_id = b.account_id.or(source_account);

    let source_id: String =
        sqlx::query_scalar(r#"SELECT "sourceId" FROM "ScheduledTransaction" WHERE "id" = ?"#)
            .bind(id)
            .fetch_one(pool)
            .await?;

    let tx_id = crate::id::cuid();
    let data = LedgerCreate {
        id: tx_id.clone(),
        name,
        amount,
        date,
        created_at: now_iso(),
        tx_type: if source_type == "EXPENSE" {
            "EXPENSE"
        } else {
            "INCOME"
        }
        .into(),
        account_id,
        to_account_id: None,
        parent_id: None,
        budget_id: Some(budget_id),
        // ADR-001: which occurrence this satisfies, as distinct from when the
        // money moved. A late payment still finds its schedule row.
        occurrence_date: Some(due_date),
        expense_id: if source_type == "EXPENSE" {
            Some(source_id.clone())
        } else {
            None
        },
        trade: None,
        bitcoin: None,
        note: None,
        purchase_group_id: None,
    };

    let mut conn = pool.acquire().await?;
    ledger::ledger_create(&mut conn, &data).await?;
    drop(conn);

    // Underpaying marks PARTIAL, not PAID. The distinction is what keeps a
    // short payment visible instead of closing the occurrence as satisfied.
    let new_status = if amount.0 >= expected {
        "PAID"
    } else {
        "PARTIAL"
    };
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
              SET "status" = ?, "transactionId" = ?, "actualAmount" = ?, "updatedAt" = ?
            WHERE "id" = ?"#,
        new_status,
        tx_id,
        amount.0,
        now,
        id
    )
    .execute(pool)
    .await?;

    // Income is linked through `incomeId`, which `LedgerCreate` does not carry
    // — it is set here so the fulfilling row still points back at its source.
    if source_type == "INCOME" {
        sqlx::query!(
            r#"UPDATE "Transaction" SET "incomeId" = ? WHERE "id" = ?"#,
            source_id,
            tx_id
        )
        .execute(pool)
        .await?;
    }

    Ok(Response::created(
        crate::transactions::fetch_serialized_pub(pool, &tx_id).await?,
    ))
}

// ─── POST /:id/snooze ───

#[derive(Deserialize)]
struct SnoozeBody {
    days: i64,
}

pub async fn snooze(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: SnoozeBody =
        serde_json::from_value(body.unwrap_or(Value::Null)).map_err(|e| ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "days", "message": e.to_string() }])),
        })?;

    /*
     * `days` BEFORE state, matching the reference — `@hono/zod-openapi`
     * validates in middleware, so its handler never sees `days: 0`. Rust
     * checked the row first and answered "Cannot snooze a paid scheduled
     * transaction" to a request whose real problem was the body, which is a
     * true sentence about the wrong thing.
     */
    if b.days < 1 {
        return Err(ApiError::invalid_field(
            "days",
            "Number must be greater than or equal to 1",
        ));
    }

    let (status, _, _, _) = status_of(pool, id).await?;
    // A paid occurrence has nothing left to defer.
    if status == "PAID" {
        return Err(ApiError::conflict(
            "Cannot snooze a paid scheduled transaction",
        ));
    }

    let until = avoir_core::dates::today() + chrono::Duration::days(b.days);
    let until = crate::id::date_at_utc_midnight(until);
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
              SET "status" = 'SNOOZED', "snoozedUntil" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        until,
        now,
        id
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(one(pool, id).await?))
}

// ─── POST /:id/skip ───

pub async fn skip(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let (status, _, _, _) = status_of(pool, id).await?;
    if status == "PAID" {
        return Err(ApiError::conflict(
            "Cannot skip a paid scheduled transaction",
        ));
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction"
              SET "status" = 'SKIPPED', "updatedAt" = ? WHERE "id" = ?"#,
        now,
        id
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(one(pool, id).await?))
}

// ─── GET / ───

/// The schedule for a window, generated on demand.
///
/// Generation runs first and lazily: the rows are derived from the recurring
/// items, so materialising them on read is what keeps them in step with an
/// edit made anywhere else. ADR-024 is why it inserts rather than replaces —
/// a row that survives keeps its id, and the client is holding that id.
pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    // Field-scoped, because the client renders `details[].field`. These said
    // "periodStart is required" at the top level with no details — true, and
    // unusable by a form.
    let start = p
        .query("periodStart")
        .and_then(|s| chrono::NaiveDate::parse_from_str(s.get(..10).unwrap_or(""), "%Y-%m-%d").ok())
        .ok_or_else(|| ApiError::invalid_field("periodStart", "Invalid date"))?;
    let end = p
        .query("periodEnd")
        .and_then(|s| chrono::NaiveDate::parse_from_str(s.get(..10).unwrap_or(""), "%Y-%m-%d").ok())
        .ok_or_else(|| ApiError::invalid_field("periodEnd", "Invalid date"))?;

    // An unknown `sourceType` silently matched nothing and returned `200 []`,
    // which tells a caller their filter found no occurrences rather than that
    // the filter is not a thing.
    let source_type = p
        .query("sourceType")
        .filter(|s| !s.is_empty())
        .map(String::from);
    if let Some(t) = source_type.as_deref() {
        if !["EXPENSE", "INCOME"].contains(&t) {
            return Err(ApiError::invalid_field(
                "sourceType",
                format!("Invalid enum value. Expected 'EXPENSE' | 'INCOME', received '{t}'"),
            ));
        }
    }

    let window = avoir_db::schedule_generator::Window {
        start,
        end,
        source_type,
        source_id: p
            .query("sourceId")
            .filter(|s| !s.is_empty())
            .map(String::from),
    };

    let mut conn = pool.acquire().await?;
    avoir_db::schedule_generator::generate(&mut conn, &window).await?;
    drop(conn);

    let from = format!("{}T00:00:00.000Z", start);
    let to = format!("{}T00:00:00.000Z", end);
    let source_type = window.source_type.clone();
    let source_id = window.source_id.clone();

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "ScheduledTransaction"
            WHERE "dueDate" >= ?1 AND "dueDate" <= ?2
              AND (?3 IS NULL OR "sourceType" = ?3)
              AND (?4 IS NULL OR "sourceId" = ?4)
            ORDER BY "dueDate" ASC, "id" ASC"#,
        from,
        to,
        source_type,
        source_id
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(one(pool, &r.id).await?);
    }
    Ok(Response::ok(out))
}
