//! Merge on combine (reconcile-merge).
//!
//! Ported from `routes/reconciliations.merge.ts`.
//!
//! When the bank prints one line for several transactions the app recorded
//! separately, "Combine them" used to write only a pairing and leave the ledger
//! holding N rows forever. This replaces those N rows with one parent
//! transaction at the bank's amount and date, split across the budgets the
//! originals carried — the existing `parentId` split model, which balance
//! calculation and budget aggregation already handle.
//!
//! The whole operation runs inside one transaction: the deletes, the parent
//! create, the child allocations, and the match land together or not at all. A
//! half-completed merge would leave the balance counting both the originals and
//! the parent, which is exactly the discrepancy the reconciler exists to
//! surface.
//!
//! # Ledger-gate note
//!
//! This file is on the approved list because it creates child allocations
//! directly — children carry `parentId`, affect no account balance, and are
//! exempt for the same reason as in `transactions_children.rs`. The
//! balance-visible parent and every delete go through `ledger_create` /
//! `ledger_delete`.
//!
//! # One thing the Rust gate does that the TypeScript could not
//!
//! The TypeScript had to read each original's `DebtPayment` *before* opening the
//! transaction and hand it to `ledgerDelete`, because `DebtPayment.transactionId`
//! is `ON DELETE SET NULL` and the reversal hook could not find it afterwards.
//! `ledger_delete` here reads it itself, inside the gate, so the caller cannot
//! forget — the hazard is removed rather than documented.

use crate::id::{cuid, now_iso, parse_date};
use crate::reconciliations::require_session;
use crate::{ApiError, Response};
use avoir_core::money::Cents;
use avoir_db::ledger::{ledger_create, ledger_delete, LedgerCreate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

#[derive(Deserialize, Default)]
#[serde(default)]
struct MergeBody {
    #[serde(rename = "statementRowId")]
    statement_row_id: String,
    #[serde(rename = "transactionIds")]
    transaction_ids: Vec<String>,
    name: String,
}

struct Original {
    id: String,
    name: String,
    tx_type: String,
    amount: i64,
    date: String,
    account_id: Option<String>,
    parent_id: Option<String>,
    budget_id: Option<String>,
}

/// The pairing a merge created.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MergeMatchShape {
    id: String,
    session_id: String,
    statement_row_id: String,
    transaction_id: String,
    match_type: &'static str,
    created_at: String,
}

/// What a merge did: the parent it kept, how many children it made, and the
/// match that pairs the parent with the statement line.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MergedShape {
    parent_transaction_id: String,
    child_count: usize,
    #[serde(rename = "match")]
    matched: MergeMatchShape,
}

