//! `/debts` and `/debts/:id/escrow`.
//!
//! Ported from `routes/debts.ts` and `routes/escrow.ts`. The arithmetic —
//! payment splitting, amortization, payoff estimation — is already in
//! `avoir_core::debt` from step 2; this is the data layer around it.
//!
//! # The recorded payment outranks the reconstructed one (ADR-031)
//!
//! `resolve_base_payment` trusts the stored `minimumPayment` and falls back to
//! the PMT formula only when none is recorded. ADR-023 originally had it the
//! other way round, and it was wrong on every debt where the stored terms are
//! not exactly the lender's — production showed a derived figure against a real
//! the real payment. **The same helper is used by the per-debt figure and by the
//! summary total**, because they appear on the same screen and a second copy
//! of the rule would let them disagree.
//!
//! # Escrow reads need a `createdAt` tie-break (ADR-032)
//!
//! Editing escrow inserts a new row rather than updating the existing one, so
//! one period accumulates several records — production reached five rows all
//! dated 2026-08-01. Ordering by `periodStartDate` alone leaves them tied, and
//! a tie has no defined order in SQL. The symptom was an escrow edit that
//! appeared not to save: the write had succeeded and the read could not see
//! it, which sent the original investigation to the wrong half of the code.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::debt::{
    self, estimate_payoff_date, generate_amortization, months_remaining, resolve_base_payment,
    BasePaymentInput, DebtInput, Frequency,
};
use avoir_core::money::{Cents, Percent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

fn parse_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

struct DebtRow {
    id: String,
    name: String,
    r#type: String,
    original_balance: i64,
    current_balance: i64,
    apr: i64,
    minimum_payment: i64,
    frequency: String,
    start_date: String,
    maturity_date: Option<String>,
    term_months: Option<i64>,
    linked_expense_id: Option<String>,
    linked_account_id: Option<String>,
    paid_off: i64,
    escrow_enabled: i64,
    note: Option<String>,
    management_url: Option<String>,
    created_at: String,
    updated_at: String,
}

async fn fetch_debt(pool: &SqlitePool, id: &str) -> Result<DebtRow, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "type!",
                  "originalBalance" AS "original_balance!: i64",
                  "currentBalance" AS "current_balance!: i64", "apr" AS "apr!: i64",
                  "minimumPayment" AS "minimum_payment!: i64", "frequency" AS "frequency!",
                  "startDate" AS "start_date!", "maturityDate" AS "maturity_date: String",
                  "termMonths" AS "term_months: i64",
                  "linkedExpenseId" AS "linked_expense_id: String",
                  "linkedAccountId" AS "linked_account_id: String",
                  "paidOff" AS "paid_off!: i64", "escrowEnabled" AS "escrow_enabled!: i64",
                  "note" AS "note: String", "managementUrl" AS "management_url: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Debt" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Debt"))?;

    Ok(DebtRow {
        id: r.id,
        name: r.name,
        r#type: r.r#type,
        original_balance: r.original_balance,
        current_balance: r.current_balance,
        apr: r.apr,
        minimum_payment: r.minimum_payment,
        frequency: r.frequency,
        start_date: r.start_date,
        maturity_date: r.maturity_date,
        term_months: r.term_months,
        linked_expense_id: r.linked_expense_id,
        linked_account_id: r.linked_account_id,
        paid_off: r.paid_off,
        escrow_enabled: r.escrow_enabled,
        note: r.note,
        management_url: r.management_url,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// The current monthly escrow for a debt, or zero.
///
/// The `createdAt` tie-break is required, not decoration — see the module
/// docs and ADR-032.
async fn current_escrow(pool: &SqlitePool, debt_id: &str) -> Result<Cents, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "monthlyAmount" AS "amount!: i64" FROM "EscrowRecord"
            WHERE "debtId" = ?
            ORDER BY "periodStartDate" DESC, "createdAt" DESC LIMIT 1"#,
        debt_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(r.map(|r| Cents(r.amount)).unwrap_or(Cents::ZERO))
}

/// The escrow record currently in force, serialized, or null.
///
/// Same ordering as `current_escrow` and for the same reason (ADR-032): editing
/// escrow inserts a new row rather than updating, so a period accumulates
/// records and a tie on `periodStartDate` has no defined order without the
/// `createdAt` tie-break.
async fn current_escrow_record(
    pool: &SqlitePool,
    debt_id: &str,
) -> Result<Option<EscrowShape>, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "debtId" AS "debt_id!", "monthlyAmount" AS "amount!: i64",
                  "periodStartDate" AS "start!", "periodEndDate" AS "end!",
                  "createdAt" AS "created!", "updatedAt" AS "updated!"
             FROM "EscrowRecord" WHERE "debtId" = ?
            ORDER BY "periodStartDate" DESC, "createdAt" DESC LIMIT 1"#,
        debt_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(match r {
        Some(r) => Some(escrow_json(
            &r.id, &r.debt_id, r.amount, &r.start, &r.end, &r.created, &r.updated,
        )),
        None => None,
    })
}

fn to_input(d: &DebtRow) -> DebtInput {
    DebtInput {
        current_balance: Cents(d.current_balance),
        apr: Percent(d.apr),
        minimum_payment: Cents(d.minimum_payment),
        frequency: Frequency::from_stored(&d.frequency),
        term_months: d.term_months,
        maturity_date: d.maturity_date.as_deref().and_then(parse_date),
        start_date: parse_date(&d.start_date),
        original_balance: Some(Cents(d.original_balance)),
    }
}

/// The principal-and-interest figure this debt is amortized and displayed at.
fn p_and_i(d: &DebtRow) -> Cents {
    resolve_base_payment(&BasePaymentInput {
        minimum_payment: Cents(d.minimum_payment),
        original_balance: Some(Cents(d.original_balance)),
        apr: Percent(d.apr),
        term_months: d.term_months,
        frequency: Frequency::from_stored(&d.frequency),
    })
}

/// The `/debts/summary` figures.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebtSummaryShape {
    total_balance: f64,
    total_minimum_monthly: f64,
    debt_free_date: Option<String>,
    active_count: i64,
    paid_off_count: i64,
}

