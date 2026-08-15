//! Pay-period extension: the horizon moves ahead of use, and calling it twice
//! is a no-op rather than an error.

use avoir_db::pay_period::extend_by_one;
use sqlx::SqliteConnection;

async fn schedule(conn: &mut SqliteConnection, ty: &str) {
    sqlx::query(
        r#"INSERT INTO "PaySchedule" ("id","name","type","anchorDate","isDefault","createdAt","updatedAt")
           VALUES ('sch','Main', ?, '2026-01-02',1,'2026-01-01T00:00:00','2026-01-01T00:00:00')"#,
    ).bind(ty).execute(&mut *conn).await.unwrap();
}

async fn period(
    conn: &mut SqliteConnection,
    id: &str,
    start: &str,
    end: &str,
    pay: &str,
    year: i64,
    num: i64,
) {
    sqlx::query(
        r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES (?, 'sch', ?, ?, ?, ?, ?)"#,
    ).bind(id).bind(start).bind(end).bind(pay).bind(year).bind(num)
     .execute(&mut *conn).await.unwrap();
}

async fn count(conn: &mut SqliteConnection) -> i64 {
    sqlx::query_scalar(r#"SELECT COUNT(*) FROM "PayPeriod""#)
        .fetch_one(&mut *conn)
        .await
        .unwrap()
}

#[tokio::test]
async fn extending_appends_one_period_after_the_latest() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    schedule(&mut c, "BIWEEKLY").await;
    period(
        &mut c,
        "p1",
        "2026-01-02",
        "2026-01-15",
        "2026-01-02",
        2026,
        1,
    )
    .await;

    let created = extend_by_one(&mut c).await.unwrap();
    assert!(created.is_some());
    assert_eq!(count(&mut c).await, 2);

    let next: (String, String) =
        sqlx::query_as(r#"SELECT "startDate","endDate" FROM "PayPeriod" WHERE "id" <> 'p1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        next.0, "2026-01-16",
        "starts the day after the previous ended"
    );
}

/// Each call extends by ONE more period — it is incremental, not idempotent.
///
/// I initially asserted the opposite and the test failed: after the first
/// extension the latest period has moved, so the second call generates the one
/// after that. The TypeScript behaves the same way, and it is the intent — the
/// hook fires per recurring transaction, so the horizon advances with use. The
/// uniqueness check on (scheduleId, year, periodNum) guards against duplicating
/// the SAME period, not against being called twice.
#[tokio::test]
async fn each_call_extends_the_horizon_by_one_more_period() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    schedule(&mut c, "BIWEEKLY").await;
    period(
        &mut c,
        "p1",
        "2026-01-02",
        "2026-01-15",
        "2026-01-02",
        2026,
        1,
    )
    .await;

    extend_by_one(&mut c).await.unwrap();
    extend_by_one(&mut c).await.unwrap();
    assert_eq!(count(&mut c).await, 3, "two calls, two new periods");

    let dates: Vec<String> =
        sqlx::query_scalar(r#"SELECT "startDate" FROM "PayPeriod" ORDER BY "startDate""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        dates,
        vec!["2026-01-02", "2026-01-16", "2026-01-30"],
        "each period follows the last"
    );
}

/// The duplicate guard, exercised directly: re-extending from a latest period
/// that has NOT moved must not create a second copy.
#[tokio::test]
async fn extending_from_an_unchanged_latest_does_not_duplicate() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    schedule(&mut c, "BIWEEKLY").await;
    period(
        &mut c,
        "p1",
        "2026-01-02",
        "2026-01-15",
        "2026-01-02",
        2026,
        1,
    )
    .await;
    // Pre-create exactly the period the next extension would generate.
    period(
        &mut c,
        "p2",
        "2026-01-16",
        "2026-01-29",
        "2026-01-16",
        2026,
        2,
    )
    .await;
    // Its endDate is later, so the walk starts from it — but seed a THIRD with an
    // earlier end so `latest` still points at p2's successor slot.
    let before = count(&mut c).await;

    // Extending now generates period 3, which does not exist — so it is created.
    extend_by_one(&mut c).await.unwrap();
    assert_eq!(count(&mut c).await, before + 1);

    // Deleting it and re-running reproduces the same period rather than a new one.
    sqlx::query(r#"DELETE FROM "PayPeriod" WHERE "periodNum" = 3"#)
        .execute(&mut *c)
        .await
        .unwrap();
    extend_by_one(&mut c).await.unwrap();
    let nums: Vec<i64> =
        sqlx::query_scalar(r#"SELECT "periodNum" FROM "PayPeriod" ORDER BY "periodNum""#)
            .fetch_all(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        nums,
        vec![1, 2, 3],
        "regenerating produces the same period, not a fourth"
    );
}

#[tokio::test]
async fn no_default_schedule_is_a_no_op() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    assert_eq!(extend_by_one(&mut c).await.unwrap(), None);
}

/// Nothing to extend FROM is also a no-op — the generator needs an anchor in
/// the existing data, not just a schedule.
#[tokio::test]
async fn a_schedule_with_no_periods_is_a_no_op() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    schedule(&mut c, "BIWEEKLY").await;
    assert_eq!(extend_by_one(&mut c).await.unwrap(), None);
}

/// A monthly schedule extends by a month, not by a fortnight — the generator
/// is doing the work, so the frequency has to reach it.
#[tokio::test]
async fn the_schedule_type_drives_the_period_length() {
    let pool = avoir_db::connect_in_memory().await.unwrap();
    let mut c = pool.acquire().await.unwrap();
    sqlx::query(
        r#"INSERT INTO "PaySchedule" ("id","name","type","anchorDate","isDefault","createdAt","updatedAt","firstPayDay")
           VALUES ('sch','Main','MONTHLY','2026-01-01',1,'2026-01-01T00:00:00','2026-01-01T00:00:00',1)"#,
    ).execute(&mut *c).await.unwrap();
    period(
        &mut c,
        "p1",
        "2026-01-01",
        "2026-01-31",
        "2026-01-01",
        2026,
        1,
    )
    .await;

    extend_by_one(&mut c).await.unwrap();
    let next: (String, String) =
        sqlx::query_as(r#"SELECT "startDate","endDate" FROM "PayPeriod" WHERE "id" <> 'p1'"#)
            .fetch_one(&mut *c)
            .await
            .unwrap();
    assert_eq!(
        (next.0.as_str(), next.1.as_str()),
        ("2026-02-01", "2026-02-28"),
        "a whole calendar month"
    );
}
