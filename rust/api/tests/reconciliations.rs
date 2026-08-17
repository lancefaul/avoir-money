//! `/reconciliations` — sessions, import, matching, close, abandon, merge.

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

async fn ok(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> Value {
    call(pool, method, path, body)
        .await
        .unwrap_or_else(|e| panic!("{method} {path} failed: {e}"))
        .body
}

async fn err(pool: &SqlitePool, method: &str, path: &str, body: Option<Value>) -> ApiError {
    call(pool, method, path, body)
        .await
        .err()
        .unwrap_or_else(|| panic!("{method} {path} unexpectedly succeeded"))
}

fn id_of(v: &Value) -> String {
    v["id"].as_str().expect("id").to_string()
}

async fn account(pool: &SqlitePool, opening: f64) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/accounts",
            Some(json!({ "name": "Checking", "type": "CHECKING", "openingBalance": opening })),
        )
        .await,
    )
}

async fn session(pool: &SqlitePool, account_id: &str, ending: f64) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/reconciliations",
            Some(json!({
                "accountId": account_id,
                "periodStart": "2026-03-01",
                "periodEnd": "2026-03-31",
                "statementEndingBalance": ending,
            })),
        )
        .await,
    )
}

/// An ordinary expense on the account.
async fn expense(
    pool: &SqlitePool,
    account_id: &str,
    name: &str,
    amount: f64,
    date: &str,
) -> String {
    id_of(
        &ok(
            pool,
            "POST",
            "/transactions",
            Some(json!({
                "name": name, "amount": amount, "date": date,
                "type": "EXPENSE", "accountId": account_id,
            })),
        )
        .await,
    )
}

const CSV: &str = "\
Transaction Date,Post Date,Description,Amount
3/5/2026,3/6/2026,COFFEE SHOP,-4.75
3/9/2026,3/10/2026,GROCERY MART,-20.00
";

// ═══ Session lifecycle ═══

#[tokio::test]
async fn a_session_opens_as_a_draft_with_no_residual_recorded_yet() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;

    let s = ok(
        &pool,
        "POST",
        "/reconciliations",
        Some(json!({
            "accountId": acct,
            "periodStart": "2026-03-01",
            "periodEnd": "2026-03-31",
            "statementEndingBalance": 75.25,
        })),
    )
    .await;

    assert_eq!(s["status"], "DRAFT");
    assert_eq!(s["statementEndingBalance"], 75.25);
    // Not the live residual — the figure agreed AT CLOSE, and nothing has closed.
    assert_eq!(s["residualAtClose"], 0.0);
    assert!(s["reconciledAt"].is_null());
}

#[tokio::test]
async fn a_second_draft_on_one_account_is_refused() {
    // The partial unique index is the rule: two drafts would let one period be
    // reconciled twice with conflicting resolutions.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    session(&pool, &acct, 75.0).await;

    let e = err(
        &pool,
        "POST",
        "/reconciliations",
        Some(json!({
            "accountId": acct,
            "periodStart": "2026-04-01",
            "periodEnd": "2026-04-30",
            "statementEndingBalance": 50.0,
        })),
    )
    .await;
    assert_eq!(e.status, 409);
}

#[tokio::test]
async fn a_draft_on_a_different_account_is_allowed() {
    // Proves the refusal above comes from the partial index and not from a
    // blanket "one draft anywhere" reading of it.
    let pool = db().await;
    let a = account(&pool, 100.0).await;
    let b = id_of(
        &ok(
            &pool,
            "POST",
            "/accounts",
            Some(json!({ "name": "Savings", "type": "SAVINGS", "openingBalance": 0 })),
        )
        .await,
    );
    session(&pool, &a, 75.0).await;
    session(&pool, &b, 10.0).await;
}