/// One period of the amortization schedule.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AmortEntryShape {
    /// `month`, not `period`. `AmortizationEntrySchema` requires `month` and it
    /// is NOT optional, so the old name made Zod throw and the amortization
    /// view rendered nothing. The core type calls it `period` because a
    /// schedule can be biweekly; the wire name is the client's to choose, and
    /// this rename is the one place that translation happens.
    month: u32,
    payment_amount: f64,
    principal_amount: f64,
    interest_amount: f64,
    escrow_amount: f64,
    remaining_balance: f64,
}

/// The amortization envelope.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AmortShape {
    debt_id: String,
    entries: Vec<AmortEntryShape>,
    total_interest: f64,
    total_payments: f64,
    total_escrow: f64,
    payoff_date: Option<String>,
    months_remaining: u32,
    is_negatively_amortizing: bool,
}

/// What an extra payment did: the rows it wrote and where the balance landed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtraPaymentShape {
    transaction_id: String,
    debt_payment_id: String,
    principal_amount: f64,
    interest_amount: f64,
    new_balance: f64,
    paid_off: bool,
}

/// One escrow record.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EscrowShape {
    id: String,
    debt_id: String,
    monthly_amount: f64,
    period_start_date: String,
    period_end_date: String,
    created_at: String,
    updated_at: String,
}

/// A debt, as the write routes echo it back.
///
/// The three shapes below COMPOSE with `#[serde(flatten)]` rather than being
/// built and then patched. The previous code did the latter — `v["estimated
/// PayoffDate"] = …` and `obj.insert("totalPrincipalPaid", …)` — which means
/// the true shape of a detail response existed nowhere, only as the sum of a
/// base object and three mutations scattered through two functions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebtShape {
    id: String,
    name: String,
    #[serde(rename = "type")]
    kind: String,
    original_balance: f64,
    current_balance: f64,
    apr: f64,
    minimum_payment: f64,
    frequency: String,
    start_date: String,
    maturity_date: Option<String>,
    term_months: Option<i64>,
    linked_expense_id: Option<String>,
    linked_account_id: Option<String>,
    paid_off: bool,
    escrow_enabled: bool,
    note: Option<String>,
    management_url: Option<String>,
    created_at: String,
    updated_at: String,
    /// P&I plus current escrow. Escrow is a pass-through added on top and is
    /// never part of P&I — folding it in is the double-count ADR-023 was
    /// written about.
    monthly_payment: f64,
}

