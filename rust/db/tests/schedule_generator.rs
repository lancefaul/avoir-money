//! The schedule generator, against the case that exposed it.
//!
//! The generator shipped matching a utility reading to an occurrence by
//! **calendar month**. The original matches by distance — the nearest reading
//! within ±15 days — and the difference is not cosmetic: a bill due on the last
//! day of a month governs the *following* month's occurrence, which a month
//! match cannot see. The result was a bill that had been paid on 07/31
//! reappearing as overdue on 08/03.
//!
//! These tests are written around real production data (the water utility
//! garbage: monthly, due on the 1st, skip-weekend on, readings dated 06/30 and
//! 07/31) because the shape is what makes the bug reachable, and a synthetic
//! shape would not have been.

use avoir_db::schedule_generator::{generate, Window};
use chrono::NaiveDate;
use sqlx::SqlitePool;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

async fn db() -> SqlitePool {
    avoir_db::connect_in_memory().await.expect("test db")
}

/// A monthly utility expense due on the 1st, with skip-weekend on.
///
/// `amount` is the recurring item's generic figure — the fallback a metered
/// bill is supposed to override.
async fn seed_expense(pool: &SqlitePool, amount: i64) {
    let now = "2026-01-01T00:00:00.000Z";
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt") VALUES ('g','G','#000',?1);
           INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
             VALUES ('b','Utilities',1,?1,'g',0);"#,
    )
    .bind(now)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO "Expense"
             ("id","name","amount","frequency","budgetId","isAutomatic","dueDay",
              "skipWeekend","startDate","createdAt","updatedAt")
           VALUES ('e1','CityWater',?1,'MONTHLY','b',0,1,1,?2,?2,?2)"#,
    )
    .bind(amount)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

/// Link a metered service to the expense and give it readings.
///
/// Each entry is `(due_date, cost_cents, other_fees_cents)`.
async fn seed_readings(pool: &SqlitePool, readings: &[(NaiveDate, i64, i64)]) {
    let now = "2026-01-01T00:00:00.000Z";
    sqlx::query(
        r#"INSERT INTO "UtilityProvider" ("id","name","createdAt","updatedAt")
             VALUES ('p','CityWater',?1,?1);
           INSERT INTO "UtilityService"
             ("id","providerId","serviceType","metering","expenseId","createdAt","updatedAt")
             VALUES ('s','p','GARBAGE','METERED','e1',?1,?1);"#,
    )
    .bind(now)
    .execute(pool)
    .await
    .unwrap();

    for (i, (due, cost, other)) in readings.iter().enumerate() {
        sqlx::query(
            r#"INSERT INTO "UtilityReading"
                 ("id","billDate","cost","otherFees","dueDate","serviceId","createdAt")
               VALUES (?1,?2,?3,?4,?2,'s',?5)"#,
        )
        .bind(format!("r{i}"))
        .bind(iso(*due))
        .bind(cost)
        .bind(other)
        .bind(now)
        .execute(pool)
        .await
        .unwrap();
    }
}

