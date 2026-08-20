//! `/connected-services` — third-party keys the user supplies.
//!
//! Ported from `routes/connected-services.ts` and `lib/connected-services.ts`.
//!
//! # A key leaves this module in exactly one direction
//!
//! [`service_key`] hands it to the code that calls the provider. Nothing else
//! returns it. Every route here answers with a *status* — whether a key exists,
//! its last four characters, and where it came from — because no screen needs
//! the key back, and a response carrying it would put it in the webview's
//! memory and in any log between here and there for no benefit.
//!
//! # The key is stored as it is, and that is a decision rather than an omission
//!
//! It used to be AES-256-GCM ciphertext under a key derived from an
//! `INTEGRATION_SECRET` environment variable. The threat that defended against
//! was that **the database gets dumped to files that travel**. That threat is
//! now closed at the source: backups strip this table and vacuum the freed
//! pages, and the JSON export skips it outright. Nothing that leaves the machine
//! carries a credential, so the cipher was protecting a file that no longer
//! exists.
//!
//! What it never defended against was someone reading the database file, because
//! the key lived in the same process's environment — an accepted limit, stated
//! as such in the original. Encryption whose key sits beside the ciphertext buys
//! obscurity, and obscurity that costs a packaged desktop app the ability to
//! store a key at all (no `.env`, so no secret, so every save refused) is a bad
//! trade. See migration `0004_connected_service_secret_is_plain.sql`.
//!
//! # The database wins over the environment
//!
//! A key typed into the UI is the more recent and more deliberate act, so an
//! env var left over from an earlier setup must not silently override it. The
//! env var stays a working fallback, which is what lets an existing install
//! upgrade without touching anything.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;

pub const FINNHUB: &str = "finnhub";

/// CoinGecko is optional, unlike Finnhub.
///
/// Bitcoin prices work with no key at all — that is why they have always worked
/// in this app while stocks never did. A Demo key only raises the rate limit,
/// so "not configured" is a healthy state here rather than a broken one, and
/// the UI has to say so rather than reporting it the way it reports a missing
/// Finnhub key.
pub const COINGECKO: &str = "coingecko";

/// The providers this app knows how to call. An unknown slug is refused rather
/// than stored, so the table cannot fill with keys nothing will ever read.
const KNOWN: [&str; 2] = [FINNHUB, COINGECKO];

fn env_var_for(provider: &str) -> Option<&'static str> {
    match provider {
        FINNHUB => Some("FINNHUB_API_KEY"),
        COINGECKO => Some("COINGECKO_API_KEY"),
        _ => None,
    }
}

fn env_key_for(provider: &str) -> Option<String> {
    std::env::var(env_var_for(provider)?)
        .ok()
        .filter(|v| !v.trim().is_empty())
}

struct Row {
    /// `None` for a row that survived migration 0004 with its ciphertext
    /// discarded, and for one whose key was cleared.
    secret: Option<String>,
    hint: String,
    updated_at: String,
}

async fn read_row(pool: &SqlitePool, provider: &str) -> Result<Option<Row>, ApiError> {
    let r = sqlx::query!(
        r#"SELECT "secret", "hint" AS "hint!", "updatedAt" AS "updated_at!"
             FROM "ConnectedService" WHERE "provider" = ?"#,
        provider
    )
    .fetch_optional(pool)
    .await?;
    Ok(r.map(|r| Row {
        secret: r.secret.filter(|s| !s.is_empty()),
        hint: r.hint,
        updated_at: r.updated_at,
    }))
}

/// The last four characters, for showing which key is configured.
///
/// A short key is hinted as empty rather than partly revealed — otherwise an
/// 8-character secret would be half-printed by its own hint, and a 4-character
/// one printed in full.
fn hint_of(plaintext: &str) -> String {
    if plaintext.chars().count() > 8 {
        plaintext
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    } else {
        String::new()
    }
}

/// The key to use when calling a provider, or `None` if there is none.
///
/// A row with no usable secret falls through to the environment and then to
/// nothing, rather than failing — the same shape as before, since a row can
/// still exist without a key (migration 0004 leaves every pre-existing row that
/// way).
pub async fn service_key(pool: &SqlitePool, provider: &str) -> Result<Option<String>, ApiError> {
    if let Some(row) = read_row(pool, provider).await? {
        if let Some(key) = row.secret {
            return Ok(Some(key));
        }
    }
    Ok(env_key_for(provider))
}

