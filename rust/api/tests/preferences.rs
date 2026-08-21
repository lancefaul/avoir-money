//! `/preferences` — interface settings, and the property localStorage could not
//! provide.
//!
//! They were persisted into localStorage, which Chromium keys by ORIGIN. The
//! server binds `127.0.0.1:0`, so the OS picks a fresh port each launch, so the
//! origin changed every time and every launch read an empty store. 58 stranded
//! stores had accumulated before it was noticed — and only because
//! `hiddenAccountIds` was the one setting whose default differed from the
//! owner's state. The other five reset to values that matched their choices, so
//! a total loss presented as one missing feature.
//!
//! The bug was ADDRESSING, not storage, which is why the test that matters here
//! opens the database a SECOND TIME rather than merely reading back what it
//! wrote.

use avoir_api::{dispatch, ApiError, Response};
use serde_json::{json, Value};
use sqlx::SqlitePool;

async fn db() -> SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

async fn call(
    pool: &SqlitePool,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    dispatch(pool, method, path, body).await
}

#[tokio::test]
async fn a_preference_survives_reopening_the_database() {
    // A FILE database, not in-memory: `sqlite::memory:` is per-connection, so
    // an in-memory test would pass whether or not the value ever reached disk
    // — which is the same shape as the bug being fixed. Same temp-dir idiom as
    // `backups.rs`, rather than a new dev-dependency for one path.
    let dir = std::env::temp_dir().join(format!(
        "avoir-prefs-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let url = format!("sqlite:{}", dir.join("prefs.db").display());

    let first = avoir_db::connect(&url).await.expect("open");
    let blob = r#"{"state":{"hiddenAccountIds":["a1","a2"]},"version":1}"#;
    let r = call(
        &first,
        "PUT",
        "/preferences",
        Some(json!({ "key": "budget-tracker-ui", "value": blob })),
    )
    .await
    .expect("write");
    assert_eq!(r.status, 200);
    first.close().await;

    // The next launch. Under localStorage this is where the settings vanished.
    let second = avoir_db::connect(&url).await.expect("reopen");
    let got = call(&second, "GET", "/preferences", None)
        .await
        .expect("read");
    assert_eq!(got.body["budget-tracker-ui"], json!(blob));

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn writing_the_same_key_replaces_rather_than_appends() {
    let pool = db().await;
    for v in ["first", "second"] {
        call(
            &pool,
            "PUT",
            "/preferences",
            Some(json!({ "key": "k", "value": v })),
        )
        .await
        .expect("write");
    }
    let got = call(&pool, "GET", "/preferences", None)
        .await
        .expect("read");
    assert_eq!(got.body["k"], json!("second"));
    assert_eq!(
        got.body.as_object().unwrap().len(),
        1,
        "an upsert, not an append — otherwise every toggle grows the table"
    );
}

#[tokio::test]
async fn an_empty_store_is_an_empty_object_not_an_error() {
    // Every fresh install takes this path, so a 404 here would put a failure on
    // the first launch every new user has.
    let pool = db().await;
    let got = call(&pool, "GET", "/preferences", None)
        .await
        .expect("read");
    assert_eq!(got.status, 200);
    assert_eq!(got.body, json!({}));
}

#[tokio::test]
async fn removing_a_key_that_was_never_written_is_not_an_error() {
    // `removeItem` cannot check first and has nothing useful to do if told.
    let pool = db().await;
    let r = call(&pool, "DELETE", "/preferences/never-written", None)
        .await
        .expect("delete");
    assert_eq!(r.status, 204);
}

#[tokio::test]
async fn a_written_key_can_be_removed() {
    let pool = db().await;
    call(
        &pool,
        "PUT",
        "/preferences",
        Some(json!({ "key": "k", "value": "v" })),
    )
    .await
    .expect("write");
    call(&pool, "DELETE", "/preferences/k", None)
        .await
        .expect("delete");
    let got = call(&pool, "GET", "/preferences", None)
        .await
        .expect("read");
    assert_eq!(got.body, json!({}));
}

#[tokio::test]
async fn a_malformed_write_is_refused() {
    let pool = db().await;
    for bad in [
        json!({ "value": "x" }),            // no key
        json!({ "key": "", "value": "x" }), // empty key
        json!({ "key": "k" }),              // no value
        json!({ "key": "k", "value": 5 }),  // not a string
    ] {
        let e = call(&pool, "PUT", "/preferences", Some(bad.clone()))
            .await
            .expect_err(&format!("should refuse {bad}"));
        assert_eq!(e.status, 400, "for {bad}");
    }
    // No body at all, which the dispatcher passes through as None.
    let e = call(&pool, "PUT", "/preferences", None)
        .await
        .expect_err("should refuse an absent body");
    assert_eq!(e.status, 400);
}

#[tokio::test]
async fn an_oversized_value_is_refused() {
    // The renderer writes here unvalidated, and an unbounded column is how a
    // preferences table becomes a place to put things.
    let pool = db().await;
    let huge = "x".repeat(256 * 1024 + 1);
    let e = call(
        &pool,
        "PUT",
        "/preferences",
        Some(json!({ "key": "k", "value": huge })),
    )
    .await
    .expect_err("should refuse");
    assert_eq!(e.status, 400);
}
