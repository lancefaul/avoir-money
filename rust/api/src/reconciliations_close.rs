//! Closing a reconciliation, and the escape hatch.
//!
//! Ported from `routes/reconciliations.close.ts`.
//!
//! This is the enforcement point for the rule the whole feature exists to
//! impose: **a session cannot be closed while the residual is non-zero.** That
//! rule is what forces a transaction correction to be paired with the opening
//! correction that was compensating for it — fix only one side and the residual
//! becomes non-zero, the close is refused, and the second error is exposed.
//!
//! The escape hatch does NOT relax that rule. It creates a real, visible,
//! reasoned transaction that brings the residual to zero honestly. It must never
//! adjust `openingBalance`: an escape hatch that moved the opening would let the
//! user close without fixing anything, recreating the exact bug this feature was
//! built to catch.

use crate::id::{cuid, now_iso};
use crate::reconciliations::{require_session, residual_json};
use crate::{ApiError, Response};
use avoir_core::money::Cents;
use avoir_db::ledger::{ledger_create, LedgerCreate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

// ─── POST /{id}/adjustment ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct AdjustmentBody {
    reason: String,
}

/// A session with its recomputed residual, as the adjustment route answers.
#[derive(Serialize)]
struct SessionResidualShape {
    session: crate::reconciliations::SessionShape,
    residual: crate::reconciliations::ResidualShape,
}

/// The same, plus how many rows the close cleared.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClosedShape {
    session: crate::reconciliations::SessionShape,
    residual: crate::reconciliations::ResidualShape,
    cleared_transactions: usize,
}

pub async fn adjustment(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: AdjustmentBody = crate::body_of(body)?;
    let reason = b.reason.trim().to_string();
    // Mandatory and non-empty: the escape hatch exists so a discrepancy can be
    // closed *visibly*, and an adjustment with no stated reason is the invisible
    // absorption this feature was built to eliminate.
    if reason.is_empty() {
        return Err(crate::recurring::required("reason"));
    }
    if reason.chars().count() > 500 {
        return Err(ApiError::bad_request(
            "reason must be at most 500 characters",
        ));
    }

    let mut tx = pool.begin().await?;
    let session = require_session(&mut tx, id).await?;
    if session.status != "DRAFT" {
        return Err(ApiError::conflict(
            "Only a draft session can take an adjustment",
        ));
    }
    if session.adjustment_transaction_id.is_some() {
        return Err(ApiError::conflict("This session already has an adjustment"));
    }

    let before = avoir_db::reconciliation::compute(&mut tx, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("Reconciliation session"))?;
    if before.is_balanced {
        // Refusing here is deliberate: an adjustment on a balanced session is a
        // meaningless artifact in the register that would later read as a real
        // discrepancy someone papered over.
        return Err(ApiError::bad_request(
            "Residual is already zero — no adjustment is needed",
        ));
    }

    // A positive residual means the bank holds more than the app accounts for,
    // so the adjustment must credit the account; a negative residual debits it.
    let amount = before.residual.abs();
    let tx_type = if before.residual.0 > 0 {
        "INCOME"
    } else {
        "EXPENSE"
    };

    let adjustment_id = cuid();
    let now = now_iso();
    ledger_create(
        &mut tx,
        &LedgerCreate {
            id: adjustment_id.clone(),
            name: format!("Reconciliation adjustment — {reason}"),
            amount,
            date: session.period_end.clone(),
            created_at: now.clone(),
            tx_type: tx_type.into(),
            account_id: Some(session.account_id.clone()),
            to_account_id: None,
            parent_id: None,
            budget_id: None,
            expense_id: None,
            note: Some(reason.clone()),
            trade: None,
            bitcoin: None,
            occurrence_date: None,
            purchase_group_id: None,
        },
    )
    .await
    .map_err(ApiError::from)?;

    sqlx::query!(
        r#"UPDATE "ReconciliationSession"
              SET "adjustmentTransactionId" = ?, "adjustmentReason" = ?, "updatedAt" = ?
            WHERE "id" = ?"#,
        adjustment_id,
        reason,
        now,
        id
    )
    .execute(&mut *tx)
    .await?;

    let updated = require_session(&mut tx, id).await?;
    let after = avoir_db::reconciliation::compute(&mut tx, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("Reconciliation session"))?;
    tx.commit().await?;

    Ok(Response::created(SessionResidualShape {
        session: updated.to_json(),
        residual: residual_json(&after),
    }))
}

