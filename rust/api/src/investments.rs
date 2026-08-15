//! `/investments` — holdings, and the custodians and wallets that hold them.
//!
//! Ported from `routes/investments.ts` and `routes/investments.entities.ts`.
//!
//! # Two numbers, two representations, in one row
//!
//! `InvestmentHolding` is where ADR-033's split is most visible:
//! `quantity` is a **quantity** (TEXT exact decimal — BTC needs 8 places and
//! production snapshots reach 20) while `costBasis` is **money** (INTEGER
//! cents). The JSON contract is dollars-and-units for both, so this module
//! converts in one direction on read and the other on write, and never lets
//! SQL touch `quantity` arithmetically.
//!
//! # Deleting an entity that something still points at
//!
//! Custodians and wallets both refuse deletion while a **non-zero** holding
//! references them, and both then delete their zero-quantity holdings before
//! removing themselves. That asymmetry is deliberate and worth stating: a
//! zero-quantity holding is a spent position, not a record of anything, and
//! leaving it behind would make the custodian undeletable forever with nothing
//! to show for it. A non-zero holding is somebody's money.
//!
//! The trade and payment guards are the part that could not exist before
//! ADR-027. When `custodianId` lived inside a JSON blob the route had to
//! hand-roll a JSON-path existence check; they are real foreign keys now, so
//! these are ordinary queries — and the wallet guard covers bitcoin payments
//! as well as trades, which the JSON-era check missed entirely.

use crate::id::{cuid, now_iso, parse_date};
use crate::recurring::{present, required};
use crate::{ApiError, Response};
use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

use avoir_core::money::Cents;

/// A stored TEXT quantity as the JSON number the frontend schema expects.
///
/// `z.number()` is what the contract says, so the conversion has to happen
/// somewhere; doing it here — at the serialisation boundary, once — keeps
/// every arithmetic step before it exact.
pub(crate) fn qty_to_f64(s: &str) -> f64 {
    s.parse::<Decimal>()
        .ok()
        .and_then(|d| d.to_f64())
        .unwrap_or(0.0)
}

/// A JSON number as the exact decimal to store.
///
/// **Via the f64's own shortest decimal spelling, not via its bits.**
/// `Decimal::from_f64_retain` — which is the function that looks right — keeps
/// the full binary expansion, so one satoshi arrives as
/// `0.0000000100000000000000002092`. That is the ADR-033 float-noise defect
/// being written afresh at the boundary the whole TEXT representation exists to
/// protect, and it is invisible until something compares two quantities.
///
/// Rust's `Display` for `f64` emits the shortest decimal that round-trips to
/// the same value, which is by construction what the user typed before JSON
/// turned it into a float. Parsing that string recovers it exactly.
///
/// A value too small or too large for `Decimal`'s 28 significant digits has no
/// decimal spelling to recover, and falls back to zero rather than to noise.
pub(crate) fn f64_to_qty(v: f64) -> String {
    Decimal::from_str(&format!("{v}"))
        .unwrap_or(Decimal::ZERO)
        .normalize()
        .to_string()
}

// ═══ Holdings ═══

struct HoldingRow {
    id: String,
    name: String,
    ticker: Option<String>,
    ty: String,
    quantity: String,
    cost_basis: Option<i64>,
    custodian_id: Option<String>,
    wallet_id: Option<String>,
    created_at: String,
    updated_at: String,
}

/// A holding.
///
/// `quantity` is decimal TEXT on disk (ADR-033 — it measures units, not money)
/// and parses to f64 only here, for display.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingShape {
    id: String,
    name: String,
    ticker: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    quantity: f64,
    cost_basis: Option<f64>,
    custodian_id: Option<String>,
    wallet_id: Option<String>,
    created_at: String,
    updated_at: String,
}

/// A snapshot of a holding on a date.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotShape {
    id: String,
    holding_id: String,
    date: String,
    quantity: f64,
    value: Option<f64>,
    created_at: String,
}