/// Mark an occurrence paid, as the user did on 07/31.
async fn mark_paid(pool: &SqlitePool, due: NaiveDate, amount: i64) {
    let now = "2026-08-01T00:00:00.000Z";
    sqlx::query(
        r#"INSERT INTO "ScheduledTransaction"
             ("id","sourceType","sourceId","dueDate","expectedAmount","status",
              "expenseId","createdAt","updatedAt")
           VALUES ('paid','EXPENSE','e1',?1,?2,'PAID','e1',?3,?3)"#,
    )
    .bind(iso(due))
    .bind(amount)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

/// Every generated row, as `(YYYY-MM-DD, expectedAmount, status)`.
async fn rows(pool: &SqlitePool) -> Vec<(String, i64, String)> {
    sqlx::query_as::<_, (String, i64, String)>(
        r#"SELECT substr("dueDate",1,10), "expectedAmount", "status"
             FROM "ScheduledTransaction" WHERE "sourceId" = 'e1'
            ORDER BY "dueDate""#,
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn run(pool: &SqlitePool, start: NaiveDate, end: NaiveDate) {
    let mut conn = pool.acquire().await.unwrap();
    generate(
        &mut conn,
        &Window {
            start,
            end,
            source_type: None,
            source_id: None,
        },
    )
    .await
    .unwrap();
}

/// The reported bug, end to end.
///
/// August 1st 2026 is a Saturday, so skip-weekend moves the occurrence to Monday
/// the 3rd. The bill it is actually about was due 07/31 and is already paid.
/// Resolution must pull it back onto that date, where the fulfilled-month check
/// suppresses it — leaving no August row at all.
#[tokio::test]
async fn a_paid_bill_does_not_reappear_in_the_following_month() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;
    seed_readings(
        &pool,
        &[(d(2026, 6, 30), 2823, 100), (d(2026, 7, 31), 2823, 100)],
    )
    .await;
    mark_paid(&pool, d(2026, 7, 31), 2923).await;

    run(&pool, d(2026, 1, 1), d(2026, 8, 17)).await;

    let got = rows(&pool).await;
    assert!(
        !got.iter().any(|(date, _, _)| date.starts_with("2026-08")),
        "the 08/03 occurrence belongs to the bill paid on 07/31, so it must not \
         be generated; got {got:?}"
    );
}

/// The same run, from the other direction: the paid row survives untouched and
/// is the only thing in that window.
///
/// Asserting only the absence of August would also pass if the generator had
/// produced nothing at all, which is why this pins what it *did* produce.
#[tokio::test]
async fn the_readings_own_dates_are_what_get_scheduled() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;
    seed_readings(
        &pool,
        &[(d(2026, 6, 30), 2823, 100), (d(2026, 7, 31), 2823, 100)],
    )
    .await;
    mark_paid(&pool, d(2026, 7, 31), 2923).await;

    run(&pool, d(2026, 6, 1), d(2026, 8, 17)).await;

    let got = rows(&pool).await;
    // Three occurrences, three different outcomes, and all three matter:
    //
    // - **06/01** keeps its generic due day at the stored amount. June 1st is a
    //   Monday, and the nearest reading (06/30) is 29 days away — outside the
    //   window. An unread month is supposed to fall back.
    // - **07/01 → 06/30**, priced at the reading. One day away, so July's
    //   occurrence is about June's bill; the generic due day does not survive.
    // - **08/03 → 07/31**, and then vanishes. Three days away, and that month is
    //   already PAID. This is the row that used to appear as overdue.
    assert_eq!(
        got,
        vec![
            ("2026-06-01".into(), 2823, "PENDING".into()),
            ("2026-06-30".into(), 2923, "PENDING".into()),
            ("2026-07-31".into(), 2923, "PAID".into()),
        ],
        "an occurrence sits on its own bill's due date when it has one, and on \
         the generic due day when it does not"
    );
}

/// A month with no reading yet keeps the generic due day and the stored amount.
///
/// This is the case the ±15-day window must *not* swallow: September's bill has
/// not been issued, so 09/01 with the fallback amount is correct.
#[tokio::test]
async fn a_month_beyond_the_last_reading_keeps_its_generic_due_day() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;
    seed_readings(&pool, &[(d(2026, 7, 31), 2823, 100)]).await;

    run(&pool, d(2026, 9, 1), d(2026, 9, 30)).await;

    assert_eq!(
        rows(&pool).await,
        vec![("2026-09-01".into(), 2823, "PENDING".into())],
        "no reading is within 15 days of 09/01, so nothing overrides it"
    );
}

/// The reading supplies the amount, including its fees.
///
/// $28.23 cost + $1.00 other fees = $29.23, which is what production shows and
/// what the recurring item's own $28.23 must not override.
///
/// Both rows are asserted rather than just the matched one: the pair shows the
/// fee arithmetic and the fallback in the same run, so a change that quietly
/// dropped `otherFees` would still have to explain why only one row moved.
#[tokio::test]
async fn the_reading_prices_the_occurrence_not_the_stored_amount() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;
    seed_readings(&pool, &[(d(2026, 7, 31), 2823, 100)]).await;

    run(&pool, d(2026, 7, 1), d(2026, 8, 17)).await;

    let got = rows(&pool).await;
    assert_eq!(
        got,
        vec![
            // 07/01 is 30 days from the only reading — no override.
            ("2026-07-01".into(), 2823, "PENDING".into()),
            // 08/03 pulled back onto the bill, priced cost + fees.
            ("2026-07-31".into(), 2923, "PENDING".into()),
        ],
        "cost plus fees where a reading governs, the stored amount where none does"
    );
}

