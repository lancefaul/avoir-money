//! `/expenses` and `/income` — the recurring items that drive the schedule.
//!
//! Ported from `routes/expenses.ts`, `routes/expenses.lifecycle.ts` and
//! `routes/income.ts`. They are one module because they are one shape: a
//! named amount on a frequency, with the same four-state lifecycle. Income
//! simply has fewer due-date fields.
//!
//! # The lifecycle is four states, not two booleans
//!
//! `pausedUntil` and `archivedAt` are both **nullable timestamps** rather than
//! flags (ADR-004). The timestamp carries *when*, which a boolean throws away,
//! and the two are independent: an item can be paused, archived, both, or
//! neither. The rules that make them distinct:
//!
//! - **Pause** is temporary and reversible; resuming may move `startDate`.
//! - **Archive** is deliberate. It SKIPs every PENDING schedule row and
//!   unlinks the item from its budget, because an archived item must stop
//!   contributing to the baseline.
//! - **Delete is refused (409) while archived.** Restore first. This is not
//!   ceremony — it forces the destructive step to be a separate decision from
//!   the reversible one.
//!
//! # Schedule invalidation is part of every write
//!
//! `ScheduledTransaction` rows are generated lazily from these records, so any
//! edit that moves a due date or an amount must delete the future PENDING rows
//! that were computed from the old values. SNOOZED rows go too when dates
//! move, because a snooze points at a due date that no longer exists.
//! PAID/PARTIAL/SKIPPED rows are always preserved — they are history, or a
//! deliberate user action (ADR-024).

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// Which of the two tables a request is about.
///
/// The pair is carried as data rather than duplicated as two near-identical
/// modules — the lifecycle rules are identical and were worth stating once.
#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Expense,
    Income,
}

impl Kind {
    /// `ScheduledTransaction.sourceType`.
    fn source_type(self) -> &'static str {
        match self {
            Kind::Expense => "EXPENSE",
            Kind::Income => "INCOME",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Kind::Expense => "Expense",
            Kind::Income => "Income",
        }
    }
}

/// `amountSchedule` is a JSON object of period → dollars, stored as TEXT.
///
/// It is passed through rather than scaled: the importer classifies only
/// numeric columns as money, so these values are still decimal dollars on
/// disk and the frontend expects exactly that.
fn parse_schedule(raw: Option<String>) -> Value {
    raw.and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or(Value::Null)
}

// ─── Serialization ───

/// A recurring expense, as every `/expenses` route returns it.
///
/// This replaced a 22-positional-argument `serialize_expense` carrying an
/// `#[allow(clippy::too_many_arguments)]`. The lint was right: fourteen of
/// those arguments were `Option<String>` or `&str`, so transposing any adjacent
/// pair type-checked and produced a wrong record silently. Named fields make
/// that mistake unavailable rather than merely unlikely.
///
/// See `budgets.rs` for the two rules these types keep — camelCase on the wire,
/// and never `skip_serializing_if`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseShape {
    id: String,
    name: String,
    amount: f64,
    frequency: String,
    budget_id: String,
    account_id: Option<String>,
    is_automatic: bool,
    skip_weekend: bool,
    due_day: Option<i64>,
    due_weekday: Option<i64>,
    due_ordinal: Option<i64>,
    amount_schedule: Value,
    start_date: Option<String>,
    end_date: Option<String>,
    paused_until: Option<String>,
    archived_at: Option<String>,
    note: Option<String>,
    management_url: Option<String>,
    /// ADR-010: a virtual field, not a column. The FK lives on `Debt`
    /// (`Debt.linkedExpenseId`) and is read back here — a bidirectional FK
    /// would be a circular dependency with an insert-ordering problem.
    linked_debt_id: Option<String>,
    is_linked_to_budget: bool,
    created_at: String,
    updated_at: String,
}