/// Everything a client is allowed to know about a stored key.
///
/// Three sites built this from separate `json!` literals — the database case,
/// the environment fallback, and unconfigured — which is exactly the shape a
/// field can go missing from on one branch and not the others.
///
/// `storageAvailable` is always true today (ADR-035 removed the encryption that
/// could be unavailable) and is kept so a keyring-backed store can reintroduce
/// the unavailable state without a schema change.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatusShape {
    provider: String,
    configured: bool,
    hint: String,
    source: &'static str,
    updated_at: Option<String>,
    storage_available: bool,
}

async fn status(pool: &SqlitePool, provider: &str) -> Result<ServiceStatusShape, ApiError> {
    // Always true now: storing a key needs nothing configured. The field stays
    // in the response because the frontend schema requires it, and because
    // "storage is unavailable" is a state a future keyring-backed store could
    // reintroduce.
    let storage = true;

    if let Some(row) = read_row(pool, provider).await? {
        if row.secret.is_some() {
            return Ok(ServiceStatusShape {
                provider: provider.to_string(),
                configured: true,
                hint: row.hint,
                source: "database",
                updated_at: Some(row.updated_at),
                storage_available: storage,
            });
        }
        // A row with no key. Reported as unconfigured because that is what it
        // is operationally — the fallback below is what will actually be used.
    }

    if let Some(env) = env_key_for(provider) {
        return Ok(ServiceStatusShape {
            provider: provider.to_string(),
            configured: true,
            hint: hint_of(&env),
            source: "environment",
            updated_at: None,
            storage_available: storage,
        });
    }

    Ok(ServiceStatusShape {
        provider: provider.to_string(),
        configured: false,
        hint: String::new(),
        source: "none",
        updated_at: None,
        storage_available: storage,
    })
}

pub async fn list(pool: &SqlitePool) -> Result<Response, ApiError> {
    let mut out = Vec::new();
    for p in KNOWN {
        out.push(status(pool, p).await?);
    }
    Ok(Response::ok(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SetBody {
    #[serde(rename = "apiKey")]
    api_key: String,
}

pub async fn set(
    pool: &SqlitePool,
    provider: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    if !KNOWN.contains(&provider) {
        return Err(ApiError::bad_request(format!(
            "Unknown provider: {provider}"
        )));
    }
    let b: SetBody = serde_json::from_value(body.unwrap_or(Value::Null)).map_err(|e| ApiError {
        status: 400,
        error: "Validation failed".into(),
        details: Some(json!([{ "field": "apiKey", "message": e.to_string() }])),
    })?;

    // Trimmed before anything else: a pasted key routinely carries whitespace,
    // and a trailing newline in a bearer token is an authentication failure
    // with no visible cause.
    let key = b.api_key.trim().to_string();
    if key.len() < 8 || key.len() > 500 {
        return Err(ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(
                json!([{ "field": "apiKey", "message": "must be between 8 and 500 characters" }]),
            ),
        });
    }

    let hint = hint_of(&key);
    let now = now_iso();
    let id = cuid();

    sqlx::query!(
        r#"INSERT INTO "ConnectedService"
             ("id","provider","secret","hint","createdAt","updatedAt")
           VALUES (?1,?2,?3,?4,?5,?5)
           ON CONFLICT("provider") DO UPDATE SET
             "secret" = ?3, "hint" = ?4, "updatedAt" = ?5"#,
        id,
        provider,
        key,
        hint,
        now
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(status(pool, provider).await?))
}

/// Remove a stored key. Silent when there was none — the end state is the same.
pub async fn clear(pool: &SqlitePool, provider: &str) -> Result<Response, ApiError> {
    if !KNOWN.contains(&provider) {
        return Err(ApiError::bad_request(format!(
            "Unknown provider: {provider}"
        )));
    }
    sqlx::query!(
        r#"DELETE FROM "ConnectedService" WHERE "provider" = ?"#,
        provider
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(status(pool, provider).await?))
}