/// A debt as the READ routes return it: the base plus a projected payoff date.
///
/// Write routes deliberately omit the payoff date — the reference adds it on
/// list and get only, and a create echoing back what it just stored has no
/// business projecting.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebtReadShape {
    #[serde(flatten)]
    debt: DebtShape,
    estimated_payoff_date: Option<String>,
}

/// The detail route: what has been paid, and how much is left.
///
/// Only the detail route carries these — the list does not, and adding them
/// there would mean a payments query per row.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DebtDetailShape {
    #[serde(flatten)]
    debt: DebtReadShape,
    total_principal_paid: f64,
    total_interest_paid: f64,
    months_remaining: u32,
    current_escrow_record: Option<EscrowShape>,
}

fn serialize(d: &DebtRow, escrow: Cents) -> DebtShape {
    let monthly = p_and_i(d) + escrow;
    DebtShape {
        id: d.id.clone(),
        name: d.name.clone(),
        kind: d.r#type.clone(),
        original_balance: Cents(d.original_balance).as_dollars_f64(),
        current_balance: Cents(d.current_balance).as_dollars_f64(),
        apr: Percent(d.apr).as_percent_f64(),
        minimum_payment: Cents(d.minimum_payment).as_dollars_f64(),
        frequency: d.frequency.clone(),
        start_date: d.start_date.clone(),
        maturity_date: d.maturity_date.clone(),
        term_months: d.term_months,
        linked_expense_id: d.linked_expense_id.clone(),
        linked_account_id: d.linked_account_id.clone(),
        paid_off: d.paid_off != 0,
        escrow_enabled: d.escrow_enabled != 0,
        note: d.note.clone(),
        management_url: d.management_url.clone(),
        created_at: d.created_at.clone(),
        updated_at: d.updated_at.clone(),
        monthly_payment: monthly.as_dollars_f64(),
    }
}

/// One debt, as the READ routes return it.
///
/// `estimatedPayoffDate` belongs here rather than only on the detail route,
/// because the list shows it too — the debts page prints a payoff date on every
/// row. It was absent from both until the differential harness compared them
/// against the reference on 2026-08-11.
///
/// The WRITE routes use `debt_written_json` below instead. In the reference,
/// create and update call `serializeDebt(record)` bare while list and get add
/// the payoff date on top, so the shape genuinely differs by route — and a
/// payoff date is a projection from the loan's terms, which a create echoing
/// back what it just stored has no business computing.
async fn debt_json(pool: &SqlitePool, id: &str) -> Result<DebtReadShape, ApiError> {
    let d = fetch_debt(pool, id).await?;
    let escrow = if d.escrow_enabled != 0 {
        current_escrow(pool, id).await?
    } else {
        Cents::ZERO
    };
    // A paid-off debt has no payoff date rather than one in the past.
    let estimated_payoff_date = if d.current_balance > 0 {
        let today = avoir_core::dates::today();
        estimate_payoff_date(&to_input(&d), today, Cents::ZERO, today)
            .map(crate::id::date_at_utc_midnight)
    } else {
        None
    };
    Ok(DebtReadShape {
        debt: serialize(&d, escrow),
        estimated_payoff_date,
    })
}

/// One debt, as `POST` and `PUT` echo it back: no `estimatedPayoffDate`.
async fn debt_written_json(pool: &SqlitePool, id: &str) -> Result<DebtShape, ApiError> {
    let d = fetch_debt(pool, id).await?;
    let escrow = if d.escrow_enabled != 0 {
        current_escrow(pool, id).await?
    } else {
        Cents::ZERO
    };
    Ok(serialize(&d, escrow))
}

