//! `/reconciliations` — session lifecycle, statement import, and matching.
//!
//! Ported from `routes/reconciliations.ts`. Closing lives in
//! `reconciliations_close.rs` and merging in `reconciliations_merge.rs`, the
//! same split the TypeScript uses and for the same reason: the close rule is the
//! point of the whole feature and stays legible on its own.
//!
//! Resolutions — correcting, adding or deleting a transaction, or adjusting an
//! opening balance — deliberately have **no endpoint here**. They reuse the
//! transaction and account routes, which keeps every correction on the ledger
//! gate and stops the reconciliation UI from growing its own divergent
//! semantics for an edit.

use crate::id::{cuid, now_iso, parse_date};
use crate::{ApiError, Path, Response};
use avoir_core::matcher::{reconcile, AppTx, ReconcileOptions, StatementLine};
use avoir_core::money::Cents;
use avoir_core::reconcile::{app_tx_direction, Direction, TradeDirection};
use avoir_core::statement;
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::{HashMap, HashSet};

/// Days of slack when loading app transactions around the reported window.
const LOAD_PAD_DAYS: i64 = 7;

// ─── Session ───

/// Every column of a session, as the frontend's `ReconciliationSessionSchema`
/// expects it.
pub(crate) struct Session {
    pub id: String,
    pub account_id: String,
    pub period_start: String,
    pub period_end: String,
    pub statement_ending_balance: i64,
    pub status: String,
    pub residual_at_close: i64,
    pub reconciled_at: Option<String>,
    pub adjustment_transaction_id: Option<String>,
    pub adjustment_reason: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// What an import did.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedShape {
    imported: usize,
    skipped_duplicates: usize,
    period_start: String,
    period_end: String,
}

/// What an auto-match run found. `summary` stays a `Value` because its keys are
/// finding kinds, not a fixed field set.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchRunShape {
    matched: usize,
    unmatched_statement: usize,
    unmatched_app: usize,
    summary: Value,
}

/// A bare acknowledgement, for the routes whose answer is "it worked".
#[derive(Serialize)]
struct SuccessShape {
    success: bool,
}

/// A parsed statement line.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatementRowShape {
    id: String,
    session_id: String,
    posted_date: String,
    transaction_date: String,
    description: String,
    amount: f64,
    raw_line: String,
    created_at: String,
}

/// A pairing between a statement line and a transaction.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MatchShape {
    id: String,
    session_id: String,
    statement_row_id: String,
    transaction_id: String,
    match_type: String,
    created_at: String,
}

/// The session detail: everything a reconciliation screen needs in one read.
///
/// Composed rather than patched onto the serialized session, which is what the
/// four `obj.insert` calls here used to do.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDetailShape {
    #[serde(flatten)]
    session: SessionShape,
    statement_rows: Vec<StatementRowShape>,
    matches: Vec<MatchShape>,
    app_transactions: Vec<Value>,
    residual: ResidualShape,
}

/// A reconciliation session on the wire.
///
/// ADR-029: abandoning a session DELETES it, so `ABANDONED` is unreachable and
/// `status` is only ever IN_PROGRESS or RECONCILED. A closed session keeps its
/// rows forever — they are the evidence of what was reconciled against, and the
/// only case where they are not rebuildable from the statement file.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionShape {
    id: String,
    account_id: String,
    period_start: String,
    period_end: String,
    statement_ending_balance: f64,
    status: String,
    residual_at_close: f64,
    reconciled_at: Option<String>,
    adjustment_transaction_id: Option<String>,
    adjustment_reason: Option<String>,
    created_at: String,
    updated_at: String,
}

/// The residual, in the shape `ResidualSchema` parses.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResidualShape {
    opening_balance: f64,
    transaction_sum: f64,
    expected_balance: f64,
    statement_ending_balance: f64,
    residual: f64,
    is_balanced: bool,
    activity_after_period_end: f64,
}