// ─── POST /{id}/close ───

pub async fn close(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let mut tx = pool.begin().await?;
    let session = require_session(&mut tx, id).await?;
    if session.status != "DRAFT" {
        return Err(ApiError::conflict("Only a draft session can be closed"));
    }

    // Recomputed from live data, never taken from the client. The entire
    // guarantee of this endpoint rests on this figure being current.
    let residual = avoir_db::reconciliation::compute(&mut tx, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("Reconciliation session"))?;

    if !residual.is_balanced {
        return Err(ApiError {
            status: 409,
            error: format!(
                "Cannot close: {:.2} is unaccounted for. Resolve the remaining \
                 differences, or record an adjustment with a reason.",
                residual.residual.as_dollars_f64()
            ),
            details: Some(crate::to_body(residual_json(&residual))),
        });
    }

    // The invariant must hold for the account before this period is declared
    // reconciled — closing on top of a broken ledger would certify it as correct.
    //
    // Note this re-derives the account's total independently of the residual
    // even though `compute` already summed the same rows: the residual sums only
    // *through the period end*, while the invariant is about the account's whole
    // history. A period can balance perfectly on an account whose stored balance
    // is wrong, and that is exactly the state this refuses to certify.
    let account = sqlx::query!(
        r#"SELECT "balance" AS "balance!: i64", "openingBalance" AS "opening!: i64"
             FROM "Account" WHERE "id" = ?"#,
        session.account_id
    )
    .fetch_one(&mut *tx)
    .await?;

    let total = avoir_db::reconciliation::account_signed_sum(&mut tx, &session.account_id)
        .await
        .map_err(ApiError::from)?;
    let expected = Cents(account.opening) + total;
    if Cents(account.balance) != expected {
        return Err(ApiError::conflict(
            "Cannot close: this account's stored balance disagrees with the sum of its \
             transactions. Run the ledger integrity check before reconciling.",
        ));
    }

    let matched: Vec<String> = sqlx::query_scalar!(
        r#"SELECT DISTINCT "transactionId" AS "tx_id!"
             FROM "ReconciliationMatch" WHERE "sessionId" = ?"#,
        id
    )
    .fetch_all(&mut *tx)
    .await?;

    // Ledger-gate note: this file is on the approved list (QUALITY.md) for
    // exactly this write. `reconciledAt` is metadata about when a row was
    // certified — it touches no amount, no account and no date, so there is
    // nothing for a lifecycle hook to react to and routing it through
    // `ledger_update` would recompute the balance chain once per matched row for
    // no effect.
    let now = now_iso();
    for tx_id in &matched {
        sqlx::query!(
            r#"UPDATE "Transaction" SET "reconciledAt" = ? WHERE "id" = ?"#,
            now,
            tx_id
        )
        .execute(&mut *tx)
        .await?;
    }

    let residual_cents = residual.residual.0;
    sqlx::query!(
        r#"UPDATE "ReconciliationSession"
              SET "status" = 'RECONCILED', "reconciledAt" = ?, "residualAtClose" = ?,
                  "updatedAt" = ?
            WHERE "id" = ?"#,
        now,
        residual_cents,
        now,
        id
    )
    .execute(&mut *tx)
    .await?;

    let updated = require_session(&mut tx, id).await?;
    tx.commit().await?;

    Ok(Response::ok(ClosedShape {
        session: updated.to_json(),
        residual: residual_json(&residual),
        cleared_transactions: matched.len(),
    }))
}