#[tokio::test]
async fn opening_a_session_on_a_missing_account_is_a_404_not_a_500() {
    let pool = db().await;
    let e = err(
        &pool,
        "POST",
        "/reconciliations",
        Some(json!({
            "accountId": "nope",
            "periodStart": "2026-03-01",
            "periodEnd": "2026-03-31",
            "statementEndingBalance": 1.0,
        })),
    )
    .await;
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn a_period_that_ends_before_it_starts_is_refused() {
    let pool = db().await;
    let acct = account(&pool, 0.0).await;
    let e = err(
        &pool,
        "POST",
        "/reconciliations",
        Some(json!({
            "accountId": acct,
            "periodStart": "2026-03-31",
            "periodEnd": "2026-03-01",
            "statementEndingBalance": 1.0,
        })),
    )
    .await;
    assert_eq!(e.status, 400);
}

#[tokio::test]
async fn the_anchor_and_the_cutoff_can_both_be_changed_on_a_draft() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.0).await;

    let updated = ok(
        &pool,
        "PATCH",
        &format!("/reconciliations/{sid}"),
        Some(json!({ "statementEndingBalance": 60.5, "periodEnd": "2026-04-15" })),
    )
    .await;
    assert_eq!(updated["statementEndingBalance"], 60.5);
    assert_eq!(updated["periodEnd"], "2026-04-15T00:00:00.000Z");
}

#[tokio::test]
async fn a_patch_that_changes_nothing_is_refused() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.0).await;
    let e = err(
        &pool,
        "PATCH",
        &format!("/reconciliations/{sid}"),
        Some(json!({})),
    )
    .await;
    assert_eq!(e.status, 400);
}

#[tokio::test]
async fn sessions_list_filtered_by_account_and_status() {
    let pool = db().await;
    let a = account(&pool, 100.0).await;
    let b = id_of(
        &ok(
            &pool,
            "POST",
            "/accounts",
            Some(json!({ "name": "Savings", "type": "SAVINGS", "openingBalance": 0 })),
        )
        .await,
    );
    session(&pool, &a, 75.0).await;
    session(&pool, &b, 10.0).await;

    let all = ok(&pool, "GET", "/reconciliations", None).await;
    assert_eq!(all.as_array().unwrap().len(), 2);

    let mine = ok(
        &pool,
        "GET",
        &format!("/reconciliations?accountId={a}"),
        None,
    )
    .await;
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(mine[0]["accountId"], a.as_str());

    let drafts = ok(&pool, "GET", "/reconciliations?status=DRAFT", None).await;
    assert_eq!(drafts.as_array().unwrap().len(), 2);
    let closed = ok(&pool, "GET", "/reconciliations?status=RECONCILED", None).await;
    assert_eq!(closed.as_array().unwrap().len(), 0);
}

// ═══ The residual ═══

#[tokio::test]
async fn the_residual_is_the_gap_between_the_bank_and_the_app() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    // App believes 100 − 4.75 = 95.25. Bank says 90.25, so 5.00 is missing.
    let sid = session(&pool, &acct, 90.25).await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let r = &d["residual"];
    assert_eq!(r["openingBalance"], 100.0);
    assert_eq!(r["transactionSum"], -4.75);
    assert_eq!(r["expectedBalance"], 95.25);
    assert_eq!(r["residual"], -5.0);
    assert_eq!(r["isBalanced"], false);
}

#[tokio::test]
async fn a_balanced_period_is_exactly_zero_with_no_tolerance() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 95.25).await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(d["residual"]["residual"], 0.0);
    assert_eq!(d["residual"]["isBalanced"], true);
}

#[tokio::test]
async fn a_single_cent_of_disagreement_is_not_balanced() {
    // The TypeScript compared against a 0.005 epsilon, which was wide enough to
    // hide a half-cent. In integer cents the comparison is exact, so this is the
    // smallest disagreement the feature can express — and it must not pass.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 95.24).await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(d["residual"]["isBalanced"], false);
    assert_eq!(d["residual"]["residual"], -0.01);
}

