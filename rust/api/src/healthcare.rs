//! `/healthcare` — insurance policies, their live balances, and the budget
//! they drive.
//!
//! Ported from `routes/healthcare.ts` and the database half of
//! `lib/healthcare.ts`. The arithmetic lives in `avoir_core::healthcare`.
//!
//! # A policy owns a budget, and the budget is where its spending is counted
//!
//! Creating a policy creates a system budget for it under an `INSURANCE` group,
//! and every balance on this page is the sum of that budget's expenses within
//! the policy year. That indirection is what lets a medical and a dental policy
//! from the same employer track separately without the user classifying each
//! receipt twice.
//!
//! # Three statuses, and only one of them is reversible by editing
//!
//! ACTIVE → ENDED → CLOSED. Ending coverage stops the policy applying while
//! leaving its budget selectable, because bills for a plan year keep arriving
//! after the plan year stops. Closing retires the budget too. A CLOSED policy
//! refuses every edit — its numbers are the record of what happened.

use crate::id::{cuid, date_at_utc_midnight, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::healthcare::{compute_capped_balance, compute_oopm_spread, RawBalance};
use avoir_core::money::Cents;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{SqliteConnection, SqlitePool};

/// The first and last instant of a policy year, in the spelling dates are
/// stored in. Compared as strings, which is exact because every stored date is
/// the same fixed-width ISO form.
fn year_bounds(year: i64) -> (String, String) {
    (
        format!("{year}-01-01T00:00:00.000Z"),
        format!("{year}-12-31T23:59:59.999Z"),
    )
}

struct Policy {
    id: String,
    ty: String,
    year: i64,
    employer: String,
    premium: i64,
    deductible_limit: Option<i64>,
    oopm_limit: Option<i64>,
    status: String,
    ended_on: Option<String>,
    closed_on: Option<String>,
    deductible_override: bool,
    oopm_override: bool,
    metadata: String,
    budget_id: Option<String>,
    created_at: String,
    updated_at: String,
}

async fn read_policy(conn: &mut SqliteConnection, id: &str) -> Result<Policy, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "type" AS "ty!", "year" AS "year!: i64",
                  "employer" AS "employer!", "premium" AS "premium!: i64",
                  "deductibleLimit" AS "deductible_limit: i64",
                  "oopmLimit" AS "oopm_limit: i64", "status" AS "status!",
                  "endedOn" AS ended_on, "closedOn" AS closed_on,
                  "deductibleOverride" AS "deductible_override!: i64",
                  "oopmOverride" AS "oopm_override!: i64",
                  "metadata" AS "metadata!", "budgetId" AS budget_id,
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "InsurancePolicy" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| ApiError::not_found("Insurance policy"))?;

    Ok(Policy {
        id: r.id,
        ty: r.ty,
        year: r.year,
        employer: r.employer,
        premium: r.premium,
        deductible_limit: r.deductible_limit,
        oopm_limit: r.oopm_limit,
        status: r.status,
        ended_on: r.ended_on,
        closed_on: r.closed_on,
        deductible_override: r.deductible_override != 0,
        oopm_override: r.oopm_override != 0,
        metadata: r.metadata,
        budget_id: r.budget_id,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

/// Everything spent under a policy's budget within its year.
///
/// Deductible and OOPM read the same total — see `avoir_core::healthcare`.
/// A policy with no budget has spent nothing by definition, because the budget
/// is the only thing that attributes spending to it.
async fn raw_balance(conn: &mut SqliteConnection, policy: &Policy) -> Result<RawBalance, ApiError> {
    let Some(budget_id) = &policy.budget_id else {
        return Ok(RawBalance {
            deductible: Cents::ZERO,
            oopm: Cents::ZERO,
        });
    };
    let (start, end) = year_bounds(policy.year);
    // SUM over INTEGER cents is exact — the reason ADR-033 put money in an
    // integer column rather than a TEXT decimal.
    let total = sqlx::query_scalar!(
        r#"SELECT COALESCE(SUM("amount"), 0) AS "total!: i64"
             FROM "Transaction"
            WHERE "type" = 'EXPENSE' AND "budgetId" = ?1
              AND "date" >= ?2 AND "date" <= ?3"#,
        budget_id,
        start,
        end
    )
    .fetch_one(&mut *conn)
    .await?;

    Ok(RawBalance {
        deductible: Cents(total),
        oopm: Cents(total),
    })
}

async fn serialize(conn: &mut SqliteConnection, policy: &Policy) -> Result<PolicyShape, ApiError> {
    let raw = raw_balance(conn, policy).await?;
    let capped = compute_capped_balance(
        raw,
        policy.deductible_limit.map(Cents),
        policy.oopm_limit.map(Cents),
        policy.deductible_override,
    );
    let dollars = |c: Cents| c.as_dollars_f64();
    let opt = |c: Option<Cents>| c.map(dollars);
    let limit_d = opt(policy.deductible_limit.map(Cents));
    let limit_o = opt(policy.oopm_limit.map(Cents));

    // `metadata` is a JSON string in the column. Re-parsed rather than passed
    // through as a string, because the schema declares it an object and the
    // frontend reads `metadata.insurer` off it.
    let metadata: Value = serde_json::from_str(&policy.metadata).unwrap_or_else(|_| json!({}));

    Ok(PolicyShape {
        id: policy.id.clone(),
        kind: policy.ty.clone(),
        year: policy.year,
        employer: policy.employer.clone(),
        premium: dollars(Cents(policy.premium)),
        deductible_limit: limit_d,
        oopm_limit: limit_o,
        status: policy.status.clone(),
        ended_on: policy.ended_on.clone(),
        closed_on: policy.closed_on.clone(),
        deductible_override: policy.deductible_override,
        oopm_override: policy.oopm_override,
        metadata,
        budget_id: policy.budget_id.clone(),
        created_at: policy.created_at.clone(),
        updated_at: policy.updated_at.clone(),
        balance: BalanceShape {
            deductible_spent: opt(capped.deductible_spent),
            deductible_raw: dollars(capped.deductible_raw),
            deductible_limit: limit_d,
            oopm_spent: opt(capped.oopm_spent),
            oopm_raw: dollars(capped.oopm_raw),
            oopm_limit: limit_o,
            deductible_override: policy.deductible_override,
            oopm_override: policy.oopm_override,
        },
    })
}

/// Where a policy stands against its two limits.
///
/// `*Spent` are the CAPPED figures and `*Raw` the uncapped ones — a deductible
/// cannot be more than met, but the raw total is what says by how much the year
/// overshot, and both are on screen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BalanceShape {
    deductible_spent: Option<f64>,
    deductible_raw: f64,
    deductible_limit: Option<f64>,
    oopm_spent: Option<f64>,
    oopm_raw: f64,
    oopm_limit: Option<f64>,
    deductible_override: bool,
    oopm_override: bool,
}

/// An insurance policy with its balance.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyShape {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    year: i64,
    employer: String,
    premium: f64,
    deductible_limit: Option<f64>,
    oopm_limit: Option<f64>,
    status: String,
    ended_on: Option<String>,
    closed_on: Option<String>,
    deductible_override: bool,
    oopm_override: bool,
    /// A JSON string in the column, re-parsed rather than passed through —
    /// the schema declares it an object and the frontend reads
    /// `metadata.insurer` off it.
    metadata: Value,
    budget_id: Option<String>,
    created_at: String,
    updated_at: String,
    balance: BalanceShape,
}

