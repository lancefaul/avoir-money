//! `/descriptions` — the shared names transactions are filed under.

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

async fn make(pool: &SqlitePool, name: &str) -> String {
    call(pool, "POST", "/descriptions", Some(json!({ "name": name })))
        .await
        .expect("create description")
        .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn account(pool: &SqlitePool) -> String {
    call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": 1000.00 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A transaction filed under a SPECIFIC description.
///
/// Written directly rather than through the route because the test needs to
/// choose which description the row lands under. The ledger gate does file
/// every created transaction on its own — see
/// `creating_a_transaction_files_it_under_a_description` below — but it files
/// by NAME, which is not the control this helper needs.
///
/// The comment here used to say "no route sets `descriptionId`", and that was
/// true of the port and false of the reference: the gap meant the whole feature
/// was inert for anything created in-app.
async fn filed(pool: &SqlitePool, id: &str, account_id: &str, description: &str, name: &str) {
    sqlx::query(
        r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date","createdAt",
                                      "imported","isCashBack","accountId","descriptionId")
           VALUES (?, 'EXPENSE', ?, 2500, 2500, '2026-03-01T00:00:00.000Z',
                   '2026-03-01T00:00:00.000Z', 0, 0, ?, ?)"#,
    )
    .bind(id)
    .bind(name)
    .bind(account_id)
    .bind(description)
    .execute(pool)
    .await
    .unwrap();
}

async fn names_of(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as(r#"SELECT "id","name" FROM "Transaction" ORDER BY "id""#)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn a_description_round_trips_and_lists_alphabetically() {
    let pool = db().await;
    for name in ["Zebra Cafe", "Amazon", "Marks"] {
        make(&pool, name).await;
    }
    let r = call(&pool, "GET", "/descriptions", None).await.unwrap();
    let names: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["Amazon", "Marks", "Zebra Cafe"]);
}

#[tokio::test]
async fn the_same_merchant_in_different_case_is_the_same_merchant() {
    let pool = db().await;
    make(&pool, "Amazon").await;
    // Allowing both is how a description list grows a dozen spellings of one
    // shop, which is the thing this feature exists to prevent.
    for attempt in ["amazon", "AMAZON", "AmAzOn"] {
        let err = call(
            &pool,
            "POST",
            "/descriptions",
            Some(json!({ "name": attempt })),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 409, "{attempt}");
    }
}

#[tokio::test]
async fn a_name_is_trimmed_and_an_empty_one_refused() {
    let pool = db().await;
    let r = call(
        &pool,
        "POST",
        "/descriptions",
        Some(json!({ "name": "  Amazon \n" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));

    for blank in ["", "   "] {
        let err = call(
            &pool,
            "POST",
            "/descriptions",
            Some(json!({ "name": blank })),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 400);
    }
}

#[tokio::test]
async fn search_is_case_insensitive_and_matches_anywhere() {
    let pool = db().await;
    // "Sold via amazon" matches in the MIDDLE — without it every fixture would
    // match at the start and `starts_with` would pass this test, which is what
    // mutation testing caught.
    for name in ["Amazon Prime", "Whole Foods", "Sold via amazon"] {
        make(&pool, name).await;
    }
    let r = call(&pool, "GET", "/descriptions?search=AMAZ", None)
        .await
        .unwrap();
    let found: Vec<&str> = r
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap())
        .collect();
    assert_eq!(found, vec!["Amazon Prime", "Sold via amazon"]);

    let none = call(&pool, "GET", "/descriptions?search=zzz", None)
        .await
        .unwrap();
    assert_eq!(none.body, json!([]));
}

#[tokio::test]
async fn case_folding_covers_more_than_ascii() {
    let pool = db().await;
    make(&pool, "CAFÉ RIO").await;

    // Postgres folded full Unicode via `mode: 'insensitive'`. SQLite's `lower()`
    // and `COLLATE NOCASE` both fold ASCII only — `lower('CAFÉ')` is `'cafÉ'`,
    // measured rather than assumed. Doing it in Rust keeps "CAFÉ" and "café"
    // one merchant, as they were before the port.
    let err = call(
        &pool,
        "POST",
        "/descriptions",
        Some(json!({ "name": "café rio" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);

    let r = call(&pool, "GET", "/descriptions?search=caf%C3%A9", None)
        .await
        .unwrap();
    assert_eq!(r.body.as_array().unwrap().len(), 1, "{}", r.body);
}

#[tokio::test]
async fn a_wildcard_in_the_search_is_matched_literally() {
    let pool = db().await;
    make(&pool, "50% off store").await;
    make(&pool, "Regular shop").await;

    // `%` and `_` are LIKE wildcards, so an unescaped search for "50%" would
    // match everything.
    let r = call(&pool, "GET", "/descriptions?search=50%25", None)
        .await
        .unwrap();
    assert_eq!(r.body.as_array().unwrap().len(), 1);
    assert_eq!(r.body[0]["name"], json!("50% off store"));

    let underscore = call(&pool, "GET", "/descriptions?search=_", None)
        .await
        .unwrap();
    assert_eq!(underscore.body, json!([]), "a lone _ matches no real name");
}

#[tokio::test]
async fn renaming_moves_every_transaction_filed_under_it() {
    let pool = db().await;
    let acct = account(&pool).await;
    let d = make(&pool, "AMZN MKTP").await;
    let other = make(&pool, "Whole Foods").await;
    filed(&pool, "t1", &acct, &d, "AMZN MKTP").await;
    filed(&pool, "t2", &acct, &d, "AMZN MKTP").await;
    filed(&pool, "t3", &acct, &other, "Whole Foods").await;

    let r = call(
        &pool,
        "PUT",
        &format!("/descriptions/{d}"),
        Some(json!({ "name": "Amazon" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));

    // Every transaction carries a copy of the name, so all of them move.
    assert_eq!(
        names_of(&pool).await,
        vec![
            ("t1".to_string(), "Amazon".to_string()),
            ("t2".to_string(), "Amazon".to_string()),
            ("t3".to_string(), "Whole Foods".to_string()),
        ]
    );
    assert!(
        avoir_db::balance::check_invariant(&mut pool.acquire().await.unwrap())
            .await
            .unwrap()
            .is_empty(),
        "renaming must not move a balance"
    );
}

#[tokio::test]
async fn changing_only_the_capitalisation_is_allowed() {
    let pool = db().await;
    let d = make(&pool, "amazon").await;
    // The uniqueness check excludes self, so a row cannot conflict with itself.
    let r = call(
        &pool,
        "PUT",
        &format!("/descriptions/{d}"),
        Some(json!({ "name": "Amazon" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));
}

#[tokio::test]
async fn renaming_onto_another_name_is_refused() {
    let pool = db().await;
    make(&pool, "Amazon").await;
    let d = make(&pool, "Whole Foods").await;
    let err = call(
        &pool,
        "PUT",
        &format!("/descriptions/{d}"),
        Some(json!({ "name": "AMAZON" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 409);
}

#[tokio::test]
async fn merging_repoints_the_transactions_and_removes_the_sources() {
    let pool = db().await;
    let acct = account(&pool).await;
    let target = make(&pool, "Amazon").await;
    let a = make(&pool, "AMZN MKTP").await;
    let b = make(&pool, "Amazon.com").await;
    filed(&pool, "t1", &acct, &a, "AMZN MKTP").await;
    filed(&pool, "t2", &acct, &b, "Amazon.com").await;

    let r = call(
        &pool,
        "POST",
        "/descriptions/merge",
        Some(json!({ "sourceIds": [a, b], "targetId": target })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));

    let rows: Vec<(String, String, String)> =
        sqlx::query_as(r#"SELECT "id","name","descriptionId" FROM "Transaction" ORDER BY "id""#)
            .fetch_all(&pool)
            .await
            .unwrap();
    for (id, name, desc) in &rows {
        assert_eq!(name, "Amazon", "{id}");
        assert_eq!(desc, &target, "{id}");
    }

    let left: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "TransactionDescription""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, vec![target]);
}

#[tokio::test]
async fn merging_a_description_into_itself_is_a_no_op_not_an_error() {
    let pool = db().await;
    let acct = account(&pool).await;
    let target = make(&pool, "Amazon").await;
    filed(&pool, "t1", &acct, &target, "Amazon").await;

    // A UI selecting a range that includes the target should not have to
    // filter it out.
    let r = call(
        &pool,
        "POST",
        "/descriptions/merge",
        Some(json!({ "sourceIds": [target.clone()], "targetId": target })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "TransactionDescription""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "the target survives");
    let tx: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Transaction""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(tx, 1);
}

#[tokio::test]
async fn a_merge_naming_a_missing_source_moves_nothing() {
    let pool = db().await;
    let acct = account(&pool).await;
    let target = make(&pool, "Amazon").await;
    let real = make(&pool, "AMZN MKTP").await;
    filed(&pool, "t1", &acct, &real, "AMZN MKTP").await;

    let err = call(
        &pool,
        "POST",
        "/descriptions/merge",
        Some(json!({ "sourceIds": [real.clone(), "ghost"], "targetId": target })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);

    // All-or-nothing: a partial merge would move some rows and leave the caller
    // unable to tell which.
    assert_eq!(
        names_of(&pool).await,
        vec![("t1".to_string(), "AMZN MKTP".to_string())]
    );
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "TransactionDescription""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 2);
}

#[tokio::test]
async fn merging_from_the_surviving_side_does_the_same_thing() {
    let pool = db().await;
    let acct = account(&pool).await;
    let target = make(&pool, "Amazon").await;
    let source = make(&pool, "AMZN MKTP").await;
    filed(&pool, "t1", &acct, &source, "AMZN MKTP").await;

    let r = call(
        &pool,
        "POST",
        &format!("/descriptions/{target}/merge"),
        Some(json!({ "mergeId": source })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Amazon"));
    assert_eq!(
        names_of(&pool).await,
        vec![("t1".to_string(), "Amazon".to_string())]
    );
    let left: Vec<String> = sqlx::query_scalar(r#"SELECT "id" FROM "TransactionDescription""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(left, vec![target]);
}

#[tokio::test]
async fn merging_into_itself_from_the_surviving_side_is_refused() {
    let pool = db().await;
    let d = make(&pool, "Amazon").await;
    // Unlike the bulk form, this one names exactly one source — so asking for
    // it is a mistake rather than an over-broad selection, and deleting the
    // target would destroy the description entirely.
    let err = call(
        &pool,
        "POST",
        &format!("/descriptions/{d}/merge"),
        Some(json!({ "mergeId": d })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "TransactionDescription""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn a_description_in_use_cannot_be_deleted_and_says_how_many() {
    let pool = db().await;
    let acct = account(&pool).await;
    let d = make(&pool, "Amazon").await;
    filed(&pool, "t1", &acct, &d, "Amazon").await;
    filed(&pool, "t2", &acct, &d, "Amazon").await;

    let err = call(&pool, "DELETE", &format!("/descriptions/{d}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);
    // The answer to "why can't I delete this" is the number.
    assert!(err.error.contains('2'), "{}", err.error);
}

#[tokio::test]
async fn a_description_nothing_uses_deletes() {
    let pool = db().await;
    let d = make(&pool, "Amazon").await;
    let r = call(&pool, "DELETE", &format!("/descriptions/{d}"), None)
        .await
        .unwrap();
    assert_eq!(r.status, 204);
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "TransactionDescription""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_missing_description_is_a_404_on_every_route_that_names_one() {
    let pool = db().await;
    let real = make(&pool, "Amazon").await;
    for (method, path, body) in [
        (
            "PUT",
            "/descriptions/nope".into(),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", "/descriptions/nope".into(), None),
        (
            "POST",
            "/descriptions/nope/merge".into(),
            Some(json!({ "mergeId": real.clone() })),
        ),
        (
            "POST",
            format!("/descriptions/{real}/merge"),
            Some(json!({ "mergeId": "nope" })),
        ),
        (
            "POST",
            "/descriptions/merge".into(),
            Some(json!({ "sourceIds": [real.clone()], "targetId": "nope" })),
        ),
    ] {
        let err = call(&pool, method, &path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

#[tokio::test]
async fn creating_a_transaction_files_it_under_a_description() {
    let pool = db().await;
    let acct = account(&pool).await;

    // The reference's ledger gate looks the name up and creates the description
    // when it is new. The port had no equivalent, so every transaction it wrote
    // carried a NULL `descriptionId` and this whole feature — the merge and
    // rename UI above — had nothing to operate on.
    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "Corner Shop", "type": "EXPENSE", "amount": 12.34,
            "date": "2026-03-01T00:00:00.000Z", "accountId": acct
        })),
    )
    .await
    .unwrap();
    let first = r.body["id"].as_str().unwrap().to_string();

    let filed_under: Option<String> =
        sqlx::query_scalar(r#"SELECT "descriptionId" FROM "Transaction" WHERE "id" = ?"#)
            .bind(&first)
            .fetch_one(&pool)
            .await
            .unwrap();
    let filed_under = filed_under.expect("the gate files the row under a description");

    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "TransactionDescription""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(names, vec!["Corner Shop"]);

    // A second transaction with the same name REUSES it, case-insensitively —
    // the reference matches with `mode: 'insensitive'`, and without that a typo
    // in capitalisation becomes a second description for the merge UI to clean
    // up after.
    let r = call(
        &pool,
        "POST",
        "/transactions",
        Some(json!({
            "name": "corner shop", "type": "EXPENSE", "amount": 5.00,
            "date": "2026-03-02T00:00:00.000Z", "accountId": acct
        })),
    )
    .await
    .unwrap();
    let second: Option<String> =
        sqlx::query_scalar(r#"SELECT "descriptionId" FROM "Transaction" WHERE "id" = ?"#)
            .bind(r.body["id"].as_str().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(second.as_deref(), Some(filed_under.as_str()));

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "TransactionDescription""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "one description, not one per capitalisation");
}
