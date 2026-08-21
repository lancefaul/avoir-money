//! Every refusal both backends agreed on, replayed against this one.
//!
//! # Why this file is generated and not written
//!
//! Measured on 2026-08-12: the Rust suite asserted an error MESSAGE 25 times;
//! the TypeScript reference did it 152 times, and asserted a 4xx status 300
//! times against Rust's 127. That gap is not a number to close for its own
//! sake — it is the reason `apps/api` cannot be deleted. `apps/api` is the only
//! thing that can say what a refusal is supposed to look like.
//!
//! Writing those assertions by hand would reproduce the exact failure the gap
//! was diagnosed as. From `.kiro/docs/BACKLOG.md`: every defect in the port's
//! last week came from the differential harness or from someone opening a page,
//! and **none** from 816 tests — two of them were covered by tests that passed
//! against a completely non-functional endpoint, because the tests spoke the
//! same invented dialect as the code. A hand-written expectation is one
//! person's belief about a rule they may never have read.
//!
//! So the expectations come from the reference instead. `write-diff.mjs` drives
//! each refusal against BOTH backends and records only the ones where they
//! agreed on the status AND the message — every value in
//! `fixtures/refusals.json` was produced independently, twice. Regenerate with:
//!
//! ```sh
//! RECORD_REFUSALS="$PWD/rust/api/tests/fixtures/refusals.json" \
//!   bash tools/differential/run-writes.sh
//! ```
//!
//! # What this buys that the harness does not
//!
//! The harness needs both backends running, a Postgres, and a Docker daemon. It
//! is therefore something someone remembers to do. This runs in `cargo test`,
//! offline, in milliseconds — and it keeps working **after `apps/api` is
//! deleted**, which is the point. The oracle stops being a running backend and
//! becomes a file.
//!
//! # What it deliberately does not cover
//!
//! `needsState` entries referenced ids the scenario minted, so they cannot be
//! replayed against an empty database — a 404 here would be one this test
//! caused itself, which is worse than no coverage because it looks like
//! coverage. They are skipped, counted, and reported by name.
//!
//! 5xx is excluded at record time. Two steps returned `500 Internal server
//! error` from both backends (an FK reference to a non-existent row), and
//! agreement there means "both are wrong in the same place" rather than a
//! contract. Pinning it would make this file defend a bug.

use avoir_api::dispatch;
use serde::Deserialize;
use sqlx::SqlitePool;

#[derive(Deserialize)]
struct Fixture {
    refusals: Vec<Refusal>,
}

#[derive(Deserialize)]
struct Refusal {
    name: String,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    status: u16,
    error: Option<String>,
    /// Recorded only when both backends produced the SAME details. Null means
    /// "the two deliberately differ here" — see the recorder — not "no details".
    #[serde(default)]
    details: Option<serde_json::Value>,
    #[serde(rename = "needsState")]
    needs_state: bool,
}

fn fixture() -> Fixture {
    let raw = include_str!("fixtures/refusals.json");
    serde_json::from_str(raw).expect("fixtures/refusals.json is not valid JSON")
}

/// The recorded refusals, replayed.
///
/// Every case is driven in one test rather than one test each, because the
/// useful failure message is the WHOLE list of divergences — fixing them one
/// `cargo test` at a time, when a single change to the error layer moves
/// twenty, is a worse loop than seeing all twenty at once.
#[tokio::test]
async fn the_recorded_refusals_still_hold() {
    let pool: SqlitePool = avoir_db::connect_in_memory().await.expect("test db");
    let fx = fixture();

    let mut checked = 0usize;
    let mut skipped: Vec<&str> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for r in &fx.refusals {
        if r.needs_state {
            skipped.push(&r.name);
            continue;
        }
        checked += 1;

        // A refusal is an `Err(ApiError)` here, not a `Response` with a status —
        // so a case that unexpectedly SUCCEEDS lands in the `Ok` arm, which is
        // the regression this file exists to catch.
        match dispatch(&pool, &r.method, &r.path, r.body.clone()).await {
            Ok(_) => failures.push(format!(
                "{}\n      expected {} {:?}, but the request SUCCEEDED",
                r.name,
                r.status,
                r.error.as_deref().unwrap_or("")
            )),
            Err(e) => {
                if e.status != r.status {
                    failures.push(format!(
                        "{}\n      status: expected {}, got {}  ({})",
                        r.name, r.status, e.status, e.error
                    ));
                } else if let Some(want) = &r.error {
                    // The message, not just the status. A 400 for the wrong
                    // reason passes a status-only assertion, and that is the
                    // whole shape of the gap this closes.
                    if &e.error != want {
                        failures.push(format!(
                            "{}\n      message: expected {:?}\n               got      {:?}",
                            r.name, want, e.error
                        ));
                    } else if let Some(want_details) = &r.details {
                        // And WHICH FIELD, where one was recorded. Without this
                        // the suite could not see `invalid_field` pointing at the
                        // wrong input: both bodies still say "Validation failed",
                        // so the message assertion above passes. Proven by
                        // mutation — changing `oopmLimit` to `deductibleLimit`
                        // was invisible until this arrived.
                        let got = e.details.clone().unwrap_or(serde_json::Value::Null);
                        if &got != want_details {
                            failures.push(format!(
                                "{}\n      details: expected {}\n               got      {}",
                                r.name, want_details, got
                            ));
                        }
                    }
                }
            }
        }
    }

    // A fixture that silently emptied would pass every assertion above. This is
    // the same staleness guard `expectStatus` is to the harness: the count is
    // pinned low enough not to be brittle and high enough that an empty or
    // truncated file fails here rather than reporting green.
    assert!(
        checked >= 15,
        "only {checked} refusals were replayable — the fixture looks truncated. \
         Regenerate it; see this file's header."
    );

    assert!(
        failures.is_empty(),
        "{} of {checked} recorded refusals no longer hold:\n\n  {}\n\n\
         Each expectation was produced independently by BOTH backends, so a \
         failure here is a change in this one.\n\
         ({} skipped as needing fixture state: {})",
        failures.len(),
        failures.join("\n\n  "),
        skipped.len(),
        skipped.join(", ")
    );
}
