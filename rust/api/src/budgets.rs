//! `/budgets` — the categories, and the groups they hang under.
//!
//! Ported from `routes/budgets.ts`.
//!
//! # System budgets cannot be deleted or reassigned
//!
//! Uncategorized, Income, Trade, Transfer and Payment are created by an
//! idempotent seed rather than a migration (ADR-017), precisely so they can be
//! re-created if something removes them. That is a recovery mechanism, not a
//! licence to delete them: transactions point at them, and the seed would
//! re-create them under NEW ids, orphaning every reference. `isSystem` is the
//! guard, enforced with a 403.
//!
//! # Delete has two meanings, and the caller picks
//!
//! **Soft** sets `deletedAt` and retires the budget's allocations
//! (`CategoryBudget.removedAt`) without touching history — the budget stops
//! being offered, and every transaction that used it still says what it was.
//! **Hard** removes the budget and everything that references it. The two are
//! separate because the reversible one is what people almost always want, and
//! making it the default would mean the destructive one happened by omission.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

// ═══ Response shapes ═══
//
// Declared rather than assembled with `json!` at each site. The difference is
// not style: `group_json` and `list_groups` used to build the SAME shape from
// two separate `json!` literals, so nothing connected them and either could
// drift. That is not hypothetical — an invented `deletedAt` was added to one of
// them during a harness test and the other was unaffected, which is precisely
// how a response shape gets invented in the first place.
//
// Two rules these types must keep, both load-bearing:
//
//   * `rename_all = "camelCase"` — the wire is camelCase and the fields are
//     snake_case. Every name is checked once here instead of being retyped as a
//     string literal per site.
//   * NO `skip_serializing_if`. An absent field and a null field are different
//     to the frontend: `BudgetItemSchema` marks several `.nullable()`, which
//     requires the key to be PRESENT and null. Omitting it changes the contract
//     silently, and the read harness's ignore list cannot see a missing
//     optional field — that blind spot is what let three defects ship.

/// What a budget delete did.
///
/// Soft and hard delete answer with different fields, so they are different
/// types rather than one with everything optional — a soft delete never
/// reports a transaction count because it never touches transactions.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SoftDeletedShape {
    soft_deleted: bool,
}

/// A hard delete: what went with the budget.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HardDeletedShape {
    deleted: bool,
    transactions_deleted: i64,
    budgets_deleted: i64,
}

/// A delete that moved the references instead of removing them.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReassignedShape {
    reassigned: i64,
    budgets_deleted: i64,
    deleted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupShape {
    id: String,
    name: String,
    color: String,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BudgetShape {
    id: String,
    name: String,
    icon: Option<String>,
    is_custom: bool,
    created_at: String,
    group_id: String,
    is_system: bool,
    /// FLAT, not nested. The Budgets page groups its rows by `groupName` and
    /// renders a section per group; without it every row falls under `''`, no
    /// section matches, and the page shows a grand total and not one category.
    /// Both are `.optional()` in `BudgetItemSchema`, so their absence parses
    /// cleanly — which is exactly why nothing caught it.
    ///
    /// A nested `group` object and a `deletedAt` were also emitted here and are
    /// NOT in the reference. A comment claimed the nested object was "what the
    /// group editor reads"; it is not, and it cannot have been, because the
    /// reference never returned it and the frontend was built against the
    /// reference. Removed after the differential showed 140 differences on this
    /// route that were entirely those two fields across 70 budgets.
    group_name: String,
    group_color: String,
}

// ═══ Groups ═══

async fn group_json(pool: &SqlitePool, id: &str) -> Result<GroupShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "color" AS "color!",
                  "createdAt" AS "created_at!"
             FROM "BudgetGroup" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Group"))?;
    Ok(GroupShape {
        id: r.id,
        name: r.name,
        color: r.color,
        created_at: r.created_at,
    })
}

