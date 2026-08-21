//! Upcoming bills and income on the transactions list.
//!
//! The whole module shipped untested in the first cut. These pin the rules that
//! decide whether a row appears at all — the ones a reader would "simplify".

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

fn today() -> chrono::NaiveDate {
    chrono::Utc::now().date_naive()
}

fn iso(d: chrono::NaiveDate) -> String {
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

async fn seed_expense(pool: &SqlitePool) -> (String, String) {
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('g','G','#000',?)"#,
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
           VALUES ('b','Bills',1,?,'g',0)"#,
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Expense" ("id","name","amount","frequency","budgetId","isAutomatic",
                                  "dueDay","skipWeekend","createdAt","updatedAt")
           VALUES ('e1','Internet',6000,'MONTHLY','b',1,1,0,?,?)"#,
    )
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
    ("e1".into(), "b".into())
}

/// One occurrence, at a given offset from today, with a given status.
async fn occurrence(
    pool: &SqlitePool,
    id: &str,
    offset_days: i64,
    status: &str,
    snoozed: Option<i64>,
) {
    let due = today() + chrono::Duration::days(offset_days);
    let snooze = snoozed.map(|d| iso(today() + chrono::Duration::days(d)));
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status","expenseId",
              "snoozedUntil","createdAt","updatedAt")
           VALUES (?,'EXPENSE','e1',?,6000,?,'e1',?,?,?)"#,
    )
    .bind(id)
    .bind(iso(due))
    .bind(status)
    .bind(snooze)
    .bind(avoir_api::id::now_iso())
    .bind(avoir_api::id::now_iso())
    .execute(pool)
    .await
    .unwrap();
}

async fn anticipations(pool: &SqlitePool, query: &str) -> Vec<Value> {
    call(pool, "GET", &format!("/transactions?limit=50{query}"), None)
        .await
        .unwrap()
        .body
        .get("anticipations")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

#[tokio::test]
async fn a_generated_bill_appears_with_its_details() {
    // Seeded rows are NOT used here. The generator prunes any PENDING row that
    // does not correspond to a computed occurrence (ADR-024), so a hand-inserted
    // one is deleted before it can be read back — which is correct, and means a
    // fixture that fights it tests nothing. These assert on what generation
    // actually produces.
    let pool = db().await;
    seed_expense(&pool).await;

    let a = anticipations(&pool, "").await;
    assert!(
        !a.is_empty(),
        "a monthly bill since the epoch has occurrences"
    );
    let first = &a[0];
    assert_eq!(first["sourceType"], "expense");
    assert_eq!(first["name"], "Internet");
    assert_eq!(first["amount"], json!(60.00));
    assert_eq!(first["isAutomatic"], true);
    assert_eq!(first["frequency"], "MONTHLY");
}

#[tokio::test]
async fn an_overdue_bill_still_appears() {
    // The point of the list. A bill that came due and was never paid must not
    // scroll off it — the expense here has been due on the 1st of every month
    // since the epoch, so most of its occurrences are in the past.
    let pool = db().await;
    seed_expense(&pool).await;

    let a = anticipations(&pool, "").await;
    assert!(
        a.iter().any(|x| x["status"] == "OVERDUE"),
        "expected at least one overdue occurrence: {a:#?}"
    );
}

#[tokio::test]
async fn a_bill_beyond_the_lookahead_does_not_appear_yet() {
    let pool = db().await;
    seed_expense(&pool).await;
    occurrence(&pool, "s1", 30, "PENDING", None).await;

    let a = anticipations(&pool, "").await;
    assert!(
        a.iter().all(|x| x["id"] != "s1"),
        "30 days out is not 'upcoming'"
    );
}

#[tokio::test]
async fn a_paid_occurrence_is_not_anticipated() {
    // It is a transaction now. Showing both would double it on the page.
    let pool = db().await;
    seed_expense(&pool).await;
    occurrence(&pool, "s1", -2, "PAID", None).await;

    let a = anticipations(&pool, "").await;
    assert!(a.iter().all(|x| x["id"] != "s1"));
}

#[tokio::test]
async fn a_live_snooze_stays_hidden_unless_asked_for() {
    // A snooze is a deliberate "not now" — but the row has to be reachable, or
    // undoing it is impossible from the only screen that shows it.
    let pool = db().await;
    seed_expense(&pool).await;
    occurrence(&pool, "s1", -1, "SNOOZED", Some(5)).await;

    assert!(
        anticipations(&pool, "")
            .await
            .iter()
            .all(|x| x["id"] != "s1"),
        "hidden by default"
    );
    let shown = anticipations(&pool, "&showSnoozed=true").await;
    let mine: Vec<&Value> = shown.iter().filter(|x| x["id"] == "s1").collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["status"], "SNOOZED");
}

