//! `/descriptions` — the shared names transactions are filed under.
//!
//! Ported from `routes/descriptions.ts`.
//!
//! # A description is a name many transactions share
//!
//! So renaming one is not a single-row edit: every transaction pointing at it
//! carries a copy of the name, and all of them move together. Merging is the
//! same operation with a second step — repoint the rows, then remove the name
//! nothing references any more.
//!
//! Both go through `ledger_update` rather than a bulk `UPDATE`. No hook reads
//! `descriptionId`, so this is not about side effects; it is that `name` moves
//! with it, and a gate that some name-changes skip is a gate with an exception
//! nobody will remember.
//!
//! # Uniqueness is case-insensitive, and deliberately
//!
//! "Amazon" and "amazon" are the same merchant. Allowing both is how a
//! description list grows a dozen spellings of one shop, which is the thing
//! this feature exists to prevent.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_db::ledger::{ledger_update, LedgerUpdate};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;

/// A description, as all four of its routes return it.
///
/// Four separate `json!({ "id": …, "name": … })` literals built this shape
/// before — create, update, read and list — with nothing connecting them. See
/// `budgets.rs` for the rules these types keep.
#[derive(Serialize)]
struct DescriptionShape {
    id: String,
    name: String,
}

const DUPLICATE: &str = "A description with this name already exists";

/// Every description, as `(id, name)`.
///
/// Case folding happens in Rust, not SQL, and that is the whole reason this
/// function exists. **SQLite folds ASCII only** — `lower('CAFÉ')` is `'cafÉ'`,
/// and `COLLATE NOCASE` is no better; measured, not assumed. Postgres's
/// `mode: 'insensitive'` folded full Unicode, so leaving the comparison in SQL
/// would have quietly made "CAFÉ" and "café" two merchants on SQLite where they
/// were one before. `str::to_lowercase` folds the whole of Unicode.
///
/// Reading the table to compare it is affordable because it is a list of
/// merchant names — tens to hundreds of rows, and the alternative is a stored
/// fold column that has to be kept in step with the name forever.
async fn all_names(pool: &SqlitePool) -> Result<Vec<(String, String)>, ApiError> {
    Ok(sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!"
             FROM "TransactionDescription" ORDER BY "name" ASC"#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|r| (r.id, r.name))
    .collect())
}

/// Is this name already taken, ignoring case and one id?
async fn name_taken(pool: &SqlitePool, name: &str, except: &str) -> Result<bool, ApiError> {
    let wanted = name.to_lowercase();
    Ok(all_names(pool)
        .await?
        .iter()
        .any(|(id, n)| id != except && n.to_lowercase() == wanted))
}

async fn read(pool: &SqlitePool, id: &str) -> Result<DescriptionShape, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!"
             FROM "TransactionDescription" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Description"))?;
    Ok(DescriptionShape {
        id: r.id,
        name: r.name,
    })
}

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    // Filtered in Rust for the same reason as `name_taken`, plus one more: a
    // substring match in SQL means LIKE, and LIKE treats `%` and `_` as
    // wildcards — so a search for "50%" would match every description unless
    // the input were escaped. `str::contains` has no metacharacters.
    let search = p
        .query("search")
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);

    let rows = all_names(pool).await?;
    Ok(Response::ok(
        rows.into_iter()
            .filter(|(_, name)| match &search {
                Some(q) => name.to_lowercase().contains(q),
                None => true,
            })
            .map(|(id, name)| DescriptionShape { id, name })
            .collect::<Vec<_>>(),
    ))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct NameBody {
    name: String,
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: NameBody = crate::body_of(body)?;
    let name = b.name.trim().to_string();
    if name.is_empty() {
        return Err(crate::recurring::required("name"));
    }
    if name_taken(pool, &name, "").await? {
        return Err(ApiError::conflict(DUPLICATE));
    }

    let id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "TransactionDescription" ("id","name","createdAt")
           VALUES (?,?,?)"#,
        id,
        name,
        now
    )
    .execute(pool)
    .await?;
    Ok(Response::created(DescriptionShape { id, name }))
}