/// A holding as the LIST returns it: the record plus the names of what holds it
/// and its most recent snapshot. Composed rather than patched onto the base.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HoldingListShape {
    #[serde(flatten)]
    holding: HoldingShape,
    custodian_name: Option<String>,
    wallet_name: Option<String>,
    latest_snapshot: Option<SnapshotShape>,
}

/// A custodian. Two sites built this from separate `json!` literals.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CustodianShape {
    id: String,
    name: String,
    management_url: Option<String>,
    created_at: String,
    updated_at: String,
}

/// A wallet — a custodian plus where the keys live.
///
/// Deliberately not `#[serde(flatten)]` over `CustodianShape`: the two are the
/// same SHAPE by coincidence, not the same thing, and a wallet gaining a field
/// should not silently give custodians one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WalletShape {
    id: String,
    name: String,
    management_url: Option<String>,
    custody_type: String,
    storage_type: Option<String>,
    created_at: String,
    updated_at: String,
}

fn holding_json(r: &HoldingRow) -> HoldingShape {
    HoldingShape {
        id: r.id.clone(),
        name: r.name.clone(),
        ticker: r.ticker.clone(),
        kind: r.ty.clone(),
        quantity: qty_to_f64(&r.quantity),
        cost_basis: r.cost_basis.map(|c| Cents(c).as_dollars_f64()),
        custodian_id: r.custodian_id.clone(),
        wallet_id: r.wallet_id.clone(),
        created_at: r.created_at.clone(),
        updated_at: r.updated_at.clone(),
    }
}