#[tokio::test]
async fn activity_after_the_cutoff_is_reported_but_never_netted_out() {
    // Netting it would let an error inside the period cancel an equal and
    // opposite one outside it, and both would vanish from the single number the
    // feature exists to keep honest.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "IN PERIOD", 4.75, "2026-03-05").await;
    expense(&pool, &acct, "AFTER CUTOFF", 10.0, "2026-04-20").await;
    let sid = session(&pool, &acct, 95.25).await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(d["residual"]["transactionSum"], -4.75);
    assert_eq!(d["residual"]["activityAfterPeriodEnd"], -10.0);
    // Still balanced: the later row is context, not part of the comparison.
    assert_eq!(d["residual"]["isBalanced"], true);
}

#[tokio::test]
async fn split_children_are_never_offered_as_candidates() {
    // A child carries its parent's `accountId`, so it looks like an ordinary row
    // to anything that filters on the account alone — but it is invisible to
    // every balance query by construction, and offering it here would let one
    // purchase be matched against the statement twice while its parent is
    // reported unmatched.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let g = ok(
        &pool,
        "POST",
        "/budgets/groups",
        Some(json!({ "name": "G", "color": "#fff" })),
    )
    .await;
    let b = id_of(
        &ok(
            &pool,
            "POST",
            "/budgets",
            Some(json!({ "name": "Food", "groupId": g["id"] })),
        )
        .await,
    );

    let parent = expense(&pool, &acct, "BASKET", 30.0, "2026-03-05").await;
    ok(
        &pool,
        "POST",
        &format!("/transactions/{parent}/children"),
        Some(json!({ "preTaxAmount": 10.0, "budgetId": b })),
    )
    .await;

    let sid = session(&pool, &acct, 70.0).await;
    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;

    let candidates = d["appTransactions"].as_array().unwrap();
    assert_eq!(candidates.len(), 1, "only the parent: {candidates:#?}");
    assert_eq!(candidates[0]["id"], parent.as_str());
    // And the residual counts the purchase once, not twice.
    assert_eq!(d["residual"]["transactionSum"], -30.0);
}

#[tokio::test]
async fn a_fully_offset_row_is_never_offered_as_a_candidate() {
    // A row whose net is zero moved no cash, so the bank never printed it.
    // Offering it makes the matcher hunt for a statement line that cannot exist
    // and report a phantom. Written directly because the create route refuses a
    // zero amount — these rows are history, from when rewards could fully cover
    // a charge.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let real = expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;

    sqlx::query(
        r#"INSERT INTO "Transaction"
             ("id","type","name","amount","netAmount","date","createdAt",
              "accountId","imported","isCashBack")
           VALUES ('offset-row','EXPENSE','FULLY COVERED',0,0,
                   '2026-03-06T00:00:00.000Z','2026-03-06T00:00:00.000Z',?,0,0)"#,
    )
    .bind(&acct)
    .execute(&pool)
    .await
    .unwrap();

    let sid = session(&pool, &acct, 95.25).await;
    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;

    let candidates = d["appTransactions"].as_array().unwrap();
    assert_eq!(candidates.len(), 1, "only the real charge: {candidates:#?}");
    assert_eq!(candidates[0]["id"], real.as_str());
}

// ═══ Import ═══

#[tokio::test]
async fn importing_a_statement_stores_its_rows_and_widens_the_window() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    assert_eq!(res["imported"], 2);
    assert_eq!(res["skippedDuplicates"], 0);
    // periodStart moves back to the earliest POSTED row, so matching cannot
    // starve. periodEnd is the user's cutoff and is left alone.
    assert_eq!(res["periodStart"], "2026-03-06T00:00:00.000Z");
    assert_eq!(res["periodEnd"], "2026-03-31T00:00:00.000Z");

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let rows = d["statementRows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["description"], "COFFEE SHOP");
    assert_eq!(rows[0]["amount"], -4.75);
}