/// The detail route's extra fields: what has been paid, and how much is left.
///
/// Only the detail route carries these — the list does not, and adding them
/// there would mean a payments query per row.
async fn debt_detail_json(pool: &SqlitePool, id: &str) -> Result<DebtDetailShape, ApiError> {
    let v = debt_json(pool, id).await?;
    let d = fetch_debt(pool, id).await?;

    let paid = sqlx::query!(
        r#"SELECT COALESCE(SUM("principalAmount"), 0) AS "principal!: i64",
                  COALESCE(SUM("interestAmount"), 0) AS "interest!: i64"
             FROM "DebtPayment" WHERE "debtId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;

    let months = if d.current_balance > 0 {
        let today = avoir_core::dates::today();
        months_remaining(&to_input(&d), Cents::ZERO, today)
    } else {
        0
    };

    let escrow_record = if d.escrow_enabled != 0 {
        current_escrow_record(pool, id).await?
    } else {
        None
    };

    Ok(DebtDetailShape {
        debt: v,
        total_principal_paid: Cents(paid.principal).as_dollars_f64(),
        total_interest_paid: Cents(paid.interest).as_dollars_f64(),
        months_remaining: months,
        current_escrow_record: escrow_record,
    })
}

// ─── GET /summary ───

pub async fn summary(pool: &SqlitePool) -> Result<Response, ApiError> {
    let ids = sqlx::query!(r#"SELECT "id" AS "id!", "paidOff" AS "paid!: i64" FROM "Debt""#)
        .fetch_all(pool)
        .await?;
    let paid_off_count = ids.iter().filter(|r| r.paid != 0).count() as i64;

    let mut total_balance = Cents::ZERO;
    let mut total_monthly = Cents::ZERO;
    let mut active = 0i64;
    let mut debt_free: Option<chrono::NaiveDate> = None;
    let today = avoir_core::dates::today();

    for r in ids.iter().filter(|r| r.paid == 0) {
        active += 1;
        let d = fetch_debt(pool, &r.id).await?;
        total_balance += Cents(d.current_balance);

        // The same helper `serialize` uses. This total appears on the same
        // page as the rows it sums, so a second copy of the rule here would
        // let the summary disagree with the figures above it.
        let escrow = if d.escrow_enabled != 0 {
            current_escrow(pool, &d.id).await?
        } else {
            Cents::ZERO
        };
        total_monthly += p_and_i(&d) + escrow;

        if d.current_balance > 0 {
            if let Some(payoff) = estimate_payoff_date(&to_input(&d), today, Cents::ZERO, today) {
                // The debt-free date is the LAST payoff, not the first.
                if debt_free.is_none_or(|cur| payoff > cur) {
                    debt_free = Some(payoff);
                }
            }
        }
    }

    Ok(Response::ok(DebtSummaryShape {
        total_balance: total_balance.as_dollars_f64(),
        total_minimum_monthly: total_monthly.as_dollars_f64(),
        debt_free_date: debt_free.map(crate::id::date_at_utc_midnight),
        active_count: active,
        paid_off_count,
    }))
}

// ─── GET / ───

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let include_paid = p.query_bool("includePaidOff").unwrap_or(false) as i64;
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "Debt"
            WHERE (?1 = 1 OR "paidOff" = 0)
            ORDER BY "name" ASC"#,
        include_paid
    )
    .fetch_all(pool)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(debt_json(pool, &r.id).await?);
    }
    Ok(Response::ok(out))
}

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    Ok(Response::ok(debt_detail_json(pool, id).await?))
}