/// One healthcare transaction, as the spending list shows it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpendingRowShape {
    id: String,
    date: String,
    name: String,
    category: String,
    category_icon: Option<String>,
    payment_method: Option<String>,
    amount: f64,
}

/// Year-to-date spending on the two non-insurance healthcare budgets.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthcareSummaryShape {
    healthcare_budget_spent: f64,
    medicine_budget_spent: f64,
}

// ═══ Reads ═══

pub async fn list_years(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query_scalar!(
        r#"SELECT DISTINCT "year" AS "year!: i64" FROM "InsurancePolicy" ORDER BY "year" DESC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(json!(rows)))
}

pub async fn list_policies(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let year: i64 = p
        .query("year")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ApiError::bad_request("year is required"))?;

    let ids = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "InsurancePolicy"
            WHERE "year" = ? ORDER BY "createdAt" DESC"#,
        year
    )
    .fetch_all(pool)
    .await?;

    let mut conn = pool.acquire().await?;
    let mut out = Vec::new();
    for id in ids {
        let policy = read_policy(&mut conn, &id).await?;
        out.push(serialize(&mut conn, &policy).await?);
    }
    Ok(Response::ok(out))
}

pub async fn get_policy(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let policy = read_policy(&mut conn, id).await?;
    Ok(Response::ok(serialize(&mut conn, &policy).await?))
}