/// A recurring income.
///
/// Deliberately NOT the same type as `ExpenseShape`: income has no due rule, no
/// automatic flag, no debt link and no budget link, and sharing one struct
/// would mean emitting those keys as null on a resource that has no concept of
/// them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomeShape {
    id: String,
    name: String,
    amount: f64,
    frequency: String,
    budget_id: String,
    account_id: Option<String>,
    amount_schedule: Value,
    start_date: Option<String>,
    end_date: Option<String>,
    paused_until: Option<String>,
    archived_at: Option<String>,
    note: Option<String>,
    management_url: Option<String>,
    created_at: String,
    updated_at: String,
}

async fn expense_json(pool: &SqlitePool, id: &str) -> Result<ExpenseShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "amount" AS "amount!: i64",
                  "frequency" AS "frequency!", "budgetId" AS "budget_id!",
                  "accountId" AS "account_id: String", "isAutomatic" AS "is_automatic!: i64",
                  "skipWeekend" AS "skip_weekend!: i64", "dueDay" AS "due_day: i64",
                  "dueWeekday" AS "due_weekday: i64", "dueOrdinal" AS "due_ordinal: i64",
                  "amountSchedule" AS "amount_schedule: String",
                  "startDate" AS "start_date: String", "endDate" AS "end_date: String",
                  "pausedUntil" AS "paused_until: String", "archivedAt" AS "archived_at: String",
                  "note" AS "note: String", "managementUrl" AS "management_url: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!",
                  (SELECT d."id" FROM "Debt" d WHERE d."linkedExpenseId" = "Expense"."id" LIMIT 1)
                      AS "linked_debt_id: String",
                  (SELECT COUNT(*) FROM "BudgetExpenseLink" l WHERE l."expenseId" = "Expense"."id")
                      AS "link_count!: i64"
             FROM "Expense" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Expense"))?;

    Ok(ExpenseShape {
        id: r.id,
        name: r.name,
        amount: Cents(r.amount).as_dollars_f64(),
        frequency: r.frequency,
        budget_id: r.budget_id,
        account_id: r.account_id,
        is_automatic: r.is_automatic != 0,
        skip_weekend: r.skip_weekend != 0,
        due_day: r.due_day,
        due_weekday: r.due_weekday,
        due_ordinal: r.due_ordinal,
        amount_schedule: parse_schedule(r.amount_schedule),
        start_date: r.start_date,
        end_date: r.end_date,
        paused_until: r.paused_until,
        archived_at: r.archived_at,
        note: r.note,
        management_url: r.management_url,
        linked_debt_id: r.linked_debt_id,
        is_linked_to_budget: r.link_count > 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

async fn income_json(pool: &SqlitePool, id: &str) -> Result<IncomeShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "amount" AS "amount!: i64",
                  "frequency" AS "frequency!", "budgetId" AS "budget_id!",
                  "accountId" AS "account_id: String",
                  "amountSchedule" AS "amount_schedule: String",
                  "startDate" AS "start_date: String", "endDate" AS "end_date: String",
                  "pausedUntil" AS "paused_until: String", "archivedAt" AS "archived_at: String",
                  "note" AS "note: String", "managementUrl" AS "management_url: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Income" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Income"))?;

    Ok(IncomeShape {
        id: r.id,
        name: r.name,
        amount: Cents(r.amount).as_dollars_f64(),
        frequency: r.frequency,
        budget_id: r.budget_id,
        account_id: r.account_id,
        amount_schedule: parse_schedule(r.amount_schedule),
        start_date: r.start_date,
        end_date: r.end_date,
        paused_until: r.paused_until,
        archived_at: r.archived_at,
        note: r.note,
        management_url: r.management_url,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// One record of either kind, as `Value`.
///
/// The two shapes are deliberately different types, so the one place that has
/// to hold either — this dispatch, and the lifecycle routes that call it — is
/// where they erase to `Value`. That erasure is confined here rather than being
/// the default everywhere, which is the whole point of the change.
async fn one(pool: &SqlitePool, kind: Kind, id: &str) -> Result<Value, ApiError> {
    Ok(match kind {
        Kind::Expense => crate::to_body(expense_json(pool, id).await?),
        Kind::Income => crate::to_body(income_json(pool, id).await?),
    })
}

// ─── Schedule invalidation ───

/// Delete the future PENDING rows computed from values that just changed.
///
/// `include_snoozed` additionally clears SNOOZED rows, and is used whenever
/// **dates** move: a snooze points at a specific due date, so keeping it after
/// the date changes leaves a row referring to an occurrence that no longer
/// exists. An amount-only change leaves snoozes alone — the user's "not now"
/// is still about a real date.
///
/// PAID and PARTIAL are never touched (they are history) and SKIPPED is never
/// touched (it is a deliberate choice), per ADR-024.
async fn invalidate_schedule(
    pool: &SqlitePool,
    kind: Kind,
    id: &str,
    include_snoozed: bool,
) -> Result<(), ApiError> {
    let source = kind.source_type();
    let snoozed = include_snoozed as i64;
    sqlx::query!(
        r#"DELETE FROM "ScheduledTransaction"
            WHERE "sourceType" = ? AND "sourceId" = ?
              AND ("status" = 'PENDING' OR (?3 = 1 AND "status" = 'SNOOZED'))"#,
        source,
        id,
        snoozed
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Re-derive any budget this item feeds.
///
/// The TypeScript calls `triggerBudgetRecompute` at nine sites; this is the
/// same thing, and its absence was recorded in BACKLOG.md as a known gap while
/// budget-linking was unported. Income never feeds a budget baseline — only
/// expenses do — so it is a no-op there rather than a second code path.
///
/// A failure here must not fail the write. The money change is the real work
/// and the budget figure is derived from it, so the error is logged and the
/// request succeeds — matching the TypeScript, which wraps it in a catch that
/// only warns.
async fn recompute_linked_budgets(pool: &SqlitePool, kind: Kind, id: &str) -> Result<(), ApiError> {
    if kind != Kind::Expense {
        return Ok(());
    }
    if let Err(e) = crate::category_budgets::recompute_for_expense(pool, id).await {
        eprintln!("[api] budget recompute failed for expense {id}: {e}");
    }
    Ok(())
}

/// Mark every PENDING occurrence SKIPPED — used by archive and delete.
///
/// Deliberately not a delete: the rows record that an occurrence was expected
/// and consciously not paid, which is exactly what archiving an item means for
/// the periods it was already scheduled into.
async fn skip_pending(pool: &SqlitePool, kind: Kind, id: &str) -> Result<(), ApiError> {
    let source = kind.source_type();
    sqlx::query!(
        r#"UPDATE "ScheduledTransaction" SET "status" = 'SKIPPED'
            WHERE "sourceType" = ? AND "sourceId" = ? AND "status" = 'PENDING'"#,
        source,
        id
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ─── GET / ───

pub async fn list(pool: &SqlitePool, kind: Kind, p: &Path<'_>) -> Result<Response, ApiError> {
    // Archived items are hidden unless asked for. They are still real records
    // — restoring one has to bring back everything it had — so this is a
    // filter, never a delete.
    let want_archived = p.query_bool("archived").unwrap_or(false) as i64;
    let frequency = p.query("frequency").filter(|s| !s.is_empty());
    let is_automatic = p.query_bool("isAutomatic").map(|v| v as i64);

    let ids: Vec<String> = match kind {
        Kind::Expense => sqlx::query!(
            r#"SELECT "id" AS "id!" FROM "Expense"
                WHERE ((?1 = 1 AND "archivedAt" IS NOT NULL)
                    OR (?1 = 0 AND "archivedAt" IS NULL))
                  AND (?2 IS NULL OR "frequency" = ?2)
                  AND (?3 IS NULL OR "isAutomatic" = ?3)
                ORDER BY "name" ASC"#,
            want_archived,
            frequency,
            is_automatic
        )
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect(),
        Kind::Income => sqlx::query!(
            r#"SELECT "id" AS "id!" FROM "Income"
                WHERE ((?1 = 1 AND "archivedAt" IS NOT NULL)
                    OR (?1 = 0 AND "archivedAt" IS NULL))
                  AND (?2 IS NULL OR "frequency" = ?2)
                ORDER BY "name" ASC"#,
            want_archived,
            frequency
        )
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect(),
    };

    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        out.push(one(pool, kind, &id).await?);
    }
    Ok(Response::ok(Value::Array(out)))
}

// ─── GET /:id ───

pub async fn get(pool: &SqlitePool, kind: Kind, id: &str) -> Result<Response, ApiError> {
    Ok(Response::ok(one(pool, kind, id).await?))
}

// ─── POST / ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateRecurring {
    name: String,
    amount: f64,
    frequency: String,
    #[serde(rename = "budgetId")]
    budget_id: String,
    #[serde(rename = "accountId")]
    account_id: Option<String>,
    #[serde(rename = "isAutomatic")]
    is_automatic: Option<bool>,
    #[serde(rename = "skipWeekend")]
    skip_weekend: Option<bool>,
    #[serde(rename = "dueDay")]
    due_day: Option<i64>,
    #[serde(rename = "dueWeekday")]
    due_weekday: Option<i64>,
    #[serde(rename = "dueOrdinal")]
    due_ordinal: Option<i64>,
    #[serde(rename = "amountSchedule")]
    amount_schedule: Option<Value>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(rename = "endDate")]
    end_date: Option<String>,
    note: Option<String>,
    #[serde(rename = "managementUrl")]
    management_url: Option<String>,
    #[serde(rename = "linkedDebtId")]
    linked_debt_id: Option<String>,
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
pub(crate) fn present<'de, T, D>(de: D) -> Result<Option<T>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    T::deserialize(de).map(Some)
}

/// A required field was missing or empty.
pub(crate) fn required(field: &str) -> ApiError {
    ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": field, "message": "is required" }])),
    }
}

/// Reject a frequency the schema does not allow.
///
/// The empty check below this had a comment explaining that an unchecked
/// frequency "reaches SQLite and fails there — a CHECK violation on
/// `frequency` — which surfaces as a 500, blaming the server for what is
/// plainly a bad request". That was exactly right and only half-implemented:
/// it caught a MISSING frequency and let an INVALID one through to precisely
/// the 500 it described. `WHENEVER` returned "Internal server error".
///
/// `from_stored` is reused rather than a new list written, so the accepted set
/// cannot drift from the one the rest of the app computes with.
fn check_frequency(v: &str) -> Result<(), ApiError> {
    if avoir_core::budget::Frequency::from_stored(v).is_some() {
        return Ok(());
    }
    Err(ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{
            "field": "frequency",
            "message": format!(
                "Invalid enum value. Expected 'ONE_TIME' | 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'QUARTERLY' | 'BIANNUAL' | 'ANNUAL', received '{v}'"
            ),
        }])),
    })
}

