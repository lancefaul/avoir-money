//! `/debts` and `/debts/:id/escrow`.

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

async fn make_debt(pool: &SqlitePool, name: &str, ty: &str, extra: Value) -> String {
    let mut b = json!({
        "name": name, "type": ty,
        "originalBalance": 20000.00, "currentBalance": 15000.00,
        "apr": 5.0, "minimumPayment": 350.00, "frequency": "MONTHLY",
        "startDate": "2024-01-01T00:00:00.000Z"
    });
    for (k, v) in extra.as_object().unwrap() {
        b[k] = v.clone();
    }
    call(pool, "POST", "/debts", Some(b))
        .await
        .expect("create debt")
        .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn a_debt_round_trips_with_money_as_cents_and_apr_as_hundredths() {
    let pool = db().await;
    let id = make_debt(&pool, "Car Loan", "AUTO", json!({})).await;

    let r = call(&pool, "GET", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["currentBalance"], json!(15000.00));
    assert_eq!(r.body["apr"], json!(5.0));
    assert_eq!(r.body["minimumPayment"], json!(350.00));
    assert_eq!(r.body["paidOff"], json!(false));

    let (bal, apr): (i64, i64) =
        sqlx::query_as(r#"SELECT "currentBalance", "apr" FROM "Debt" WHERE "id" = ?"#)
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bal, 1_500_000, "cents");
    assert_eq!(apr, 500, "hundredths of a percent");
}

#[tokio::test]
async fn the_displayed_payment_is_the_recorded_one_not_a_reconstruction() {
    let pool = db().await;
    // ADR-031: the stored minimumPayment wins. Deriving it from the terms
    // derives a payment the borrower never makes, because
    // termMonths holds months REMAINING rather than the full schedule.
    let id = make_debt(
        &pool,
        "Auto",
        "AUTO",
        json!({
            "minimumPayment": 653.52, "termMonths": 71, "originalBalance": 40000.00
        }),
    )
    .await;

    let r = call(&pool, "GET", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    assert_eq!(r.body["monthlyPayment"], json!(653.52));
}

#[tokio::test]
async fn escrow_is_added_on_top_of_p_and_i_never_folded_into_it() {
    let pool = db().await;
    let id = make_debt(
        &pool,
        "Home",
        "MORTGAGE",
        json!({
            "minimumPayment": 954.83, "escrowEnabled": true
        }),
    )
    .await;
    call(
        &pool,
        "POST",
        &format!("/debts/{id}/escrow"),
        Some(json!({
            "monthlyAmount": 250.00,
            "periodStartDate": "2026-08-01T00:00:00.000Z",
            "periodEndDate": "2027-07-31T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();

    let r = call(&pool, "GET", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    // 954.83 P&I + 250.00 escrow. Treating the stored payment as PITI and
    // adding escrow again is the double-count ADR-023 was written about.
    assert_eq!(r.body["minimumPayment"], json!(954.83), "P&I alone");
    assert_eq!(r.body["monthlyPayment"], json!(1204.83), "P&I + escrow");
}

#[tokio::test]
async fn re_saving_a_period_updates_it_instead_of_accumulating_rows() {
    let pool = db().await;
    let id = make_debt(&pool, "Home", "MORTGAGE", json!({ "escrowEnabled": true })).await;

    // ADR-032 describes one period accumulating FIVE rows in production, and
    // an edit that appeared not to save because a tie-broken read returned a
    // stale sibling. It records the uniqueness constraint as the open fix —
    // and production has since gained it, so this port upserts rather than
    // inserting. There is no sibling left to return.
    for amount in [200.00_f64, 250.00] {
        call(
            &pool,
            "POST",
            &format!("/debts/{id}/escrow"),
            Some(json!({
                "monthlyAmount": amount,
                "periodStartDate": "2026-08-01T00:00:00.000Z",
                "periodEndDate": "2027-07-31T00:00:00.000Z"
            })),
        )
        .await
        .expect("upsert");
    }

    let list = call(&pool, "GET", &format!("/debts/{id}/escrow"), None)
        .await
        .unwrap();
    assert_eq!(
        list.body.as_array().unwrap().len(),
        1,
        "one period, one row"
    );
    assert_eq!(
        list.body[0]["monthlyAmount"],
        json!(250.00),
        "the newer amount won"
    );

    let r = call(&pool, "GET", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    // Compared in cents: summing two f64 dollar figures reintroduces exactly
    // the representation error the cents type exists to avoid.
    let p_and_i = r.body["minimumPayment"].as_f64().unwrap();
    assert_eq!(
        (r.body["monthlyPayment"].as_f64().unwrap() * 100.0).round() as i64,
        ((p_and_i + 250.00) * 100.0).round() as i64
    );
}

#[tokio::test]
async fn different_periods_coexist_and_the_latest_is_current() {
    let pool = db().await;
    let id = make_debt(&pool, "Home", "MORTGAGE", json!({ "escrowEnabled": true })).await;

    for (start, end, amount) in [
        (
            "2025-08-01T00:00:00.000Z",
            "2026-07-31T00:00:00.000Z",
            250.00_f64,
        ),
        (
            "2026-08-01T00:00:00.000Z",
            "2027-07-31T00:00:00.000Z",
            250.00,
        ),
    ] {
        call(
            &pool,
            "POST",
            &format!("/debts/{id}/escrow"),
            Some(json!({
                "monthlyAmount": amount, "periodStartDate": start, "periodEndDate": end
            })),
        )
        .await
        .unwrap();
    }

    let list = call(&pool, "GET", &format!("/debts/{id}/escrow"), None)
        .await
        .unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 2, "history is kept");
    // Newest period first, and that is the one the payment uses.
    assert_eq!(list.body[0]["monthlyAmount"], json!(250.00));

    let r = call(&pool, "GET", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    // Compared in cents: summing two f64 dollar figures reintroduces exactly
    // the representation error the cents type exists to avoid.
    let p_and_i = r.body["minimumPayment"].as_f64().unwrap();
    assert_eq!(
        (r.body["monthlyPayment"].as_f64().unwrap() * 100.0).round() as i64,
        ((p_and_i + 250.00) * 100.0).round() as i64
    );
}

#[tokio::test]
async fn escrow_is_refused_on_anything_that_is_not_a_mortgage() {
    let pool = db().await;
    let id = make_debt(&pool, "Card", "CREDIT_CARD", json!({})).await;
    let err = call(
        &pool,
        "POST",
        &format!("/debts/{id}/escrow"),
        Some(json!({
            "monthlyAmount": 100.00,
            "periodStartDate": "2026-08-01T00:00:00.000Z",
            "periodEndDate": "2027-07-31T00:00:00.000Z"
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
}

#[tokio::test]
async fn escrow_records_round_trip_and_delete() {
    let pool = db().await;
    let id = make_debt(&pool, "Home", "MORTGAGE", json!({ "escrowEnabled": true })).await;
    let e = call(
        &pool,
        "POST",
        &format!("/debts/{id}/escrow"),
        Some(json!({
            "monthlyAmount": 300.00,
            "periodStartDate": "2026-08-01T00:00:00.000Z",
            "periodEndDate": "2027-07-31T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();
    let eid = e.body["id"].as_str().unwrap().to_string();
    assert_eq!(e.body["monthlyAmount"], json!(300.00));

    let up = call(
        &pool,
        "PUT",
        &format!("/debts/{id}/escrow/{eid}"),
        Some(json!({
            "monthlyAmount": 325.50,
            "periodStartDate": "2026-08-01T00:00:00.000Z",
            "periodEndDate": "2027-07-31T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();
    assert_eq!(up.body["monthlyAmount"], json!(325.50));

    let list = call(&pool, "GET", &format!("/debts/{id}/escrow"), None)
        .await
        .unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 1);

    let d = call(&pool, "DELETE", &format!("/debts/{id}/escrow/{eid}"), None)
        .await
        .unwrap();
    assert_eq!(d.status, 204);
    let list = call(&pool, "GET", &format!("/debts/{id}/escrow"), None)
        .await
        .unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn the_summary_agrees_with_the_rows_it_sums() {
    let pool = db().await;
    make_debt(
        &pool,
        "A",
        "AUTO",
        json!({ "currentBalance": 10000.00, "minimumPayment": 300.00 }),
    )
    .await;
    make_debt(
        &pool,
        "B",
        "AUTO",
        json!({ "currentBalance": 5000.00, "minimumPayment": 150.00 }),
    )
    .await;

    let list = call(&pool, "GET", "/debts", None).await.unwrap();
    let row_total: i64 = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|d| (d["monthlyPayment"].as_f64().unwrap() * 100.0).round() as i64)
        .sum();

    let s = call(&pool, "GET", "/debts/summary", None).await.unwrap();
    assert_eq!(s.body["totalBalance"], json!(15000.00));
    assert_eq!(s.body["activeCount"], json!(2));
    // The summary and the rows appear on the same screen. A second copy of the
    // payment rule would let them disagree.
    assert_eq!(
        (s.body["totalMinimumMonthly"].as_f64().unwrap() * 100.0).round() as i64,
        row_total
    );
}

#[tokio::test]
async fn paid_off_debts_are_hidden_from_the_list_and_counted_separately() {
    let pool = db().await;
    let a = make_debt(&pool, "Active", "AUTO", json!({})).await;
    let done = make_debt(&pool, "Done", "AUTO", json!({})).await;
    call(
        &pool,
        "PUT",
        &format!("/debts/{done}"),
        Some(json!({ "paidOff": true })),
    )
    .await
    .unwrap();

    let list = call(&pool, "GET", "/debts", None).await.unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 1);
    assert_eq!(list.body[0]["id"], json!(a));

    let all = call(&pool, "GET", "/debts?includePaidOff=true", None)
        .await
        .unwrap();
    assert_eq!(all.body.as_array().unwrap().len(), 2);

    let s = call(&pool, "GET", "/debts/summary", None).await.unwrap();
    assert_eq!(s.body["activeCount"], json!(1));
    assert_eq!(s.body["paidOffCount"], json!(1));
}

#[tokio::test]
async fn an_amortization_schedule_pays_the_debt_down_to_zero() {
    let pool = db().await;
    let id = make_debt(
        &pool,
        "Auto",
        "AUTO",
        json!({
            "currentBalance": 5000.00, "apr": 6.0, "minimumPayment": 500.00
        }),
    )
    .await;

    let r = call(&pool, "GET", &format!("/debts/{id}/amortization"), None)
        .await
        .unwrap();
    let entries = r.body["entries"].as_array().unwrap();
    assert!(!entries.is_empty());
    assert_eq!(r.body["isNegativelyAmortizing"], json!(false));

    let last = entries.last().unwrap();
    assert_eq!(
        last["remainingBalance"],
        json!(0.0),
        "the schedule reaches zero"
    );
    // Every entry splits into principal + interest (+ escrow), so the totals
    // are the sum of the parts rather than an independent calculation.
    let total_interest: f64 = entries
        .iter()
        .map(|e| e["interestAmount"].as_f64().unwrap())
        .sum();
    assert!((r.body["totalInterest"].as_f64().unwrap() - total_interest).abs() < 0.05);
}

#[tokio::test]
async fn a_payment_that_cannot_cover_interest_is_reported_not_looped() {
    let pool = db().await;
    // ADR-011: negative amortization produces an infinite schedule, so it is
    // detected and reported rather than run to the cap.
    let id = make_debt(
        &pool,
        "Underwater",
        "CREDIT_CARD",
        json!({
            "currentBalance": 20000.00, "apr": 25.0, "minimumPayment": 10.00
        }),
    )
    .await;

    let r = call(&pool, "GET", &format!("/debts/{id}/amortization"), None)
        .await
        .unwrap();
    assert_eq!(r.body["isNegativelyAmortizing"], json!(true));
}

#[tokio::test]
async fn an_escrow_override_lets_the_schedule_answer_a_what_if() {
    let pool = db().await;
    let id = make_debt(
        &pool,
        "Home",
        "MORTGAGE",
        json!({
            "currentBalance": 10000.00, "minimumPayment": 500.00, "escrowEnabled": true
        }),
    )
    .await;

    let base = call(&pool, "GET", &format!("/debts/{id}/amortization"), None)
        .await
        .unwrap();
    let with = call(
        &pool,
        "GET",
        &format!("/debts/{id}/amortization?escrow=200"),
        None,
    )
    .await
    .unwrap();

    assert_eq!(base.body["totalEscrow"], json!(0.0));
    assert!(with.body["totalEscrow"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn an_extra_payment_moves_the_balance_the_account_and_the_ledger_together() {
    let pool = db().await;
    let now = avoir_api::id::now_iso();
    sqlx::query(
        r#"INSERT INTO "BudgetGroup" ("id","name","color","createdAt")
                   VALUES ('bg1','B','#000',?)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO "Budget" ("id","name","isCustom","createdAt","groupId","isSystem")
                   VALUES ('unc','Uncategorized',0,?,'bg1',1)"#,
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();
    let acct = call(
        &pool,
        "POST",
        "/accounts",
        Some(json!({ "name": "Checking", "type": "Checking", "balance": 5000.00 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string();

    let id = make_debt(
        &pool,
        "Auto",
        "AUTO",
        json!({
            "currentBalance": 10000.00, "apr": 6.0, "linkedAccountId": acct
        }),
    )
    .await;

    let r = call(
        &pool,
        "POST",
        &format!("/debts/{id}/extra-payment"),
        Some(json!({
            "amount": 1000.00, "date": "2026-03-01T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 201);
    // Interest first, then principal — an extra payment does not reduce the
    // balance by its full face value.
    let principal = r.body["principalAmount"].as_f64().unwrap();
    let interest = r.body["interestAmount"].as_f64().unwrap();
    assert!(interest > 0.0, "a month of interest is charged");
    assert!(
        (principal + interest - 1000.00).abs() < 0.01,
        "the split sums to the payment"
    );
    assert_eq!(r.body["newBalance"].as_f64().unwrap(), 10000.00 - principal);

    // The money left a real account, through the gate.
    let acc = call(&pool, "GET", &format!("/accounts/{acct}"), None)
        .await
        .unwrap();
    assert_eq!(acc.body["balance"], json!(4000.00));
    let mut conn = pool.acquire().await.unwrap();
    assert!(avoir_db::balance::check_invariant(&mut conn)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn an_extra_payment_that_clears_the_balance_marks_it_paid_off() {
    let pool = db().await;
    let id = make_debt(
        &pool,
        "Nearly",
        "AUTO",
        json!({
            "currentBalance": 100.00, "apr": 0.0
        }),
    )
    .await;

    let r = call(
        &pool,
        "POST",
        &format!("/debts/{id}/extra-payment"),
        Some(json!({
            "amount": 500.00, "date": "2026-03-01T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();

    // Otherwise it lingers as an active debt with no balance, and the
    // debt-free date never arrives.
    assert_eq!(r.body["newBalance"], json!(0.0));
    assert_eq!(r.body["paidOff"], json!(true));

    let err = call(
        &pool,
        "POST",
        &format!("/debts/{id}/extra-payment"),
        Some(json!({
            "amount": 10.00, "date": "2026-03-02T00:00:00.000Z"
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400, "a paid-off debt takes no more payments");
}

#[tokio::test]
async fn an_update_leaves_unmentioned_fields_alone_and_can_clear_a_link() {
    let pool = db().await;
    let id = make_debt(
        &pool,
        "Auto",
        "AUTO",
        json!({ "note": "keep me", "termMonths": 60 }),
    )
    .await;

    let r = call(
        &pool,
        "PUT",
        &format!("/debts/{id}"),
        Some(json!({ "name": "Auto v2" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["name"], json!("Auto v2"));
    assert_eq!(r.body["note"], json!("keep me"));
    assert_eq!(r.body["termMonths"], json!(60));

    let r = call(
        &pool,
        "PUT",
        &format!("/debts/{id}"),
        Some(json!({ "note": null })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["note"], json!(null));
}

#[tokio::test]
async fn deleting_a_debt_takes_its_escrow_with_it() {
    let pool = db().await;
    let id = make_debt(&pool, "Home", "MORTGAGE", json!({ "escrowEnabled": true })).await;
    call(
        &pool,
        "POST",
        &format!("/debts/{id}/escrow"),
        Some(json!({
            "monthlyAmount": 300.00,
            "periodStartDate": "2026-08-01T00:00:00.000Z",
            "periodEndDate": "2027-07-31T00:00:00.000Z"
        })),
    )
    .await
    .unwrap();

    call(&pool, "DELETE", &format!("/debts/{id}"), None)
        .await
        .unwrap();
    let left: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "EscrowRecord""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "EscrowRecord cascades from Debt");
}

#[tokio::test]
async fn missing_records_are_404() {
    let pool = db().await;
    let missing = "cnope0000000000000000000";
    for (m, p, b) in [
        ("GET", format!("/debts/{missing}"), None),
        (
            "PUT",
            format!("/debts/{missing}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("/debts/{missing}"), None),
        ("GET", format!("/debts/{missing}/amortization"), None),
        ("GET", format!("/debts/{missing}/escrow"), None),
        (
            "POST",
            format!("/debts/{missing}/extra-payment"),
            Some(json!({ "amount": 1.0, "date": "2026-03-01T00:00:00.000Z" })),
        ),
    ] {
        let err = call(&pool, m, &p, b)
            .await
            .err()
            .unwrap_or_else(|| panic!("{m} {p}"));
        assert_eq!(err.status, 404, "{m} {p}");
    }
}
