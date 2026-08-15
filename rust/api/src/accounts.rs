//! `/accounts` — the port of `apps/api/src/routes/accounts.ts`.
//!
//! Two representation gaps sit between the stored row and the JSON the
//! frontend's `AccountSchema` expects, and both must be closed here or the
//! Zod parse fails loudly in the browser:
//!
//! 1. **Money is integer cents in SQLite and a decimal number in JSON**
//!    (ADR-033). `balance: 15614426` on disk is `156144.26` on the wire.
//! 2. **`interestRate` is hundredths of a percent**, classified `percentage`
//!    by the importer and scaled by 100 like money. `450` is `4.5`.
//!
//! Booleans are the third, quieter one: SQLite has no boolean type, so they
//! are `INTEGER CHECK (x IN (0,1))` and must come back as real JSON booleans.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Path, Response};
use avoir_core::money::{Cents, Percent};
use avoir_db::balance;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// One account as `AccountSchema` describes it.
struct Row {
    id: String,
    name: String,
    r#type: String,
    balance: i64,
    opening_balance: i64,
    archived: i64,
    has_rewards: i64,
    parent_account_id: Option<String>,
    earns_interest: i64,
    interest_rate: i64,
    interest_rate_type: String,
    brand: Option<String>,
    created_at: String,
    updated_at: String,
}

/// One account, as every account route returns it.
///
/// See `budgets.rs` for why these are declared rather than assembled per site.
/// The two rules that matter: `rename_all = "camelCase"`, and no
/// `skip_serializing_if` — an absent key and a null key are different to the
/// frontend's Zod, and the harness cannot see a missing optional field.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountShape {
    id: String,
    name: String,
    /// `type` is a Rust keyword, so the field is `kind` and renamed on the wire.
    #[serde(rename = "type")]
    kind: String,
    balance: f64,
    opening_balance: f64,
    archived: bool,
    has_rewards: bool,
    parent_account_id: Option<String>,
    earns_interest: bool,
    interest_rate: f64,
    interest_rate_type: String,
    /// Which card ART this account renders with. Chosen, not inferred from the
    /// name — see the `brand` column comment in `0006_account_brand.sql`.
    brand: Option<String>,
    created_at: String,
    updated_at: String,
}

/// What a recalculate reports: the correction it made, and both sides of it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecalculatedShape {
    old_balance: f64,
    new_balance: f64,
    difference: f64,
}

/// A bare count, for the routes whose answer is a number.
#[derive(Serialize)]
struct CountShape {
    count: i64,
}

/// What a chain rebuild reports.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChainRebuiltShape {
    updated_transactions: i64,
    final_balance: f64,
}

fn serialize(a: &Row) -> AccountShape {
    AccountShape {
        id: a.id.clone(),
        name: a.name.clone(),
        kind: a.r#type.clone(),
        balance: Cents(a.balance).as_dollars_f64(),
        opening_balance: Cents(a.opening_balance).as_dollars_f64(),
        archived: a.archived != 0,
        has_rewards: a.has_rewards != 0,
        parent_account_id: a.parent_account_id.clone(),
        earns_interest: a.earns_interest != 0,
        interest_rate: Percent(a.interest_rate).as_percent_f64(),
        interest_rate_type: a.interest_rate_type.clone(),
        brand: a.brand.clone(),
        created_at: a.created_at.clone(),
        updated_at: a.updated_at.clone(),
    }
}

