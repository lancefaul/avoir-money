//! `/purchases` — one purchase, paid from several accounts (ADR-030).
//!
//! Ported from `routes/purchases.ts`.
//!
//! # Budget and account are independent partitions of one total
//!
//! A receipt has line items that belong to budgets, and payments that come from
//! accounts, and the two have nothing to do with each other. So a split purchase
//! is modelled as a **purchase group**:
//!
//! - An **Anchor** with `accountId = null` carrying the total and the budget. It
//!   is invisible to every account balance *for free*, because `WHERE
//!   accountId = X` never selects a null-account row.
//! - One **leg** per funding account, each an ordinary top-level transaction
//!   carrying its share and the system "Payment" allocation, so the legs are
//!   invisible to budget rollup exactly as TRANSFER is.
//!
//! The legs are the only balance-visible rows, which is why the balance chain
//! and `openingBalance + SUM(tx) == balance` need no changes at all. That is
//! the whole reason ADR-030 chose grouped siblings over a funding-allocation
//! table: the alternative moves per-row balance metadata onto allocation rows
//! and rewrites the invariant in the most incident-prone code in the project.
//!
//! # A simple purchase stays one row
//!
//! One payment means one ordinary transaction with an account and a budget —
//! the degenerate one-of-each case. Always materialising Anchor + one leg would
//! have doubled 2,300 existing rows to buy uniformity in the case that needs
//! none.

use crate::id::{cuid, now_iso, parse_date};
use crate::{ApiError, Response};
use avoir_core::money::Cents;
use avoir_db::ledger::{ledger_create, ledger_delete, LedgerCreate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{SqliteConnection, SqlitePool};

#[derive(Deserialize, Default, Clone)]
#[serde(default)]
struct Payment {
    #[serde(rename = "accountId")]
    account_id: String,
    amount: f64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct PurchaseBody {
    name: String,
    date: String,
    amount: f64,
    #[serde(rename = "budgetId")]
    budget_id: Option<String>,
    note: Option<String>,
    payments: Vec<Payment>,
}

/// A bare acknowledgement, for the route whose answer is "it worked".
#[derive(Serialize)]
struct SuccessShape {
    success: bool,
}

/// What a purchase write reports: the group it belongs to, and every row it
/// created.
///
/// `purchaseGroupId` is NULL for the degenerate one-account case — a simple
/// purchase stays a single ordinary transaction and is never promoted to a
/// group (ADR-030), so the field says "this was not split" rather than being
/// omitted. Three separate `json!` literals built this shape before.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseWriteShape {
    purchase_group_id: Option<String>,
    transaction_ids: Vec<String>,
}

/// The checks `CreatePurchaseSchema` makes with a `superRefine`.
///
/// **The legs must sum to the total exactly.** In cents that is an equality, not
/// a tolerance — the TypeScript needed `sumCurrency` and a rounded comparison
/// because floats cannot be added reliably; integers can, so the check is the
/// obvious one and cannot be defeated by an epsilon.
fn check_payments(total: Cents, payments: &[Payment]) -> Result<Vec<Cents>, ApiError> {
    // These are `superRefine` issues on `payments` in the reference, so they
    // arrive at the client as `{ error: 'Validation failed', details: [{ field:
    // 'payments', message }] }` — not as a bare `error` string. The distinction
    // is visible to the user: `request.ts` builds its message from
    // `details[].field` and `details[].message`, so a message returned as
    // `error` alone loses the field name that says WHICH input was wrong.
    let issue = |message: &str| ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": "payments", "message": message }])),
    };

    if payments.is_empty() {
        return Err(issue("at least one payment is required"));
    }
    let legs: Vec<Cents> = payments
        .iter()
        .map(|p| Cents::from_dollars_f64(p.amount))
        .collect();
    let paid: i64 = legs.iter().map(|c| c.0).sum();
    if paid != total.0 {
        return Err(issue(&format!(
            "payment legs must sum to the amount {:.2} (got {:.2})",
            total.as_dollars_f64(),
            Cents(paid).as_dollars_f64()
        )));
    }
    // One leg per account: two legs on the same account is one payment written
    // twice, and it would show as two rows on that account's ledger.
    let mut seen: Vec<&str> = payments.iter().map(|p| p.account_id.as_str()).collect();
    seen.sort_unstable();
    let before = seen.len();
    seen.dedup();
    if seen.len() != before {
        return Err(issue(
            "each account may fund a purchase only once — combine same-account legs into one",
        ));
    }
    Ok(legs)
}

