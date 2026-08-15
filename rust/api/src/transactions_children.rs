//! `/transactions/:id/children` and `/transactions/:id/link`.
//!
//! Ported from `routes/transactions.children.ts` and
//! `routes/transactions.linking.ts`.
//!
//! # Why children may bypass the ledger gate, and what pays for it
//!
//! A child carries `parentId`, and **every balance query filters on
//! `parentId IS NULL`** — the balance hook, the chain walk, and all three
//! restatements of the ledger invariant. A child is therefore invisible to
//! every account balance by construction, not by discipline, which is why
//! `transactions.children.ts` is on QUALITY.md's approved list.
//!
//! What that buys has a price: the load-bearing filter is a single column, so a
//! row that acquires a `parentId` disappears from the ledger and a row that
//! loses one reappears in it. Nothing here ever sets `parentId` on an existing
//! row or clears it — children are created as children and deleted as children.
//!
//! # The sum of the parts may not exceed the whole
//!
//! Children are line items on a receipt whose total is the parent. They may sum
//! to less (the rest is unallocated) but never to more, and the check is made
//! against siblings *excluding* the row being edited — otherwise raising a
//! child by a penny is judged against its own old value and refused.
//!
//! # Linking is a ledger update, not a column write
//!
//! `POST /:id/link` goes through `ledger_update`, because attaching a
//! transaction to a recurring expense is what makes the debt-payment hook fire
//! and what the schedule matcher reads. Writing `expenseId` directly would
//! attach the row and run none of it.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Response};
use avoir_core::money::{Cents, Percent};
use avoir_core::tax::{compute_line_total, TaxInput};
use avoir_db::ledger::{ledger_update, LedgerUpdate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

struct Parent {
    ty: String,
    name: String,
    amount: i64,
    date: String,
    account_id: Option<String>,
    pay_period_id: Option<String>,
}

/// A parent a child may be attached to.
///
/// A child of a child would be invisible to the balance twice over and has no
/// meaning; only spending can be itemised, so income and transfers are refused.
async fn splittable_parent(pool: &SqlitePool, id: &str) -> Result<Parent, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "type" AS "ty!", "name" AS "name!", "amount" AS "amount!: i64",
                  "date" AS "date!", "accountId" AS account_id,
                  "payPeriodId" AS pay_period_id, "parentId" AS parent_id
             FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Transaction"))?;

    if r.parent_id.is_some() {
        return Err(ApiError::bad_request("Cannot split a child transaction"));
    }
    if r.ty != "EXPENSE" && r.ty != "REFUND" {
        return Err(ApiError::bad_request(
            "Only EXPENSE and REFUND transactions can be split",
        ));
    }
    Ok(Parent {
        ty: r.ty,
        name: r.name,
        amount: r.amount,
        date: r.date,
        account_id: r.account_id,
        pay_period_id: r.pay_period_id,
    })
}

/// One sub-allocation of a parent transaction.
///
/// A child carries no account, so it never moves a balance and is excluded from
/// the ledger's `parentId IS NULL` filter — which is what lets a purchase be
/// split across budgets without touching the balance chain.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChildShape {
    id: String,
    parent_id: String,
    budget_id: Option<String>,
    /// ZERO when the column is NULL, not null.
    ///
    /// `ChildTransactionSchema` types both of these as a plain `number`, so a
    /// null fails to parse and takes the whole allocation list with it. The
    /// reference coerces (`r.preTaxAmount ? Number(...) : 0`), and zero is the
    /// honest value: a line with no tax recorded has no tax.
    pre_tax_amount: f64,
    tax_amount: f64,
    /// Stored in hundredths of a percent, as every rate in this schema is.
    /// Genuinely nullable — "no rate was given" is different from "0%".
    tax_rate: Option<f64>,
    /// The column is `amount`; the WIRE name is `lineTotal`.
    ///
    /// The port emitted `amount` and no `lineTotal` at all, so every attempt to
    /// split a transaction across budgets threw in the browser:
    ///
    ///   invalid_type, expected number, received undefined, path ["lineTotal"]
    ///
    /// Neither harness could see it. `/transactions/{id}/children` IS exercised
    /// — three times — but production has no split transactions, so every
    /// response was `children: []`, which satisfies the schema trivially and
    /// compares equal to the reference's empty array. A check over data that
    /// lacks the case is blind to defects in that case.
    line_total: f64,
    note: Option<String>,
    created_at: String,
}