async fn fetch_one(pool: &SqlitePool, id: &str) -> Result<Row, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "type!",
                  "balance" AS "balance!: i64", "openingBalance" AS "opening_balance!: i64",
                  "archived" AS "archived!: i64", "hasRewards" AS "has_rewards!: i64",
                  "parentAccountId" AS "parent_account_id: String",
                  "earnsInterest" AS "earns_interest!: i64",
                  "interestRate" AS "interest_rate!: i64",
                  "interestRateType" AS "interest_rate_type!", "brand" AS "brand: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
           FROM "Account" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Account"))?;

    Ok(Row {
        id: r.id,
        name: r.name,
        r#type: r.r#type,
        balance: r.balance,
        opening_balance: r.opening_balance,
        archived: r.archived,
        has_rewards: r.has_rewards,
        parent_account_id: r.parent_account_id,
        earns_interest: r.earns_interest,
        interest_rate: r.interest_rate,
        interest_rate_type: r.interest_rate_type,
        brand: r.brand,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

// ─── GET / ───

pub async fn list(pool: &SqlitePool, p: &Path<'_>) -> Result<Response, ApiError> {
    let filter = p.query_bool("earnsInterest");
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "name" AS "name!", "type" AS "type!",
                  "balance" AS "balance!: i64", "openingBalance" AS "opening_balance!: i64",
                  "archived" AS "archived!: i64", "hasRewards" AS "has_rewards!: i64",
                  "parentAccountId" AS "parent_account_id: String",
                  "earnsInterest" AS "earns_interest!: i64",
                  "interestRate" AS "interest_rate!: i64",
                  "interestRateType" AS "interest_rate_type!", "brand" AS "brand: String",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
           FROM "Account"
           WHERE (?1 IS NULL OR "earnsInterest" = ?1)
           ORDER BY "name" ASC"#,
        filter
    )
    .fetch_all(pool)
    .await?;

    let out: Vec<AccountShape> = rows
        .into_iter()
        .map(|r| {
            serialize(&Row {
                id: r.id,
                name: r.name,
                r#type: r.r#type,
                balance: r.balance,
                opening_balance: r.opening_balance,
                archived: r.archived,
                has_rewards: r.has_rewards,
                parent_account_id: r.parent_account_id,
                earns_interest: r.earns_interest,
                interest_rate: r.interest_rate,
                interest_rate_type: r.interest_rate_type,
                brand: r.brand,
                created_at: r.created_at,
                updated_at: r.updated_at,
            })
        })
        .collect();

    Ok(Response::ok(out))
}

// ─── GET /:id ───

pub async fn get(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    Ok(Response::ok(serialize(&fetch_one(pool, id).await?)))
}

// ─── POST / ───

/// `CreateAccountSchema`. Money arrives as decimal dollars and is scaled on
/// the way in — the wire format is unchanged from the Hono era on purpose.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateAccount {
    name: String,
    r#type: String,
    #[serde(default)]
    balance: Option<f64>,
    #[serde(default, rename = "openingBalance")]
    opening_balance: Option<f64>,
    #[serde(default, rename = "hasRewards")]
    has_rewards: Option<bool>,
    #[serde(default, rename = "earnsInterest")]
    earns_interest: Option<bool>,
    #[serde(default, rename = "interestRate")]
    interest_rate: Option<f64>,
    #[serde(default, rename = "interestRateType")]
    interest_rate_type: Option<String>,
    /// Optional card art. Absent means the generic layout for the type.
    #[serde(default)]
    brand: Option<String>,
}

fn check_name(name: &str) -> Result<(), ApiError> {
    if name.is_empty() || name.chars().count() > 100 {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": "name",
                "message": "must be between 1 and 100 characters"
            }])),
        });
    }
    Ok(())
}

fn check_rate(rate: f64) -> Result<(), ApiError> {
    if !(0.0..=100.0).contains(&rate) {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": "interestRate",
                "message": "must be between 0 and 100"
            }])),
        });
    }
    Ok(())
}