/// **Takes a connection, not the pool, and that is load-bearing.** The pool
/// holds ONE connection, so a helper that asks it for another while a caller
/// still owns one deadlocks against itself — and it surfaces as a timeout
/// rather than an error, which reads like a slow query. Twice now. Threading
/// the connection makes the mistake unavailable rather than merely discouraged.
async fn accounts_exist(conn: &mut SqliteConnection, payments: &[Payment]) -> Result<(), ApiError> {
    for p in payments {
        let n = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "Account" WHERE "id" = ?"#,
            p.account_id
        )
        .fetch_one(&mut *conn)
        .await?;
        if n == 0 {
            return Err(ApiError::not_found("One or more funding accounts"));
        }
    }
    Ok(())
}

/// The system allocation legs are filed under, so they are money movement
/// rather than spend.
///
/// Absent on a fresh database — the seed creates it (ADR-017) — in which case
/// the leg falls to the gate's Uncategorized default, which is harmless: it is
/// still not the purchase's budget, and the Anchor still carries that.
async fn payment_budget(conn: &mut SqliteConnection) -> Result<Option<String>, ApiError> {
    Ok(sqlx::query_scalar!(
        r#"SELECT "id" FROM "Budget" WHERE "name" = 'Payment' AND "isSystem" = 1 LIMIT 1"#
    )
    .fetch_optional(&mut *conn)
    .await?)
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: PurchaseBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    let date = parse_date(&b.date).ok_or_else(|| ApiError::bad_request("date must be a date"))?;
    let date = crate::id::date_at_utc_midnight(date);
    let total = Cents::from_dollars_f64(b.amount);
    if total.0 < 0 {
        return Err(ApiError::bad_request("amount must not be negative"));
    }
    let legs = check_payments(total, &b.payments)?;

    let now = now_iso();
    let mut tx = pool.begin().await?;
    accounts_exist(&mut tx, &b.payments).await?;

    // ── One account: an ordinary transaction, no group at all ──
    if b.payments.len() == 1 {
        let id = cuid();
        ledger_create(
            &mut tx,
            &LedgerCreate {
                id: id.clone(),
                name: b.name.clone(),
                amount: total,
                date,
                created_at: now,
                tx_type: "EXPENSE".into(),
                account_id: Some(b.payments[0].account_id.clone()),
                to_account_id: None,
                parent_id: None,
                budget_id: b.budget_id.clone(),
                expense_id: None,
                trade: None,
                bitcoin: None,
                occurrence_date: None,
                note: None,
                purchase_group_id: None,
            },
        )
        .await
        .map_err(ApiError::from)?;
        tx.commit().await?;
        return Ok(Response::created(PurchaseWriteShape {
            purchase_group_id: None,
            transaction_ids: vec![id],
        }));
    }

    // ── Split: Anchor + legs, written atomically ──
    let group = cuid();
    let payment_budget = payment_budget(&mut tx).await?;
    let anchor_id = cuid();

    ledger_create(
        &mut tx,
        &LedgerCreate {
            id: anchor_id.clone(),
            name: b.name.clone(),
            amount: total,
            date: date.clone(),
            created_at: now.clone(),
            tx_type: "EXPENSE".into(),
            // Balance-neutral by construction: no account to move.
            account_id: None,
            to_account_id: None,
            parent_id: None,
            budget_id: b.budget_id.clone(),
            expense_id: None,
            trade: None,
            bitcoin: None,
            occurrence_date: None,
            note: None,
            purchase_group_id: Some(group.clone()),
        },
    )
    .await
    .map_err(ApiError::from)?;

    let mut ids = vec![anchor_id];
    for (p, amount) in b.payments.iter().zip(&legs) {
        let leg_id = cuid();
        ledger_create(
            &mut tx,
            &LedgerCreate {
                id: leg_id.clone(),
                name: b.name.clone(),
                amount: *amount,
                date: date.clone(),
                created_at: now.clone(),
                tx_type: "EXPENSE".into(),
                account_id: Some(p.account_id.clone()),
                to_account_id: None,
                parent_id: None,
                budget_id: payment_budget.clone(),
                expense_id: None,
                trade: None,
                bitcoin: None,
                occurrence_date: None,
                note: None,
                purchase_group_id: Some(group.clone()),
            },
        )
        .await
        .map_err(ApiError::from)?;
        ids.push(leg_id);
    }
    tx.commit().await?;

    Ok(Response::created(PurchaseWriteShape {
        purchase_group_id: Some(group),
        transaction_ids: ids,
    }))
}