#[tokio::test]
async fn importing_the_same_file_twice_adds_nothing() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    let again = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    assert_eq!(again["imported"], 0);
    assert_eq!(again["skippedDuplicates"], 2);

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(d["statementRows"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn one_file_containing_a_line_twice_stores_it_twice() {
    // The load-bearing case. A bank prints two rows when you buy the same item
    // twice in a day. Treating the raw line as a unique key dropped the second,
    // which left the app's second transaction with nothing to pair against — and
    // because its twin had matched, it was reported as a probable duplicate. A
    // correct transaction accused of being a duplicate is the worst output here.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;

    let twice = "\
Transaction Date,Post Date,Description,Amount
3/5/2026,3/6/2026,VENDING,-3.29
3/5/2026,3/6/2026,VENDING,-3.29
";
    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": twice })),
    )
    .await;
    assert_eq!(res["imported"], 2, "both identical lines are real rows");
    assert_eq!(res["skippedDuplicates"], 0);

    // And re-importing that same file still adds nothing, because the stored
    // COUNT already covers both.
    let again = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": twice })),
    )
    .await;
    assert_eq!(again["imported"], 0);
    assert_eq!(again["skippedDuplicates"], 2);
}

#[tokio::test]
async fn a_third_copy_of_a_line_is_imported_when_only_two_are_stored() {
    // Counting, not presence: the check is "how many of this line do we hold",
    // so a file with one more copy contributes exactly one more row.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;
    let head = "Transaction Date,Post Date,Description,Amount\n";
    let line = "3/5/2026,3/6/2026,VENDING,-3.29\n";

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": format!("{head}{line}{line}") })),
    )
    .await;
    let third = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": format!("{head}{line}{line}{line}") })),
    )
    .await;
    assert_eq!(third["imported"], 1);
    assert_eq!(third["skippedDuplicates"], 2);
}

#[tokio::test]
async fn a_parse_failure_writes_nothing() {
    // A partially imported statement produces a residual indistinguishable from
    // a real discrepancy.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": "Nothing,Useful\n1,2\n" })),
    )
    .await;
    assert_eq!(e.status, 400);

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert!(d["statementRows"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn a_closed_session_cannot_import() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 100.0).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    assert_eq!(e.status, 409);
}

// ═══ Matching ═══

#[tokio::test]
async fn matching_pairs_the_statement_against_the_ledger() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    expense(&pool, &acct, "GROCERY MART", 20.0, "2026-03-09").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;
    assert_eq!(res["matched"], 2);
    assert_eq!(res["unmatchedStatement"], 0);
    assert_eq!(res["unmatchedApp"], 0);
    assert_eq!(res["summary"]["matched"], 2);

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(d["matches"].as_array().unwrap().len(), 2);
    assert_eq!(d["matches"][0]["matchType"], "EXACT");
}

#[tokio::test]
async fn the_reported_match_count_equals_what_was_actually_stored() {
    // The route reports the number of pairings it PROPOSED. That is only honest
    // because the matcher assigns globally best-first and gives each row to at
    // most one finding, so it cannot propose the same pair twice and have the
    // `INSERT OR IGNORE` quietly drop one. Asserted rather than assumed —
    // several same-amount charges on one day is exactly the input that would
    // break it, so that is what this feeds it.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    for _ in 0..4 {
        expense(&pool, &acct, "VENDING", 3.29, "2026-03-05").await;
    }
    let sid = session(&pool, &acct, 86.84).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": "\
Transaction Date,Post Date,Description,Amount
3/5/2026,3/6/2026,VENDING,-3.29
3/5/2026,3/6/2026,VENDING,-3.29
3/5/2026,3/6/2026,VENDING,-3.29
3/5/2026,3/6/2026,VENDING,-3.29
" })),
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;
    let reported = res["matched"].as_i64().unwrap();

    let stored: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ReconciliationMatch""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(reported, stored, "reported {reported}, stored {stored}");
    assert_eq!(stored, 4, "each charge paired with its own line");
}