pub async fn create(
    pool: &SqlitePool,
    kind: Kind,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    crate::require_present(&body, &["amount"])?;
    let b: CreateRecurring = crate::body_of(body)?;
    if b.name.is_empty() || b.name.chars().count() > 200 {
        return Err(ApiError::bad_request(
            "name must be between 1 and 200 characters",
        ));
    }
    if b.amount < 0.0 {
        return Err(ApiError::bad_request("amount must be nonnegative"));
    }
    // `#[serde(default)]` on the struct means a MISSING required field arrives
    // as an empty string rather than a deserialization error. Without these
    // checks the request reaches SQLite and fails there — a CHECK violation on
    // `frequency`, an FK violation on `budgetId` — which surfaces as a 500,
    // blaming the server for what is plainly a bad request.
    if b.frequency.is_empty() {
        return Err(required("frequency"));
    }
    check_frequency(&b.frequency)?;
    if b.budget_id.is_empty() {
        return Err(required("budgetId"));
    }
    if kind == Kind::Income && b.amount <= 0.0 {
        return Err(ApiError::bad_request("amount must be positive"));
    }

    let id = cuid();
    let now = now_iso();
    let amount = Cents::from_dollars_f64(b.amount).0;
    let schedule = b.amount_schedule.as_ref().map(|v| v.to_string());

    match kind {
        Kind::Expense => {
            let is_auto = b.is_automatic.unwrap_or(false) as i64;
            // Defaults TRUE — `CreateExpenseSchema` says `.default(true)` and
            // the port had `false`. Not cosmetic: it decides whether a bill
            // falling on a Saturday is scheduled for that Saturday or moved off
            // the weekend, so every due date generated for an expense created
            // through the port was potentially a day or two out.
            let skip_we = b.skip_weekend.unwrap_or(true) as i64;
            sqlx::query!(
                r#"INSERT INTO "Expense"
                     ("id","name","amount","frequency","budgetId","accountId","isAutomatic",
                      "skipWeekend","dueDay","dueWeekday","dueOrdinal","amountSchedule",
                      "startDate","endDate","note","managementUrl","createdAt","updatedAt")
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"#,
                id,
                b.name,
                amount,
                b.frequency,
                b.budget_id,
                b.account_id,
                is_auto,
                skip_we,
                b.due_day,
                b.due_weekday,
                b.due_ordinal,
                schedule,
                b.start_date,
                b.end_date,
                b.note,
                b.management_url,
                now,
                now,
            )
            .execute(pool)
            .await?;

            // ADR-010: the FK lives on Debt, so linking is a write to the
            // debt, not a column on this row.
            if let Some(debt) = &b.linked_debt_id {
                let n = sqlx::query!(
                    r#"UPDATE "Debt" SET "linkedExpenseId" = ? WHERE "id" = ?"#,
                    id,
                    debt
                )
                .execute(pool)
                .await?
                .rows_affected();
                if n == 0 {
                    return Err(ApiError::not_found("Linked debt"));
                }
            }
        }
        Kind::Income => {
            sqlx::query!(
                r#"INSERT INTO "Income"
                     ("id","name","amount","frequency","budgetId","accountId","amountSchedule",
                      "startDate","endDate","note","managementUrl","createdAt","updatedAt")
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"#,
                id,
                b.name,
                amount,
                b.frequency,
                b.budget_id,
                b.account_id,
                schedule,
                b.start_date,
                b.end_date,
                b.note,
                b.management_url,
                now,
                now,
            )
            .execute(pool)
            .await?;
        }
    }

    Ok(Response::created(one(pool, kind, &id).await?))
}