impl Session {
    pub fn to_json(&self) -> SessionShape {
        SessionShape {
            id: self.id.clone(),
            account_id: self.account_id.clone(),
            period_start: self.period_start.clone(),
            period_end: self.period_end.clone(),
            statement_ending_balance: Cents(self.statement_ending_balance).as_dollars_f64(),
            status: self.status.clone(),
            residual_at_close: Cents(self.residual_at_close).as_dollars_f64(),
            reconciled_at: self.reconciled_at.clone(),
            adjustment_transaction_id: self.adjustment_transaction_id.clone(),
            adjustment_reason: self.adjustment_reason.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

/// Load one session, or `None`.
///
/// Takes a connection rather than the pool: the pool holds exactly one, so a
/// helper that asks for another while a caller already owns one deadlocks
/// against itself and surfaces as a timeout. Structural, not a convention.
pub(crate) async fn load_session(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<Session>, ApiError> {
    let row = sqlx::query!(
        r#"SELECT "id" AS "id!", "accountId" AS "account_id!",
                  "periodStart" AS "period_start!", "periodEnd" AS "period_end!",
                  "statementEndingBalance" AS "statement_ending_balance!: i64",
                  "status" AS "status!", "residualAtClose" AS "residual_at_close!: i64",
                  "reconciledAt" AS reconciled_at,
                  "adjustmentTransactionId" AS adjustment_transaction_id,
                  "adjustmentReason" AS adjustment_reason,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "ReconciliationSession" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?;

    Ok(row.map(|r| Session {
        id: r.id,
        account_id: r.account_id,
        period_start: r.period_start,
        period_end: r.period_end,
        statement_ending_balance: r.statement_ending_balance,
        status: r.status,
        residual_at_close: r.residual_at_close,
        reconciled_at: r.reconciled_at,
        adjustment_transaction_id: r.adjustment_transaction_id,
        adjustment_reason: r.adjustment_reason,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }))
}

pub(crate) async fn require_session(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Session, ApiError> {
    load_session(conn, id)
        .await?
        .ok_or_else(|| ApiError::not_found("Reconciliation session"))
}

pub(crate) fn residual_json(r: &avoir_db::reconciliation::Residual) -> ResidualShape {
    ResidualShape {
        opening_balance: r.opening_balance.as_dollars_f64(),
        transaction_sum: r.transaction_sum.as_dollars_f64(),
        expected_balance: r.expected_balance.as_dollars_f64(),
        statement_ending_balance: r.statement_ending_balance.as_dollars_f64(),
        residual: r.residual.as_dollars_f64(),
        is_balanced: r.is_balanced,
        activity_after_period_end: r.activity_after_period_end.as_dollars_f64(),
    }
}

// ─── POST / ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateBody {
    #[serde(rename = "accountId")]
    account_id: String,
    #[serde(rename = "periodStart")]
    period_start: String,
    #[serde(rename = "periodEnd")]
    period_end: String,
    /*
     * `Option`, not `f64`, and `#[serde(default)]` on this struct is why. With
     * a bare `f64` a body omitting the anchor deserializes to 0.0, passes every
     * check, and only fails at the DRAFT unique index — so "you forgot the
     * statement balance" surfaced as "this account already has a draft
     * reconciliation". Same defect as `ReadingBody.cost`, found the same way.
     *
     * The field is the external anchor: without it there is no residual, and
     * without a residual there is no completion check, which is the feature.
     */
    #[serde(rename = "statementEndingBalance")]
    statement_ending_balance: Option<f64>,
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: CreateBody = crate::body_of(body)?;
    if b.account_id.trim().is_empty() {
        return Err(crate::recurring::required("accountId"));
    }
    // Field-scoped throughout: the client renders `details[].field`, and a
    // top-level sentence gives a form nothing to mark.
    let anchor_dollars = b
        .statement_ending_balance
        .ok_or_else(|| ApiError::invalid_field("statementEndingBalance", "Required"))?;
    let start = parse_date(&b.period_start)
        .ok_or_else(|| ApiError::invalid_field("periodStart", "Invalid date"))?;
    let end = parse_date(&b.period_end)
        .ok_or_else(|| ApiError::invalid_field("periodEnd", "Invalid date"))?;
    if end < start {
        return Err(ApiError::invalid_field(
            "periodEnd",
            "periodEnd must be on or after periodStart",
        ));
    }

    let mut conn = pool.acquire().await?;
    let exists = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Account" WHERE "id" = ?"#,
        b.account_id
    )
    .fetch_one(&mut *conn)
    .await?;
    if exists == 0 {
        return Err(ApiError::not_found("Account"));
    }

    let id = cuid();
    let now = now_iso();
    let start_s = crate::id::date_at_utc_midnight(start);
    let end_s = crate::id::date_at_utc_midnight(end);
    let anchor = Cents::from_dollars_f64(anchor_dollars).0;

    let inserted = sqlx::query!(
        r#"INSERT INTO "ReconciliationSession"
             ("id","accountId","periodStart","periodEnd","statementEndingBalance",
              "status","residualAtClose","createdAt","updatedAt")
           VALUES (?, ?, ?, ?, ?, 'DRAFT', 0, ?, ?)"#,
        id,
        b.account_id,
        start_s,
        end_s,
        anchor,
        now,
        now
    )
    .execute(&mut *conn)
    .await;

    if let Err(e) = inserted {
        // The partial unique index permits one DRAFT per account: two concurrent
        // drafts would let the same period be reconciled twice with conflicting
        // resolutions.
        if is_unique_violation(&e) {
            return Err(ApiError::conflict(
                "This account already has a draft reconciliation",
            ));
        }
        return Err(e.into());
    }

    let session = require_session(&mut conn, &id).await?;
    Ok(Response::created(session.to_json()))
}

/// SQLite's extended result codes for a uniqueness collision.
///
/// `2067` is `SQLITE_CONSTRAINT_UNIQUE` and `1555` is
/// `SQLITE_CONSTRAINT_PRIMARYKEY`. Prisma folded both into `P2002`, so mapping
/// both to 409 keeps the responses identical to the routes being replaced.
///
/// Detected from the error rather than by a pre-flight `SELECT`, because the
/// constraint is the thing that actually decides. A check-then-insert is a
/// different rule that merely agrees most of the time — and for the one-draft
/// index it would have to reproduce the `WHERE status = 'DRAFT'` predicate,
/// giving two definitions of "already has a draft" free to drift.
pub(crate) fn is_unique_violation(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => {
            matches!(db.code().as_deref(), Some("2067") | Some("1555"))
        }
        _ => false,
    }
}

// ─── PATCH /{id} ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct UpdateBody {
    #[serde(rename = "statementEndingBalance")]
    statement_ending_balance: Option<f64>,
    #[serde(rename = "periodEnd")]
    period_end: Option<String>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateBody = crate::body_of(body)?;
    if b.statement_ending_balance.is_none() && b.period_end.is_none() {
        return Err(ApiError::bad_request(
            "Provide statementEndingBalance or periodEnd",
        ));
    }

    let mut conn = pool.acquire().await?;
    let session = require_session(&mut conn, id).await?;
    // A closed session's residual is the historical record of what was agreed;
    // a later anchor or cutoff edit would rewrite that agreement after the fact.
    if session.status != "DRAFT" {
        return Err(ApiError::conflict("Only a draft session can be changed"));
    }

    if let Some(v) = b.statement_ending_balance {
        let cents = Cents::from_dollars_f64(v).0;
        sqlx::query!(
            r#"UPDATE "ReconciliationSession" SET "statementEndingBalance" = ? WHERE "id" = ?"#,
            cents,
            id
        )
        .execute(&mut *conn)
        .await?;
    }
    if let Some(d) = &b.period_end {
        let parsed =
            parse_date(d).ok_or_else(|| ApiError::bad_request("periodEnd must be a date"))?;
        let s = crate::id::date_at_utc_midnight(parsed);
        sqlx::query!(
            r#"UPDATE "ReconciliationSession" SET "periodEnd" = ? WHERE "id" = ?"#,
            s,
            id
        )
        .execute(&mut *conn)
        .await?;
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "ReconciliationSession" SET "updatedAt" = ? WHERE "id" = ?"#,
        now,
        id
    )
    .execute(&mut *conn)
    .await?;

    let updated = require_session(&mut conn, id).await?;
    Ok(Response::ok(updated.to_json()))
}

// ─── GET / ───

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let account_id = p.query("accountId");
    let status = p.query("status");

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "accountId" AS "account_id!",
                  "periodStart" AS "period_start!", "periodEnd" AS "period_end!",
                  "statementEndingBalance" AS "statement_ending_balance!: i64",
                  "status" AS "status!", "residualAtClose" AS "residual_at_close!: i64",
                  "reconciledAt" AS reconciled_at,
                  "adjustmentTransactionId" AS adjustment_transaction_id,
                  "adjustmentReason" AS adjustment_reason,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "ReconciliationSession"
            WHERE (?1 IS NULL OR "accountId" = ?1)
              AND (?2 IS NULL OR "status" = ?2)
            ORDER BY "periodEnd" DESC, "createdAt" DESC"#,
        account_id,
        status
    )
    .fetch_all(pool)
    .await?;