/// Rename a description, and every transaction filed under it.
pub async fn rename(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: NameBody = crate::body_of(body)?;
    let name = b.name.trim().to_string();
    if name.is_empty() {
        return Err(crate::recurring::required("name"));
    }
    read(pool, id).await?;
    // Excluding self, so re-saving a name unchanged — or changing only its
    // capitalisation — is allowed rather than a conflict with itself.
    if name_taken(pool, &name, id).await? {
        return Err(ApiError::conflict(DUPLICATE));
    }

    sqlx::query!(
        r#"UPDATE "TransactionDescription" SET "name" = ? WHERE "id" = ?"#,
        name,
        id
    )
    .execute(pool)
    .await?;

    retitle(pool, id, &name, None).await?;
    Ok(Response::ok(DescriptionShape {
        id: id.to_string(),
        name,
    }))
}

/// Point every transaction on `from_description` at `name`, and optionally move
/// it to another description.
///
/// One `ledger_update` per row rather than a bulk UPDATE — see the module note.
/// The connection is scoped so it is released before anything else asks the
/// pool for one; the pool holds exactly one.
async fn retitle(
    pool: &SqlitePool,
    from_description: &str,
    name: &str,
    move_to: Option<&str>,
) -> Result<usize, ApiError> {
    let ids = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!" FROM "Transaction" WHERE "descriptionId" = ?"#,
        from_description
    )
    .fetch_all(pool)
    .await?;

    let mut conn = pool.acquire().await?;
    for tx in &ids {
        ledger_update(
            &mut conn,
            tx,
            &LedgerUpdate {
                name: Some(name.to_string()),
                description_id: move_to.map(|d| Some(d.to_string())),
                ..Default::default()
            },
        )
        .await
        .map_err(ApiError::from)?;
    }
    Ok(ids.len())
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct MergeBody {
    #[serde(rename = "sourceIds")]
    source_ids: Vec<String>,
    #[serde(rename = "targetId")]
    target_id: String,
}

/// Fold several descriptions into one.
pub async fn merge(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: MergeBody = crate::body_of(body)?;
    let target = read(pool, &b.target_id)
        .await
        .map_err(|_| ApiError::not_found("Target description"))?;
    let name = target.name.clone();

    // Merging a description into itself is a no-op, not an error — a UI that
    // selects a range including the target should not have to filter it out.
    let sources: Vec<String> = b
        .source_ids
        .iter()
        .filter(|id| **id != b.target_id)
        .cloned()
        .collect();
    if sources.is_empty() {
        return Ok(Response::ok(target));
    }

    // All-or-nothing on existence: a partial merge would move some rows and
    // leave the caller unable to tell which.
    for id in &sources {
        let n = sqlx::query_scalar!(
            r#"SELECT count(*) FROM "TransactionDescription" WHERE "id" = ?"#,
            id
        )
        .fetch_one(pool)
        .await?;
        if n == 0 {
            return Err(ApiError::new(
                404,
                "One or more source descriptions not found",
            ));
        }
    }

    for id in &sources {
        retitle(pool, id, &name, Some(&b.target_id)).await?;
        // Safe now: nothing references it.
        sqlx::query!(r#"DELETE FROM "TransactionDescription" WHERE "id" = ?"#, id)
            .execute(pool)
            .await?;
    }

    Ok(Response::ok(target))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct MergeIntoBody {
    #[serde(rename = "mergeId")]
    merge_id: String,
}

/// The same fold, addressed from the surviving description.
pub async fn merge_into(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: MergeIntoBody = crate::body_of(body)?;
    if id == b.merge_id {
        return Err(ApiError::bad_request(
            "Cannot merge a description into itself",
        ));
    }
    let target = read(pool, id)
        .await
        .map_err(|_| ApiError::not_found("Target description"))?;
    let name = target.name.clone();
    read(pool, &b.merge_id)
        .await
        .map_err(|_| ApiError::not_found("Source description"))?;

    retitle(pool, &b.merge_id, &name, Some(id)).await?;
    sqlx::query!(
        r#"DELETE FROM "TransactionDescription" WHERE "id" = ?"#,
        b.merge_id
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(target))
}

/// Remove a description nothing is filed under.
///
/// Refused while transactions reference it, with the count, because the answer
/// to "why can't I delete this" is the number — and merging is the operation
/// they actually want.
pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    read(pool, id).await?;
    let n = sqlx::query_scalar!(
        r#"SELECT count(*) FROM "Transaction" WHERE "descriptionId" = ?"#,
        id
    )
    .fetch_one(pool)
    .await?;
    if n > 0 {
        return Err(ApiError::conflict(format!(
            "Cannot delete: {n} transaction(s) still reference this description"
        )));
    }
    sqlx::query!(r#"DELETE FROM "TransactionDescription" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}