/// The children envelope: the allocations, and how much of the parent is left.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChildrenShape {
    children: Vec<ChildShape>,
    remaining_amount: f64,
    parent_amount: f64,
}

#[allow(clippy::too_many_arguments)]
fn child_json(
    id: &str,
    parent_id: &str,
    amount: i64,
    budget_id: Option<&str>,
    pre_tax: Option<i64>,
    tax: Option<i64>,
    rate: Option<i64>,
    note: Option<&str>,
    created_at: &str,
) -> ChildShape {
    ChildShape {
        id: id.to_string(),
        parent_id: parent_id.to_string(),
        budget_id: budget_id.map(str::to_string),
        pre_tax_amount: pre_tax.map_or(0.0, |c| Cents(c).as_dollars_f64()),
        tax_amount: tax.map_or(0.0, |c| Cents(c).as_dollars_f64()),
        tax_rate: rate.map(|r| Percent(r).as_percent_f64()),
        line_total: Cents(amount).as_dollars_f64(),
        note: note.map(str::to_string),
        created_at: created_at.to_string(),
    }
}

async fn read_child(pool: &SqlitePool, id: &str) -> Result<ChildShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "parentId" AS "parent_id!", "amount" AS "amount!: i64",
                  "budgetId" AS budget_id, "preTaxAmount" AS "pre_tax: i64",
                  "taxAmount" AS "tax: i64", "taxRate" AS "rate: i64",
                  "note", "createdAt" AS "created_at!"
             FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    Ok(child_json(
        &r.id,
        &r.parent_id,
        r.amount,
        r.budget_id.as_deref(),
        r.pre_tax,
        r.tax,
        r.rate,
        r.note.as_deref(),
        &r.created_at,
    ))
}

/// What the children add up to, optionally ignoring one of them.
async fn siblings_total(
    pool: &SqlitePool,
    parent_id: &str,
    except: Option<&str>,
) -> Result<i64, ApiError> {
    let except = except.unwrap_or("");
    // Exact: `amount` is INTEGER cents, so SUM cannot drift.
    Ok(sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM("amount"), 0) AS "total!: i64"
             FROM "Transaction" WHERE "parentId" = ?1 AND "id" <> ?2"#,
        parent_id,
        except
    )
    .fetch_one(pool)
    .await?)
}