    let out: Vec<SessionShape> = rows
        .into_iter()
        .map(|r| {
            Session {
                id: r.id,
                account_id: r.account_id,
                period_start: r.period_start,
                period_end: r.period_end,
                statement_ending_balance: r.statement_ending_balance,
                status: r.status,
                residual_at_close: r.residual_at_close,
                reconciled_at: r.reconciled_at,
                adjustment_transaction_id: r.adjustment_transaction_id,
                adjustment_reason: r.adjustment_reason,
                created_at: r.created_at,
                updated_at: r.updated_at,
            }
            .to_json()
        })
        .collect();

    Ok(Response::ok(out))
}

// ─── Candidate transactions ───

/// One app transaction the reconciler considered.
pub(crate) struct Candidate {
    pub id: String,
    pub date: String,
    pub name: String,
    pub amount: i64,
    pub net_amount: i64,
    pub tx_type: String,
    pub to_account_id: Option<String>,
    pub expense_id: Option<String>,
    pub income_id: Option<String>,
    pub trade_direction: Option<String>,
    pub note: Option<String>,
}

/// The transactions a reconciliation considers, in one place.
///
/// Both the matcher and the detail view need exactly this set, and the window
/// rules are subtle enough that two copies would drift: rows are loaded with
/// padding because a charge dated on the last day of a period can post after it,
/// and fully-offset rows are excluded because they move no cash and the bank
/// never prints them.
///
/// Amounts are compared as `netAmount`, never gross `amount`. Rewards and gift
/// cards settle before the charge reaches the card, so a $200.00 basket with
/// $60.00 of rewards prints as $140.00 on the statement. The residual already
/// sums `netAmount`, so using gross here would also put the matcher and the
/// residual in disagreement about the same transaction.
pub(crate) async fn load_candidates(
    conn: &mut SqliteConnection,
    account_id: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Result<Vec<Candidate>, ApiError> {
    let from = crate::id::date_at_utc_midnight(period_start - Duration::days(LOAD_PAD_DAYS));
    // The upper bound is the padded day's END, because a stored date is midnight
    // and `<=` against that day's midnight would still include it — but a row
    // carrying a time-of-day (703 exist in production, stamped at local noon by
    // one 2026-04-11 import) would sort past it and vanish.
    let to = format!(
        "{}T23:59:59.999Z",
        (period_end + Duration::days(LOAD_PAD_DAYS)).format("%Y-%m-%d")
    );

    let rows = sqlx::query!(
        r#"SELECT t."id" AS "id!", t."date" AS "date!", t."name" AS "name!",
                  t."amount" AS "amount!: i64", t."netAmount" AS "net_amount!: i64",
                  t."type" AS "tx_type!", t."toAccountId" AS to_account_id,
                  t."expenseId" AS expense_id, t."incomeId" AS income_id,
                  d."direction" AS trade_direction, t."note"
             FROM "Transaction" t
             LEFT JOIN "TradeDetail" d ON d."transactionId" = t."id"
            WHERE t."parentId" IS NULL
              AND t."date" >= ?2 AND t."date" <= ?3
              AND (t."accountId" = ?1 OR (t."toAccountId" = ?1 AND t."type" = 'TRANSFER'))
              AND t."netAmount" <> 0
            ORDER BY t."date" ASC, t."createdAt" ASC"#,
        account_id,
        from,
        to
    )
    .fetch_all(&mut *conn)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Candidate {
            id: r.id,
            date: r.date,
            name: r.name,
            amount: r.amount,
            net_amount: r.net_amount,
            tx_type: r.tx_type,
            to_account_id: r.to_account_id,
            expense_id: r.expense_id,
            income_id: r.income_id,
            trade_direction: r.trade_direction,
            note: r.note,
        })
        .collect())
}