#[tokio::test]
async fn a_statement_line_the_app_never_recorded_is_reported_unmatched() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;
    assert_eq!(res["matched"], 1);
    assert_eq!(res["unmatchedStatement"], 1);
}

#[tokio::test]
async fn re_running_the_matcher_never_destroys_a_manual_pairing() {
    // Matching is routine — it happens after every resolution — so wiping manual
    // work here would silently destroy decisions the user cannot get back.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let tx = expense(&pool, &acct, "SOMETHING ELSE ENTIRELY", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let row_id = d["statementRows"][0]["id"].as_str().unwrap().to_string();

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/matches"),
        Some(json!({ "statementRowId": row_id, "transactionId": tx })),
    )
    .await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;

    let after = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let manual: Vec<&Value> = after["matches"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["matchType"] == "MANUAL")
        .collect();
    assert_eq!(manual.len(), 1, "the manual pairing survived");
    assert_eq!(manual[0]["transactionId"], tx.as_str());
}

#[tokio::test]
async fn matching_heals_a_window_too_narrow_for_the_rows_it_holds() {
    // A session whose periodStart predates the import rule keeps its stale
    // window forever — nothing else recomputes it, and re-importing the same
    // file is a no-op. So the matcher recomputes it, or every older statement
    // line comes back as missing from the app: a hundred false discrepancies
    // that look exactly like real ones.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    // Push the window forward, as a stale session would have it.
    ok(
        &pool,
        "PATCH",
        &format!("/reconciliations/{sid}"),
        Some(json!({ "periodEnd": "2026-03-31" })),
    )
    .await;
    sqlx::query(r#"UPDATE "ReconciliationSession" SET "periodStart" = '2026-03-25T00:00:00.000Z'"#)
        .execute(&pool)
        .await
        .unwrap();

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(
        d["periodStart"], "2026-03-06T00:00:00.000Z",
        "the window was pulled back to cover the earliest statement row"
    );
}

#[tokio::test]
async fn a_manual_match_against_another_sessions_row_is_refused() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let tx = expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 75.25).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/matches"),
        Some(json!({ "statementRowId": "not-in-this-session", "transactionId": tx })),
    )
    .await;
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn the_same_pair_cannot_be_matched_twice() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let tx = expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let row_id = d["statementRows"][0]["id"].as_str().unwrap().to_string();

    let body = json!({ "statementRowId": row_id, "transactionId": tx });
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/matches"),
        Some(body.clone()),
    )
    .await;
    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/matches"),
        Some(body),
    )
    .await;
    assert_eq!(e.status, 409);
}

#[tokio::test]
async fn breaking_a_match_removes_only_that_pairing() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    expense(&pool, &acct, "GROCERY MART", 20.0, "2026-03-09").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;

    let d = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    let mid = d["matches"][0]["id"].as_str().unwrap().to_string();

    ok(
        &pool,
        "DELETE",
        &format!("/reconciliations/{sid}/matches/{mid}"),
        None,
    )
    .await;

    let after = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(after["matches"].as_array().unwrap().len(), 1);

    // And a second delete of the same id is a 404, not a silent success.
    let e = err(
        &pool,
        "DELETE",
        &format!("/reconciliations/{sid}/matches/{mid}"),
        None,
    )
    .await;
    assert_eq!(e.status, 404);
}

// ═══ Abandon (ADR-029) ═══

