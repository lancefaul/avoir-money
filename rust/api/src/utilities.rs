//! `/utilities` — providers, their services, and the meter readings that bill.
//!
//! Ported from `routes/utilities.providers.ts` and
//! `routes/utilities.readings.ts`.
//!
//! # Two numeric representations in one table
//!
//! `UtilityReading` is the clearest case of ADR-033's split. `cost`,
//! `convenienceFee` and `otherFees` are money and are INTEGER cents.
//! `usage` and `unitCost` are a **quantity and a unit rate** and are TEXT
//! exact decimal — `unitCost` reaches 18 significant decimals in production,
//! which cents would flatten to zero. They are passed through as strings and
//! never summed in SQL.
//!
//! # Deletion is refused, not cascaded
//!
//! A provider with services, and a service with readings, both refuse
//! deletion with a 409. The FKs are `ON DELETE RESTRICT`, so the database
//! agrees, but the check is done up front to produce a message that says
//! which relationship is in the way rather than a constraint error.
//!
//! # Entering a reading can move money
//!
//! When a service is linked to a recurring expense, saving a reading pushes
//! the resolved total onto that month's transaction **through the ledger
//! gate** — never with a direct write. That path is exactly how
//! `Account.balance` drifted before ADR-013: four code paths updated
//! `Transaction.amount` without recomputing `netAmount` or firing the hooks.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::money::Cents;
use avoir_core::utility::{total_bill, FeeType};
use avoir_db::ledger::{self, LedgerUpdate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

// ═══ Providers ═══

async fn provider_json(pool: &SqlitePool, id: &str) -> Result<ProviderShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT p."id" AS "id!", p."name" AS "name!", p."createdAt" AS "created_at!",
                  p."updatedAt" AS "updated_at!",
                  (SELECT group_concat(DISTINCT s."serviceType")
                     FROM "UtilityService" s WHERE s."providerId" = p."id")
                      AS "service_types: String"
             FROM "UtilityProvider" p WHERE p."id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Provider"))?;
    let mut service_types: Vec<String> = r
        .service_types
        .unwrap_or_default()
        .split(',')
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();
    service_types.sort();
    Ok(ProviderShape {
        id: r.id,
        name: r.name,
        service_types,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// A utility provider. Two sites built this from separate `json!` literals.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderShape {
    id: String,
    name: String,
    /// The kinds of service this provider supplies, distinct and sorted.
    ///
    /// Carried on the provider so the nav can show what a provider IS without
    /// fetching its services — services are nested under a provider, so the
    /// list would otherwise need one request per row. It replaces a hardcoded
    /// match on provider NAMES, which only worked for the providers someone had
    /// already added to the list and disclosed which ones those were.
    service_types: Vec<String>,
    created_at: String,
    updated_at: String,
}

/// A service under a provider.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceShape {
    id: String,
    provider_id: String,
    service_type: String,
    metering: String,
    expense_id: Option<String>,
    created_at: String,
    updated_at: String,
}

/// One bill.
///
/// `usage` and `unitCost` stay EXACT decimal strings on disk and are parsed to
/// numbers only for the wire — never cents (ADR-033). `unitCost` reaches 18
/// decimals in production, which cents would flatten to zero.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadingShape {
    id: String,
    bill_date: String,
    usage: Option<f64>,
    cost: f64,
    unit_cost: Option<f64>,
    details: Option<Value>,
    created_at: String,
    convenience_fee: Option<f64>,
    convenience_fee_type: Option<String>,
    other_fees: Option<f64>,
    due_date: Option<String>,
    service_id: String,
}

pub async fn list_providers(pool: &SqlitePool) -> Result<Response, ApiError> {
    // One query, not one per provider: `group_concat` over the join collapses
    // each provider's distinct service types into a single row.
    let rows = sqlx::query!(
        r#"SELECT p."id" AS "id!", p."name" AS "name!", p."createdAt" AS "created_at!",
                  p."updatedAt" AS "updated_at!",
                  (SELECT group_concat(DISTINCT s."serviceType")
                     FROM "UtilityService" s WHERE s."providerId" = p."id")
                      AS "service_types: String"
             FROM "UtilityProvider" p ORDER BY p."name" ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| {
                let mut types: Vec<String> = r
                    .service_types
                    .unwrap_or_default()
                    .split(',')
                    .filter(|t| !t.is_empty())
                    .map(str::to_string)
                    .collect();
                types.sort();
                ProviderShape {
                    id: r.id,
                    name: r.name,
                    service_types: types,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                }
            })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

pub async fn create_provider(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: NameBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    // `UtilityProvider_name_key` is UNIQUE; without this the violation reached
    // sqlx and came back a 500. Same defect, same shape, as budget groups.
    let taken = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "UtilityProvider" WHERE "name" = ?"#,
        b.name
    )
    .fetch_one(pool)
    .await?;
    if taken > 0 {
        return Err(ApiError::conflict(
            "A provider with this name already exists",
        ));
    }
    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "UtilityProvider" ("id","name","createdAt","updatedAt") VALUES (?,?,?,?)"#,
        id,
        b.name,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(provider_json(pool, &id).await?))
}