// ─── PUT /:id ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct UpdateRecurring {
    name: Option<String>,
    amount: Option<f64>,
    frequency: Option<String>,
    #[serde(rename = "budgetId")]
    budget_id: Option<String>,
    #[serde(deserialize_with = "present", rename = "accountId")]
    account_id: Option<Option<String>>,
    #[serde(rename = "isAutomatic")]
    is_automatic: Option<bool>,
    #[serde(rename = "skipWeekend")]
    skip_weekend: Option<bool>,
    #[serde(deserialize_with = "present", rename = "dueDay")]
    due_day: Option<Option<i64>>,
    #[serde(deserialize_with = "present", rename = "dueWeekday")]
    due_weekday: Option<Option<i64>>,
    #[serde(deserialize_with = "present", rename = "dueOrdinal")]
    due_ordinal: Option<Option<i64>>,
    #[serde(deserialize_with = "present", rename = "amountSchedule")]
    amount_schedule: Option<Option<Value>>,
    #[serde(deserialize_with = "present", rename = "startDate")]
    start_date: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "endDate")]
    end_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    note: Option<Option<String>>,
    #[serde(deserialize_with = "present", rename = "managementUrl")]
    management_url: Option<Option<String>>,
}

/// Did this patch move a **date**, as opposed to only an amount?
///
/// The distinction decides whether SNOOZED rows are cleared alongside PENDING
/// ones, so it is named rather than inlined.
fn moves_dates(b: &UpdateRecurring) -> bool {
    b.frequency.is_some()
        || b.due_day.is_some()
        || b.due_weekday.is_some()
        || b.due_ordinal.is_some()
        || b.start_date.is_some()
        || b.end_date.is_some()
}