/// The expenses behind a policy's balance, so the number can be audited.
pub async fn list_transactions(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let mut conn = pool.acquire().await?;
    let policy = read_policy(&mut conn, id).await?;
    let Some(budget_id) = policy.budget_id.clone() else {
        return Ok(Response::ok(json!([])));
    };
    let (start, end) = year_bounds(policy.year);

    let rows = sqlx::query!(
        r#"SELECT t."id" AS "id!", t."date" AS "date!", t."name" AS "name!",
                  t."amount" AS "amount!: i64",
                  b."name" AS budget_name, b."icon" AS budget_icon,
                  a."name" AS account_name
             FROM "Transaction" t
             LEFT JOIN "Budget" b ON b."id" = t."budgetId"
             LEFT JOIN "Account" a ON a."id" = t."accountId"
            WHERE t."type" = 'EXPENSE' AND t."budgetId" = ?1
              AND t."date" >= ?2 AND t."date" <= ?3
            ORDER BY t."date" DESC"#,
        budget_id,
        start,
        end
    )
    .fetch_all(&mut *conn)
    .await?;

    Ok(Response::ok(
        rows.into_iter()
            .map(|r| SpendingRowShape {
                id: r.id,
                date: r.date,
                name: r.name,
                category: r.budget_name.unwrap_or_default(),
                category_icon: r.budget_icon,
                payment_method: r.account_name,
                amount: Cents(r.amount).as_dollars_f64(),
            })
            .collect::<Vec<_>>(),
    ))
}

/// Year-to-date spending on the two non-insurance healthcare budgets.
pub async fn summary(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let year: i64 = p
        .query("year")
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| ApiError::bad_request("year is required"))?;
    let (start, end) = year_bounds(year);

    // One query for both, rather than two sequential ones. The pool holds a
    // single connection, so the TypeScript's `Promise.all` serialised anyway.
    let rows = sqlx::query!(
        r#"SELECT b."name" AS "name!", COALESCE(SUM(t."amount"), 0) AS "total!: i64"
             FROM "Budget" b
             LEFT JOIN "Transaction" t
               ON t."budgetId" = b."id" AND t."type" = 'EXPENSE'
              AND t."date" >= ?1 AND t."date" <= ?2
            WHERE b."name" IN ('Healthcare', 'Medicine')
            GROUP BY b."name""#,
        start,
        end
    )
    .fetch_all(pool)
    .await?;

    // A budget that does not exist has spent nothing — the LEFT JOIN covers a
    // budget with no transactions, and this covers no budget at all.
    let find = |name: &str| {
        rows.iter()
            .find(|r| r.name == name)
            .map(|r| r.total)
            .unwrap_or(0)
    };
    let healthcare = find("Healthcare");
    let medicine = find("Medicine");

    Ok(Response::ok(HealthcareSummaryShape {
        healthcare_budget_spent: Cents(healthcare).as_dollars_f64(),
        medicine_budget_spent: Cents(medicine).as_dollars_f64(),
    }))
}

// ═══ Writes ═══

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateBody {
    #[serde(rename = "type")]
    ty: String,
    year: i64,
    employer: String,
    premium: f64,
    #[serde(rename = "deductibleLimit")]
    deductible_limit: Option<f64>,
    #[serde(rename = "oopmLimit")]
    oopm_limit: Option<f64>,
    metadata: Option<Value>,
}

fn icon_for(ty: &str) -> &'static str {
    match ty {
        "MEDICAL" => "🏥",
        "DENTAL" => "🦷",
        _ => "👓",
    }
}