pub async fn create(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: CreateAccount = crate::body_of(body)?;
    check_name(&b.name)?;
    if let Some(r) = b.interest_rate {
        check_rate(r)?;
    }

    // A rewards account only makes sense nested under a card, so it has its own
    // endpoint that always supplies a parent. A parentless Rewards account
    // would be an orphan the nested-card UI can never render.
    if b.r#type == "Rewards" {
        return Err(ApiError::bad_request(
            "Create rewards accounts via POST /accounts/:id/rewards-account",
        ));
    }

    // The form's "Starting Balance" arrives as `balance`. A new account has no
    // transactions, so opening and balance are equal **by definition** —
    // recording both is what keeps the starting figure recoverable once
    // transactions begin moving `balance`.
    //
    // Whichever field arrives seeds both. The TypeScript let `openingBalance`
    // fall back to `balance` but not the reverse, so a request carrying only
    // `openingBalance` — a shape the schema permits — created an account with
    // `balance = 0` beside a non-zero opening, which violates
    // `openingBalance + SUM(tx) == balance` from birth and stays wrong until
    // the first transaction happens to rebuild it. Making it symmetric closes
    // that without changing the path the form actually takes.
    let opening = match (b.opening_balance, b.balance) {
        (Some(o), _) => Cents::from_dollars_f64(o),
        (None, Some(bal)) => Cents::from_dollars_f64(bal),
        (None, None) => Cents::ZERO,
    };
    let balance = opening;

    let id = cuid();
    let now = now_iso();
    let rate = Percent::from_percent_f64(b.interest_rate.unwrap_or(0.0));
    let rate_type = b.interest_rate_type.unwrap_or_else(|| "APY".into());
    let has_rewards = b.has_rewards.unwrap_or(false) as i64;
    let earns_interest = b.earns_interest.unwrap_or(false) as i64;

    sqlx::query!(
        r#"INSERT INTO "Account"
             ("id","name","type","balance","openingBalance","archived","hasRewards",
              "parentAccountId","earnsInterest","interestRate","interestRateType",
              "brand","createdAt","updatedAt")
           VALUES (?,?,?,?,?,0,?,NULL,?,?,?,?,?,?)"#,
        id,
        b.name,
        b.r#type,
        balance.0,
        opening.0,
        has_rewards,
        earns_interest,
        rate.0,
        rate_type,
        b.brand,
        now,
        now,
    )
    .execute(pool)
    .await?;

    Ok(Response::created(serialize(&fetch_one(pool, &id).await?)))
}

// ─── PUT /:id ───

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateAccount {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    r#type: Option<String>,
    #[serde(default)]
    balance: Option<f64>,
    #[serde(default, rename = "openingBalance")]
    opening_balance: Option<f64>,
    #[serde(default, rename = "hasRewards")]
    has_rewards: Option<bool>,
    #[serde(default, rename = "earnsInterest")]
    earns_interest: Option<bool>,
    #[serde(default, rename = "interestRate")]
    interest_rate: Option<f64>,
    #[serde(default, rename = "interestRateType")]
    interest_rate_type: Option<String>,
    /// `present` so an explicit null CLEARS the art rather than being ignored —
    /// that is how a user goes back to the generic layout.
    #[serde(default, deserialize_with = "crate::recurring::present")]
    brand: Option<Option<String>>,
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: UpdateAccount = crate::body_of(body)?;
    if let Some(n) = &b.name {
        check_name(n)?;
    }
    if let Some(r) = b.interest_rate {
        check_rate(r)?;
    }

    let existing = fetch_one(pool, id).await?;

    // `openingBalance` is updatable, but it can never be written on its own.
    // The invariant is openingBalance + SUM(transactions) == balance, and the
    // transaction sum does not change here — so moving the opening by Δ must
    // move `balance` by Δ too, and shift every balanceBefore/balanceAfter in
    // the chain. rebuild_chain does exactly that. Writing the opening without
    // it would break the invariant on every edit.
    let new_opening = b.opening_balance.map(Cents::from_dollars_f64);
    let opening_changed = new_opening.is_some_and(|o| o.0 != existing.opening_balance);

    let now = now_iso();
    let name = b.name.unwrap_or(existing.name);
    let r#type = b.r#type.unwrap_or(existing.r#type);
    let balance = b
        .balance
        .map(Cents::from_dollars_f64)
        .map(|c| c.0)
        .unwrap_or(existing.balance);
    let opening = new_opening.map(|c| c.0).unwrap_or(existing.opening_balance);
    let has_rewards = b
        .has_rewards
        .map(|v| v as i64)
        .unwrap_or(existing.has_rewards);
    let earns_interest = b
        .earns_interest
        .map(|v| v as i64)
        .unwrap_or(existing.earns_interest);
    let rate = b
        .interest_rate
        .map(Percent::from_percent_f64)
        .map(|p| p.0)
        .unwrap_or(existing.interest_rate);
    let rate_type = b.interest_rate_type.unwrap_or(existing.interest_rate_type);
    // Three states, not two: absent keeps what is stored, an explicit null
    // clears the art, a value sets it. That is what `present` buys.
    let brand = match b.brand {
        Some(v) => v,
        None => existing.brand,
    };

    sqlx::query!(
        r#"UPDATE "Account"
              SET "name" = ?, "type" = ?, "balance" = ?, "openingBalance" = ?,
                  "hasRewards" = ?, "earnsInterest" = ?, "interestRate" = ?,
                  "interestRateType" = ?, "brand" = ?, "updatedAt" = ?
            WHERE "id" = ?"#,
        name,
        r#type,
        balance,
        opening,
        has_rewards,
        earns_interest,
        rate,
        rate_type,
        brand,
        now,
        id,
    )
    .execute(pool)
    .await?;

    if opening_changed {
        let mut conn = pool.acquire().await?;
        balance::rebuild_chain(&mut conn, id).await?;
    }

    // Re-read unconditionally. When the opening moved, rebuild_chain rewrote
    // `balance`, so anything captured above is already stale and would report
    // the pre-shift figure to the client.
    Ok(Response::ok(serialize(&fetch_one(pool, id).await?)))
}