pub async fn list(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let parent = sqlx::query!(
        r#"SELECT "amount" AS "amount!: i64" FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Transaction"))?;

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "parentId" AS "parent_id!", "amount" AS "amount!: i64",
                  "budgetId" AS budget_id, "preTaxAmount" AS "pre_tax: i64",
                  "taxAmount" AS "tax: i64", "taxRate" AS "rate: i64",
                  "note", "createdAt" AS "created_at!"
             FROM "Transaction" WHERE "parentId" = ? ORDER BY "createdAt" ASC"#,
        id
    )
    .fetch_all(pool)
    .await?;

    let allocated: i64 = rows.iter().map(|r| r.amount).sum();
    Ok(Response::ok(ChildrenShape {
        children: rows
            .iter()
            .map(|r| {
                child_json(
                    &r.id,
                    &r.parent_id,
                    r.amount,
                    r.budget_id.as_deref(),
                    r.pre_tax,
                    r.tax,
                    r.rate,
                    r.note.as_deref(),
                    &r.created_at,
                )
            })
            .collect(),
        remaining_amount: Cents(parent.amount - allocated).as_dollars_f64(),
        parent_amount: Cents(parent.amount).as_dollars_f64(),
    }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ChildBody {
    #[serde(rename = "preTaxAmount")]
    pre_tax_amount: f64,
    #[serde(rename = "taxAmount")]
    tax_amount: Option<f64>,
    #[serde(rename = "taxRate")]
    tax_rate: Option<f64>,
    #[serde(rename = "budgetId")]
    budget_id: Option<String>,
    note: Option<String>,
}

/// The largest line the schema permits. Not arbitrary: `preTaxAmount` is a
/// dollar figure that becomes `i64` cents, and an unbounded `f64` from JSON
/// would overflow the conversion long before it looked wrong to a reader.
const MAX_LINE: f64 = 999_999_999.0;

/// Bounds the `CreateChildTransactionSchema` states and the port did not.
///
/// Every one of these was enforced by Zod on the TypeScript side, and a port
/// that accepts what the original refused is not a port — it is a wider API
/// with the same shape.
fn check_bounds(
    pre_tax: f64,
    tax_amount: Option<f64>,
    tax_rate: Option<f64>,
    note: Option<&str>,
) -> Result<(), ApiError> {
    let bad = |field: &str, message: &str| ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": field, "message": message }])),
    };
    // `<= 0.0` rather than `!(> 0.0)`: the negated form would also catch NaN,
    // but NaN cannot arrive here — `serde_json` rejects NaN, Infinity and
    // out-of-range literals at parse time, verified rather than assumed. So the
    // readable comparison is the safe one.
    if pre_tax <= 0.0 {
        return Err(bad("preTaxAmount", "must be greater than zero"));
    }
    if pre_tax > MAX_LINE {
        return Err(bad("preTaxAmount", "is too large"));
    }
    if tax_amount.is_some_and(|a| a < 0.0) {
        return Err(bad("taxAmount", "must not be negative"));
    }
    if tax_rate.is_some_and(|r| !(0.0..=100.0).contains(&r)) {
        return Err(bad("taxRate", "must be between 0 and 100"));
    }
    if note.is_some_and(|n| n.chars().count() > 500) {
        return Err(bad("note", "must be 500 characters or fewer"));
    }
    Ok(())
}

/// Turn the request's two optional tax fields into the one-of-three the
/// calculation takes.
///
/// They are mutually exclusive: a line has a tax amount or a rate, never both,
/// because supplying both invites them to disagree and gives no rule for which
/// wins.
fn tax_input(amount: Option<f64>, rate: Option<f64>) -> Result<TaxInput, ApiError> {
    match (amount, rate) {
        (Some(_), Some(_)) => Err(ApiError::bad_request(
            "Provide either taxAmount or taxRate, not both",
        )),
        (Some(a), None) => Ok(TaxInput::Amount(Cents::from_dollars_f64(a))),
        (None, Some(r)) => Ok(TaxInput::Rate(Percent::from_percent_f64(r))),
        (None, None) => Ok(TaxInput::None),
    }
}

pub async fn create(
    pool: &SqlitePool,
    parent_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ChildBody = crate::body_of(body)?;
    let parent = splittable_parent(pool, parent_id).await?;
    // A line item with no budget is the thing this feature exists to avoid —
    // splitting a receipt is how spending gets attributed.
    if b.budget_id.as_deref().unwrap_or("").trim().is_empty() {
        return Err(crate::recurring::required("budgetId"));
    }
    check_bounds(
        b.pre_tax_amount,
        b.tax_amount,
        b.tax_rate,
        b.note.as_deref(),
    )?;
    let tax = tax_input(b.tax_amount, b.tax_rate)?;
    let line = compute_line_total(Cents::from_dollars_f64(b.pre_tax_amount), tax);

    let existing = siblings_total(pool, parent_id, None).await?;
    if existing + line.line_total.0 > parent.amount {
        let remaining = Cents(parent.amount - existing).as_dollars_f64();
        return Err(ApiError::bad_request(format!(
            "Child amount exceeds remaining amount of {remaining}"
        )));
    }

    let id = cuid();
    let now = now_iso();
    let rate = match tax {
        TaxInput::Rate(r) => Some(r.0),
        _ => None,
    };
    // A direct insert, not `ledger_create`. `parentId` keeps this row out of
    // every balance query, so there is no side effect for the gate to run —
    // and running one would double-count the parent it belongs to.
    sqlx::query!(
        r#"INSERT INTO "Transaction"
             ("id","parentId","type","name","amount","netAmount","date","accountId",
              "payPeriodId","budgetId","preTaxAmount","taxAmount","taxRate","note",
              "createdAt","imported","isCashBack")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0)"#,
        id,
        parent_id,
        parent.ty,
        parent.name,
        line.line_total.0,
        line.line_total.0,
        parent.date,
        parent.account_id,
        parent.pay_period_id,
        b.budget_id,
        line.pre_tax_amount.0,
        line.tax_amount.0,
        rate,
        b.note,
        now
    )
    .execute(pool)
    .await?;

    Ok(Response::created(read_child(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ChildPatch {
    #[serde(rename = "preTaxAmount")]
    pre_tax_amount: Option<f64>,
    #[serde(rename = "taxAmount")]
    tax_amount: Option<f64>,
    #[serde(rename = "taxRate")]
    tax_rate: Option<f64>,
    #[serde(rename = "budgetId", deserialize_with = "crate::recurring::present")]
    budget_id: Option<Option<String>>,
    #[serde(deserialize_with = "crate::recurring::present")]
    note: Option<Option<String>>,
}

async fn child_of(pool: &SqlitePool, parent_id: &str, child_id: &str) -> Result<(), ApiError> {
    let owner = sqlx::query_scalar!(
        r#"SELECT "parentId" FROM "Transaction" WHERE "id" = ?"#,
        child_id
    )
    .fetch_optional(pool)
    .await?
    .flatten();
    if owner.as_deref() != Some(parent_id) {
        return Err(ApiError::not_found("Child transaction"));
    }
    Ok(())
}

pub async fn update(
    pool: &SqlitePool,
    parent_id: &str,
    child_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ChildPatch = crate::body_of(body)?;
    let parent = sqlx::query!(
        r#"SELECT "amount" AS "amount!: i64" FROM "Transaction" WHERE "id" = ?"#,
        parent_id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Transaction"))?;
    child_of(pool, parent_id, child_id).await?;

    let existing = sqlx::query!(
        r#"SELECT "preTaxAmount" AS "pre_tax: i64", "taxAmount" AS "tax: i64",
                  "taxRate" AS "rate: i64"
             FROM "Transaction" WHERE "id" = ?"#,
        child_id
    )
    .fetch_one(pool)
    .await?;

    // Bounds are checked against what is SUPPLIED, not the merged row: the
    // stored value was already validated when it was written, and re-checking
    // it would refuse an edit to a note on a row that predates a rule.
    check_bounds(
        b.pre_tax_amount.unwrap_or(1.0),
        b.tax_amount,
        b.tax_rate,
        b.note.as_ref().and_then(|o| o.as_deref()),
    )?;
    if b.budget_id
        .as_ref()
        .is_some_and(|v| v.as_deref().unwrap_or("").trim().is_empty())
    {
        return Err(crate::recurring::required("budgetId"));
    }

    let pre_tax = match b.pre_tax_amount {
        Some(v) => Cents::from_dollars_f64(v),
        None => Cents(existing.pre_tax.unwrap_or(0)),
    };

    // Supplying one of the pair clears the other, because they cannot coexist.
    // Supplying neither keeps whichever the row already had — an edit to the
    // note must not silently convert a rate into a fixed amount.
    let tax = match (b.tax_amount, b.tax_rate) {
        (Some(_), Some(_)) => {
            return Err(ApiError::bad_request(
                "Provide either taxAmount or taxRate, not both",
            ))
        }
        (Some(a), None) => TaxInput::Amount(Cents::from_dollars_f64(a)),
        (None, Some(r)) => TaxInput::Rate(Percent::from_percent_f64(r)),
        (None, None) => match (existing.rate, existing.tax) {
            (Some(r), _) => TaxInput::Rate(Percent(r)),
            (None, Some(t)) => TaxInput::Amount(Cents(t)),
            (None, None) => TaxInput::None,
        },
    };
    let line = compute_line_total(pre_tax, tax);

    // Siblings EXCLUDING this child — otherwise raising it by a penny is
    // judged against its own old value and refused.
    let siblings = siblings_total(pool, parent_id, Some(child_id)).await?;
    if siblings + line.line_total.0 > parent.amount {
        return Err(ApiError::bad_request(
            "Updated amount would exceed parent total",
        ));
    }

    let rate = match tax {
        TaxInput::Rate(r) => Some(r.0),
        _ => None,
    };
    sqlx::query!(
        r#"UPDATE "Transaction"
              SET "amount" = ?1, "netAmount" = ?1,
                  "preTaxAmount" = ?2, "taxAmount" = ?3, "taxRate" = ?4,
                  "budgetId" = CASE WHEN ?5 THEN ?6 ELSE "budgetId" END,
                  "note" = CASE WHEN ?7 THEN ?8 ELSE "note" END
            WHERE "id" = ?9"#,
        line.line_total.0,
        line.pre_tax_amount.0,
        line.tax_amount.0,
        rate,
        b.budget_id.is_some(),
        b.budget_id.and_then(|o| o),
        b.note.is_some(),
        b.note.and_then(|o| o),
        child_id
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(read_child(pool, child_id).await?))
}

pub async fn delete(
    pool: &SqlitePool,
    parent_id: &str,
    child_id: &str,
) -> Result<Response, ApiError> {
    let exists = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Transaction" WHERE "id" = ?"#,
        parent_id
    )
    .fetch_one(pool)
    .await?;
    if exists == 0 {
        return Err(ApiError::not_found("Transaction"));
    }
    child_of(pool, parent_id, child_id).await?;

    sqlx::query!(r#"DELETE FROM "Transaction" WHERE "id" = ?"#, child_id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ═══ Linking ═══

#[derive(Deserialize, Default)]
#[serde(default)]
struct LinkBody {
    #[serde(rename = "expenseId")]
    expense_id: Option<String>,
    #[serde(rename = "incomeId")]
    income_id: Option<String>,
}

/// Attach a transaction to the recurring expense or income it settles.
///
/// **One transaction per occurrence.** A second row claiming the same source on
/// the same date would make the schedule show one bill paid twice and the other
/// unpaid, so it is refused with a 409 rather than silently accepted.
pub async fn link(pool: &SqlitePool, id: &str, body: Option<Value>) -> Result<Response, ApiError> {
    let b: LinkBody = crate::body_of(body)?;
    let date = sqlx::query_scalar!(
        r#"SELECT "date" AS "date!" FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Transaction"))?;

    if b.expense_id.is_none() && b.income_id.is_none() {
        return Err(ApiError::bad_request(
            "An expenseId or an incomeId is required",
        ));
    }

    let mut budget_id: Option<String> = None;

    if let Some(expense_id) = &b.expense_id {
        budget_id = Some(
            sqlx::query_scalar!(
                r#"SELECT "budgetId" AS "budget_id!" FROM "Expense" WHERE "id" = ?"#,
                expense_id
            )
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| ApiError::not_found("Expense"))?,
        );
        let clash = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "Transaction"
                WHERE "expenseId" = ?1 AND "date" = ?2 AND "id" <> ?3"#,
            expense_id,
            date,
            id
        )
        .fetch_one(pool)
        .await?;
        if clash > 0 {
            return Err(ApiError::conflict(
                "Another transaction is already linked to this expense for this occurrence date",
            ));
        }
    }

    if let Some(income_id) = &b.income_id {
        budget_id = Some(
            sqlx::query_scalar!(
                r#"SELECT "budgetId" AS "budget_id!" FROM "Income" WHERE "id" = ?"#,
                income_id
            )
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| ApiError::not_found("Income"))?,
        );
        let clash = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "Transaction"
                WHERE "incomeId" = ?1 AND "date" = ?2 AND "id" <> ?3"#,
            income_id,
            date,
            id
        )
        .fetch_one(pool)
        .await?;
        if clash > 0 {
            return Err(ApiError::conflict(
                "Another transaction is already linked to this income for this occurrence date",
            ));
        }
    }

    // Through the gate. Linking is what makes the debt-payment hook fire and
    // what the schedule matcher reads, so a direct column write would attach
    // the row and run none of it.
    //
    // **Scoped deliberately.** The pool holds ONE connection, so a handler that
    // still owns it when it calls something taking `&SqlitePool` deadlocks
    // against itself — the second acquire waits for a connection the first will
    // not release until the function returns. It cost four tests here to find,
    // and it fails as a timeout rather than an error, which reads like a slow
    // query rather than a bug.
    {
        let mut conn = pool.acquire().await?;
        ledger_update(
            &mut conn,
            id,
            &LedgerUpdate {
                expense_id: Some(b.expense_id.clone()),
                income_id: Some(b.income_id.clone()),
                budget_id: budget_id.map(Some),
                ..Default::default()
            },
        )
        .await
        .map_err(ApiError::from)?;
    }

    Ok(Response::ok(
        crate::transactions::fetch_serialized_pub(pool, id).await?,
    ))
}

pub async fn unlink(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "expenseId" AS expense_id, "incomeId" AS income_id
             FROM "Transaction" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Transaction"))?;

    if r.expense_id.is_none() && r.income_id.is_none() {
        return Err(ApiError::bad_request(
            "Transaction is not linked to any recurring source",
        ));
    }

    // The budget is deliberately left alone. It was set from the source when
    // the link was made, but the user may have changed it since, and unlinking
    // says nothing about where the money should be counted.
    // Scoped for the same reason as `link` — one connection, so it has to be
    // released before the serializer asks the pool for one.
    {
        let mut conn = pool.acquire().await?;
        ledger_update(
            &mut conn,
            id,
            &LedgerUpdate {
                expense_id: Some(None),
                income_id: Some(None),
                ..Default::default()
            },
        )
        .await
        .map_err(ApiError::from)?;
    }

    Ok(Response::ok(
        crate::transactions::fetch_serialized_pub(pool, id).await?,
    ))
}