/// The subset of the given ids a `ScheduledTransaction` is matched to.
///
/// Merging such a row deletes it and reverts its scheduled item to PENDING, so
/// the UI discloses it before the merge (reconcile-merge Req 5.3).
async fn scheduled_match_ids(
    conn: &mut SqliteConnection,
    ids: &[String],
) -> Result<HashSet<String>, ApiError> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    // No `IN (?)` expansion: sqlx's compile-time macros cannot bind a list, and
    // building the SQL by hand would need `AssertSqlSafe`. One indexed lookup
    // per id against `ReconciliationMatch_transactionId_idx` is cheap enough at
    // the sizes involved (a statement period, not the whole ledger).
    let mut out = HashSet::new();
    for id in ids {
        let n = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "ScheduledTransaction" WHERE "transactionId" = ?"#,
            id
        )
        .fetch_one(&mut *conn)
        .await?;
        if n > 0 {
            out.insert(id.clone());
        }
    }
    Ok(out)
}

fn trade_dir(s: Option<&str>) -> Option<TradeDirection> {
    match s {
        Some("BUY") => Some(TradeDirection::Buy),
        Some("SELL") => Some(TradeDirection::Sell),
        _ => None,
    }
}

// ─── GET /{id} ───

pub async fn detail(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let session = require_session(&mut conn, id).await?;

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "sessionId" AS "session_id!",
                  "postedDate" AS "posted_date!", "transactionDate" AS "transaction_date!",
                  "description" AS "description!", "amount" AS "amount!: i64",
                  "rawLine" AS "raw_line!", "createdAt" AS "created_at!"
             FROM "StatementRow" WHERE "sessionId" = ?
            ORDER BY "postedDate" ASC, "createdAt" ASC"#,
        id
    )
    .fetch_all(&mut *conn)
    .await?;

    let matches = sqlx::query!(
        r#"SELECT "id" AS "id!", "sessionId" AS "session_id!",
                  "statementRowId" AS "statement_row_id!", "transactionId" AS "transaction_id!",
                  "matchType" AS "match_type!", "createdAt" AS "created_at!"
             FROM "ReconciliationMatch" WHERE "sessionId" = ?"#,
        id
    )
    .fetch_all(&mut *conn)
    .await?;

    let residual = avoir_db::reconciliation::compute(&mut conn, id)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("Reconciliation session"))?;

    // The displayed candidates must match what the matcher considers, so the
    // load window runs to whichever is later — the cutoff or the statement's
    // last posted row — mirroring the match route. Otherwise a cutoff before the
    // statement's end would hide, in step 2, rows the matcher paired against.
    let period_start = parse_date(&session.period_start)
        .ok_or_else(|| ApiError::new(500, "stored periodStart is not a date"))?;
    let period_end = parse_date(&session.period_end)
        .ok_or_else(|| ApiError::new(500, "stored periodEnd is not a date"))?;
    let last_posted = rows.last().and_then(|r| parse_date(&r.posted_date));
    let load_end = match last_posted {
        Some(d) if d > period_end => d,
        _ => period_end,
    };

    let candidates =
        load_candidates(&mut conn, &session.account_id, period_start, load_end).await?;
    let ids: Vec<String> = candidates.iter().map(|c| c.id.clone()).collect();
    let scheduled = scheduled_match_ids(&mut conn, &ids).await?;

    let app_transactions: Vec<Value> = candidates
        .iter()
        .map(|t| {
            json!({
                "id": t.id,
                "date": t.date,
                "name": t.name,
                // What the account was actually charged — the figure the bank prints.
                "amount": Cents(t.net_amount).abs().as_dollars_f64(),
                // Gross-minus-net offset, retained for the correction path. 0 for
                // go-forward rows (the rewardsApplied discount was retired);
                // non-zero only where history has the two diverging.
                "offset": Cents(t.amount - t.net_amount).as_dollars_f64(),
                "type": t.tx_type,
                "inbound": t.to_account_id.as_deref() == Some(session.account_id.as_str()),
                // Lets the UI's shared appTxDirection sign a Cash Wallet sell as a credit.
                "tradeDirection": t.trade_direction,
                "note": t.note,
                // Disclosure (reconcile-merge Req 5): what a merge would drop.
                "recurringLink": t.expense_id.is_some() || t.income_id.is_some(),
                "scheduledMatch": scheduled.contains(&t.id),
            })
        })
        .collect();

    Ok(Response::ok(SessionDetailShape {
        session: session.to_json(),
        statement_rows: rows
            .iter()
            .map(|r| StatementRowShape {
                id: r.id.clone(),
                session_id: r.session_id.clone(),
                posted_date: r.posted_date.clone(),
                transaction_date: r.transaction_date.clone(),
                description: r.description.clone(),
                amount: Cents(r.amount).as_dollars_f64(),
                raw_line: r.raw_line.clone(),
                created_at: r.created_at.clone(),
            })
            .collect(),
        matches: matches
            .iter()
            .map(|m| MatchShape {
                id: m.id.clone(),
                session_id: m.session_id.clone(),
                statement_row_id: m.statement_row_id.clone(),
                transaction_id: m.transaction_id.clone(),
                match_type: m.match_type.clone(),
                created_at: m.created_at.clone(),
            })
            .collect(),
        app_transactions,
        residual: residual_json(&residual),
    }))
}