pub async fn merge(pool: &SqlitePool, id: &str, body: Option<Value>) -> Result<Response, ApiError> {
    let b: MergeBody = crate::body_of(body)?;
    let name = b.name.trim().to_string();
    if name.is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if name.chars().count() > 200 {
        return Err(ApiError::bad_request("name must be at most 200 characters"));
    }
    if b.statement_row_id.trim().is_empty() {
        return Err(crate::recurring::required("statementRowId"));
    }
    if b.transaction_ids.is_empty() {
        return Err(crate::recurring::required("transactionIds"));
    }

    let mut tx = pool.begin().await?;
    let session = require_session(&mut tx, id).await?;
    if session.status != "DRAFT" {
        return Err(ApiError::conflict(
            "Only a draft session can merge transactions",
        ));
    }

    let row = sqlx::query!(
        r#"SELECT "amount" AS "amount!: i64", "postedDate" AS "posted_date!"
             FROM "StatementRow" WHERE "id" = ? AND "sessionId" = ?"#,
        b.statement_row_id,
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new(404, "Statement row not found in this session"))?;

    // De-dup so a repeated id cannot be counted (or deleted) twice.
    let mut unique_ids: Vec<String> = b.transaction_ids.clone();
    unique_ids.sort();
    unique_ids.dedup();

    let mut originals: Vec<Original> = Vec::with_capacity(unique_ids.len());
    for tx_id in &unique_ids {
        let r = sqlx::query!(
            r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "tx_type!",
                      "amount" AS "amount!: i64", "date" AS "date!",
                      "accountId" AS account_id, "parentId" AS parent_id,
                      "budgetId" AS budget_id
                 FROM "Transaction" WHERE "id" = ?"#,
            tx_id
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::new(404, "One or more transactions were not found"))?;
        originals.push(Original {
            id: r.id,
            name: r.name,
            tx_type: r.tx_type,
            amount: r.amount,
            date: r.date,
            account_id: r.account_id,
            parent_id: r.parent_id,
            budget_id: r.budget_id,
        });
    }

    // ─── Eligibility (Requirement 1) ───
    //
    // Same-type only: the split model stores each child with the parent's single
    // type and drives the remainder to zero, so a mixed EXPENSE+REFUND set
    // cannot be represented without counting a refund as spending. INCOME and
    // TRANSFER are excluded for the same reason a free-form correction is —
    // different balance semantics — and stay pairings.
    for t in &originals {
        if t.tx_type != "EXPENSE" && t.tx_type != "REFUND" {
            return Err(ApiError::bad_request(format!(
                "\"{}\" is a {}; only expense and refund transactions can be merged",
                t.name, t.tx_type
            )));
        }
        if t.parent_id.is_some() {
            return Err(ApiError::bad_request(format!(
                "\"{}\" is already part of a split and cannot be merged",
                t.name
            )));
        }
        if t.account_id.as_deref() != Some(session.account_id.as_str()) {
            return Err(ApiError::bad_request(format!(
                "\"{}\" is not on the account being reconciled",
                t.name
            )));
        }
        if t.amount == 0 {
            return Err(ApiError::bad_request(format!(
                "\"{}\" has a zero amount and cannot become a child allocation",
                t.name
            )));
        }
    }
    let tx_type = originals[0].tx_type.clone();
    if originals.iter().any(|t| t.tx_type != tx_type) {
        return Err(ApiError::bad_request(
            "A merge must be all expenses or all refunds, not a mix of the two",
        ));
    }

    // The parent carries the bank line's amount, so the selected rows must sum
    // to it or the merge would not be balance-neutral (Requirement 3.7). A
    // genuine combination decision always sums exactly; this guards direct API
    // misuse.
    //
    // In cents that is an equality. The TypeScript needed a 0.005 tolerance
    // because two float sums cannot be compared — which also meant a genuine
    // half-cent disagreement passed the check.
    let originals_sum: i64 = originals.iter().map(|t| t.amount).sum();
    let row_magnitude = Cents(row.amount).abs();
    if originals_sum != row_magnitude.0 {
        return Err(ApiError::bad_request(format!(
            "The selected transactions sum to {:.2}, which does not match the statement line of {:.2}",
            Cents(originals_sum).as_dollars_f64(),
            row_magnitude.as_dollars_f64()
        )));
    }

    // A null-budget child gets the Uncategorized system budget substituted
    // (Requirement 3.3) — the gate does this for the parent automatically, but
    // the children are created directly here.
    //
    // Absent on a database whose seed has not run (ADR-017 makes it a seed, not
    // a migration, precisely so it can be re-created at any time). The
    // TypeScript threw a 500 in that case; here the child keeps a NULL budget
    // instead, which is the same state and not an error: "no category" and "the
    // Uncategorized category" are already one thing to the user, and
    // `transactions.rs` deliberately makes a filter on Uncategorized match NULL
    // rows for exactly that reason. Refusing the whole merge over a missing seed
    // row would be the only thing here that actually loses data.
    let uncategorized = sqlx::query_scalar!(
        r#"SELECT "id" FROM "Budget" WHERE "name" = 'Uncategorized' AND "isSystem" = 1 LIMIT 1"#
    )
    .fetch_optional(&mut *tx)
    .await?;

    // One original's budget becomes the parent's own allocation (its remainder);
    // only the OTHERS become children. So the split holds exactly the budgets the
    // rows carried — no $0 remainder category, ever. Which original is the parent
    // is cosmetic (every budget still receives its exact amount, since the
    // remainder parent.amount − SUM(children) equals the head's amount toward the
    // head's budget), but prefer one that HAS a budget so Uncategorized surfaces
    // only for a genuinely un-budgeted row — never as an empty $0 remainder.
    let head_idx = originals
        .iter()
        .position(|t| t.budget_id.is_some())
        .unwrap_or(0);
    let head_id = originals[head_idx].id.clone();
    let head_name = originals[head_idx].name.clone();
    let head_budget = originals[head_idx].budget_id.clone();
    let head_date = day_of(&originals[head_idx].date);

    // Delete every original through the gate so its reversal hooks fire — the
    // balance chain, a schedule un-match, a debt reversal — inside this
    // transaction, rolling back with it on any failure.
    for t in &originals {
        ledger_delete(&mut tx, &t.id)
            .await
            .map_err(ApiError::from)?;
    }

    // The parent: the bank's amount and posted date, the chosen name, the
    // account being reconciled, and the head's budget as its remainder (the gate
    // falls back to Uncategorized only if that row genuinely had none — a
    // non-zero Uncategorized portion, never a $0 one). Its name and date are
    // preserved in the note, like the children's.
    let parent_id = cuid();
    let now = now_iso();
    ledger_create(
        &mut tx,
        &LedgerCreate {
            id: parent_id.clone(),
            name: name.clone(),
            amount: row_magnitude,
            date: row.posted_date.clone(),
            created_at: now.clone(),
            tx_type: tx_type.clone(),
            account_id: Some(session.account_id.clone()),
            to_account_id: None,
            parent_id: None,
            budget_id: head_budget,
            expense_id: None,
            note: Some(format!("{head_name} · {head_date}")),
            trade: None,
            bitcoin: None,
            occurrence_date: None,
            purchase_group_id: None,
        },
    )
    .await
    .map_err(ApiError::from)?;

    // One child per REMAINING original: its own amount and budget, with its name
    // and date preserved in the note (a child has neither field of its own).
    let mut child_count = 0usize;
    for t in originals.iter().filter(|t| t.id != head_id) {
        let child_id = cuid();
        let child_budget = t.budget_id.clone().or_else(|| uncategorized.clone());
        let child_note = format!("{} · {}", t.name, day_of(&t.date));
        sqlx::query!(
            r#"INSERT INTO "Transaction"
                 ("id","parentId","type","name","amount","netAmount","date","createdAt",
                  "imported","isCashBack","accountId","budgetId","note")
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)"#,
            child_id,
            parent_id,
            tx_type,
            name,
            t.amount,
            t.amount,
            row.posted_date,
            now,
            session.account_id,
            child_budget,
            child_note
        )
        .execute(&mut *tx)
        .await?;
        child_count += 1;
    }

    let match_id = cuid();
    sqlx::query!(
        r#"INSERT INTO "ReconciliationMatch"
             ("id","sessionId","statementRowId","transactionId","matchType","createdAt")
           VALUES (?, ?, ?, ?, 'MANUAL', ?)"#,
        match_id,
        id,
        b.statement_row_id,
        parent_id,
        now
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Response::created(MergedShape {
        parent_transaction_id: parent_id.clone(),
        child_count,
        matched: MergeMatchShape {
            id: match_id,
            session_id: id.to_string(),
            statement_row_id: b.statement_row_id,
            transaction_id: parent_id,
            match_type: "MANUAL",
            created_at: now,
        },
    }))
}

/// `YYYY-MM-DD` out of a stored date, for the preserved-name note.
fn day_of(stored: &str) -> String {
    match parse_date(stored) {
        Some(d) => d.format("%Y-%m-%d").to_string(),
        None => stored.to_string(),
    }
}