pub async fn create_policy(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    crate::require_present(&body, &["year", "premium"])?;
    let b: CreateBody = crate::body_of(body)?;
    if !["MEDICAL", "DENTAL", "VISION"].contains(&b.ty.as_str()) {
        // Phrased as the reference's Zod enum error, deliberately. The FIELD is
        // the contract — it is what marks the input — but a message the user
        // reads should not change wording because the backend was rewritten.
        return Err(ApiError::invalid_field(
            "type",
            format!(
                "Invalid enum value. Expected 'MEDICAL' | 'DENTAL' | 'VISION', received '{}'",
                b.ty
            ),
        ));
    }
    if b.employer.trim().is_empty() {
        return Err(crate::recurring::required("employer"));
    }
    // `metadata: PolicyMetadataSchema` in the reference is NOT optional, and the
    // port had it `Option<Value>`. The schema is a union whose last arm is
    // `z.object({}).passthrough()`, so any OBJECT is accepted and the field is
    // still mandatory — an omitted one fails with "Invalid input", which is
    // what the harness caught.
    //
    // Worth stating why an empty object is required rather than tolerated as
    // absent: the column is where per-type policy detail lives (copays, network
    // tiers), and the difference between "this policy has no extra detail" and
    // "nobody supplied any" is one the caller is being made to state.
    match &b.metadata {
        Some(Value::Object(_)) => {}
        _ => {
            return Err(ApiError {
                status: 400,
                error: "Validation failed".into(),
                details: Some(json!([{ "field": "metadata", "message": "Invalid input" }])),
            })
        }
    }
    let deductible = b.deductible_limit.map(Cents::from_dollars_f64);
    let oopm = b.oopm_limit.map(Cents::from_dollars_f64);
    if let (Some(d), Some(o)) = (deductible, oopm) {
        if o.0 < d.0 {
            return Err(ApiError::invalid_field(
                "oopmLimit",
                "OOPM limit must be >= deductible limit",
            ));
        }
    }

    let mut tx = pool.begin().await?;
    let now = now_iso();

    // One INSURANCE group for every policy budget, created on first use.
    let group_id = match sqlx::query_scalar!(
        r#"SELECT "id" FROM "BudgetGroup" WHERE "name" = 'INSURANCE' LIMIT 1"#
    )
    .fetch_optional(&mut *tx)
    .await?
    {
        Some(id) => id,
        None => {
            let id = cuid();
            sqlx::query!(
                r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
                   VALUES (?, 'INSURANCE', 'violet50', ?)"#,
                id,
                now
            )
            .execute(&mut *tx)
            .await?;
            id
        }
    };

    let metadata = b.metadata.clone().unwrap_or_else(|| json!({}));
    let insurer = metadata
        .get("insurer")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&b.employer)
        .to_string();
    let type_label = {
        let mut cs = b.ty.chars();
        match cs.next() {
            Some(c) => format!("{c}{}", cs.as_str().to_lowercase()),
            None => String::new(),
        }
    };
    let budget_name = format!("{insurer} {type_label} {}", b.year);

    let budget_id = cuid();
    let icon = icon_for(&b.ty);
    sqlx::query!(
        r#"INSERT INTO "Budget" ("id","name","icon","groupId","isSystem","isCustom","createdAt")
           VALUES (?,?,?,?,1,0,?)"#,
        budget_id,
        budget_name,
        icon,
        group_id,
        now
    )
    .execute(&mut *tx)
    .await?;

    let id = cuid();
    let premium = Cents::from_dollars_f64(b.premium).0;
    let d = deductible.map(|c| c.0);
    let o = oopm.map(|c| c.0);
    let meta_s = metadata.to_string();
    sqlx::query!(
        r#"INSERT INTO "InsurancePolicy"
             ("id","type","year","employer","premium","deductibleLimit","oopmLimit",
              "metadata","budgetId","status","deductibleOverride","oopmOverride",
              "createdAt","updatedAt")
           VALUES (?,?,?,?,?,?,?,?,?, 'ACTIVE', 0, 0, ?, ?)"#,
        id,
        b.ty,
        b.year,
        b.employer,
        premium,
        d,
        o,
        meta_s,
        budget_id,
        now,
        now
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let mut conn = pool.acquire().await?;
    let policy = read_policy(&mut conn, &id).await?;
    Ok(Response::created(serialize(&mut conn, &policy).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct UpdateBody {
    employer: Option<String>,
    premium: Option<f64>,
    #[serde(
        rename = "deductibleLimit",
        deserialize_with = "crate::recurring::present"
    )]
    deductible_limit: Option<Option<f64>>,
    #[serde(rename = "oopmLimit", deserialize_with = "crate::recurring::present")]
    oopm_limit: Option<Option<f64>>,
    metadata: Option<Value>,
}

pub async fn update_policy(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateBody = crate::body_of(body)?;
    let mut conn = pool.acquire().await?;
    let existing = read_policy(&mut conn, id).await?;

    // A closed policy's numbers are the record of what happened.
    if existing.status == "CLOSED" {
        return Err(ApiError::new(403, "Cannot modify a closed policy"));
    }

    // Checked against the row as it will be, not as it is — otherwise raising
    // both limits in one request is judged against the old OOPM.
    let merged_d = match b.deductible_limit {
        Some(v) => v.map(Cents::from_dollars_f64),
        None => existing.deductible_limit.map(Cents),
    };
    let merged_o = match b.oopm_limit {
        Some(v) => v.map(Cents::from_dollars_f64),
        None => existing.oopm_limit.map(Cents),
    };
    if let (Some(d), Some(o)) = (merged_d, merged_o) {
        if o.0 < d.0 {
            return Err(ApiError::invalid_field(
                "oopmLimit",
                "OOPM limit must be >= deductible limit",
            ));
        }
    }

    let premium = b.premium.map(|p| Cents::from_dollars_f64(p).0);
    let meta = b.metadata.as_ref().map(|m| m.to_string());
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "InsurancePolicy"
              SET "employer" = COALESCE(?1, "employer"),
                  "premium" = COALESCE(?2, "premium"),
                  "deductibleLimit" = ?3,
                  "oopmLimit" = ?4,
                  "metadata" = COALESCE(?5, "metadata"),
                  "updatedAt" = ?6
            WHERE "id" = ?7"#,
        b.employer,
        premium,
        merged_d.map(|c| c.0),
        merged_o.map(|c| c.0),
        meta,
        now,
        id
    )
    .execute(&mut *conn)
    .await?;

    let policy = read_policy(&mut conn, id).await?;
    Ok(Response::ok(serialize(&mut conn, &policy).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct OverridesBody {
    #[serde(rename = "deductibleOverride")]
    deductible_override: Option<bool>,
    #[serde(rename = "oopmOverride")]
    oopm_override: Option<bool>,
}

pub async fn update_overrides(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: OverridesBody = crate::body_of(body)?;
    let mut conn = pool.acquire().await?;
    let existing = read_policy(&mut conn, id).await?;
    if existing.status == "CLOSED" {
        return Err(ApiError::new(403, "Cannot modify a closed policy"));
    }

    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "InsurancePolicy"
              SET "deductibleOverride" = COALESCE(?1, "deductibleOverride"),
                  "oopmOverride" = COALESCE(?2, "oopmOverride"),
                  "updatedAt" = ?3
            WHERE "id" = ?4"#,
        b.deductible_override,
        b.oopm_override,
        now,
        id
    )
    .execute(&mut *conn)
    .await?;

    // The overrides change what is left to reach the maximum, so the budget
    // that saves for it has to move with them.
    sync_oopm_to_budget(&mut conn, id).await?;

    let policy = read_policy(&mut conn, id).await?;
    Ok(Response::ok(serialize(&mut conn, &policy).await?))
}

/// Move a policy along ACTIVE → ENDED → CLOSED.
///
/// One handler for both steps because they are the same shape and differ only
/// in which status is required and which stamp is written.
pub async fn advance_status(pool: &SqlitePool, id: &str, to: &str) -> Result<Response, ApiError> {
    let (from, message) = match to {
        "ENDED" => ("ACTIVE", "Only active policies can have coverage ended"),
        _ => ("ENDED", "Only policies with ended coverage can be closed"),
    };

    let mut conn = pool.acquire().await?;
    let policy = read_policy(&mut conn, id).await?;
    if policy.status != from {
        return Err(ApiError::bad_request(message));
    }

    let stamp = date_at_utc_midnight(avoir_core::dates::today());
    let now = now_iso();
    if to == "ENDED" {
        sqlx::query!(
            r#"UPDATE "InsurancePolicy" SET "status" = 'ENDED', "endedOn" = ?1, "updatedAt" = ?2
                WHERE "id" = ?3"#,
            stamp,
            now,
            id
        )
        .execute(&mut *conn)
        .await?;
    } else {
        sqlx::query!(
            r#"UPDATE "InsurancePolicy" SET "status" = 'CLOSED', "closedOn" = ?1, "updatedAt" = ?2
                WHERE "id" = ?3"#,
            stamp,
            now,
            id
        )
        .execute(&mut *conn)
        .await?;
    }

    let policy = read_policy(&mut conn, id).await?;
    Ok(Response::ok(serialize(&mut conn, &policy).await?))
}

// ═══ Budget synchronisation ═══

/// Write the month's OOPM spread into the policy budget's version.
///
/// Every early return is a case where writing would destroy something: a closed
/// policy is history, a missing year plan or allocation means there is nowhere
/// to write, and a **manual override means somebody typed a number on purpose**
/// — the same rule `budget_links::recompute_from_links` honours, for the same
/// reason.
pub(crate) async fn sync_oopm_to_budget(
    conn: &mut SqliteConnection,
    policy_id: &str,
) -> Result<(), ApiError> {
    let policy = read_policy(&mut *conn, policy_id).await?;
    if policy.status == "CLOSED" {
        return Ok(());
    }
    let Some(budget_id) = policy.budget_id.clone() else {
        return Ok(());
    };

    let raw = raw_balance(&mut *conn, &policy).await?;
    let capped = compute_capped_balance(
        raw,
        policy.deductible_limit.map(Cents),
        policy.oopm_limit.map(Cents),
        policy.deductible_override,
    );
    let today = avoir_core::dates::today();
    let current_month = chrono::Datelike::month(&today);
    let spread = compute_oopm_spread(
        policy.oopm_limit.map(Cents),
        capped.oopm_spent.unwrap_or(Cents::ZERO),
        policy.oopm_override,
        current_month,
    );

    let plan = sqlx::query!(
        r#"SELECT "id" AS "id!", "status" AS "status!" FROM "YearPlan" WHERE "year" = ?"#,
        policy.year
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(plan) = plan else { return Ok(()) };
    if plan.status != "ACTIVE" && plan.status != "DRAFT" {
        return Ok(());
    }

    let category_budget = sqlx::query_scalar!(
        r#"SELECT "id" FROM "CategoryBudget"
            WHERE "yearPlanId" = ? AND "budgetId" = ?"#,
        plan.id,
        budget_id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(category_budget) = category_budget else {
        return Ok(());
    };

    let manual = sqlx::query_scalar!(
        r#"SELECT "manualOverride" AS "manual!: i64" FROM "BudgetVersion"
            WHERE "categoryBudgetId" = ? ORDER BY "effectiveDate" DESC LIMIT 1"#,
        category_budget
    )
    .fetch_optional(&mut *conn)
    .await?;
    if manual == Some(1) {
        return Ok(());
    }

    // One version per month: the existing one is replaced rather than joined,
    // so a month cannot accumulate siblings the way escrow records did
    // (ADR-032).
    let effective = format!(
        "{}-{:02}-01T00:00:00.000Z",
        chrono::Datelike::year(&today),
        current_month
    );
    sqlx::query!(
        r#"DELETE FROM "BudgetVersion"
            WHERE "categoryBudgetId" = ? AND "effectiveDate" = ?"#,
        category_budget,
        effective
    )
    .execute(&mut *conn)
    .await?;

    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "BudgetVersion"
             ("id","categoryBudgetId","amount","frequency","monthlyEquivalent",
              "activeMonths","manualOverride","effectiveDate","createdAt")
           VALUES (?,?,?, 'MONTHLY', ?, '[]', 0, ?, ?)"#,
        id,
        category_budget,
        spread.0,
        spread.0,
        effective,
        now
    )
    .execute(&mut *conn)
    .await?;

    Ok(())
}
