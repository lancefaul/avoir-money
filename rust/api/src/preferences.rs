//! `/preferences` — interface settings, stored with the user's data.
//!
//! # Why these are not in localStorage any more
//!
//! They were, and they silently reset on every launch. Chromium keys
//! localStorage by ORIGIN, the origin includes the port, and the server binds
//! `127.0.0.1:0` so the OS picks a fresh port each time. That choice is
//! deliberate — ADR-036 wants a port that is not guessable across launches and
//! a desktop app that cannot fail to start because something else holds a
//! number — but it means every launch opened a brand-new, empty store.
//!
//! Measured rather than inferred: **58 distinct origins** had accumulated in
//! the Electron profile by 2026-08-14, one per launch since the shell shipped,
//! each holding the settings of the session that wrote it. One of them still
//! had the three hidden account ids the owner was looking for.
//!
//! The write was always correct. Only the read went somewhere new.
//!
//! # Why only one setting looked broken
//!
//! Six settings persist, and five of them reset to values that happened to
//! match the owner's choices — the default theme is the one they had picked, so
//! its reset was invisible. `hiddenAccountIds` was the only setting whose
//! default (`[]`) differed from their state, which is why it was the only
//! symptom. A bug is not small because one symptom is.
//!
//! # Key/value, not a column per setting
//!
//! This is the exact shape of the `StateStorage` interface zustand persists
//! through — `getItem`/`setItem`/`removeItem` over a string key — so the
//! adapter is a direct mapping with nothing to keep in step when a setting is
//! added. The value is opaque here on purpose: the server has no opinion about
//! what the interface stores, and giving it one would mean a migration every
//! time a checkbox appears.
//!
//! # These are preferences, not ledger data
//!
//! Nothing here affects a balance, and no lifecycle hook fires. They live in the
//! database because that is what survives a port change, an Electron profile
//! wipe and a reinstall — and because they get carried by backup and export for
//! free, which localStorage never did.

use crate::id::now_iso;
use crate::{ApiError, Response};
use serde_json::{json, Map, Value};
use sqlx::SqlitePool;

/// Every stored preference, as one flat object.
///
/// Returned as a map rather than a list of rows because the client is a storage
/// adapter keyed by name: it asks for one key and expects a string back. An
/// empty table is `{}` and not a 404 — "nothing stored yet" is the ordinary
/// first-run state, and making the client treat it as an error would put a
/// failure on the path every fresh install takes.
pub async fn get_all(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(r#"SELECT "key", "value" FROM "UiPreference""#)
        .fetch_all(pool)
        .await?;

    let mut out = Map::new();
    for r in rows {
        out.insert(r.key, Value::String(r.value));
    }
    Ok(Response::ok(Value::Object(out)))
}

/// Write one key. The body is `{ "key": "...", "value": "..." }`.
///
/// An upsert, so the client never has to know whether a setting has been stored
/// before — which it cannot know without a round-trip it should not need.
pub async fn put(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    // `Option`, matching every other write route: the dispatcher hands over
    // whatever the request carried, and "no body at all" is a client error to
    // report rather than a shape to assume.
    let body = body.ok_or_else(|| ApiError::bad_request("a body is required"))?;
    let key = body
        .get("key")
        .and_then(Value::as_str)
        .filter(|k| !k.is_empty())
        .ok_or_else(|| ApiError::bad_request("key is required"))?;

    // The value is whatever the client serialised. It is stored verbatim, not
    // parsed: this endpoint is a storage adapter, and a server that validated
    // the shape would need changing every time the interface grew a setting.
    let value = body
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("value must be a string"))?;

    // A bound, because this is an unvalidated blob written from the renderer
    // and an unbounded column is how a preferences table becomes a place to
    // put things. 256 KB is far beyond any interface state and far below
    // anything that would strain SQLite.
    const MAX_BYTES: usize = 256 * 1024;
    if value.len() > MAX_BYTES {
        return Err(ApiError::bad_request("value is too large for a preference"));
    }

    let now = now_iso();
    sqlx::query!(
        r#"INSERT INTO "UiPreference" ("key","value","updatedAt") VALUES (?,?,?)
           ON CONFLICT("key") DO UPDATE SET "value" = excluded."value",
                                            "updatedAt" = excluded."updatedAt""#,
        key,
        value,
        now
    )
    .execute(pool)
    .await?;

    Ok(Response::ok(json!({ "key": key })))
}

/// Forget one key. Idempotent — deleting what is not there is not an error,
/// because the client's `removeItem` has no way to find out first and no
/// meaningful thing to do if told.
pub async fn delete(pool: &SqlitePool, key: &str) -> Result<Response, ApiError> {
    sqlx::query!(r#"DELETE FROM "UiPreference" WHERE "key" = ?"#, key)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}