/// Regeneration is idempotent — an occurrence that moved onto a reading must not
/// also survive at the date it moved from.
///
/// The prune only removes PENDING rows that no longer correspond to a computed
/// occurrence, so a resolution that is not stable across runs would leave a
/// trail of stale rows rather than one moving row.
#[tokio::test]
async fn regenerating_does_not_accumulate_rows() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;
    seed_readings(
        &pool,
        &[(d(2026, 6, 30), 2823, 100), (d(2026, 7, 31), 2823, 100)],
    )
    .await;

    run(&pool, d(2026, 6, 1), d(2026, 8, 17)).await;
    let first = rows(&pool).await;
    run(&pool, d(2026, 6, 1), d(2026, 8, 17)).await;
    let second = rows(&pool).await;

    assert_eq!(first, second, "a second run must be a no-op");
}

/// Run the generator against a real imported database.
///
/// Opt-in, because it needs data that only exists where production has been
/// imported:
///
/// ```text
/// cp ~/.local/share/com.avoir.finance/avoir.db /tmp/check.db
/// GENERATOR_DB=/tmp/check.db cargo test -p avoir-db --test schedule_generator \
///   -- --ignored --nocapture
/// ```
///
/// It writes, so it is pointed at a COPY. The fixtures above prove the rules;
/// this proves they survive contact with four years of accumulated schedule
/// rows, three services sharing one provider, and readings entered by hand.
#[tokio::test]
#[ignore]
async fn against_real_data() {
    let Ok(path) = std::env::var("GENERATOR_DB") else {
        eprintln!("GENERATOR_DB not set");
        return;
    };
    let pool = SqlitePool::connect(&format!("sqlite://{path}"))
        .await
        .unwrap();

    // The same window the transactions page asks for.
    let today = chrono::Utc::now().date_naive();
    let mut conn = pool.acquire().await.unwrap();
    generate(
        &mut conn,
        &Window {
            start: d(2026, 1, 1),
            end: today + chrono::Duration::days(7),
            source_type: None,
            source_id: None,
        },
    )
    .await
    .unwrap();
    drop(conn);

    let rows = sqlx::query_as::<_, (String, String, i64, String)>(
        r#"SELECT e."name", substr(s."dueDate",1,10), s."expectedAmount", s."status"
             FROM "ScheduledTransaction" s JOIN "Expense" e ON e."id" = s."sourceId"
            WHERE e."name" LIKE '%the water utility%' AND s."dueDate" >= '2026-06-01'
              AND s."dueDate" < '2026-10-01'
            ORDER BY e."name", s."dueDate""#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    for r in &rows {
        println!("{:32} {} {:>7} {}", r.0, r.1, r.2, r.3);
    }

    // The reported symptom: a bill paid on 07/31 reappearing three days later.
    let phantom: Vec<_> = rows.iter().filter(|r| r.1 == "2026-08-03").collect();
    assert!(
        phantom.is_empty(),
        "08/03 belongs to the bill paid on 07/31 and must not be scheduled: {phantom:?}"
    );
}