async fn load_holding(pool: &SqlitePool, id: &str) -> Result<HoldingRow, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "ticker", "type" AS "ty!",
                  "quantity" AS "quantity!", "costBasis" AS "cost_basis: i64",
                  "custodianId" AS custodian_id, "walletId" AS wallet_id,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "InvestmentHolding" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Investment holding"))?;
    Ok(HoldingRow {
        id: r.id,
        name: r.name,
        ticker: r.ticker,
        ty: r.ty,
        quantity: r.quantity,
        cost_basis: r.cost_basis,
        custodian_id: r.custodian_id,
        wallet_id: r.wallet_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// Every holding that still holds something, with its newest snapshot.
///
/// The `quantity > 0` filter is applied in Rust, not SQL. It has to be:
/// `quantity` is TEXT, and `WHERE "quantity" > 0` in SQLite compares a string
/// against a number under type affinity rules that do not mean what they look
/// like — `'0.5' > 0` is true only by accident of coercion, and `'-1'` would
/// pass a lexicographic comparison. Parsing is the only honest test.
pub async fn list(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT h."id" AS "id!", h."name" AS "name!", h."ticker",
                  h."type" AS "ty!", h."quantity" AS "quantity!",
                  h."costBasis" AS "cost_basis: i64",
                  h."custodianId" AS custodian_id, h."walletId" AS wallet_id,
                  h."createdAt" AS "created_at!", h."updatedAt" AS "updated_at!",
                  c."name" AS custodian_name, w."name" AS wallet_name
             FROM "InvestmentHolding" h
             LEFT JOIN "Custodian" c ON c."id" = h."custodianId"
             LEFT JOIN "Wallet" w ON w."id" = h."walletId"
            ORDER BY h."name" ASC"#
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::new();
    for r in rows {
        if qty_to_f64(&r.quantity) <= 0.0 {
            continue;
        }
        let snap = sqlx::query!(
            r#"SELECT "id" AS "id!", "holdingId" AS "holding_id!", "date" AS "date!",
                      "quantity" AS "quantity!", "value" AS "value: i64",
                      "createdAt" AS "created_at!"
                 FROM "InvestmentSnapshot" WHERE "holdingId" = ?
                ORDER BY "date" DESC LIMIT 1"#,
            r.id
        )
        .fetch_optional(pool)
        .await?;

        let row = HoldingRow {
            id: r.id,
            name: r.name,
            ticker: r.ticker,
            ty: r.ty,
            quantity: r.quantity,
            cost_basis: r.cost_basis,
            custodian_id: r.custodian_id,
            wallet_id: r.wallet_id,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
        out.push(HoldingListShape {
            holding: holding_json(&row),
            custodian_name: r.custodian_name,
            wallet_name: r.wallet_name,
            latest_snapshot: snap.map(|s| SnapshotShape {
                id: s.id,
                holding_id: s.holding_id,
                date: s.date,
                quantity: qty_to_f64(&s.quantity),
                value: s.value.map(|c| Cents(c).as_dollars_f64()),
                created_at: s.created_at,
            }),
        });
    }
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HoldingBody {
    name: String,
    ticker: Option<String>,
    #[serde(rename = "type")]
    ty: String,
    quantity: f64,
    #[serde(rename = "costBasis")]
    cost_basis: Option<f64>,
    #[serde(rename = "custodianId")]
    custodian_id: Option<String>,
    #[serde(rename = "walletId")]
    wallet_id: Option<String>,
}

/// The `type`-to-owner pairing `CreateInvestmentHoldingSchema` enforces with a
/// `superRefine`: a stock is held by a custodian, bitcoin by a wallet, and
/// neither may carry the other's owner.
fn check_owner_pairing(
    ty: &str,
    custodian_id: &Option<String>,
    wallet_id: &Option<String>,
    require_owner: bool,
) -> Result<(), ApiError> {
    match ty {
        "STOCK" => {
            if require_owner && custodian_id.is_none() {
                return Err(ApiError {
                    status: 400,
                    error: "Validation failed".into(),
                    details: Some(json!([{ "field": "custodianId",
                        "message": "custodianId is required for stock holdings" }])),
                });
            }
            if wallet_id.is_some() {
                return Err(ApiError {
                    status: 400,
                    error: "Validation failed".into(),
                    details: Some(json!([{ "field": "walletId",
                        "message": "walletId must not be set for stock holdings" }])),
                });
            }
        }
        "BITCOIN" => {
            if require_owner && wallet_id.is_none() {
                return Err(ApiError {
                    status: 400,
                    error: "Validation failed".into(),
                    details: Some(json!([{ "field": "walletId",
                        "message": "walletId is required for bitcoin holdings" }])),
                });
            }
            if custodian_id.is_some() {
                return Err(ApiError {
                    status: 400,
                    error: "Validation failed".into(),
                    details: Some(json!([{ "field": "custodianId",
                        "message": "custodianId must not be set for bitcoin holdings" }])),
                });
            }
        }
        other => {
            return Err(ApiError::bad_request(format!(
                "Unknown investment type: {other}"
            )))
        }
    }
    Ok(())
}

/// Both foreign keys exist, checked before the insert so the failure is a 400
/// naming the field rather than a raw constraint violation.
async fn check_owner_exists(
    pool: &SqlitePool,
    custodian_id: &Option<String>,
    wallet_id: &Option<String>,
) -> Result<(), ApiError> {
    if let Some(cid) = custodian_id {
        let n = sqlx::query_scalar!(r#"SELECT count(*) FROM "Custodian" WHERE "id" = ?"#, cid)
            .fetch_one(pool)
            .await?;
        if n == 0 {
            return Err(ApiError::bad_request("Custodian not found"));
        }
    }
    if let Some(wid) = wallet_id {
        let n = sqlx::query_scalar!(r#"SELECT count(*) FROM "Wallet" WHERE "id" = ?"#, wid)
            .fetch_one(pool)
            .await?;
        if n == 0 {
            return Err(ApiError::bad_request("Wallet not found"));
        }
    }
    Ok(())
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: HoldingBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(required("name"));
    }
    if b.quantity < 0.0 {
        return Err(ApiError::bad_request("quantity must not be negative"));
    }
    check_owner_pairing(&b.ty, &b.custodian_id, &b.wallet_id, true)?;
    check_owner_exists(pool, &b.custodian_id, &b.wallet_id).await?;

    let id = cuid();
    let now = now_iso();
    let qty = f64_to_qty(b.quantity);
    let basis = b.cost_basis.map(|c| Cents::from_dollars_f64(c).0);
    sqlx::query!(
        r#"INSERT INTO "InvestmentHolding"
             ("id","name","ticker","type","quantity","costBasis","custodianId","walletId",
              "createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?,?)"#,
        id,
        b.name,
        b.ticker,
        b.ty,
        qty,
        basis,
        b.custodian_id,
        b.wallet_id,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(holding_json(
        &load_holding(pool, &id).await?,
    )))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HoldingPatch {
    name: Option<String>,
    #[serde(deserialize_with = "present")]
    ticker: Option<Option<String>>,
    #[serde(rename = "type")]
    ty: Option<String>,
    quantity: Option<f64>,
    #[serde(rename = "costBasis", deserialize_with = "present")]
    cost_basis: Option<Option<f64>>,
    #[serde(rename = "custodianId", deserialize_with = "present")]
    custodian_id: Option<Option<String>>,
    #[serde(rename = "walletId", deserialize_with = "present")]
    wallet_id: Option<Option<String>>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: HoldingPatch = crate::body_of(body)?;
    let existing = load_holding(pool, id).await?;

    // The pairing rule is checked against the row as it will be, not as it was
    // — otherwise moving a holding from a custodian to a wallet in one PUT
    // would be judged against the type it is leaving.
    let ty = b.ty.clone().unwrap_or_else(|| existing.ty.clone());
    let custodian_id = match &b.custodian_id {
        Some(v) => v.clone(),
        None => existing.custodian_id.clone(),
    };
    let wallet_id = match &b.wallet_id {
        Some(v) => v.clone(),
        None => existing.wallet_id.clone(),
    };
    check_owner_pairing(&ty, &custodian_id, &wallet_id, false)?;
    check_owner_exists(pool, &custodian_id, &wallet_id).await?;

    if b.quantity.is_some_and(|q| q < 0.0) {
        return Err(ApiError::bad_request("quantity must not be negative"));
    }

    let qty = b.quantity.map(f64_to_qty);
    let basis = b
        .cost_basis
        .map(|o| o.map(|c| Cents::from_dollars_f64(c).0));
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "InvestmentHolding"
              SET "name" = COALESCE(?1, "name"),
                  "ticker" = CASE WHEN ?2 THEN ?3 ELSE "ticker" END,
                  "type" = ?4,
                  "quantity" = COALESCE(?5, "quantity"),
                  "costBasis" = CASE WHEN ?6 THEN ?7 ELSE "costBasis" END,
                  "custodianId" = ?8,
                  "walletId" = ?9,
                  "updatedAt" = ?10
            WHERE "id" = ?11"#,
        b.name,
        // `Option<Option<T>>` is the whole reason these are two placeholders:
        // the outer layer says the key was present, the inner says what it was
        // set to. Collapsing them would make `ticker: null` — clear the field —
        // indistinguishable from omitting `ticker`, which is a silent no-op.
        b.ticker.is_some(),
        b.ticker.as_ref().and_then(|o| o.clone()),
        ty,
        qty,
        b.cost_basis.is_some(),
        basis.and_then(|o| o),
        custodian_id,
        wallet_id,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(holding_json(&load_holding(pool, id).await?)))
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    load_holding(pool, id).await?;

    // Transfers reference holdings with ON DELETE RESTRICT, so this check is
    // belt and braces — but the constraint failure would surface as a 500 and
    // this says what to do about it.
    let refs = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "InvestmentTransfer"
            WHERE "fromHoldingId" = ?1 OR "toHoldingId" = ?1"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if refs > 0 {
        return Err(ApiError::conflict(
            "Cannot delete holding with transfer history. Delete transfers first.",
        ));
    }

    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"DELETE FROM "InvestmentSnapshot" WHERE "holdingId" = ?"#,
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(r#"DELETE FROM "InvestmentHolding" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Response::no_content())
}

// ═══ Snapshots ═══

#[derive(Deserialize, Default)]
#[serde(default)]
struct SnapshotBody {
    date: String,
    quantity: f64,
    value: Option<f64>,
}

pub async fn create_snapshot(
    pool: &SqlitePool,
    holding_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: SnapshotBody = crate::body_of(body)?;
    load_holding(pool, holding_id).await?;

    let date = parse_date(&b.date).ok_or_else(|| ApiError::bad_request("Invalid date"))?;
    let date_s = crate::id::date_at_utc_midnight(date);
    let id = cuid();
    let now = now_iso();
    let qty = f64_to_qty(b.quantity);
    let value = b.value.map(|v| Cents::from_dollars_f64(v).0);
    sqlx::query!(
        r#"INSERT INTO "InvestmentSnapshot"
             ("id","holdingId","date","quantity","value","createdAt") VALUES (?,?,?,?,?,?)"#,
        id,
        holding_id,
        date_s,
        qty,
        value,
        now
    )
    .execute(pool)
    .await?;

    Ok(Response::created(SnapshotShape {
        id,
        holding_id: holding_id.to_string(),
        date: date_s,
        quantity: b.quantity,
        value: value.map(|c| Cents(c).as_dollars_f64()),
        created_at: now,
    }))
}

// ═══ Custodians ═══

async fn custodian_json(pool: &SqlitePool, id: &str) -> Result<CustodianShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "managementUrl" AS url,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Custodian" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Custodian"))?;
    Ok(CustodianShape {
        id: r.id,
        name: r.name,
        management_url: r.url,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

pub async fn list_custodians(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "managementUrl" AS url,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Custodian" ORDER BY "name" ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| CustodianShape {
                id: r.id,
                name: r.name,
                management_url: r.url,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CustodianBody {
    name: String,
    #[serde(rename = "managementUrl")]
    management_url: Option<String>,
}

/// An empty string is not a URL, and the frontend sends one when the field is
/// left blank — `CreateCustodianSchema` preprocesses `''` to `undefined` for
/// exactly that reason, so the same normalisation happens here.
fn blank_to_none(v: Option<String>) -> Option<String> {
    v.filter(|s| !s.trim().is_empty())
}

async fn custodian_name_taken(
    pool: &SqlitePool,
    name: &str,
    except: Option<&str>,
) -> Result<bool, ApiError> {
    let except = except.unwrap_or("");
    let n = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Custodian" WHERE "name" = ? AND "id" <> ?"#,
        name,
        except
    )
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

pub async fn create_custodian(
    pool: &SqlitePool,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: CustodianBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(required("name"));
    }
    if custodian_name_taken(pool, &b.name, None).await? {
        return Err(ApiError::conflict(
            "A custodian with this name already exists",
        ));
    }
    let id = cuid();
    let now = now_iso();
    let url = blank_to_none(b.management_url);
    sqlx::query!(
        r#"INSERT INTO "Custodian" ("id","name","managementUrl","createdAt","updatedAt")
           VALUES (?,?,?,?,?)"#,
        id,
        b.name,
        url,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(custodian_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CustodianPatch {
    name: Option<String>,
    #[serde(rename = "managementUrl", deserialize_with = "present")]
    management_url: Option<Option<String>>,
}

pub async fn update_custodian(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: CustodianPatch = crate::body_of(body)?;
    custodian_json(pool, id).await?;
    if let Some(name) = &b.name {
        if name.trim().is_empty() {
            return Err(required("name"));
        }
        if custodian_name_taken(pool, name, Some(id)).await? {
            return Err(ApiError::conflict(
                "A custodian with this name already exists",
            ));
        }
    }
    let url = b.management_url.as_ref().map(|o| blank_to_none(o.clone()));
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "Custodian"
              SET "name" = COALESCE(?1, "name"),
                  "managementUrl" = CASE WHEN ?2 THEN ?3 ELSE "managementUrl" END,
                  "updatedAt" = ?4
            WHERE "id" = ?5"#,
        b.name,
        url.is_some(),
        url.and_then(|o| o),
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(custodian_json(pool, id).await?))
}

pub async fn delete_custodian(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    custodian_json(pool, id).await?;

    // Parsed in Rust rather than compared in SQL, for the reason `list` gives.
    let quantities = sqlx::query_scalar!(
        r#"SELECT "quantity" AS "quantity!" FROM "InvestmentHolding" WHERE "custodianId" = ?"#,
        id
    )
    .fetch_all(pool)
    .await?;
    if quantities.iter().any(|q| qty_to_f64(q) > 0.0) {
        return Err(ApiError::conflict(
            "Cannot delete: referenced by active holdings",
        ));
    }

    let trades = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "TradeDetail" WHERE "custodianId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if trades > 0 {
        return Err(ApiError::conflict(
            "Cannot delete: referenced by existing trades",
        ));
    }

    let mut tx = pool.begin().await?;
    // Only the zero-quantity holdings, which the check above already proved is
    // all of them.
    sqlx::query!(
        r#"DELETE FROM "InvestmentHolding" WHERE "custodianId" = ?"#,
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(r#"DELETE FROM "Custodian" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Response::no_content())
}

// ═══ Wallets ═══

async fn wallet_json(pool: &SqlitePool, id: &str) -> Result<WalletShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "managementUrl" AS url,
                  "custodyType" AS "custody!", "storageType" AS storage,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Wallet" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Wallet"))?;
    Ok(WalletShape {
        id: r.id,
        name: r.name,
        management_url: r.url,
        custody_type: r.custody,
        storage_type: r.storage,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

pub async fn list_wallets(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "managementUrl" AS url,
                  "custodyType" AS "custody!", "storageType" AS storage,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "Wallet" ORDER BY "name" ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| WalletShape {
                id: r.id,
                name: r.name,
                management_url: r.url,
                custody_type: r.custody,
                storage_type: r.storage,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct WalletBody {
    name: String,
    #[serde(rename = "managementUrl")]
    management_url: Option<String>,
    #[serde(rename = "custodyType")]
    custody_type: Option<String>,
    #[serde(rename = "storageType")]
    storage_type: Option<String>,
}

/// The custody/storage invariant `CreateWalletSchema` enforces.
///
/// Custodial means somebody else holds the keys, so *where* it is stored is a
/// property of their arrangement and must be stated. Non-custodial means the
/// keys are here, and hot/cold is then a property of this wallet — but the
/// schema chose to keep it unset rather than duplicate what the wallet already
/// is. Either way the pairing is the record's meaning, not a formality.
fn check_custody(custody: &str, storage: &Option<String>) -> Result<(), ApiError> {
    match (custody, storage) {
        ("CUSTODIAL", None) => Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "storageType",
                "message": "storageType is required for custodial wallets" }])),
        }),
        ("NON_CUSTODIAL", Some(_)) => Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": "storageType",
                "message": "storageType must not be set for non-custodial wallets" }])),
        }),
        ("CUSTODIAL", _) | ("NON_CUSTODIAL", _) => Ok(()),
        (other, _) => Err(ApiError::bad_request(format!(
            "Unknown custody type: {other}"
        ))),
    }
}