// ─── POST / and PUT /:id ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateDebt {
    name: String,
    r#type: String,
    #[serde(rename = "originalBalance")]
    original_balance: f64,
    #[serde(rename = "currentBalance")]
    current_balance: Option<f64>,
    apr: f64,
    #[serde(rename = "minimumPayment")]
    minimum_payment: f64,
    frequency: String,
    #[serde(rename = "startDate")]
    start_date: String,
    #[serde(rename = "maturityDate")]
    maturity_date: Option<String>,
    #[serde(rename = "termMonths")]
    term_months: Option<i64>,
    #[serde(rename = "linkedExpenseId")]
    linked_expense_id: Option<String>,
    #[serde(rename = "linkedAccountId")]
    linked_account_id: Option<String>,
    #[serde(rename = "escrowEnabled")]
    escrow_enabled: Option<bool>,
    note: Option<String>,
    #[serde(rename = "managementUrl")]
    management_url: Option<String>,
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: CreateDebt = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if b.frequency.is_empty() {
        return Err(crate::recurring::required("frequency"));
    }
    if b.start_date.is_empty() {
        return Err(crate::recurring::required("startDate"));
    }

    let id = cuid();
    let now = now_iso();
    let original = Cents::from_dollars_f64(b.original_balance).0;
    // A new debt has been paid down to whatever the user says it is; absent
    // that, it is at its original balance.
    let current = b
        .current_balance
        .map(|v| Cents::from_dollars_f64(v).0)
        .unwrap_or(original);
    let apr = Percent::from_percent_f64(b.apr).0;
    let minimum = Cents::from_dollars_f64(b.minimum_payment).0;
    let escrow = b.escrow_enabled.unwrap_or(false) as i64;

    sqlx::query!(
        r#"INSERT INTO "Debt"
             ("id","name","type","originalBalance","currentBalance","apr","minimumPayment",
              "frequency","startDate","linkedExpenseId","linkedAccountId","paidOff","note",
              "createdAt","updatedAt","maturityDate","termMonths","managementUrl","escrowEnabled")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)"#,
        id,
        b.name,
        b.r#type,
        original,
        current,
        apr,
        minimum,
        b.frequency,
        b.start_date,
        b.linked_expense_id,
        b.linked_account_id,
        b.note,
        now,
        now,
        b.maturity_date,
        b.term_months,
        b.management_url,
        escrow
    )
    .execute(pool)
    .await?;

    Ok(Response::created(debt_written_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct DebtPatch {
    name: Option<String>,
    r#type: Option<String>,
    #[serde(rename = "originalBalance")]
    original_balance: Option<f64>,
    #[serde(rename = "currentBalance")]
    current_balance: Option<f64>,
    apr: Option<f64>,
    #[serde(rename = "minimumPayment")]
    minimum_payment: Option<f64>,
    frequency: Option<String>,
    #[serde(rename = "startDate")]
    start_date: Option<String>,
    #[serde(
        default,
        deserialize_with = "crate::recurring::present",
        rename = "maturityDate"
    )]
    maturity_date: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::recurring::present",
        rename = "termMonths"
    )]
    term_months: Option<Option<i64>>,
    #[serde(
        default,
        deserialize_with = "crate::recurring::present",
        rename = "linkedExpenseId"
    )]
    linked_expense_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::recurring::present",
        rename = "linkedAccountId"
    )]
    linked_account_id: Option<Option<String>>,
    #[serde(rename = "paidOff")]
    paid_off: Option<bool>,
    #[serde(rename = "escrowEnabled")]
    escrow_enabled: Option<bool>,
    #[serde(default, deserialize_with = "crate::recurring::present")]
    note: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::recurring::present",
        rename = "managementUrl"
    )]
    management_url: Option<Option<String>>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: DebtPatch = crate::body_of(body)?;
    fetch_debt(pool, id).await?;

    let now = now_iso();
    let original = b.original_balance.map(|v| Cents::from_dollars_f64(v).0);
    let current = b.current_balance.map(|v| Cents::from_dollars_f64(v).0);
    let apr = b.apr.map(|v| Percent::from_percent_f64(v).0);
    let minimum = b.minimum_payment.map(|v| Cents::from_dollars_f64(v).0);
    let paid_off = b.paid_off.map(|v| v as i64);
    let escrow = b.escrow_enabled.map(|v| v as i64);

    let (mat_set, mat) = split_opt(&b.maturity_date);
    let (exp_set, exp) = split_opt(&b.linked_expense_id);
    let (acct_set, acct) = split_opt(&b.linked_account_id);
    let (note_set, note) = split_opt(&b.note);
    let (url_set, url) = split_opt(&b.management_url);
    let (term_set, term) = match &b.term_months {
        None => (0i64, None),
        Some(v) => (1, *v),
    };

    sqlx::query!(
        r#"UPDATE "Debt" SET
             "name" = COALESCE(?1, "name"),
             "type" = COALESCE(?2, "type"),
             "originalBalance" = COALESCE(?3, "originalBalance"),
             "currentBalance" = COALESCE(?4, "currentBalance"),
             "apr" = COALESCE(?5, "apr"),
             "minimumPayment" = COALESCE(?6, "minimumPayment"),
             "frequency" = COALESCE(?7, "frequency"),
             "startDate" = COALESCE(?8, "startDate"),
             "maturityDate" = CASE WHEN ?9 = 1 THEN ?10 ELSE "maturityDate" END,
             "termMonths" = CASE WHEN ?11 = 1 THEN ?12 ELSE "termMonths" END,
             "linkedExpenseId" = CASE WHEN ?13 = 1 THEN ?14 ELSE "linkedExpenseId" END,
             "linkedAccountId" = CASE WHEN ?15 = 1 THEN ?16 ELSE "linkedAccountId" END,
             "paidOff" = COALESCE(?17, "paidOff"),
             "escrowEnabled" = COALESCE(?18, "escrowEnabled"),
             "note" = CASE WHEN ?19 = 1 THEN ?20 ELSE "note" END,
             "managementUrl" = CASE WHEN ?21 = 1 THEN ?22 ELSE "managementUrl" END,
             "updatedAt" = ?23
           WHERE "id" = ?24"#,
        b.name,
        b.r#type,
        original,
        current,
        apr,
        minimum,
        b.frequency,
        b.start_date,
        mat_set,
        mat,
        term_set,
        term,
        exp_set,
        exp,
        acct_set,
        acct,
        paid_off,
        escrow,
        note_set,
        note,
        url_set,
        url,
        now,
        id
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(debt_written_json(pool, id).await?))
}