pub async fn update(
    pool: &SqlitePool,
    kind: Kind,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateRecurring = crate::body_of(body)?;
    if let Some(n) = &b.name {
        if n.is_empty() || n.chars().count() > 200 {
            return Err(ApiError::bad_request(
                "name must be between 1 and 200 characters",
            ));
        }
    }
    // Checked on update as well as create, deliberately. A rule enforced in one
    // and skipped in the other is the exact defect v0.8 shipped a fix for, and
    // it is the reason `cross_field_issues` takes facts rather than a payload.
    if let Some(f) = &b.frequency {
        check_frequency(f)?;
    }
    // Prove existence before writing, so a missing row is a 404 rather than a
    // silent no-op UPDATE.
    one(pool, kind, id).await?;

    let now = now_iso();
    let amount = b.amount.map(|v| Cents::from_dollars_f64(v).0);
    let schedule_set = b.amount_schedule.is_some() as i64;
    let schedule = b
        .amount_schedule
        .as_ref()
        .and_then(|o| o.as_ref())
        .map(|v| v.to_string());

    let (acct_set, acct) = split_opt(&b.account_id);
    let (start_set, start) = split_opt(&b.start_date);
    let (end_set, end) = split_opt(&b.end_date);
    let (note_set, note) = split_opt(&b.note);
    let (url_set, url) = split_opt(&b.management_url);

    match kind {
        Kind::Expense => {
            let (dd_set, dd) = split_opt_i(&b.due_day);
            let (dw_set, dw) = split_opt_i(&b.due_weekday);
            let (do_set, do_) = split_opt_i(&b.due_ordinal);
            let is_auto = b.is_automatic.map(|v| v as i64);
            let skip_we = b.skip_weekend.map(|v| v as i64);
            sqlx::query!(
                r#"UPDATE "Expense" SET
                     "name" = COALESCE(?1, "name"),
                     "amount" = COALESCE(?2, "amount"),
                     "frequency" = COALESCE(?3, "frequency"),
                     "budgetId" = COALESCE(?4, "budgetId"),
                     "accountId" = CASE WHEN ?5 = 1 THEN ?6 ELSE "accountId" END,
                     "isAutomatic" = COALESCE(?7, "isAutomatic"),
                     "skipWeekend" = COALESCE(?8, "skipWeekend"),
                     "dueDay" = CASE WHEN ?9 = 1 THEN ?10 ELSE "dueDay" END,
                     "dueWeekday" = CASE WHEN ?11 = 1 THEN ?12 ELSE "dueWeekday" END,
                     "dueOrdinal" = CASE WHEN ?13 = 1 THEN ?14 ELSE "dueOrdinal" END,
                     "amountSchedule" = CASE WHEN ?15 = 1 THEN ?16 ELSE "amountSchedule" END,
                     "startDate" = CASE WHEN ?17 = 1 THEN ?18 ELSE "startDate" END,
                     "endDate" = CASE WHEN ?19 = 1 THEN ?20 ELSE "endDate" END,
                     "note" = CASE WHEN ?21 = 1 THEN ?22 ELSE "note" END,
                     "managementUrl" = CASE WHEN ?23 = 1 THEN ?24 ELSE "managementUrl" END,
                     "updatedAt" = ?25
                   WHERE "id" = ?26"#,
                b.name,
                amount,
                b.frequency,
                b.budget_id,
                acct_set,
                acct,
                is_auto,
                skip_we,
                dd_set,
                dd,
                dw_set,
                dw,
                do_set,
                do_,
                schedule_set,
                schedule,
                start_set,
                start,
                end_set,
                end,
                note_set,
                note,
                url_set,
                url,
                now,
                id,
            )
            .execute(pool)
            .await?;
        }
        Kind::Income => {
            sqlx::query!(
                r#"UPDATE "Income" SET
                     "name" = COALESCE(?1, "name"),
                     "amount" = COALESCE(?2, "amount"),
                     "frequency" = COALESCE(?3, "frequency"),
                     "budgetId" = COALESCE(?4, "budgetId"),
                     "accountId" = CASE WHEN ?5 = 1 THEN ?6 ELSE "accountId" END,
                     "amountSchedule" = CASE WHEN ?7 = 1 THEN ?8 ELSE "amountSchedule" END,
                     "startDate" = CASE WHEN ?9 = 1 THEN ?10 ELSE "startDate" END,
                     "endDate" = CASE WHEN ?11 = 1 THEN ?12 ELSE "endDate" END,
                     "note" = CASE WHEN ?13 = 1 THEN ?14 ELSE "note" END,
                     "managementUrl" = CASE WHEN ?15 = 1 THEN ?16 ELSE "managementUrl" END,
                     "updatedAt" = ?17
                   WHERE "id" = ?18"#,
                b.name,
                amount,
                b.frequency,
                b.budget_id,
                acct_set,
                acct,
                schedule_set,
                schedule,
                start_set,
                start,
                end_set,
                end,
                note_set,
                note,
                url_set,
                url,
                now,
                id,
            )
            .execute(pool)
            .await?;
        }
    }

    if moves_dates(&b) {
        invalidate_schedule(pool, kind, id, true).await?;
    } else if b.amount.is_some() || b.amount_schedule.is_some() {
        invalidate_schedule(pool, kind, id, false).await?;
    }
    recompute_linked_budgets(pool, kind, id).await?;

    Ok(Response::ok(one(pool, kind, id).await?))
}