// ─── POST /{id}/import ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct ImportBody {
    csv: String,
}

pub async fn import(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ImportBody = crate::body_of(body)?;
    if b.csv.is_empty() {
        return Err(crate::recurring::required("csv"));
    }

    // ONE transaction for the whole handler, reads included.
    //
    // The pool holds a single connection, so `acquire()` followed by `begin()`
    // is a self-deadlock — it surfaces as "pool timed out", which reads like a
    // slow query rather than a bug in the handler's own shape. This is the third
    // time; the reliable answer is to open the transaction first and never take
    // a second connection.
    let mut tx = pool.begin().await?;
    let session = require_session(&mut tx, id).await?;
    if session.status != "DRAFT" {
        return Err(ApiError::conflict(
            "Only a draft session can import a statement",
        ));
    }

    // Nothing is written on a parse failure — a partially imported statement
    // produces a residual indistinguishable from a real discrepancy.
    let parsed = statement::parse(&b.csv)
        .map_err(|e| ApiError::bad_request(format!("Line {}: {}", e.line, e.message)))?;

    // Deduping is by COUNT per line, not by presence.
    //
    // Two byte-identical CSV lines are not a mistake — a bank prints two rows
    // when you buy the same $3.29 item twice on one day, and that is common
    // enough to appear several times in a single statement. Treating the line as
    // a unique key silently dropped the second one, which then had nothing on
    // the bank side to pair with: the app's second transaction surfaced as an
    // unexplained leftover and, because its twin had matched, was reported as a
    // probable double entry. A correct transaction accused of being a duplicate
    // is the worst possible output here, and it originated three layers upstream.
    //
    // Counting preserves the reason the check exists — importing the same file
    // twice still adds nothing, because the stored count already covers it —
    // while letting a file that genuinely contains a line twice store it twice.
    let existing = sqlx::query_scalar!(
        r#"SELECT "rawLine" AS "raw_line!" FROM "StatementRow" WHERE "sessionId" = ?"#,
        id
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut stored: HashMap<&str, usize> = HashMap::new();
    for line in &existing {
        *stored.entry(line.as_str()).or_insert(0) += 1;
    }

    let mut incoming: HashMap<&str, usize> = HashMap::new();
    let mut fresh = Vec::new();
    for r in &parsed.rows {
        let n = incoming.entry(r.raw_line.as_str()).or_insert(0);
        *n += 1;
        if *n > stored.get(r.raw_line.as_str()).copied().unwrap_or(0) {
            fresh.push(r);
        }
    }

    // The period must describe EVERY row the session holds, not just the file
    // that arrived last. Importing a second statement used to overwrite the
    // window with the new file's coverage while keeping the older rows, leaving
    // the session comparing a February statement against a July window — and the
    // residual sums app transactions through periodEnd, so that silently
    // compares two different spans.
    let now = now_iso();
    for r in &fresh {
        let row_id = cuid();
        let posted = crate::id::date_at_utc_midnight(r.posted_date);
        let txn = crate::id::date_at_utc_midnight(r.transaction_date);
        let amount = r.amount.0;
        sqlx::query!(
            r#"INSERT INTO "StatementRow"
                 ("id","sessionId","postedDate","transactionDate","description",
                  "amount","rawLine","createdAt")
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)"#,
            row_id,
            id,
            posted,
            txn,
            r.description,
            amount,
            r.raw_line,
            now
        )
        .execute(&mut *tx)
        .await?;
    }

    // Only periodStart is derived — it is the matching window's start and must
    // cover the earliest statement row. periodEnd is the user's cutoff, set at
    // creation and via PATCH, and is NOT derived from the file: deriving it is
    // what welded the residual to the statement's last posted date and hid the
    // very activity the user needed inside the comparison. It stays as-is.
    let min_posted = sqlx::query_scalar!(
        r#"SELECT MIN("postedDate") FROM "StatementRow" WHERE "sessionId" = ?"#,
        id
    )
    .fetch_one(&mut *tx)
    .await?;
    let period_start = match min_posted {
        Some(d) => d,
        None => crate::id::date_at_utc_midnight(parsed.period_start),
    };
    sqlx::query!(
        r#"UPDATE "ReconciliationSession" SET "periodStart" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        period_start,
        now,
        id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(Response::ok(ImportedShape {
        imported: fresh.len(),
        skipped_duplicates: parsed.rows.len() - fresh.len(),
        period_start,
        period_end: session.period_end,
    }))
}

// ─── POST /{id}/match ───

pub async fn run_match(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    // One transaction for the handler: the window heal, the reads the matcher
    // needs, and the pairings it produces all land together. Also the shape
    // that makes the single-connection self-deadlock unavailable — see the
    // note in `import`.
    let mut tx = pool.begin().await?;
    let session = require_session(&mut tx, id).await?;
    if session.status != "DRAFT" {
        return Err(ApiError::conflict("Only a draft session can be matched"));
    }

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "postedDate" AS "posted_date!",
                  "transactionDate" AS "transaction_date!",
                  "description" AS "description!", "amount" AS "amount!: i64"
             FROM "StatementRow" WHERE "sessionId" = ?"#,
        id
    )
    .fetch_all(&mut *tx)
    .await?;

    /*
     * The period must cover every row the session holds, and matching is where
     * that gets enforced rather than assumed.
     *
     * The window decides which app transactions the matcher can even see, so a
     * period narrower than the rows silently starves it: a session holding five
     * months of statement lines under a two-week window loaded a fortnight of
     * transactions and reported every older line as missing from the app. That
     * is indistinguishable, on screen, from a hundred real discrepancies.
     *
     * Import already widens the period, but a session imported before that rule
     * existed keeps its stale window forever — nothing else recomputes it, and
     * re-importing the same file is a no-op that leaves it wrong. Recomputing
     * here means any such session heals the next time it is matched.
     */
    let stored_start = parse_date(&session.period_start)
        .ok_or_else(|| ApiError::new(500, "stored periodStart is not a date"))?;
    let period_end = parse_date(&session.period_end)
        .ok_or_else(|| ApiError::new(500, "stored periodEnd is not a date"))?;

    let posted: Vec<NaiveDate> = rows
        .iter()
        .filter_map(|r| parse_date(&r.posted_date))
        .collect();
    let period_start = posted.iter().min().copied().unwrap_or(stored_start);
    // Only periodStart heals here — it must cover the earliest statement row or
    // matching starves. periodEnd is the user's cutoff and is never recomputed.
    if period_start != stored_start {
        let s = crate::id::date_at_utc_midnight(period_start);
        let now = now_iso();
        sqlx::query!(
            r#"UPDATE "ReconciliationSession" SET "periodStart" = ?, "updatedAt" = ? WHERE "id" = ?"#,
            s,
            now,
            id
        )
        .execute(&mut *tx)
        .await?;
    }

    // The matcher's endDate is the cutoff — it decides whether an unmatched app
    // charge is recent enough to be pending vs. a genuine phantom, and "recent"
    // is measured against the moment the user is reconciling to.
    //
    // The LOAD window, though, must still cover every statement row even when
    // the cutoff predates the statement's last posted line, or those late rows
    // come back as missing-from-app — the false-discrepancy failure this whole
    // feature exists to avoid. So it runs to whichever of the two is later.
    let max_posted = posted.iter().max().copied();
    let load_end = match max_posted {
        Some(d) if d > period_end => d,
        _ => period_end,
    };

    let candidates = load_candidates(&mut tx, &session.account_id, period_start, load_end).await?;

    let statement: Vec<StatementLine> = rows
        .iter()
        .map(|r| StatementLine {
            id: Some(r.id.clone()),
            date: parse_date(&r.transaction_date).unwrap_or(period_end),
            description: r.description.clone(),
            amount: Cents(r.amount).abs(),
            direction: if r.amount < 0 {
                Direction::Charge
            } else {
                Direction::Credit
            },
        })
        .collect();

    let app: Vec<AppTx> = candidates
        .iter()
        .map(|t| AppTx {
            id: t.id.clone(),
            date: parse_date(&t.date).unwrap_or(period_end),
            name: t.name.clone(),
            amount: Cents(t.net_amount).abs(),
            direction: app_tx_direction(
                &t.tx_type,
                t.to_account_id.as_deref() == Some(session.account_id.as_str()),
                trade_dir(t.trade_direction.as_deref()),
            ),
            // Lets the matcher pair a trade whose computed amount drifts a
            // couple of cents from the broker's settled figure — the one case
            // where a statement descriptor is too verbose for the name gate to
            // ever be reachable.
            is_trade: t.tx_type == "TRADE",
        })
        .collect();

    let result = reconcile(&statement, &app, period_end, &ReconcileOptions::default());

    // Persist only the pairings; the classification itself is recomputed on
    // demand so a re-run always reflects current data rather than a stale
    // snapshot.
    //
    // Rows are identified by the id carried through the matcher, NOT by their
    // values. Keying on (date, description) collapsed every same-merchant charge
    // on a day into one entry — five Walmart charges became one row with five
    // matches and four rows reported as missing from the app.
    let mut to_create: Vec<(String, String, &'static str)> = Vec::new();
    for f in &result.findings {
        if !f.kind.is_pairing() {
            continue;
        }
        let match_type = f.kind.match_type();
        let lines = f.statement.iter().chain(f.statements.iter());
        let apps: Vec<&AppTx> = f.app.iter().chain(f.apps.iter()).collect();
        for line in lines {
            let Some(row_id) = &line.id else { continue };
            for a in &apps {
                to_create.push((row_id.clone(), a.id.clone(), match_type));
            }
        }
    }

    // A MANUAL match is a decision the user made by hand; the automatic pass
    // must never overwrite it. Re-running match is routine (it happens after
    // every resolution), so wiping manual pairings here would silently destroy
    // work the user could not get back.
    let manual = sqlx::query!(
        r#"SELECT "statementRowId" AS "row_id!", "transactionId" AS "tx_id!"
             FROM "ReconciliationMatch"
            WHERE "sessionId" = ? AND "matchType" = 'MANUAL'"#,
        id
    )
    .fetch_all(&mut *tx)
    .await?;
    let manual_rows: HashSet<&str> = manual.iter().map(|m| m.row_id.as_str()).collect();
    let manual_txs: HashSet<&str> = manual.iter().map(|m| m.tx_id.as_str()).collect();

    // Anything a manual pairing already claims is off-limits to the auto pass —
    // otherwise a row could end up paired both ways at once.
    let auto: Vec<&(String, String, &str)> = to_create
        .iter()
        .filter(|(row, tx, _)| {
            !manual_rows.contains(row.as_str()) && !manual_txs.contains(tx.as_str())
        })
        .collect();

    let now = now_iso();
    sqlx::query!(
        r#"DELETE FROM "ReconciliationMatch" WHERE "sessionId" = ? AND "matchType" <> 'MANUAL'"#,
        id
    )
    .execute(&mut *tx)
    .await?;

    // `skipDuplicates` in Prisma; `OR IGNORE` here, against the unique index on
    // (statementRowId, transactionId).
    //
    // It should never fire. The matcher assigns globally best-first and gives
    // each row to at most one finding, so no pair can be proposed twice — which
    // is what lets `matched` below report `auto.len()` honestly rather than
    // over-counting silently ignored inserts. Kept anyway, because the cost of
    // being wrong about that is a 500 in the middle of a reconciliation, and the
    // cost of the guard is nothing.
    for (row_id, tx_id, match_type) in &auto {
        let match_id = cuid();
        sqlx::query!(
            r#"INSERT OR IGNORE INTO "ReconciliationMatch"
                 ("id","sessionId","statementRowId","transactionId","matchType","createdAt")
               VALUES (?, ?, ?, ?, ?, ?)"#,
            match_id,
            id,
            row_id,
            tx_id,
            match_type,
            now
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let mut summary = Map::new();
    for (kind, n) in &result.summary {
        summary.insert(kind.as_str().into(), json!(n));
    }
    let count = |k: avoir_core::matcher::FindingKind| -> usize {
        result.summary.get(&k).copied().unwrap_or(0)
    };
    use avoir_core::matcher::FindingKind as K;

    Ok(Response::ok(MatchRunShape {
        matched: auto.len() + manual.len(),
        unmatched_statement: count(K::MissingInApp),
        unmatched_app: count(K::MissingInBankPhantom) + count(K::MissingInBankPending),
        summary: Value::Object(summary),
    }))
}

// ─── POST /{id}/matches ───

#[derive(Deserialize, Default)]
#[serde(default)]
struct MatchBody {
    #[serde(rename = "statementRowId")]
    statement_row_id: String,
    #[serde(rename = "transactionId")]
    transaction_id: String,
}

pub async fn create_match(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: MatchBody = crate::body_of(body)?;
    if b.statement_row_id.trim().is_empty() {
        return Err(crate::recurring::required("statementRowId"));
    }
    if b.transaction_id.trim().is_empty() {
        return Err(crate::recurring::required("transactionId"));
    }

    let mut conn = pool.acquire().await?;
    let row = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "StatementRow" WHERE "id" = ? AND "sessionId" = ?"#,
        b.statement_row_id,
        id
    )
    .fetch_one(&mut *conn)
    .await?;
    if row == 0 {
        return Err(ApiError::new(
            404,
            "Statement row not found in this session",
        ));
    }

    let tx_exists = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Transaction" WHERE "id" = ?"#,
        b.transaction_id
    )
    .fetch_one(&mut *conn)
    .await?;
    if tx_exists == 0 {
        return Err(ApiError::not_found("Transaction"));
    }

    let match_id = cuid();
    let now = now_iso();
    let inserted = sqlx::query!(
        r#"INSERT INTO "ReconciliationMatch"
             ("id","sessionId","statementRowId","transactionId","matchType","createdAt")
           VALUES (?, ?, ?, ?, 'MANUAL', ?)"#,
        match_id,
        id,
        b.statement_row_id,
        b.transaction_id,
        now
    )
    .execute(&mut *conn)
    .await;

    if let Err(e) = inserted {
        if is_unique_violation(&e) {
            return Err(ApiError::conflict("These rows are already matched"));
        }
        return Err(e.into());
    }

    Ok(Response::created(MatchShape {
        id: match_id,
        session_id: id.to_string(),
        statement_row_id: b.statement_row_id,
        transaction_id: b.transaction_id,
        match_type: "MANUAL".into(),
        created_at: now,
    }))
}

// ─── DELETE /{id}/matches/{matchId} ───

pub async fn delete_match(
    pool: &SqlitePool,
    id: &str,
    match_id: &str,
) -> Result<Response, ApiError> {
    let n = sqlx::query!(
        r#"DELETE FROM "ReconciliationMatch" WHERE "id" = ? AND "sessionId" = ?"#,
        match_id,
        id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::not_found("Match"));
    }
    Ok(Response::ok(SuccessShape { success: true }))
}