/// A targeted regeneration must not touch other sources.
///
/// `generate` is called with a single source after an edit, so it only computes
/// occurrences for that source. Everything else in the window is therefore
/// absent from the computed set — and pruning on that basis deletes rows that
/// were never stale, only never considered.
///
/// This is not hypothetical. On the first real run after the reading-match fix
/// it removed four years of future rows for two of the three the water utility
/// services, because some other page had regenerated one expense over a wide
/// window.
#[tokio::test]
async fn a_targeted_run_leaves_other_sources_alone() {
    let pool = db().await;
    seed_expense(&pool, 2823).await;

    // A second recurring item, sharing the window and nothing else.
    let now = "2026-01-01T00:00:00.000Z";
    sqlx::query(
        r#"INSERT INTO "Expense"
             ("id","name","amount","frequency","budgetId","isAutomatic","dueDay",
              "skipWeekend","startDate","createdAt","updatedAt")
           VALUES ('e2','Internet',6000,'MONTHLY','b',1,15,0,?1,?1,?1)"#,
    )
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    run(&pool, d(2026, 6, 1), d(2026, 9, 30)).await;

    let other_before = sqlx::query_as::<_, (i64,)>(
        r#"SELECT COUNT(*) FROM "ScheduledTransaction" WHERE "sourceId" = 'e2'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .0;
    assert!(other_before > 0, "the second expense should have rows");

    // Regenerate ONLY the first expense, across the same window.
    let mut conn = pool.acquire().await.unwrap();
    generate(
        &mut conn,
        &Window {
            start: d(2026, 6, 1),
            end: d(2026, 9, 30),
            source_type: Some("EXPENSE".into()),
            source_id: Some("e1".into()),
        },
    )
    .await
    .unwrap();
    drop(conn);

    let other_after = sqlx::query_as::<_, (i64,)>(
        r#"SELECT COUNT(*) FROM "ScheduledTransaction" WHERE "sourceId" = 'e2'"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .0;
    assert_eq!(
        other_after, other_before,
        "regenerating e1 must not prune e2's pending rows"
    );
}

/// Rebuild one account's balance chain against a real database.
///
/// Opt-in and destructive, so it names the account explicitly:
///
/// ```text
/// REPAIR_DB=~/.local/share/com.avoir.finance/avoir.db \
/// REPAIR_ACCOUNT=<id> cargo test -p avoir-db --test schedule_generator \
///   -- --ignored repair_chain --nocapture
/// ```
#[tokio::test]
#[ignore]
async fn repair_chain() {
    let (Ok(path), Ok(account)) = (std::env::var("REPAIR_DB"), std::env::var("REPAIR_ACCOUNT"))
    else {
        eprintln!("REPAIR_DB / REPAIR_ACCOUNT not set");
        return;
    };
    let pool = SqlitePool::connect(&format!("sqlite://{path}"))
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let total = avoir_db::balance::rebuild_chain(&mut conn, &account)
        .await
        .unwrap();
    println!("rebuilt; final balance = {}", total.0);
}

/// The ledger invariant across every account in a real database, read-only.
///
/// `openingBalance + SUM(transactions) == balance`, plus the independent
/// `netAmount == amount` check that the balance invariant is structurally blind
/// to (ERRORS.md: "an invariant that compares two derived numbers can be
/// satisfied by matching errors").
#[tokio::test]
#[ignore]
async fn check_real_invariant() {
    let Ok(path) = std::env::var("REPAIR_DB") else {
        eprintln!("REPAIR_DB not set");
        return;
    };
    let pool = SqlitePool::connect(&format!("sqlite://{path}"))
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();

    let drift = avoir_db::balance::check_invariant(&mut conn).await.unwrap();
    for (name, residual) in &drift {
        println!("DRIFT  {name}: {}", residual.0);
    }
    let bad = avoir_db::balance::check_amount_matches_net(&mut conn)
        .await
        .unwrap();
    for (id, amount, net) in &bad {
        println!("NET != AMOUNT  {id}: amount={} net={}", amount.0, net.0);
    }
    println!(
        "accounts with balance drift: {}  rows with net drift: {}",
        drift.len(),
        bad.len()
    );

    // Balance soundness is the hard assertion: no account may disagree with the
    // sum of its transactions.
    assert!(drift.is_empty(), "ledger invariant violated");

    // `netAmount != amount` is reported rather than asserted, because eight
    // production rows legitimately have it. All eight are split CHILDREN with
    // `net = 0` — the historical gift-card allocations ADR-030 baked in — and
    // they are byte-identical in the Postgres original, so they are imported
    // history rather than a port defect. Children are excluded from the balance
    // chain by the `parentId IS NULL` filter, which is why they cannot move an
    // account.
    //
    // Deliberately NOT scoped away in `check_amount_matches_net` itself: that
    // check exists to catch the ADR-013 drift class, and narrowing a safety
    // check so a known exception stops showing is how the next real one hides.
    let unexpected: Vec<_> = bad.iter().filter(|(_, _, net)| net.0 != 0).collect();
    assert!(
        unexpected.is_empty(),
        "net drift outside the known zero-net children: {unexpected:?}"
    );
}