#[tokio::test]
async fn abandoning_leaves_matched_transactions_and_their_balances_untouched() {
    // THE property that must never regress. `ReconciliationMatch → Transaction`
    // is ON DELETE CASCADE, which means deleting a TRANSACTION removes its match
    // — not the reverse. No foreign key anywhere has a Transaction referencing a
    // reconciliation object, so a session delete cannot reach the ledger.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let tx = expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 95.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;

    let before = ok(&pool, "GET", &format!("/accounts/{acct}"), None).await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/abandon"),
        None,
    )
    .await;

    // The session and all its scaffolding are gone.
    assert_eq!(
        err(&pool, "GET", &format!("/reconciliations/{sid}"), None)
            .await
            .status,
        404
    );
    let rows: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "StatementRow""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    let matches: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ReconciliationMatch""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((rows, matches), (0, 0), "scaffolding removed");

    // The ledger is exactly as it was.
    let after = ok(&pool, "GET", &format!("/accounts/{acct}"), None).await;
    assert_eq!(after["balance"], before["balance"]);
    assert_eq!(after["balance"], 95.25);
    let still = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    let items = still["transactions"].as_array().unwrap();
    assert_eq!(items.len(), 1, "the transaction survived");
    assert_eq!(items[0]["id"], tx.as_str());
}

#[tokio::test]
async fn a_reconciled_session_cannot_be_abandoned() {
    // Once closed, its rows are the evidence of what was reconciled against —
    // the one case where they are not rebuildable, because the export may be gone.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 100.0).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/abandon"),
        None,
    )
    .await;
    assert_eq!(e.status, 409);
    // And it is still there.
    ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
}

// ═══ Close ═══

#[tokio::test]
async fn a_session_cannot_close_while_anything_is_unaccounted_for() {
    // The rule the whole feature exists to impose.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 90.25).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;
    assert_eq!(e.status, 409);
    assert!(e.error.contains("-5.00"), "says how much: {}", e.error);
    // The live residual rides along so the screen need not re-fetch it.
    assert_eq!(e.details.unwrap()["residual"], -5.0);

    let still = ok(&pool, "GET", &format!("/reconciliations/{sid}"), None).await;
    assert_eq!(still["status"], "DRAFT");
}

#[tokio::test]
async fn closing_a_balanced_session_stamps_every_matched_transaction() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    expense(&pool, &acct, "GROCERY MART", 20.0, "2026-03-09").await;
    let sid = session(&pool, &acct, 75.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/import"),
        Some(json!({ "csv": CSV })),
    )
    .await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/match"),
        None,
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;
    assert_eq!(res["session"]["status"], "RECONCILED");
    assert_eq!(res["residual"]["isBalanced"], true);
    assert_eq!(res["clearedTransactions"], 2);
    assert!(!res["session"]["reconciledAt"].is_null());

    let stamped: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM "Transaction" WHERE "reconciledAt" IS NOT NULL"#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stamped, 2);
}

#[tokio::test]
async fn a_closed_session_cannot_be_closed_again_or_edited() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 100.0).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;

    assert_eq!(
        err(
            &pool,
            "POST",
            &format!("/reconciliations/{sid}/close"),
            None
        )
        .await
        .status,
        409
    );
    // A closed session's residual is the historical record of what was agreed.
    assert_eq!(
        err(
            &pool,
            "PATCH",
            &format!("/reconciliations/{sid}"),
            Some(json!({ "statementEndingBalance": 1.0 })),
        )
        .await
        .status,
        409
    );
}

#[tokio::test]
async fn closing_is_refused_when_the_accounts_own_ledger_invariant_is_broken() {
    // Closing on top of a broken ledger would certify it as correct. Note the
    // period here balances perfectly — it is the account's whole history that
    // does not — which is why this check cannot be folded into the residual.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 95.25).await;

    // Corrupt the stored balance behind the ledger's back.
    sqlx::query(r#"UPDATE "Account" SET "balance" = 999999 WHERE "id" = ?"#)
        .bind(&acct)
        .execute(&pool)
        .await
        .unwrap();

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;
    assert_eq!(e.status, 409);
    assert!(
        e.error.contains("stored balance disagrees"),
        "names the real problem: {}",
        e.error
    );
}

// ═══ The escape hatch ═══

#[tokio::test]
async fn an_adjustment_brings_an_unexplainable_residual_to_zero_visibly() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    // Bank holds 5.00 less than the app accounts for.
    let sid = session(&pool, &acct, 90.25).await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "bank fee I cannot place" })),
    )
    .await;

    assert_eq!(res["residual"]["residual"], 0.0);
    assert_eq!(res["residual"]["isBalanced"], true);
    assert_eq!(
        res["session"]["adjustmentReason"],
        "bank fee I cannot place"
    );

    // A real, visible, reasoned transaction — not a silent opening-balance move.
    let txs = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    let adj = txs["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| {
            t["name"]
                .as_str()
                .unwrap()
                .starts_with("Reconciliation adjustment")
        })
        .expect("the adjustment is in the register");
    assert_eq!(adj["type"], "EXPENSE", "a negative residual debits");
    assert_eq!(adj["amount"], 5.0);
    assert_eq!(adj["note"], "bank fee I cannot place");

    // And the opening balance is untouched — moving it would let the user close
    // without fixing anything, recreating the bug this feature was built to catch.
    let a = ok(&pool, "GET", &format!("/accounts/{acct}"), None).await;
    assert_eq!(a["openingBalance"], 100.0);
    assert_eq!(a["balance"], 90.25);
}