// ─── POST /{id}/abandon ───

/// Abandoning DELETES the session rather than marking it abandoned (ADR-029).
///
/// A session is scaffolding for one sitting: its statement rows and pairings are
/// a parse of a CSV the user still has, rebuildable in seconds. Nothing in them
/// is a judgement — decisions the user actually made are written to the
/// transactions' notes precisely so they outlive the session that produced them.
/// Keeping the scaffolding therefore stores nothing and cost ~1,000 rows per
/// attempt; 28 abandoned sessions had accumulated 25,848 statement rows, none of
/// which any code read.
///
/// The cascade does the work: `StatementRow` and `ReconciliationMatch` both
/// cascade from the session, and `ReconciliationMatch` additionally cascades
/// from `StatementRow`. **Transactions do NOT cascade** — a match holds a
/// transaction, not the reverse — so resolutions already applied are real ledger
/// writes and survive untouched. That is the property that must never regress,
/// and it is pinned by a test.
///
/// A RECONCILED session is refused. Once a session closes, its rows are the
/// evidence of what was reconciled against and what the residual was at close —
/// the one case where they are not rebuildable, because the export may be gone.
pub async fn abandon(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let session = require_session(&mut conn, id).await?;
    if session.status == "RECONCILED" {
        return Err(ApiError::conflict(
            "A reconciled session cannot be abandoned",
        ));
    }
    sqlx::query!(r#"DELETE FROM "ReconciliationSession" WHERE "id" = ?"#, id)
        .execute(&mut *conn)
        .await?;
    Ok(Response::ok(SuccessShape { success: true }))
}