/// Remove a whole group, reversing every leg's balance.
pub async fn delete(pool: &SqlitePool, group_id: &str) -> Result<Response, ApiError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "Transaction" WHERE "purchaseGroupId" = ?"#,
        group_id
    )
    .fetch_all(pool)
    .await?;
    if ids.is_empty() {
        return Err(ApiError::not_found("Purchase group"));
    }

    // Every member through the gate, in one transaction. The Anchor's delete is
    // a no-op on balances (it has no account); each leg's reverses its own. A
    // failure part-way would leave the group half-deleted with a live balance
    // effect from the legs that survived.
    let mut tx = pool.begin().await?;
    for id in &ids {
        ledger_delete(&mut tx, id).await.map_err(ApiError::from)?;
    }
    tx.commit().await?;

    Ok(Response::ok(SuccessShape { success: true }))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct PaymentsBody {
    payments: Vec<Payment>,
}

/// Re-split how a purchase was paid, without touching what it was for.
///
/// The Anchor survives untouched, which is the point: changing who paid says
/// nothing about which budget the purchase belongs to. That independence is
/// structural here rather than a rule someone has to remember.
pub async fn update_payments(
    pool: &SqlitePool,
    group_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: PaymentsBody = crate::body_of(body)?;

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "accountId" AS account_id, "amount" AS "amount!: i64",
                  "name" AS "name!", "date" AS "date!", "note"
             FROM "Transaction" WHERE "purchaseGroupId" = ?"#,
        group_id
    )
    .fetch_all(pool)
    .await?;

    // The Anchor is the member with no account — the same property that keeps
    // it out of every balance query identifies it here.
    let anchor = rows
        .iter()
        .find(|r| r.account_id.is_none())
        .ok_or_else(|| ApiError::not_found("Purchase group"))?;

    // Checked against the STORED Anchor, because the request carries only the
    // legs and the schema cannot know the total.
    let legs = check_payments(Cents(anchor.amount), &b.payments)?;

    let (name, date, note) = (
        anchor.name.clone(),
        anchor.date.clone(),
        anchor.note.clone(),
    );
    let anchor_id = anchor.id.clone();
    let old_legs: Vec<String> = rows
        .iter()
        .filter(|r| r.account_id.is_some())
        .map(|r| r.id.clone())
        .collect();

    let now = now_iso();
    let mut tx = pool.begin().await?;
    accounts_exist(&mut tx, &b.payments).await?;
    let payment_budget = payment_budget(&mut tx).await?;

    // One atomic swap, so no account is ever left counting a removed leg.
    for id in &old_legs {
        ledger_delete(&mut tx, id).await.map_err(ApiError::from)?;
    }
    let mut ids = vec![anchor_id];
    for (p, amount) in b.payments.iter().zip(&legs) {
        let leg_id = cuid();
        ledger_create(
            &mut tx,
            &LedgerCreate {
                id: leg_id.clone(),
                name: name.clone(),
                amount: *amount,
                date: date.clone(),
                created_at: now.clone(),
                tx_type: "EXPENSE".into(),
                account_id: Some(p.account_id.clone()),
                to_account_id: None,
                parent_id: None,
                budget_id: payment_budget.clone(),
                expense_id: None,
                trade: None,
                bitcoin: None,
                occurrence_date: None,
                note: None,
                purchase_group_id: Some(group_id.to_string()),
            },
        )
        .await
        .map_err(ApiError::from)?;
        ids.push(leg_id);
    }
    tx.commit().await?;
    let _ = note;

    Ok(Response::ok(PurchaseWriteShape {
        purchase_group_id: Some(group_id.to_string()),
        transaction_ids: ids,
    }))
}