async fn wallet_name_taken(
    pool: &SqlitePool,
    name: &str,
    except: Option<&str>,
) -> Result<bool, ApiError> {
    let except = except.unwrap_or("");
    let n = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Wallet" WHERE "name" = ? AND "id" <> ?"#,
        name,
        except
    )
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

pub async fn create_wallet(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: WalletBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(required("name"));
    }
    // The schema's `.default('NON_CUSTODIAL')`.
    let custody = b.custody_type.unwrap_or_else(|| "NON_CUSTODIAL".into());
    let storage = b.storage_type.filter(|s| !s.is_empty());
    check_custody(&custody, &storage)?;
    if wallet_name_taken(pool, &b.name, None).await? {
        return Err(ApiError::conflict("A wallet with this name already exists"));
    }

    let id = cuid();
    let now = now_iso();
    let url = blank_to_none(b.management_url);
    sqlx::query!(
        r#"INSERT INTO "Wallet"
             ("id","name","managementUrl","custodyType","storageType","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?)"#,
        id,
        b.name,
        url,
        custody,
        storage,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(wallet_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct WalletPatch {
    name: Option<String>,
    #[serde(rename = "managementUrl", deserialize_with = "present")]
    management_url: Option<Option<String>>,
    #[serde(rename = "custodyType")]
    custody_type: Option<String>,
    #[serde(rename = "storageType", deserialize_with = "present")]
    storage_type: Option<Option<String>>,
}

pub async fn update_wallet(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: WalletPatch = crate::body_of(body)?;
    wallet_json(pool, id).await?;

    if let Some(name) = &b.name {
        if name.trim().is_empty() {
            return Err(required("name"));
        }
        if wallet_name_taken(pool, name, Some(id)).await? {
            return Err(ApiError::conflict("A wallet with this name already exists"));
        }
    }

    // The invariant is only re-checked when custodyType is part of the patch —
    // `UpdateWalletSchema` returns early otherwise, so a rename must not be
    // rejected for a pairing that was already stored.
    let storage = match &b.storage_type {
        Some(v) => v.clone().filter(|s| !s.is_empty()),
        None => None,
    };
    let clear_storage = if let Some(custody) = &b.custody_type {
        check_custody(custody, &storage)?;
        // Switching to non-custodial clears storageType whatever the body said.
        // The TypeScript does this unconditionally, and it has to: the pairing
        // check above would otherwise have already rejected a body that set
        // both, so the only way to arrive here is with storage absent — and
        // leaving the OLD value in place would store the combination the check
        // just refused.
        custody == "NON_CUSTODIAL"
    } else {
        false
    };

    let url = b.management_url.as_ref().map(|o| blank_to_none(o.clone()));
    let now = now_iso();
    let set_storage = b.storage_type.is_some() || clear_storage;
    let storage_value = if clear_storage { None } else { storage };
    sqlx::query!(
        r#"UPDATE "Wallet"
              SET "name" = COALESCE(?1, "name"),
                  "managementUrl" = CASE WHEN ?2 THEN ?3 ELSE "managementUrl" END,
                  "custodyType" = COALESCE(?4, "custodyType"),
                  "storageType" = CASE WHEN ?5 THEN ?6 ELSE "storageType" END,
                  "updatedAt" = ?7
            WHERE "id" = ?8"#,
        b.name,
        url.is_some(),
        url.and_then(|o| o),
        b.custody_type,
        set_storage,
        storage_value,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(wallet_json(pool, id).await?))
}

pub async fn delete_wallet(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    wallet_json(pool, id).await?;

    let quantities = sqlx::query_scalar!(
        r#"SELECT "quantity" AS "quantity!" FROM "InvestmentHolding" WHERE "walletId" = ?"#,
        id
    )
    .fetch_all(pool)
    .await?;
    if quantities.iter().any(|q| qty_to_f64(q) > 0.0) {
        return Err(ApiError::conflict(
            "Cannot delete: referenced by active holdings",
        ));
    }

    // Trades AND payments. The JSON-era guard checked only trades, because a
    // JSON-path existence check had to be written per shape and the payment
    // one never was (ADR-027).
    let trades = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "TradeDetail" WHERE "walletId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    let payments = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "BitcoinPaymentDetail" WHERE "walletId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if trades > 0 || payments > 0 {
        return Err(ApiError::conflict(
            "Cannot delete: referenced by existing trades or payments",
        ));
    }

    let mut tx = pool.begin().await?;
    sqlx::query!(
        r#"DELETE FROM "InvestmentHolding" WHERE "walletId" = ?"#,
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(r#"DELETE FROM "Wallet" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Response::no_content())
}
