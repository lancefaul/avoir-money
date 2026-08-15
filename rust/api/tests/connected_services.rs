//! `/connected-services` — statuses out, keys never.

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

/// `FINNHUB_API_KEY` is process-global and tests run in parallel, so **every**
/// test whose expectations depend on it takes this lock — including the ones
/// that need it ABSENT. Guarding only the setters is the trap: a test asserting
/// "no key configured" then reads whatever a concurrent test happened to set,
/// and the failure reads as a storage bug rather than as leakage.
fn with_env<T>(key: &str, value: Option<&str>, f: impl FnOnce() -> T) -> T {
    use std::sync::Mutex;
    static LOCK: Mutex<()> = Mutex::new(());
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev = std::env::var(key).ok();
    match value {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
    let out = f();
    match prev {
        Some(p) => std::env::set_var(key, p),
        None => std::env::remove_var(key),
    }
    out
}

fn block<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(f)
}

#[test]
fn every_known_provider_is_listed_even_with_nothing_configured() {
    with_env("FINNHUB_API_KEY", None, || {
        block(async {
            let pool = db().await;
            let r = call(&pool, "GET", "/connected-services", None)
                .await
                .unwrap();
            let list = r.body.as_array().unwrap();
            assert_eq!(list.len(), 2);
            for s in list {
                assert_eq!(s["configured"], json!(false));
                assert_eq!(s["source"], json!("none"));
                assert_eq!(s["hint"], json!(""));
                // Storing a key needs nothing configured now, so this is always
                // true — the field stays because a keyring-backed store could
                // reintroduce the unavailable state.
                assert_eq!(s["storageAvailable"], json!(true));
            }
        })
    });
}

#[tokio::test]
async fn a_stored_key_is_never_returned_only_its_last_four_characters() {
    let pool = db().await;
    let r = call(
        &pool,
        "PUT",
        "/connected-services/finnhub",
        Some(json!({ "apiKey": "finnhub_live_abcd1234" })),
    )
    .await
    .unwrap();

    assert_eq!(r.body["configured"], json!(true));
    assert_eq!(r.body["hint"], json!("1234"));
    assert_eq!(r.body["source"], json!("database"));

    // The key is stored as it is — the point of the change — so the guarantee
    // that matters is that no ROUTE hands it back. `hint` is the whole of what
    // a client may know.
    let body = r.body.to_string();
    assert!(
        !body.contains("finnhub_live_abcd1234"),
        "the key itself came back: {body}"
    );

    let list = call(&pool, "GET", "/connected-services", None)
        .await
        .unwrap()
        .body
        .to_string();
    assert!(!list.contains("finnhub_live_abcd1234"), "{list}");

    let stored: String = sqlx::query_scalar(
        r#"SELECT "secret" FROM "ConnectedService" WHERE "provider" = 'finnhub'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored, "finnhub_live_abcd1234");
}

#[tokio::test]
async fn saving_twice_replaces_rather_than_accumulates() {
    let pool = db().await;
    for key in ["finnhub_live_aaaa1111", "finnhub_live_bbbb2222"] {
        call(
            &pool,
            "PUT",
            "/connected-services/finnhub",
            Some(json!({ "apiKey": key })),
        )
        .await
        .unwrap();
    }
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "provider is unique; the second save is an update");

    let r = call(&pool, "GET", "/connected-services", None)
        .await
        .unwrap();
    let finnhub = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["provider"] == json!("finnhub"))
        .unwrap()
        .clone();
    assert_eq!(finnhub["hint"], json!("2222"));
}

#[test]
fn a_row_left_without_a_key_by_the_migration_reads_as_unconfigured() {
    with_env("FINNHUB_API_KEY", None, || {
        block(async {
            let pool = db().await;
            // Migration 0004 keeps every pre-existing row and clears its secret,
            // because the ciphertext could not be decrypted in SQL. That state
            // has to read as "not configured" rather than as a key that will
            // never work.
            sqlx::query(
                r#"INSERT INTO "ConnectedService"
                     ("id","provider","secret","hint","createdAt","updatedAt")
                   VALUES ('old','finnhub', NULL, '', '2026-08-01T00:00:00.000Z',
                           '2026-08-01T00:00:00.000Z')"#,
            )
            .execute(&pool)
            .await
            .unwrap();

            let r = call(&pool, "GET", "/connected-services", None)
                .await
                .unwrap();
            let finnhub = r
                .body
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["provider"] == json!("finnhub"))
                .unwrap()
                .clone();
            assert_eq!(finnhub["configured"], json!(false));
            assert_eq!(finnhub["source"], json!("none"));

            // And saving over it fills the same row rather than adding a second.
            call(
                &pool,
                "PUT",
                "/connected-services/finnhub",
                Some(json!({ "apiKey": "finnhub_live_abcd1234" })),
            )
            .await
            .unwrap();
            let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(n, 1);
        })
    });
}