#[tokio::test]
async fn an_expired_snooze_resurfaces_without_being_asked_for() {
    // Otherwise a bill snoozed once is hidden forever, which is the opposite of
    // what snoozing means.
    let pool = db().await;
    seed_expense(&pool).await;
    occurrence(&pool, "s1", -3, "SNOOZED", Some(-1)).await;

    let a = anticipations(&pool, "").await;
    let mine: Vec<&Value> = a.iter().filter(|x| x["id"] == "s1").collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0]["status"], "OVERDUE");
}

#[tokio::test]
async fn anticipations_ride_only_on_the_first_page() {
    // ADR-009. Repeating them per page duplicates every upcoming row down the
    // list as the user scrolls, and a cursor request is asking for more history.
    let pool = db().await;
    seed_expense(&pool).await;
    // Real transactions, so there is a real second page to ask for. Without
    // them `nextCursor` is null and the "cursor" is an empty string, which the
    // handler correctly treats as absent — the test would then be asserting
    // about the first page twice.
    let now = avoir_api::id::now_iso();
    for i in 0..3 {
        sqlx::query(
            r#"INSERT INTO "Transaction" ("id","amount","netAmount","date","createdAt","type",
                                          "name","imported","isCashBack","budgetId")
               VALUES (?,1000,1000,?,?,'EXPENSE','x',0,0,'b')"#,
        )
        .bind(format!("t{i}"))
        .bind(iso(today()))
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
    }

    assert!(!anticipations(&pool, "").await.is_empty());
    // A real cursor, taken from the first page — a made-up one is rejected
    // before the handler decides anything about anticipations.
    let first = call(&pool, "GET", "/transactions?limit=1", None)
        .await
        .unwrap();
    let cursor = first.body["nextCursor"].as_str().unwrap_or("").to_string();
    let paged = call(
        &pool,
        "GET",
        &format!("/transactions?limit=50&cursor={cursor}"),
        None,
    )
    .await
    .unwrap();
    assert!(
        paged.body.get("anticipations").is_none(),
        "a cursor page carries none"
    );
}

#[tokio::test]
async fn they_can_be_turned_off() {
    let pool = db().await;
    seed_expense(&pool).await;
    occurrence(&pool, "s1", 2, "PENDING", None).await;

    let off = call(
        &pool,
        "GET",
        "/transactions?limit=50&showAnticipations=false",
        None,
    )
    .await
    .unwrap();
    assert!(off.body.get("anticipations").is_none());
}

#[tokio::test]
async fn an_occurrence_whose_source_is_gone_is_skipped_not_rendered_blank() {
    let pool = db().await;
    seed_expense(&pool).await;
    let due = iso(today() + chrono::Duration::days(2));
    // No expenseId: nothing to name it with.
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "createdAt","updatedAt")
           VALUES ('orphan','EXPENSE','gone',?,6000,'PENDING',?,?)"#,
    )
    .bind(&due)
    .bind(avoir_api::id::now_iso())
    .bind(avoir_api::id::now_iso())
    .execute(&pool)
    .await
    .unwrap();

    let a = anticipations(&pool, "").await;
    assert!(a.iter().all(|x| x["id"] != "orphan"));
}