fn split_opt(f: &Option<Option<String>>) -> (i64, Option<String>) {
    match f {
        None => (0, None),
        Some(v) => (1, v.clone()),
    }
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    fetch_debt(pool, id).await?;
    // EscrowRecord and DebtPayment both cascade from Debt, so removing the
    // debt takes its schedule history with it.
    sqlx::query!(r#"DELETE FROM "Debt" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ─── GET /:id/amortization ───

pub async fn amortization(pool: &SqlitePool, id: &str, p: &Path<'_>) -> Result<Response, ApiError> {
    let d = fetch_debt(pool, id).await?;
    let extra = Cents::from_dollars_f64(
        p.query("extraPayment")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0),
    );
    let override_escrow = Cents::from_dollars_f64(
        p.query("escrow")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0),
    );

    // An explicit override beats the recorded record — the schedule page lets
    // you ask "what if escrow were X".
    let escrow = if override_escrow.0 > 0 {
        override_escrow
    } else if d.escrow_enabled != 0 {
        current_escrow(pool, id).await?
    } else {
        Cents::ZERO
    };

    let input = to_input(&d);
    let today = avoir_core::dates::today();
    let result = generate_amortization(&input, extra, escrow, today);
    let payoff = if d.current_balance > 0 {
        estimate_payoff_date(&input, today, extra, today)
    } else {
        None
    };

    let entries: Vec<AmortEntryShape> = result
        .entries
        .iter()
        .map(|e| AmortEntryShape {
            month: e.period,
            payment_amount: e.payment_amount.as_dollars_f64(),
            principal_amount: e.principal_amount.as_dollars_f64(),
            interest_amount: e.interest_amount.as_dollars_f64(),
            escrow_amount: e.escrow_amount.as_dollars_f64(),
            remaining_balance: e.remaining_balance.as_dollars_f64(),
        })
        .collect();

    Ok(Response::ok(AmortShape {
        debt_id: id.to_string(),
        entries,
        total_interest: result.total_interest.as_dollars_f64(),
        total_payments: result.total_payments.as_dollars_f64(),
        total_escrow: result.total_escrow.as_dollars_f64(),
        payoff_date: payoff.map(crate::id::date_at_utc_midnight),
        months_remaining: result.payoff_periods,
        is_negatively_amortizing: result.is_negatively_amortizing,
    }))
}

// ─── POST /:id/extra-payment ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct ExtraPayment {
    amount: f64,
    date: String,
    #[serde(rename = "accountId")]
    account_id: Option<String>,
    note: Option<String>,
}