/// `Option<Option<T>>` → `(was it supplied, the value)`.
///
/// A plain `Option` cannot say the difference between "leave this alone" and
/// "set it to NULL", and clearing an account link or an end date are both
/// real operations.
fn split_opt(f: &Option<Option<String>>) -> (i64, Option<String>) {
    match f {
        None => (0, None),
        Some(v) => (1, v.clone()),
    }
}
fn split_opt_i(f: &Option<Option<i64>>) -> (i64, Option<i64>) {
    match f {
        None => (0, None),
        Some(v) => (1, *v),
    }
}

// ─── Lifecycle: pause / resume / archive / restore ───

/// What `PauseModal` actually sends.
///
/// It used to be `{ pausedUntil }` — a shape nothing has ever posted, so every
/// pause deserialised to `None` and wrote NULL. The expiry date is computed
/// server-side from a duration, as the reference does, because the client
/// should not be the thing that knows what "3 months from now" means.
#[derive(Deserialize, Default)]
#[serde(default)]
struct PauseBody {
    duration: Option<i64>,
    unit: Option<String>,
    indefinite: Option<bool>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ResumeBody {
    immediately: Option<bool>,
    #[serde(rename = "resumeDate")]
    resume_date: Option<String>,
}

pub async fn pause(
    pool: &SqlitePool,
    kind: Kind,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: PauseBody = crate::body_of(body.or(Some(json!({}))))?;
    one(pool, kind, id).await?;

    // The reference's `.refine()`: indefinite, or BOTH duration and unit.
    // Rejected rather than silently treated as "pause forever" or "do nothing",
    // which is what an absent date used to mean here.
    let until = avoir_core::pause::compute_paused_until(
        b.duration,
        b.unit.as_deref(),
        b.indefinite.unwrap_or(false),
    )
    .ok_or_else(|| {
        ApiError::bad_request("Provide either indefinite=true or both duration and unit")
    })?;

    let now = now_iso();
    let until = crate::id::date_at_utc_midnight(until);
    match kind {
        Kind::Expense => {
            sqlx::query!(
                r#"UPDATE "Expense" SET "pausedUntil" = ?, "updatedAt" = ? WHERE "id" = ?"#,
                until,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        Kind::Income => {
            sqlx::query!(
                r#"UPDATE "Income" SET "pausedUntil" = ?, "updatedAt" = ? WHERE "id" = ?"#,
                until,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
    }

    // Pausing changes which occurrences are active, so the dates move.
    invalidate_schedule(pool, kind, id, true).await?;
    recompute_linked_budgets(pool, kind, id).await?;
    Ok(Response::ok(one(pool, kind, id).await?))
}

pub async fn resume(
    pool: &SqlitePool,
    kind: Kind,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ResumeBody = crate::body_of(body.or(Some(json!({}))))?;
    let current = one(pool, kind, id).await?;

    // Resuming something that is not paused is a client-state error, not a
    // no-op — reporting it is what lets the UI notice it is out of date.
    if current["pausedUntil"].is_null() {
        return Err(ApiError::bad_request("Source is not currently paused"));
    }

    let now = now_iso();
    let new_start = if b.immediately.unwrap_or(false) {
        Some(crate::id::date_at_utc_midnight(avoir_core::dates::today()))
    } else {
        b.resume_date
    };
    let start_set = new_start.is_some() as i64;

    match kind {
        Kind::Expense => {
            sqlx::query!(
                r#"UPDATE "Expense" SET "pausedUntil" = NULL,
                     "startDate" = CASE WHEN ?1 = 1 THEN ?2 ELSE "startDate" END,
                     "updatedAt" = ?3 WHERE "id" = ?4"#,
                start_set,
                new_start,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        Kind::Income => {
            sqlx::query!(
                r#"UPDATE "Income" SET "pausedUntil" = NULL,
                     "startDate" = CASE WHEN ?1 = 1 THEN ?2 ELSE "startDate" END,
                     "updatedAt" = ?3 WHERE "id" = ?4"#,
                start_set,
                new_start,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
    }

    invalidate_schedule(pool, kind, id, true).await?;
    recompute_linked_budgets(pool, kind, id).await?;
    Ok(Response::ok(one(pool, kind, id).await?))
}

pub async fn archive(pool: &SqlitePool, kind: Kind, id: &str) -> Result<Response, ApiError> {
    let current = one(pool, kind, id).await?;
    if !current["archivedAt"].is_null() {
        return Err(ApiError::conflict("Source is already archived"));
    }

    let now = now_iso();
    match kind {
        Kind::Expense => {
            sqlx::query!(
                r#"UPDATE "Expense" SET "archivedAt" = ?, "updatedAt" = ? WHERE "id" = ?"#,
                now,
                now,
                id
            )
            .execute(pool)
            .await?;
            // An archived expense must stop contributing to the budget
            // baseline. Leaving the link is what makes an archived item keep
            // shaping a budget nobody can see it in.
            sqlx::query!(
                r#"DELETE FROM "BudgetExpenseLink" WHERE "expenseId" = ?"#,
                id
            )
            .execute(pool)
            .await?;
        }
        Kind::Income => {
            sqlx::query!(
                r#"UPDATE "Income" SET "archivedAt" = ?, "updatedAt" = ? WHERE "id" = ?"#,
                now,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
    }

    skip_pending(pool, kind, id).await?;
    recompute_linked_budgets(pool, kind, id).await?;
    Ok(Response::ok(one(pool, kind, id).await?))
}

pub async fn restore(pool: &SqlitePool, kind: Kind, id: &str) -> Result<Response, ApiError> {
    let current = one(pool, kind, id).await?;
    if current["archivedAt"].is_null() {
        return Err(ApiError::conflict("Source is not archived"));
    }

    let now = now_iso();
    match kind {
        Kind::Expense => {
            sqlx::query!(
                r#"UPDATE "Expense" SET "archivedAt" = NULL, "updatedAt" = ? WHERE "id" = ?"#,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
        Kind::Income => {
            sqlx::query!(
                r#"UPDATE "Income" SET "archivedAt" = NULL, "updatedAt" = ? WHERE "id" = ?"#,
                now,
                id
            )
            .execute(pool)
            .await?;
        }
    }
    recompute_linked_budgets(pool, kind, id).await?;
    Ok(Response::ok(one(pool, kind, id).await?))
}

// ─── DELETE /:id ───

pub async fn delete(pool: &SqlitePool, kind: Kind, id: &str) -> Result<Response, ApiError> {
    let current = one(pool, kind, id).await?;

    // Archived items refuse deletion (ADR-004). Restore first — it forces the
    // irreversible step to be a separate, deliberate decision.
    if !current["archivedAt"].is_null() {
        return Err(ApiError::conflict(
            "Cannot delete an archived source. Restore it first.",
        ));
    }

    skip_pending(pool, kind, id).await?;
    let label = kind.label();
    let n = match kind {
        Kind::Expense => sqlx::query!(r#"DELETE FROM "Expense" WHERE "id" = ?"#, id)
            .execute(pool)
            .await?
            .rows_affected(),
        Kind::Income => sqlx::query!(r#"DELETE FROM "Income" WHERE "id" = ?"#, id)
            .execute(pool)
            .await?
            .rows_affected(),
    };
    if n == 0 {
        return Err(ApiError::not_found(label));
    }
    Ok(Response::no_content())
}