#[tokio::test]
async fn a_positive_residual_credits_the_account() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    // Bank holds 5.00 MORE than the app accounts for.
    let sid = session(&pool, &acct, 100.25).await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "deposit I cannot place" })),
    )
    .await;

    let txs = ok(
        &pool,
        "GET",
        &format!("/transactions?accountId={acct}"),
        None,
    )
    .await;
    let adj = txs["transactions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| {
            t["name"]
                .as_str()
                .unwrap()
                .starts_with("Reconciliation adjustment")
        })
        .unwrap();
    assert_eq!(adj["type"], "INCOME");
    let a = ok(&pool, "GET", &format!("/accounts/{acct}"), None).await;
    assert_eq!(a["balance"], 100.25);
}

#[tokio::test]
async fn an_adjustment_on_a_balanced_session_is_refused() {
    // It would be a meaningless artifact in the register that later reads as a
    // real discrepancy someone papered over.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    let sid = session(&pool, &acct, 100.0).await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "no reason at all" })),
    )
    .await;
    assert_eq!(e.status, 400);
}

#[tokio::test]
async fn an_adjustment_without_a_stated_reason_is_refused() {
    // The hatch exists so a discrepancy can be closed VISIBLY; an unexplained
    // adjustment is the invisible absorption it was built to eliminate.
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 90.25).await;

    for bad in [
        json!({ "reason": "" }),
        json!({ "reason": "   " }),
        json!({}),
    ] {
        let e = err(
            &pool,
            "POST",
            &format!("/reconciliations/{sid}/adjustment"),
            Some(bad),
        )
        .await;
        assert_eq!(e.status, 400);
    }
}

#[tokio::test]
async fn a_session_takes_at_most_one_adjustment() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 90.25).await;

    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "first" })),
    )
    .await;
    // Now balanced, so a second is refused on that ground too — force a new gap
    // first so the 409 under test is the one-adjustment rule.
    ok(
        &pool,
        "PATCH",
        &format!("/reconciliations/{sid}"),
        Some(json!({ "statementEndingBalance": 80.0 })),
    )
    .await;

    let e = err(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "second" })),
    )
    .await;
    assert_eq!(e.status, 409);
    assert!(e.error.contains("already has an adjustment"), "{}", e.error);
}

#[tokio::test]
async fn an_adjusted_session_then_closes_cleanly() {
    let pool = db().await;
    let acct = account(&pool, 100.0).await;
    expense(&pool, &acct, "COFFEE SHOP", 4.75, "2026-03-05").await;
    let sid = session(&pool, &acct, 90.25).await;
    ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/adjustment"),
        Some(json!({ "reason": "bank fee" })),
    )
    .await;

    let res = ok(
        &pool,
        "POST",
        &format!("/reconciliations/{sid}/close"),
        None,
    )
    .await;
    assert_eq!(res["session"]["status"], "RECONCILED");
    assert_eq!(res["session"]["residualAtClose"], 0.0);
}
