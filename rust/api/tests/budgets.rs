//! `/budgets` — categories and the groups they hang under.

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

async fn group(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": name, "color": "#123456" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

async fn budget(pool: &SqlitePool, gid: &str, name: &str) -> String {
    call(
        pool,
        "POST",
        "/budgets",
        Some(json!({ "name": name, "groupId": gid })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

/// A seeded system budget — the kind ADR-017 creates and nothing may delete.
async fn system_budget(pool: &SqlitePool, gid: &str) -> String {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('sys1','Uncategorized',0,?,?,1)"#,
    )
    .bind(&now)
    .bind(gid)
    .execute(pool)
    .await
    .unwrap();
    "sys1".into()
}

#[tokio::test]
async fn a_group_round_trips_and_carries_onto_its_budgets() {
    let pool = db().await;
    let gid = group(&pool, "Essentials").await;
    let bid = budget(&pool, &gid, "Groceries").await;

    let b = call(&pool, "GET", "/budgets", None).await.unwrap();
    assert_eq!(b.body[0]["name"], json!("Groceries"));
    // FLAT, not nested. The comment here used to say the nested `group` object
    // "is what the UI groups the list by" — it is not, and never was: the
    // reference has never returned a nested `group`, and the frontend was built
    // against the reference. It reads `groupName` / `groupColor`. The nested
    // object was invented during the port and this test asserted the invention.
    assert_eq!(b.body[0]["groupName"], json!("Essentials"));
    assert_eq!(b.body[0]["groupColor"], json!("#123456"));
    assert!(
        b.body[0].get("group").is_none(),
        "the nested object is gone; the reference does not return it"
    );
    assert_eq!(
        b.body[0]["isCustom"],
        json!(true),
        "user-made budgets are custom"
    );
    assert_eq!(b.body[0]["isSystem"], json!(false));
    let _ = bid;
}

#[tokio::test]
async fn a_group_with_budgets_refuses_deletion_and_says_how_many() {
    let pool = db().await;
    let gid = group(&pool, "Essentials").await;
    budget(&pool, &gid, "Groceries").await;
    budget(&pool, &gid, "Rent").await;

    let err = call(&pool, "DELETE", &format!("/budgets/groups/{gid}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 409);
    // "Move them first" is only actionable if you know the count.
    assert!(
        err.error.contains('2'),
        "the message names the count: {}",
        err.error
    );
}

#[tokio::test]
async fn a_system_budget_cannot_be_deleted_or_reassigned() {
    let pool = db().await;
    let gid = group(&pool, "System").await;
    let sys = system_budget(&pool, &gid).await;
    let other = budget(&pool, &gid, "Groceries").await;

    // ADR-017 makes these re-creatable by seed, which is a recovery path and
    // not permission to remove them: the seed returns them under NEW ids and
    // every transaction pointing at the old one is orphaned.
    let err = call(&pool, "DELETE", &format!("/budgets/{sys}"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 403);

    let err = call(&pool, "DELETE", &format!("/budgets/{sys}?mode=soft"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 403, "soft delete is refused too");

    let err = call(
        &pool,
        "POST",
        &format!("/budgets/{sys}/reassign"),
        Some(json!({ "targetBudgetId": other })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 403);
}

#[tokio::test]
async fn a_soft_delete_hides_the_budget_and_retires_its_allocations() {
    let pool = db().await;
    let gid = group(&pool, "Essentials").await;
    let bid = budget(&pool, &gid, "Groceries").await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "YearPlan" ("id","year","status","createdAt","updatedAt")
                   VALUES ('yp1',2026,'ACTIVE',?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "CategoryBudget"
             ("id","yearPlanId","budgetId","createdAt","updatedAt","highWaterMark","doneForYear")
           VALUES ('cb1','yp1',?,?,?,0,0)"#,
    )
    .bind(&bid)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(&pool, "DELETE", &format!("/budgets/{bid}?mode=soft"), None)
        .await
        .unwrap();
    assert_eq!(r.body["softDeleted"], json!(true));

    let listed = call(&pool, "GET", "/budgets", None).await.unwrap();
    assert_eq!(
        listed.body.as_array().unwrap().len(),
        0,
        "hidden by default"
    );

    let all = call(&pool, "GET", "/budgets?includeDeleted=true", None)
        .await
        .unwrap();
    assert_eq!(
        all.body.as_array().unwrap().len(),
        1,
        "still reachable — history points at it"
    );

    // A hidden budget still shaping a year plan is the same invisible
    // influence problem an archived expense has.
    let (removed,): (Option<String>,) =
        sqlx::query_as(r#"SELECT "removedAt" FROM "CategoryBudget" WHERE "id" = 'cb1'"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(removed.is_some(), "the allocation is retired with it");
}

#[tokio::test]
async fn soft_deleting_twice_is_refused() {
    let pool = db().await;
    let gid = group(&pool, "G").await;
    let bid = budget(&pool, &gid, "B").await;
    call(&pool, "DELETE", &format!("/budgets/{bid}?mode=soft"), None)
        .await
        .unwrap();

    let err = call(&pool, "DELETE", &format!("/budgets/{bid}?mode=soft"), None)
        .await
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn a_hard_delete_removes_what_referenced_it_and_reports_the_counts() {
    let pool = db().await;
    let gid = group(&pool, "G").await;
    let bid = budget(&pool, &gid, "Groceries").await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
                                  "dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('e1','Food',10000,'MONTHLY',?,0,1,0,?,?)"#,
    )
    .bind(&bid)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Income" ("id","name","amount","frequency","budgetId","createdAt","updatedAt")
           VALUES ('i1','Side',5000,'MONTHLY',?,?,?)"#,
    ).bind(&bid).bind(&now).bind(&now).execute(&pool).await.unwrap();

    let r = call(&pool, "DELETE", &format!("/budgets/{bid}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["deleted"], json!(true));
    assert_eq!(
        r.body["transactionsDeleted"],
        json!(2),
        "1 expense + 1 income"
    );

    let gone: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Expense""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(gone, 0);
    assert!(
        call(&pool, "GET", &format!("/budgets/{bid}"), None)
            .await
            .is_err()
            || call(&pool, "GET", "/budgets", None)
                .await
                .unwrap()
                .body
                .as_array()
                .unwrap()
                .is_empty()
    );
}

#[tokio::test]
async fn reassigning_moves_the_references_rather_than_deleting_them() {
    let pool = db().await;
    let gid = group(&pool, "G").await;
    let from = budget(&pool, &gid, "Old").await;
    let to = budget(&pool, &gid, "New").await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
                                  "dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('e1','Food',10000,'MONTHLY',?,0,1,0,?,?)"#,
    )
    .bind(&from)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let r = call(
        &pool,
        "POST",
        &format!("/budgets/{from}/reassign"),
        Some(json!({ "targetBudgetId": to })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["reassigned"], json!(1));
    assert_eq!(r.body["deleted"], json!(true));

    // The expense survives, re-filed. That is the whole difference from a
    // hard delete, which would have removed it.
    let (bid,): (String,) = sqlx::query_as(r#"SELECT "budgetId" FROM "Expense" WHERE "id" = 'e1'"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bid, to);
}

#[tokio::test]
async fn reassigning_to_a_missing_target_is_a_404() {
    let pool = db().await;
    let gid = group(&pool, "G").await;
    let from = budget(&pool, &gid, "Old").await;

    let err = call(
        &pool,
        "POST",
        &format!("/budgets/{from}/reassign"),
        Some(json!({ "targetBudgetId": "cnope0000000000000000000" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);

    // And the source is untouched — a failed reassign must not delete it.
    let listed = call(&pool, "GET", "/budgets", None).await.unwrap();
    assert_eq!(listed.body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn an_update_leaves_unmentioned_fields_alone() {
    let pool = db().await;
    let gid = group(&pool, "G").await;
    let bid = call(
        &pool,
        "POST",
        "/budgets",
        Some(json!({ "name": "Groceries", "groupId": gid, "icon": "cart" })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let r = call(
        &pool,
        "PUT",
        &format!("/budgets/{bid}"),
        Some(json!({ "name": "Food" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Food"));
    assert_eq!(r.body["icon"], json!("cart"), "icon kept");

    let r = call(
        &pool,
        "PUT",
        &format!("/budgets/{bid}"),
        Some(json!({ "icon": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["icon"], json!(null), "explicit null clears it");
}

#[tokio::test]
async fn filters_and_missing_records_behave() {
    let pool = db().await;
    let g1 = group(&pool, "A").await;
    let g2 = group(&pool, "B").await;
    budget(&pool, &g1, "One").await;
    budget(&pool, &g2, "Two").await;

    let r = call(&pool, "GET", &format!("/budgets?groupId={g1}"), None)
        .await
        .unwrap();
    assert_eq!(r.body.as_array().unwrap().len(), 1);

    let missing = "cnope0000000000000000000";
    for (m, p, b) in [
        (
            "PUT",
            format!("/budgets/{missing}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("/budgets/{missing}"), None),
        (
            "PUT",
            format!("/budgets/groups/{missing}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("/budgets/groups/{missing}"), None),
    ] {
        let err = call(&pool, m, &p, b)
            .await
            .err()
            .unwrap_or_else(|| panic!("{m} {p}"));
        assert_eq!(err.status, 404, "{m} {p}");
    }
}