pub async fn extra_payment(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ExtraPayment = crate::body_of(body)?;
    if b.date.is_empty() {
        return Err(crate::recurring::required("date"));
    }
    let d = fetch_debt(pool, id).await?;
    if d.paid_off != 0 {
        return Err(ApiError::bad_request("Debt is already paid off"));
    }

    // Where the money comes from: the caller's choice, else the debt's linked
    // account, else nowhere (a payment recorded without a funding account).
    let account_id = b.account_id.clone().or(d.linked_account_id.clone());

    // Which budget it lands in: the linked expense's, else Uncategorized. An
    // extra payment is still spending and has to be categorised as something.
    let mut budget_id: Option<String> = None;
    if let Some(eid) = &d.linked_expense_id {
        budget_id = sqlx::query!(
            r#"SELECT "budgetId" AS "budget_id!" FROM "Expense" WHERE "id" = ?"#,
            eid
        )
        .fetch_optional(pool)
        .await?
        .map(|r| r.budget_id);
    }
    if budget_id.is_none() {
        budget_id = sqlx::query!(
            r#"SELECT "id" AS "id!" FROM "Budget"
                WHERE "name" = 'Uncategorized' AND "isSystem" = 1 LIMIT 1"#
        )
        .fetch_optional(pool)
        .await?
        .map(|r| r.id);
    }

    let amount = Cents::from_dollars_f64(b.amount);
    let tx_id = cuid();
    let now = now_iso();

    // Through the gate, so the balance chain and every hook run.
    let mut conn = pool.acquire().await?;
    avoir_db::ledger::ledger_create(
        &mut conn,
        &avoir_db::ledger::LedgerCreate {
            id: tx_id.clone(),
            name: format!("{} Extra Payment", d.name),
            amount,
            date: b.date.clone(),
            created_at: now.clone(),
            tx_type: "EXPENSE".into(),
            account_id,
            to_account_id: None,
            parent_id: None,
            budget_id,
            expense_id: None,
            trade: None,
            bitcoin: None,
            occurrence_date: None,
            note: None,
            purchase_group_id: None,
        },
    )
    .await?;
    drop(conn);

    if let Some(note) = &b.note {
        sqlx::query!(
            r#"UPDATE "Transaction" SET "note" = ? WHERE "id" = ?"#,
            note,
            tx_id
        )
        .execute(pool)
        .await?;
    }

    // Interest first, then principal — the same split an ordinary payment
    // takes, so an extra payment reduces the balance by exactly what it should
    // rather than by its full face value.
    let split = debt::split_payment(
        Cents(d.current_balance),
        Percent(d.apr),
        amount,
        Frequency::from_stored(&d.frequency),
    );
    let new_balance = (d.current_balance - split.principal.0).max(0);

    let payment_id = cuid();
    let mut tx = pool.begin().await?;
    sqlx::query!(
        // No totalAmount column: the total is principal + interest by
        // definition, and storing it separately invites the two to disagree.
        r#"INSERT INTO "DebtPayment"
             ("id","debtId","transactionId","principalAmount","interestAmount",
              "date","createdAt")
           VALUES (?,?,?,?,?,?,?)"#,
        payment_id,
        id,
        tx_id,
        split.principal.0,
        split.interest.0,
        b.date,
        now
    )
    .execute(&mut *tx)
    .await?;
    // Reaching zero marks the debt paid off — otherwise it lingers as an
    // active debt with no balance.
    let paid = (new_balance <= 0) as i64;
    sqlx::query!(
        r#"UPDATE "Debt" SET "currentBalance" = ?1, "paidOff" = ?2, "updatedAt" = ?3
            WHERE "id" = ?4"#,
        new_balance,
        paid,
        now,
        id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Response::created(ExtraPaymentShape {
        transaction_id: tx_id,
        debt_payment_id: payment_id,
        principal_amount: split.principal.as_dollars_f64(),
        interest_amount: split.interest.as_dollars_f64(),
        new_balance: Cents(new_balance).as_dollars_f64(),
        paid_off: paid != 0,
    }))
}

// ═══ Escrow ═══

fn escrow_json(
    id: &str,
    debt_id: &str,
    amount: i64,
    start: &str,
    end: &str,
    created: &str,
    updated: &str,
) -> EscrowShape {
    EscrowShape {
        id: id.to_string(),
        debt_id: debt_id.to_string(),
        monthly_amount: Cents(amount).as_dollars_f64(),
        period_start_date: start.to_string(),
        period_end_date: end.to_string(),
        created_at: created.to_string(),
        updated_at: updated.to_string(),
    }
}

pub async fn list_escrow(pool: &SqlitePool, debt_id: &str) -> Result<Response, ApiError> {
    fetch_debt(pool, debt_id).await?;
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "debtId" AS "debt_id!", "monthlyAmount" AS "amount!: i64",
                  "periodStartDate" AS "start!", "periodEndDate" AS "end!",
                  "createdAt" AS "created!", "updatedAt" AS "updated!"
             FROM "EscrowRecord" WHERE "debtId" = ?
            ORDER BY "periodStartDate" DESC, "createdAt" DESC"#,
        debt_id
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| {
                escrow_json(
                    &r.id, &r.debt_id, r.amount, &r.start, &r.end, &r.created, &r.updated,
                )
            })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct EscrowBody {
    #[serde(rename = "monthlyAmount")]
    monthly_amount: f64,
    #[serde(rename = "periodStartDate")]
    period_start_date: String,
    #[serde(rename = "periodEndDate")]
    period_end_date: String,
}