#[tokio::test]
async fn a_pasted_key_is_trimmed_before_it_is_stored() {
    let pool = db().await;
    let r = call(
        &pool,
        "PUT",
        "/connected-services/finnhub",
        Some(json!({ "apiKey": "  finnhub_live_abcd1234\n" })),
    )
    .await
    .unwrap();
    // A trailing newline in a bearer token is an authentication failure with no
    // visible cause, so it is removed before storage rather than at every call
    // site.
    assert_eq!(r.body["hint"], json!("1234"));
    let stored: String = sqlx::query_scalar(r#"SELECT "secret" FROM "ConnectedService""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored, "finnhub_live_abcd1234");
}

#[tokio::test]
async fn a_key_can_always_be_stored() {
    let pool = db().await;
    // This used to be a 503 whenever INTEGRATION_SECRET was unset — which in a
    // packaged desktop app is always, since there is no .env for a service
    // manager to load. That refusal is the reason the encryption was dropped.
    let r = call(
        &pool,
        "PUT",
        "/connected-services/finnhub",
        Some(json!({ "apiKey": "finnhub_live_abcd1234" })),
    )
    .await
    .unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(r.body["configured"], json!(true));
}

#[tokio::test]
async fn clearing_a_key_removes_it_and_is_silent_when_there_was_none() {
    let pool = db().await;
    call(
        &pool,
        "PUT",
        "/connected-services/coingecko",
        Some(json!({ "apiKey": "cg_demo_abcd1234" })),
    )
    .await
    .unwrap();

    let r = call(&pool, "DELETE", "/connected-services/coingecko", None)
        .await
        .unwrap();
    assert_eq!(r.body["configured"], json!(false));

    // Again, with nothing there. The end state is the same, so this is success
    // rather than a 404.
    let r = call(&pool, "DELETE", "/connected-services/coingecko", None)
        .await
        .unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(r.body["configured"], json!(false));
}

#[tokio::test]
async fn an_unknown_provider_is_refused_rather_than_stored() {
    let pool = db().await;
    let err = call(
        &pool,
        "PUT",
        "/connected-services/alpaca",
        Some(json!({ "apiKey": "whatever12345" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    // Otherwise the table fills with keys nothing will ever read.
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_key_shorter_than_eight_characters_is_refused() {
    let pool = db().await;
    let err = call(
        &pool,
        "PUT",
        "/connected-services/finnhub",
        Some(json!({ "apiKey": "short" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert_eq!(err.details.unwrap()[0]["field"], json!("apiKey"));
}

#[tokio::test]
async fn a_short_key_is_not_half_printed_by_its_own_hint() {
    let pool = db().await;
    // Exactly 8 characters: long enough to store, short enough that four of
    // them would be half the key.
    let r = call(
        &pool,
        "PUT",
        "/connected-services/finnhub",
        Some(json!({ "apiKey": "12345678" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["configured"], json!(true));
    assert_eq!(r.body["hint"], json!(""));
}

#[test]
fn a_database_key_wins_over_an_environment_one() {
    with_env("FINNHUB_API_KEY", Some("env_key_zzzz9999"), || {
        block(async {
            let pool = db().await;

            let r = call(&pool, "GET", "/connected-services", None)
                .await
                .unwrap();
            let finnhub = r
                .body
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["provider"] == json!("finnhub"))
                .unwrap()
                .clone();
            assert_eq!(finnhub["source"], json!("environment"));
            assert_eq!(finnhub["hint"], json!("9999"));

            call(
                &pool,
                "PUT",
                "/connected-services/finnhub",
                Some(json!({ "apiKey": "finnhub_live_abcd1234" })),
            )
            .await
            .unwrap();

            // A key typed into the UI is the more recent, more deliberate act.
            // An env var left over from an earlier setup must not override it.
            let r = call(&pool, "GET", "/connected-services", None)
                .await
                .unwrap();
            let finnhub = r
                .body
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["provider"] == json!("finnhub"))
                .unwrap()
                .clone();
            assert_eq!(finnhub["source"], json!("database"));
            assert_eq!(finnhub["hint"], json!("1234"));
        })
    });
}

#[test]
fn a_row_with_no_key_falls_through_to_the_environment() {
    with_env("FINNHUB_API_KEY", Some("env_key_zzzz9999"), || {
        block(async {
            let pool = db().await;
            sqlx::query(
                r#"INSERT INTO "ConnectedService"
                     ("id","provider","secret","hint","createdAt","updatedAt")
                   VALUES ('old','finnhub', NULL, '', '2026-08-01T00:00:00.000Z',
                           '2026-08-01T00:00:00.000Z')"#,
            )
            .execute(&pool)
            .await
            .unwrap();

            // The row exists but holds nothing usable, so the fallback is what
            // will actually be sent to Finnhub — and the status has to say so.
            let r = call(&pool, "GET", "/connected-services", None)
                .await
                .unwrap();
            let finnhub = r
                .body
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["provider"] == json!("finnhub"))
                .unwrap()
                .clone();
            assert_eq!(finnhub["source"], json!("environment"));
            assert_eq!(finnhub["configured"], json!(true));
        })
    });
}