// ─── POST /:id/archive and /:id/unarchive ───

pub async fn set_archived(
    pool: &SqlitePool,
    id: &str,
    archived: bool,
) -> Result<Response, ApiError> {
    let flag = archived as i64;
    let now = now_iso();
    let n = sqlx::query!(
        r#"UPDATE "Account" SET "archived" = ?, "updatedAt" = ? WHERE "id" = ?"#,
        flag,
        now,
        id
    )
    .execute(pool)
    .await?
    .rows_affected();

    if n == 0 {
        return Err(ApiError::not_found("Account"));
    }
    Ok(Response::ok(serialize(&fetch_one(pool, id).await?)))
}

// ─── GET /:id/transaction-count ───

pub async fn transaction_count(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let n = sqlx::query!(
        r#"SELECT COUNT(*) AS "count!: i64" FROM "Transaction"
            WHERE "accountId" = ?1 OR "toAccountId" = ?1"#,
        id
    )
    .fetch_one(pool)
    .await?
    .count;

    Ok(Response::ok(CountShape { count: n }))
}

// ─── DELETE /:id ───

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    // Confirm existence first: the deletes below are all `DELETE ... WHERE`,
    // which affect zero rows just as happily for a missing account as for one
    // with no transactions, so nothing downstream can tell us it was absent.
    fetch_one(pool, id).await?;

    let mut tx = pool.begin().await?;

    // A rewards-enabled card owns a nested rewards account (onDelete: Cascade).
    // Deleting the card cascade-deletes that child — but the child's own rows
    // (earned credits, redeemed legs) reference it via Transaction.accountId
    // with onDelete: Restrict, which blocks the cascade once any reward has
    // been earned or redeemed. Clear the child's transactions here too so the
    // cascade can complete.
    let child = sqlx::query!(
        r#"SELECT "id" AS "id!" FROM "Account" WHERE "parentAccountId" = ?"#,
        id
    )
    .fetch_optional(&mut *tx)
    .await?
    .map(|r| r.id);

    let child_id = child.unwrap_or_default();
    sqlx::query!(
        r#"DELETE FROM "Transaction"
            WHERE "accountId" IN (?1, ?2) OR "toAccountId" IN (?1, ?2)"#,
        id,
        child_id
    )
    .execute(&mut *tx)
    .await?;

    sqlx::query!(
        r#"UPDATE "Expense" SET "accountId" = NULL WHERE "accountId" = ?"#,
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(
        r#"UPDATE "Income" SET "accountId" = NULL WHERE "accountId" = ?"#,
        id
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query!(r#"DELETE FROM "Account" WHERE "id" = ?"#, id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Response::no_content())
}

// ─── POST /:id/recalculate-balance ───

pub async fn recalculate_balance(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let existing = fetch_one(pool, id).await?;
    let old = Cents(existing.balance);
    let opening = Cents(existing.opening_balance);

    let mut conn = pool.acquire().await?;
    // Sum the account's rows on top of `openingBalance` — never from zero.
    // Summing from zero is what silently discarded the Starting Balance and
    // moved real card balances by thousands.
    let rows = balance::chain_after(&mut conn, id, "", "", "").await?;
    let new = rows.iter().fold(opening, |acc, r| acc + r.delta);

    sqlx::query!(
        r#"UPDATE "Account" SET "balance" = ? WHERE "id" = ?"#,
        new.0,
        id
    )
    .execute(&mut *conn)
    .await?;

    Ok(Response::ok(RecalculatedShape {
        old_balance: old.as_dollars_f64(),
        new_balance: new.as_dollars_f64(),
        difference: (new - old).as_dollars_f64(),
    }))
}

// ─── POST /:id/rebuild-balance-chain ───

pub async fn rebuild_balance_chain(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    fetch_one(pool, id).await?;
    let mut conn = pool.acquire().await?;
    let updated = balance::chain_after(&mut conn, id, "", "", "").await?.len() as i64;
    let total = balance::rebuild_chain(&mut conn, id).await?;

    Ok(Response::ok(ChainRebuiltShape {
        updated_transactions: updated,
        final_balance: total.as_dollars_f64(),
    }))
}

// ─── POST /:id/rewards-account ───

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateRewardsAccount {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, rename = "openingBalance")]
    opening_balance: Option<f64>,
}

