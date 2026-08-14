//! The whole differential sequence, replayed against this backend alone.
//!
//! # What this is for
//!
//! `refusals.rs` replays the refusals that need no state — 69 of 114. The
//! other 45 are the interesting ones: "already paid", "still has readings",
//! "this account already has a draft". A rule about state needs state, and
//! against an empty database those probes pass for the wrong reason or fail
//! for one.
//!
//! Those 45 are why `apps/api` cannot be deleted. It is not that its tests are
//! needed — it is that it is the ORACLE, the only thing that can say what a
//! refusal should be. `write-diff.mjs` records the full sequence with bindings
//! left symbolic, so this file can rebuild the state through the API and check
//! every refusal against the answer BOTH backends gave. The oracle stops being
//! a process and becomes a script.
//!
//! Regenerate with:
//!
//! ```sh
//! RECORD_REFUSALS="$PWD/rust/api/tests/fixtures/refusals.json" \
//!   bash tools/differential/run-writes.sh
//! ```
//!
//! # Why the sequence steps are not asserted on their bodies
//!
//! Comparing two response bodies needs two implementations. That is the
//! harness's job and it cannot be done here. This file answers a narrower
//! question — does this backend still refuse what it refused, in the state
//! where it refused it — so a 2xx step is checked only for its status, which
//! is the staleness guard: once a create stops succeeding, every step after it
//! is testing nothing.

use avoir_api::dispatch;
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;

#[derive(Deserialize)]
struct Script {
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    name: String,
    method: String,
    path: String,
    body: Option<Value>,
    bind: Option<String>,
    #[serde(rename = "bindField")]
    bind_field: Option<String>,
    binds: Option<HashMap<String, String>>,
    expect: Option<Expect>,
    #[serde(rename = "expectOk")]
    expect_ok: Option<u16>,
}

#[derive(Deserialize)]
struct Expect {
    status: u16,
    error: Option<String>,
    details: Option<Value>,
}

/// Replace every `$name` with the id this run minted for it.
///
/// An unbound `$name` is left alone rather than blanked, matching the harness:
/// a step naming something never bound should fail loudly, not quietly become
/// a request for the empty id.
fn substitute(v: &Value, binds: &HashMap<String, String>) -> Value {
    match v {
        Value::String(s) => Value::String(substitute_str(s, binds)),
        Value::Array(a) => Value::Array(a.iter().map(|x| substitute(x, binds)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), substitute(x, binds)))
                .collect(),
        ),
        other => other.clone(),
    }
}

fn substitute_str(s: &str, binds: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('$') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let end = after
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(after.len());
        let name = &after[..end];
        match binds.get(name) {
            Some(id) if !name.is_empty() => out.push_str(id),
            _ => {
                out.push('$');
                out.push_str(name);
            }
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Read a dotted path, so a list step can bind `0.id`.
fn pick<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |acc, key| match acc {
        Value::Object(o) => o.get(key),
        Value::Array(a) => key.parse::<usize>().ok().and_then(|i| a.get(i)),
        _ => None,
    })
}

#[tokio::test]
async fn the_recorded_sequence_still_behaves() {
    let pool: SqlitePool = avoir_db::connect_in_memory().await.expect("test db");
    let script: Script =
        serde_json::from_str(include_str!("fixtures/replay.json")).expect("replay.json");

    let mut binds: HashMap<String, String> = HashMap::new();
    let mut checked = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for step in &script.steps {
        let path = substitute_str(&step.path, &binds);
        let body = step.body.as_ref().map(|b| substitute(b, &binds));

        let result = dispatch(&pool, &step.method, &path, body).await;

        match (&step.expect, &result) {
            // A refusal that was recorded, and still refuses.
            (Some(want), Err(e)) => {
                checked += 1;
                if e.status != want.status {
                    failures.push(format!(
                        "{}\n      status: expected {}, got {} ({})",
                        step.name, want.status, e.status, e.error
                    ));
                } else if want.error.as_deref().is_some_and(|w| w != e.error) {
                    failures.push(format!(
                        "{}\n      message: expected {:?}\n               got      {:?}",
                        step.name,
                        want.error.as_deref().unwrap_or(""),
                        e.error
                    ));
                } else if let Some(d) = &want.details {
                    let got = e.details.clone().unwrap_or(Value::Null);
                    if &got != d {
                        failures.push(format!(
                            "{}\n      details: expected {d}\n               got      {got}",
                            step.name
                        ));
                    }
                }
            }
            // A refusal that stopped refusing. The regression this file exists for.
            (Some(want), Ok(_)) => {
                checked += 1;
                failures.push(format!(
                    "{}\n      expected {} {:?}, but the request SUCCEEDED",
                    step.name,
                    want.status,
                    want.error.as_deref().unwrap_or("")
                ));
            }
            // A sequence step. Only its status matters here — but it matters a
            // lot, because everything after it depends on the state it makes.
            (None, r) => {
                if let Some(ok) = step.expect_ok {
                    match r {
                        Ok(resp) if resp.status == ok => {}
                        Ok(resp) => failures.push(format!(
                            "{}\n      setup: expected {}, got {}",
                            step.name, ok, resp.status
                        )),
                        Err(e) => failures.push(format!(
                            "{}\n      setup FAILED: expected {}, got {} ({})",
                            step.name, ok, e.status, e.error
                        )),
                    }
                }
                // Bind whatever this step minted, so later steps can name it.
                if let Ok(resp) = r {
                    let mut take = |name: &str, field: &str| {
                        if let Some(Value::String(id)) = pick(&resp.body, field) {
                            binds.insert(name.to_string(), id.clone());
                        }
                    };
                    if let Some(map) = &step.binds {
                        for (name, field) in map {
                            take(name, field);
                        }
                    } else if let Some(name) = &step.bind {
                        take(name, step.bind_field.as_deref().unwrap_or("id"));
                    }
                }
            }
        }
    }

    // The same staleness guard the harness carries: a fixture that emptied, or
    // a replay that stopped reaching its refusals, would pass every assertion
    // above by making none of them.
    assert!(
        checked >= 100,
        "only {checked} refusals were reached — the replay stopped early or the \
         fixture is truncated. Regenerate it; see this file's header."
    );

    assert!(
        failures.is_empty(),
        "{} of {checked} recorded behaviours changed:\n\n  {}\n",
        failures.len(),
        failures.join("\n\n  ")
    );
}