pub async fn list_groups(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "color" AS "color!",
                  "createdAt" AS "created_at!"
             FROM "BudgetGroup" ORDER BY "name" ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(Response::ok(
        rows.into_iter()
            .map(|r| GroupShape {
                id: r.id,
                name: r.name,
                color: r.color,
                created_at: r.created_at,
            })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GroupBody {
    name: String,
    color: String,
}

pub async fn create_group(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: GroupBody = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if b.color.trim().is_empty() {
        return Err(crate::recurring::required("color"));
    }
    /*
     * `BudgetGroup_name_key` is a UNIQUE index, and without this check the
     * violation reached sqlx and came back as `500 Internal server error` —
     * found on 2026-08-12 by a differential step that had never existed. The
     * reference answers 409 "Group already exists", which is both correct and
     * the only version a user can act on.
     *
     * A pre-check rather than catching the constraint, matching
     * `descriptions::create`. It races in principle — two creates of the same
     * name could both pass the check — but the index still refuses the second,
     * so the failure mode is the 500 this replaces rather than a duplicate row.
     * A single-user desktop app cannot reach that race from one window.
     */
    let taken = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "BudgetGroup" WHERE "name" = ?"#,
        b.name
    )
    .fetch_one(pool)
    .await?;
    if taken > 0 {
        return Err(ApiError::conflict("Group already exists"));
    }
    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES (?,?,?,?)"#,
        id,
        b.name,
        b.color,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(group_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GroupPatch {
    name: Option<String>,
    color: Option<String>,
}

pub async fn update_group(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: GroupPatch = crate::body_of(body)?;
    group_json(pool, id).await?;
    sqlx::query!(
        r#"UPDATE "BudgetGroup" SET "name" = COALESCE(?, "name"), "color" = COALESCE(?, "color")
            WHERE "id" = ?"#,
        b.name,
        b.color,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(group_json(pool, id).await?))
}

pub async fn delete_group(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    group_json(pool, id).await?;
    let count = sqlx::query!(
        r#"SELECT COUNT(*) AS "n!: i64" FROM "Budget" WHERE "groupId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?
    .n;
    // The count is in the message because "move them first" is only actionable
    // if you know how many there are.
    if count > 0 {
        return Err(ApiError::conflict(format!(
            "Group has {count} budgets. Delete or move them first."
        )));
    }
    sqlx::query!(r#"DELETE FROM "BudgetGroup" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ═══ Budgets ═══

async fn budget_json(pool: &SqlitePool, id: &str) -> Result<BudgetShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT b."id" AS "id!", b."name" AS "name!", b."icon" AS "icon: String",
                  b."isCustom" AS "is_custom!: i64", b."createdAt" AS "created_at!",
                  b."groupId" AS "group_id!", b."deletedAt" AS "deleted_at: String",
                  b."isSystem" AS "is_system!: i64",
                  g."name" AS "group_name!", g."color" AS "group_color!",
                  g."createdAt" AS "group_created_at!"
             FROM "Budget" b JOIN "BudgetGroup" g ON g."id" = b."groupId"
            WHERE b."id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Budget"))?;

    Ok(BudgetShape {
        id: r.id,
        name: r.name,
        icon: r.icon,
        is_custom: r.is_custom != 0,
        created_at: r.created_at,
        group_id: r.group_id,
        is_system: r.is_system != 0,
        group_name: r.group_name,
        group_color: r.group_color,
    })
}

pub async fn list_budgets(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let group_id = p.query("groupId").filter(|s| !s.is_empty());
    // Soft-deleted budgets are hidden unless asked for. They still exist
    // because transactions reference them — hiding is the whole point of the
    // soft delete.
    let include_deleted = p.query_bool("includeDeleted").unwrap_or(false) as i64;

    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "Budget"
            WHERE (?1 IS NULL OR "groupId" = ?1)
              AND (?2 = 1 OR "deletedAt" IS NULL)
            ORDER BY "name" ASC"#,
        group_id,
        include_deleted
    )
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        out.push(budget_json(pool, &r.id).await?);
    }
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct CreateBudget {
    name: String,
    icon: Option<String>,
    #[serde(rename = "groupId")]
    group_id: String,
}

pub async fn create_budget(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: CreateBudget = crate::body_of(body)?;
    if b.name.trim().is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if b.group_id.is_empty() {
        return Err(crate::recurring::required("groupId"));
    }
    group_json(pool, &b.group_id).await?;

    let id = cuid();
    let now = now_iso();
    // Anything created through this endpoint is a user's own category, so
    // isCustom is 1 and isSystem is 0 — the seed is the only thing that makes
    // a system budget.
    sqlx::query!(
        r#"INSERT INTO "Budget" ("id","name","icon","isCustom","createdAt","groupId","isSystem")
           VALUES (?,?,?,1,?,?,0)"#,
        id,
        b.name,
        b.icon,
        now,
        b.group_id
    )
    .execute(pool)
    .await?;
    Ok(Response::created(budget_json(pool, &id).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct BudgetPatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "crate::recurring::present")]
    icon: Option<Option<String>>,
    #[serde(rename = "groupId")]
    group_id: Option<String>,
}

pub async fn update_budget(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: BudgetPatch = crate::body_of(body)?;
    budget_json(pool, id).await?;
    if let Some(g) = &b.group_id {
        group_json(pool, g).await?;
    }
    let (icon_set, icon) = match &b.icon {
        None => (0i64, None),
        Some(v) => (1, v.clone()),
    };
    sqlx::query!(
        // Every placeholder numbered. Mixing bare `?` with `?N` lets SQLite
        // auto-number the bare ones from the highest index already seen, so
        // they silently collide with the explicit ones — here the name bind
        // landed on the wrong slot and the update quietly did nothing.
        r#"UPDATE "Budget"
              SET "name" = COALESCE(?1, "name"),
                  "icon" = CASE WHEN ?2 = 1 THEN ?3 ELSE "icon" END,
                  "groupId" = COALESCE(?4, "groupId")
            WHERE "id" = ?5"#,
        b.name,
        icon_set,
        icon,
        b.group_id,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(budget_json(pool, id).await?))
}

/// Refuse anything destructive on a seeded budget.
///
/// ADR-017 makes these re-creatable, which is a recovery path and not a
/// licence to remove them: the seed would bring them back under new ids and
/// every transaction pointing at the old ones would be orphaned.
async fn refuse_if_system(pool: &SqlitePool, id: &str, verb: &str) -> Result<(), ApiError> {
    let is_system = sqlx::query!(
        r#"SELECT "isSystem" AS "is_system!: i64" FROM "Budget" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .map(|r| r.is_system != 0)
    .unwrap_or(false);
    if is_system {
        return Err(ApiError::new(
            403,
            format!("System budgets cannot be {verb}"),
        ));
    }
    Ok(())
}

pub async fn delete_budget(
    pool: &SqlitePool,
    id: &str,
    p: &Path<'_>,
) -> Result<Response, ApiError> {
    // Existence check only. This used to read `deletedAt` back out of the
    // SERIALIZED response, which coupled a delete rule to the wire format — so
    // removing a field the client does not use silently allowed a double soft
    // delete. Asked of the database directly now, where the answer lives.
    budget_json(pool, id).await?;
    refuse_if_system(pool, id, "deleted").await?;

    let soft = p.query("mode").unwrap_or("hard") == "soft";
    let now = now_iso();

    if soft {
        let already = sqlx::query!(
            r#"SELECT "deletedAt" AS "deleted_at: String" FROM "Budget" WHERE "id" = ?"#,
            id
        )
        .fetch_one(pool)
        .await?
        .deleted_at
        .is_some();
        if already {
            return Err(ApiError::bad_request("Budget is already soft-deleted"));
        }
        let mut tx = pool.begin().await?;
        sqlx::query!(
            r#"UPDATE "Budget" SET "deletedAt" = ? WHERE "id" = ?"#,
            now,
            id
        )
        .execute(&mut *tx)
        .await?;
        // Retire the allocations too. A hidden budget still shaping a year
        // plan is the same invisible-influence problem archiving an expense
        // has.
        sqlx::query!(
            r#"UPDATE "CategoryBudget" SET "removedAt" = ? WHERE "budgetId" = ?"#,
            now,
            id
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        return Ok(Response::ok(SoftDeletedShape { soft_deleted: true }));
    }

    let mut tx = pool.begin().await?;
    let e = sqlx::query!(r#"DELETE FROM "Expense" WHERE "budgetId" = ?"#, id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    let i = sqlx::query!(r#"DELETE FROM "Income" WHERE "budgetId" = ?"#, id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    let g = sqlx::query!(r#"DELETE FROM "BudgetGoal" WHERE "budgetId" = ?"#, id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    let allocations = sqlx::query!(r#"DELETE FROM "CategoryBudget" WHERE "budgetId" = ?"#, id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    sqlx::query!(r#"DELETE FROM "Budget" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Response::ok(HardDeletedShape {
        deleted: true,
        transactions_deleted: e + i + g,
        budgets_deleted: allocations,
    }))
}

#[derive(Deserialize)]
struct ReassignBody {
    #[serde(rename = "targetBudgetId")]
    target_budget_id: String,
}

/// Move everything pointing at one budget onto another, then remove the source.
///
/// The alternative to a hard delete when the category was a mistake rather
/// than a period that ended — nothing is lost, it is re-filed.
pub async fn reassign_budget(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: ReassignBody = crate::body_of(body)?;
    budget_json(pool, id)
        .await
        .map_err(|_| ApiError::not_found("Source"))?;
    budget_json(pool, &b.target_budget_id)
        .await
        .map_err(|_| ApiError::not_found("Target"))?;
    refuse_if_system(pool, id, "reassigned").await?;

    let target = &b.target_budget_id;
    let mut tx = pool.begin().await?;
    let e = sqlx::query!(
        r#"UPDATE "Expense" SET "budgetId" = ? WHERE "budgetId" = ?"#,
        target,
        id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    let i = sqlx::query!(
        r#"UPDATE "Income" SET "budgetId" = ? WHERE "budgetId" = ?"#,
        target,
        id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    let g = sqlx::query!(
        r#"UPDATE "BudgetGoal" SET "budgetId" = ? WHERE "budgetId" = ?"#,
        target,
        id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    // Allocations are NOT moved: they are per-year-plan amounts for a category
    // that is going away, and the target has its own. BudgetVersion rows
    // cascade from them.
    let allocations = sqlx::query!(r#"DELETE FROM "CategoryBudget" WHERE "budgetId" = ?"#, id)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    sqlx::query!(r#"DELETE FROM "Budget" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Response::ok(ReassignedShape {
        reassigned: e + i + g,
        budgets_deleted: allocations,
        deleted: true,
    }))
}