pub async fn create_rewards_account(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: CreateRewardsAccount = crate::body_of(body)?;
    let parent = fetch_one(pool, id).await?;

    if parent.r#type == "Rewards" {
        return Err(ApiError::bad_request(
            "A rewards account cannot own another rewards account",
        ));
    }

    // parentAccountId is UNIQUE — one rewards account per card. Checked up
    // front rather than caught as a constraint violation, because SQLite
    // reports uniqueness failures without naming the column and the message
    // would be guesswork.
    let taken = sqlx::query!(
        r#"SELECT 1 AS "hit!: i64" FROM "Account" WHERE "parentAccountId" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if taken {
        return Err(ApiError::conflict(
            "This account already has a rewards account",
        ));
    }

    let name = b.name.unwrap_or_else(|| format!("{} Rewards", parent.name));
    check_name(&name)?;

    // No transactions yet, so opening == balance by definition (same rule as
    // the generic create).
    let opening = Cents::from_dollars_f64(b.opening_balance.unwrap_or(0.0));
    if opening.is_negative() {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": "openingBalance",
                "message": "must be nonnegative"
            }])),
        });
    }

    let new_id = cuid();
    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "Account"
             ("id","name","type","balance","openingBalance","archived","hasRewards",
              "parentAccountId","earnsInterest","interestRate","interestRateType",
              "createdAt","updatedAt")
           VALUES (?,?,'Rewards',?,?,0,0,?,0,0,'APY',?,?)"#,
        new_id,
        name,
        opening.0,
        opening.0,
        id,
        now,
        now,
    )
    .execute(pool)
    .await?;

    Ok(Response::created(serialize(
        &fetch_one(pool, &new_id).await?,
    )))
}