pub async fn create_escrow(
    pool: &SqlitePool,
    debt_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: EscrowBody = crate::body_of(body)?;
    let d = fetch_debt(pool, debt_id).await?;
    // ADR: escrow belongs to a mortgage. Allowing it elsewhere would put a
    // second payment component on debts that have no such thing.
    if d.r#type != "MORTGAGE" {
        return Err(ApiError::bad_request(
            "Escrow is only available for mortgages",
        ));
    }
    if b.period_start_date.is_empty() {
        return Err(crate::recurring::required("periodStartDate"));
    }
    if b.period_end_date.is_empty() {
        return Err(crate::recurring::required("periodEndDate"));
    }

    let id = cuid();
    let now = now_iso();
    let amount = Cents::from_dollars_f64(b.monthly_amount).0;
    // UPSERT, not a blind insert. `(debtId, periodStartDate)` is UNIQUE — the
    // constraint ADR-032 recorded as the open fix, which production has since
    // gained — so re-saving a period updates it rather than failing.
    //
    // This closes the deeper defect that ADR left open. The TypeScript inserts
    // every time, which is how one period accumulated five rows and an edit
    // appeared not to save: the write succeeded and a tie-broken read returned
    // a stale sibling. With the constraint enforced there is no sibling.
    sqlx::query!(
        r#"INSERT INTO "EscrowRecord"
             ("id","debtId","monthlyAmount","periodStartDate","periodEndDate",
              "createdAt","updatedAt")
           VALUES (?1,?2,?3,?4,?5,?6,?6)
           ON CONFLICT ("debtId","periodStartDate") DO UPDATE SET
             "monthlyAmount" = ?3, "periodEndDate" = ?5, "updatedAt" = ?6"#,
        id,
        debt_id,
        amount,
        b.period_start_date,
        b.period_end_date,
        now
    )
    .execute(pool)
    .await?;

    // Re-read: on conflict the surviving row keeps its ORIGINAL id, so
    // returning the one generated above would hand back an id that does not
    // exist.
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "debtId" AS "debt_id!", "monthlyAmount" AS "amount!: i64",
                  "periodStartDate" AS "start!", "periodEndDate" AS "end!",
                  "createdAt" AS "created!", "updatedAt" AS "updated!"
             FROM "EscrowRecord" WHERE "debtId" = ?1 AND "periodStartDate" = ?2"#,
        debt_id,
        b.period_start_date
    )
    .fetch_one(pool)
    .await?;

    Ok(Response::created(escrow_json(
        &r.id, &r.debt_id, r.amount, &r.start, &r.end, &r.created, &r.updated,
    )))
}

pub async fn update_escrow(
    pool: &SqlitePool,
    debt_id: &str,
    escrow_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: EscrowBody = crate::body_of(body)?;
    let now = now_iso();
    let amount = Cents::from_dollars_f64(b.monthly_amount).0;
    let start = (!b.period_start_date.is_empty()).then_some(b.period_start_date.clone());
    let end = (!b.period_end_date.is_empty()).then_some(b.period_end_date.clone());

    let n = sqlx::query!(
        r#"UPDATE "EscrowRecord" SET
             "monthlyAmount" = ?1,
             "periodStartDate" = COALESCE(?2, "periodStartDate"),
             "periodEndDate" = COALESCE(?3, "periodEndDate"),
             "updatedAt" = ?4
           WHERE "id" = ?5 AND "debtId" = ?6"#,
        amount,
        start,
        end,
        now,
        escrow_id,
        debt_id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::not_found("Escrow record"));
    }

    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "debtId" AS "debt_id!", "monthlyAmount" AS "amount!: i64",
                  "periodStartDate" AS "start!", "periodEndDate" AS "end!",
                  "createdAt" AS "created!", "updatedAt" AS "updated!"
             FROM "EscrowRecord" WHERE "id" = ?"#,
        escrow_id
    )
    .fetch_one(pool)
    .await?;
    Ok(Response::ok(escrow_json(
        &r.id, &r.debt_id, r.amount, &r.start, &r.end, &r.created, &r.updated,
    )))
}

pub async fn delete_escrow(
    pool: &SqlitePool,
    debt_id: &str,
    escrow_id: &str,
) -> Result<Response, ApiError> {
    let n = sqlx::query!(
        r#"DELETE FROM "EscrowRecord" WHERE "id" = ?1 AND "debtId" = ?2"#,
        escrow_id,
        debt_id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::not_found("Escrow record"));
    }
    Ok(Response::no_content())
}