pub async fn update_provider(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: NameBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    let now = now_iso();
    let n = sqlx::query!(
        r#"UPDATE "UtilityProvider" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        b.name,
        now,
        id
    )
    .execute(pool)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(ApiError::not_found("Provider"));
    }
    Ok(Response::ok(provider_json(pool, id).await?))
}

pub async fn delete_provider(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    provider_json(pool, id).await?;
    let count = sqlx::query!(
        r#"SELECT COUNT(*) AS "n!: i64" FROM "UtilityService" WHERE "providerId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?
    .n;
    // Checked up front so the message names the relationship in the way. The
    // FK is RESTRICT, so the database would refuse too — with an error that
    // says nothing useful to the person who clicked delete.
    if count > 0 {
        return Err(ApiError::conflict(
            "Cannot delete provider that has active services",
        ));
    }
    sqlx::query!(r#"DELETE FROM "UtilityProvider" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ═══ Services ═══

async fn service_json(pool: &SqlitePool, id: &str) -> Result<ServiceShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "providerId" AS "provider_id!",
                  "serviceType" AS "service_type!", "metering" AS "metering!",
                  "expenseId" AS "expense_id: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "UtilityService" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Service"))?;
    Ok(ServiceShape {
        id: r.id,
        provider_id: r.provider_id,
        service_type: r.service_type,
        metering: r.metering,
        expense_id: r.expense_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

pub async fn list_services(pool: &SqlitePool, provider_id: &str) -> Result<Response, ApiError> {
    // An absent provider returned `200 []`, which says "this provider has no
    // services" about a provider that does not exist — indistinguishable, to a
    // caller, from a real provider with nothing on it. The reference 404s.
    provider_json(pool, provider_id).await?;
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "UtilityService"
            WHERE "providerId" = ? ORDER BY "serviceType" ASC"#,
        provider_id
    )
    .fetch_all(pool)
    .await?;
    let mut out = Vec::new();
    for r in rows {
        out.push(service_json(pool, &r.id).await?);
    }
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ServiceBody {
    #[serde(rename = "serviceType")]
    service_type: String,
    metering: String,
    #[serde(rename = "expenseId")]
    expense_id: Option<String>,
}

pub async fn create_service(
    pool: &SqlitePool,
    provider_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ServiceBody = crate::body_of(body)?;
    if b.service_type.is_empty() {
        return Err(crate::recurring::required("serviceType"));
    }
    if b.metering.is_empty() {
        return Err(crate::recurring::required("metering"));
    }
    /*
     * Both columns are CHECK-constrained, so an unknown value reached SQLite
     * and returned 500. Checked here instead, which is both the right status
     * and the only version that names the field.
     */
    const TYPES: [&str; 7] = [
        "ELECTRIC", "GAS", "WATER", "GARBAGE", "SEWAGE", "INTERNET", "CELLULAR",
    ];
    if !TYPES.contains(&b.service_type.as_str()) {
        return Err(ApiError::invalid_field(
            "serviceType",
            format!(
                "Invalid enum value. Expected 'ELECTRIC' | 'GAS' | 'WATER' | 'GARBAGE' | 'SEWAGE' | 'INTERNET' | 'CELLULAR', received '{}'",
                b.service_type
            ),
        ));
    }
    if !["METERED", "UNMETERED"].contains(&b.metering.as_str()) {
        return Err(ApiError::invalid_field(
            "metering",
            format!(
                "Invalid enum value. Expected 'METERED' | 'UNMETERED', received '{}'",
                b.metering
            ),
        ));
    }
    provider_json(pool, provider_id).await?;
    // One service of each type per provider — a UNIQUE (providerId, serviceType)
    // index that was likewise surfacing as a 500.
    let dup = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "UtilityService"
            WHERE "providerId" = ? AND "serviceType" = ?"#,
        provider_id,
        b.service_type
    )
    .fetch_one(pool)
    .await?;
    if dup > 0 {
        return Err(ApiError::conflict(
            "This provider already has a service of this type",
        ));
    }

    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "UtilityService"
             ("id","providerId","serviceType","metering","expenseId","createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?)"#,
        id,
        provider_id,
        b.service_type,
        b.metering,
        b.expense_id,
        now,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(service_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ServicePatch {
    #[serde(rename = "serviceType")]
    service_type: Option<String>,
    metering: Option<String>,
}

pub async fn update_service(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ServicePatch = crate::body_of(body)?;
    service_json(pool, id).await?;
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "UtilityService"
              SET "serviceType" = COALESCE(?, "serviceType"),
                  "metering" = COALESCE(?, "metering"),
                  "updatedAt" = ?
            WHERE "id" = ?"#,
        b.service_type,
        b.metering,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(service_json(pool, id).await?))
}

pub async fn delete_service(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    service_json(pool, id).await?;
    let count = sqlx::query!(
        r#"SELECT COUNT(*) AS "n!: i64" FROM "UtilityReading" WHERE "serviceId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?
    .n;
    // Readings are the billing history. Deleting the service that produced
    // them would orphan the record of what was actually charged.
    if count > 0 {
        return Err(ApiError::conflict(
            "Cannot delete service that has associated readings",
        ));
    }
    sqlx::query!(r#"DELETE FROM "UtilityService" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ─── Linking a service to a recurring expense ───

/// Delete the future PENDING rows of a linked expense.
///
/// Linking changes what the occurrence is expected to cost, so rows computed
/// from the old association are stale. SNOOZED rows are left standing: the
/// amount moved, not the date.
async fn invalidate_expense_schedule(pool: &SqlitePool, expense_id: &str) -> Result<(), ApiError> {
    sqlx::query!(
        r#"DELETE FROM "ScheduledTransaction"
            WHERE "sourceType" = 'EXPENSE' AND "sourceId" = ? AND "status" = 'PENDING'"#,
        expense_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct LinkBody {
    #[serde(rename = "expenseId")]
    expense_id: String,
}

pub async fn link_service(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: LinkBody = crate::body_of(body)?;
    let current = service_json(pool, id).await?;

    // Re-pointing a link leaves the OLD expense's schedule stale too, so both
    // sides are invalidated. Only invalidating the new one leaves the previous
    // expense still quoting a utility amount it no longer receives.
    if let Some(old) = current.expense_id.as_deref() {
        if old != b.expense_id {
            invalidate_expense_schedule(pool, old).await?;
        }
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "UtilityService" SET "expenseId" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        b.expense_id,
        now,
        id
    )
    .execute(pool)
    .await?;

    invalidate_expense_schedule(pool, &b.expense_id).await?;
    Ok(Response::ok(service_json(pool, id).await?))
}

pub async fn unlink_service(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let current = service_json(pool, id).await?;
    if let Some(old) = current.expense_id.as_deref() {
        invalidate_expense_schedule(pool, old).await?;
    }
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "UtilityService" SET "expenseId" = NULL, "updatedAt" = ? WHERE "id" = ?"#,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(service_json(pool, id).await?))
}

// ═══ Readings ═══

async fn reading_json(pool: &SqlitePool, id: &str) -> Result<ReadingShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "billDate" AS "bill_date!", "usage" AS "usage: String",
                  "cost" AS "cost!: i64", "unitCost" AS "unit_cost: String",
                  "details" AS "details: String", "createdAt" AS "created_at!",
                  "convenienceFee" AS "convenience_fee: i64",
                  "convenienceFeeType" AS "convenience_fee_type: String",
                  "otherFees" AS "other_fees: i64", "dueDate" AS "due_date: String",
                  "serviceId" AS "service_id!"
             FROM "UtilityReading" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Reading"))?;

    Ok(ReadingShape {
        id: r.id,
        bill_date: r.bill_date,
        usage: r.usage.as_deref().and_then(|v| v.parse::<f64>().ok()),
        cost: Cents(r.cost).as_dollars_f64(),
        unit_cost: r.unit_cost.as_deref().and_then(|v| v.parse::<f64>().ok()),
        details: r
            .details
            .as_deref()
            .and_then(|d| serde_json::from_str::<Value>(d).ok()),
        created_at: r.created_at,
        convenience_fee: r.convenience_fee.map(|v| Cents(v).as_dollars_f64()),
        convenience_fee_type: r.convenience_fee_type,
        other_fees: r.other_fees.map(|v| Cents(v).as_dollars_f64()),
        due_date: r.due_date,
        service_id: r.service_id,
    })
}

pub async fn list_readings(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let service_id = p.query("serviceId").filter(|s| !s.is_empty());
    let from = p.query("dateFrom").filter(|s| !s.is_empty());
    let to = p.query("dateTo").filter(|s| !s.is_empty());

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "UtilityReading"
            WHERE (?1 IS NULL OR "serviceId" = ?1)
              AND (?2 IS NULL OR "billDate" >= ?2)
              AND (?3 IS NULL OR "billDate" <= ?3)
            ORDER BY "billDate" DESC"#,
        service_id,
        from,
        to
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::new();
    for r in rows {
        out.push(reading_json(pool, &r.id).await?);
    }
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ReadingBody {
    #[serde(rename = "serviceId")]
    service_id: String,
    #[serde(rename = "billDate")]
    bill_date: String,
    usage: Option<f64>,
    /*
     * `Option`, not `f64`, and the struct's `#[serde(default)]` is why. With a
     * bare `f64` a body that omits `cost` deserializes to 0.0 and a bill with no
     * amount is stored as a bill for nothing — found on 2026-08-12, where Rust
     * answered 201 to a reading with no cost while the reference answered 400.
     */
    cost: Option<f64>,
    #[serde(rename = "unitCost")]
    unit_cost: Option<f64>,
    details: Option<Value>,
    #[serde(rename = "convenienceFee")]
    convenience_fee: Option<f64>,
    #[serde(rename = "convenienceFeeType")]
    convenience_fee_type: Option<String>,
    #[serde(rename = "otherFees")]
    other_fees: Option<f64>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
}

/// Push the resolved bill total onto the linked expense's transaction for the
/// month the reading is FOR.
///
/// The month comes from `dueDate` when present, falling back to `billDate` —
/// a bill dated the 28th and due the 5th belongs to the period it is paid in.
///
/// The write goes through `ledger_update`, never a direct one. Updating
/// `Transaction.amount` without recomputing `netAmount` and firing the hooks
/// is the precise defect ADR-013 was written about; utility readings were one
/// of the four paths that did it.
async fn push_amount_to_linked_transaction(
    pool: &SqlitePool,
    service_id: &str,
    total: Cents,
    match_date: &str,
) -> Result<(), ApiError> {
    let expense_id = sqlx::query!(
        r#"SELECT "expenseId" AS "expense_id: String" FROM "UtilityService" WHERE "id" = ?"#,
        service_id
    )
    .fetch_optional(pool)
    .await?
    .and_then(|r| r.expense_id);

    let Some(expense_id) = expense_id else {
        return Ok(());
    };

    // Same calendar month as the reading. Dates are stored as UTC-midnight
    // ISO strings, so a lexicographic prefix IS the month — no parsing, and
    // no timezone to get wrong.
    let month_prefix = format!("{}%", &match_date[..7.min(match_date.len())]);
    let tx = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "Transaction"
            WHERE "expenseId" = ? AND "date" LIKE ? LIMIT 1"#,
        expense_id,
        month_prefix
    )
    .fetch_optional(pool)
    .await?
    .map(|r| r.id);

    if let Some(tx_id) = tx {
        let mut conn = pool.acquire().await?;
        ledger::ledger_update(
            &mut conn,
            &tx_id,
            &LedgerUpdate {
                amount: Some(total),
                ..Default::default()
            },
        )
        .await?;
    }

    invalidate_expense_schedule(pool, &expense_id).await?;
    Ok(())
}

fn resolve_total(b: &ReadingBody) -> Cents {
    total_bill(
        // Only reached after `validate_reading`, which refuses a missing cost.
        Cents::from_dollars_f64(b.cost.unwrap_or_default()),
        b.convenience_fee.map(Cents::from_dollars_f64),
        FeeType::from_stored(b.convenience_fee_type.as_deref()),
        b.other_fees.map(Cents::from_dollars_f64),
    )
}

/// Everything about a reading that is not "does the service exist".
///
/// Added 2026-08-12 after the differential harness drove this endpoint for the
/// first time and found FOUR rejections it was not making. A reading with no
/// cost was stored as a bill for £0; a negative cost was stored as written; an
/// unknown `convenienceFeeType` was accepted; and `billDate: "last Tuesday"`
/// was persisted verbatim, because the field is a `String` that nothing ever
/// parsed. The last one is the serious one — every period query reads that
/// column, and a row whose date is a sentence is invisible to all of them.
///
/// The reference validated all four in Zod and this port validated none of
/// them, which is precisely the shape the whole coverage exercise exists to
/// find: a handler returning the right row is constrained by the row, while a
/// handler ACCEPTING a wrong one is constrained by nothing.
fn validate_reading(b: &ReadingBody) -> Result<(), ApiError> {
    let cost = b
        .cost
        .ok_or_else(|| ApiError::invalid_field("cost", "Required"))?;
    if cost < 0.0 {
        return Err(ApiError::invalid_field(
            "cost",
            "Number must be greater than or equal to 0",
        ));
    }
    // A date is a date. `parse_date` reads the leading `YYYY-MM-DD`, which is
    // what every other date-taking handler in this crate uses.
    if crate::id::parse_date(&b.bill_date).is_none() {
        return Err(ApiError::invalid_field("billDate", "Invalid date"));
    }
    if let Some(d) = b.due_date.as_deref().filter(|s| !s.is_empty()) {
        if crate::id::parse_date(d).is_none() {
            return Err(ApiError::invalid_field("dueDate", "Invalid date"));
        }
    }
    for (name, value) in [
        ("usage", b.usage),
        ("unitCost", b.unit_cost),
        ("convenienceFee", b.convenience_fee),
        ("otherFees", b.other_fees),
    ] {
        if value.is_some_and(|v| v < 0.0) {
            return Err(ApiError::invalid_field(
                name,
                "Number must be greater than or equal to 0",
            ));
        }
    }
    if let Some(t) = b.convenience_fee_type.as_deref().filter(|s| !s.is_empty()) {
        if !["dollar", "percent"].contains(&t) {
            return Err(ApiError::invalid_field(
                "convenienceFeeType",
                format!("Invalid enum value. Expected 'dollar' | 'percent', received '{t}'"),
            ));
        }
    }
    Ok(())
}

pub async fn create_reading(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: ReadingBody = crate::body_of(body)?;
    if b.service_id.is_empty() {
        return Err(crate::recurring::required("serviceId"));
    }
    if b.bill_date.is_empty() {
        return Err(crate::recurring::required("billDate"));
    }
    /*
     * Body BEFORE existence, matching the reference — and not as a stylistic
     * echo. `@hono/zod-openapi` validates against the schema in middleware, so
     * the handler there never sees a malformed body at all. Checking the
     * service first would mean a request that is wrong in both ways reports
     * "Service not found" here and a field error there.
     *
     * It also decides whether these rejections can be tested offline: with the
     * lookup first, every validation probe needs a real service to exist, so
     * `refusals.rs` had to skip all four. Now they replay against an empty
     * database — which is how a mutation removing the date check was caught.
     */
    validate_reading(&b)?;
    // A reading against a service that does not exist is a bad request, not a
    // 404 — the caller supplied the id in the body, not the path.
    if service_json(pool, &b.service_id).await.is_err() {
        return Err(ApiError::bad_request("Service not found"));
    }

    let id = cuid();
    let now = now_iso();
    let cost = Cents::from_dollars_f64(b.cost.unwrap_or_default()).0;
    let fee = b.convenience_fee.map(|v| Cents::from_dollars_f64(v).0);
    let other = b.other_fees.map(|v| Cents::from_dollars_f64(v).0);
    let usage = b.usage.map(|v| v.to_string());
    let unit_cost = b.unit_cost.map(|v| v.to_string());
    let details = b.details.as_ref().map(|d| d.to_string());

    sqlx::query!(
        r#"INSERT INTO "UtilityReading"
             ("id","billDate","usage","cost","unitCost","details","createdAt",
              "convenienceFee","convenienceFeeType","otherFees","dueDate","serviceId")
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"#,
        id,
        b.bill_date,
        usage,
        cost,
        unit_cost,
        details,
        now,
        fee,
        b.convenience_fee_type,
        other,
        b.due_date,
        b.service_id
    )
    .execute(pool)
    .await?;

    let match_date = b.due_date.clone().unwrap_or_else(|| b.bill_date.clone());
    push_amount_to_linked_transaction(pool, &b.service_id, resolve_total(&b), &match_date).await?;

    Ok(Response::created(reading_json(pool, &id).await?))
}

/// `UpdateUtilityReadingSchema` is `CreateUtilityReadingSchema.partial()`, so
/// every field is optional and an omitted one must be left exactly as it was.
///
/// Reusing the create struct here was a real bug: `#[serde(default)]` turns an
/// absent `cost` into `0.0`, and the UPDATE wrote every column
/// unconditionally — so a PUT sending only `usage` silently zeroed the bill
/// and nulled the fees. Every field is `Option` and every column is COALESCEd.
#[derive(Deserialize, Default)]
#[serde(default)]
struct ReadingPatch {
    #[serde(rename = "serviceId")]
    service_id: Option<String>,
    #[serde(rename = "billDate")]
    bill_date: Option<String>,
    usage: Option<f64>,
    cost: Option<f64>,
    #[serde(rename = "unitCost")]
    unit_cost: Option<f64>,
    details: Option<Value>,
    #[serde(rename = "convenienceFee")]
    convenience_fee: Option<f64>,
    #[serde(rename = "convenienceFeeType")]
    convenience_fee_type: Option<String>,
    #[serde(rename = "otherFees")]
    other_fees: Option<f64>,
    #[serde(rename = "dueDate")]
    due_date: Option<String>,
}

pub async fn update_reading(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    reading_json(pool, id).await?;
    let b: ReadingPatch = crate::body_of(body)?;

    let cost = b.cost.map(|v| Cents::from_dollars_f64(v).0);
    let fee = b.convenience_fee.map(|v| Cents::from_dollars_f64(v).0);
    let other = b.other_fees.map(|v| Cents::from_dollars_f64(v).0);
    let usage = b.usage.map(|v| v.to_string());
    let unit_cost = b.unit_cost.map(|v| v.to_string());
    let details = b.details.as_ref().map(|d| d.to_string());

    sqlx::query!(
        r#"UPDATE "UtilityReading"
              SET "billDate" = COALESCE(?, "billDate"),
                  "usage" = COALESCE(?, "usage"),
                  "cost" = COALESCE(?, "cost"),
                  "unitCost" = COALESCE(?, "unitCost"),
                  "details" = COALESCE(?, "details"),
                  "convenienceFee" = COALESCE(?, "convenienceFee"),
                  "convenienceFeeType" = COALESCE(?, "convenienceFeeType"),
                  "otherFees" = COALESCE(?, "otherFees"),
                  "dueDate" = COALESCE(?, "dueDate"),
                  "serviceId" = COALESCE(?, "serviceId")
            WHERE "id" = ?"#,
        b.bill_date,
        usage,
        cost,
        unit_cost,
        details,
        fee,
        b.convenience_fee_type,
        other,
        b.due_date,
        b.service_id,
        id
    )
    .execute(pool)
    .await?;

    // Recompute from the MERGED row, not from the request. A patch that
    // changes only the convenience fee still has to push the whole bill, and
    // computing it from the body alone would treat every unsent field as zero.
    let merged = sqlx::query!(
        r#"SELECT "serviceId" AS "service_id!", "cost" AS "cost!: i64",
                  "convenienceFee" AS "fee: i64",
                  "convenienceFeeType" AS "fee_type: String",
                  "otherFees" AS "other: i64",
                  "billDate" AS "bill_date!", "dueDate" AS "due_date: String"
             FROM "UtilityReading" WHERE "id" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;

    let total = total_bill(
        Cents(merged.cost),
        merged.fee.map(Cents),
        FeeType::from_stored(merged.fee_type.as_deref()),
        merged.other.map(Cents),
    );
    let match_date = merged.due_date.clone().unwrap_or(merged.bill_date);
    push_amount_to_linked_transaction(pool, &merged.service_id, total, &match_date).await?;

    Ok(Response::ok(reading_json(pool, id).await?))
}

pub async fn delete_reading(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let existing = reading_json(pool, id).await?;
    let service_id = existing.service_id;

    sqlx::query!(r#"DELETE FROM "UtilityReading" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;

    // The expense's expected amount was derived from this reading, so the
    // future occurrences computed from it are stale.
    let expense_id = sqlx::query!(
        r#"SELECT "expenseId" AS "expense_id: String" FROM "UtilityService" WHERE "id" = ?"#,
        service_id
    )
    .fetch_optional(pool)
    .await?
    .and_then(|r| r.expense_id);
    if let Some(e) = expense_id {
        invalidate_expense_schedule(pool, &e).await?;
    }

    Ok(Response::no_content())
}
