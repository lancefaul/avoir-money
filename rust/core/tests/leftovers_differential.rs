//! Differential test for leftover classification and duplicate-run detection.
//!
//! Scenario-driven rather than random: these verdicts turn on structural
//! relationships between rows — a twin that matched, a repeated identity, a run
//! of five — and random rows essentially never produce them.

use avoir_core::leftovers::*;
use avoir_core::money::Cents;
use chrono::NaiveDate;
use serde_json::Value;

fn date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn cents(v: &Value) -> Cents {
    // Fixture amounts are dollars, as the TypeScript takes them.
    Cents((v.as_f64().unwrap() * 100.0).round() as i64)
}

fn rows(v: &Value) -> Vec<LeftoverRow> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|r| LeftoverRow {
            id: r["id"].as_str().unwrap().to_string(),
            date: date(r["date"].as_str().unwrap()),
            name: r["name"].as_str().unwrap().to_string(),
            amount: cents(&r["amount"]),
            gross: r.get("gross").map(cents),
        })
        .collect()
}

fn kind_name(k: LeftoverKind) -> &'static str {
    match k {
        LeftoverKind::DuplicateInApp => "duplicate_in_app",
        LeftoverKind::MissingInBankPending => "missing_in_bank_pending",
        LeftoverKind::MissingInBankPhantom => "missing_in_bank_phantom",
    }
}

#[test]
fn leftover_classification_matches_typescript() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/leftover_vectors.json")).unwrap();
    let cases = doc["cases"].as_array().unwrap();
    assert!(cases.len() >= 11);

    let mut problems = Vec::new();

    for c in cases {
        let name = c["name"].as_str().unwrap();
        let iv = &c["in"];
        let leftovers = rows(&iv["leftovers"]);
        let matched = rows(&iv["matched"]);

        let run_opts = RunOptions {
            min_rows: iv["run"]["minRows"]
                .as_u64()
                .unwrap_or(DEFAULT_RUN_MIN_ROWS as u64) as usize,
            max_twin_span_days: iv["run"]["maxTwinSpanDays"]
                .as_i64()
                .unwrap_or(DEFAULT_RUN_MAX_TWIN_SPAN_DAYS),
        };

        let got = classify_leftovers(
            &leftovers,
            &matched,
            date(iv["endDate"].as_str().unwrap()),
            iv["pendingGraceDays"].as_i64().unwrap(),
            iv["duplicateWindowDays"].as_i64().unwrap(),
            run_opts,
        );

        for w in c["out"]["verdicts"].as_array().unwrap() {
            let id = w["id"].as_str().unwrap();
            match got.get(id) {
                None => problems.push(format!("[{name}] no verdict for {id}")),
                Some(v) => {
                    if kind_name(v.kind) != w["kind"].as_str().unwrap() {
                        problems.push(format!(
                            "[{name}] {id} kind: rust {}, ts {}",
                            kind_name(v.kind),
                            w["kind"]
                        ));
                    }
                    if v.duplicate_of_matched != w["duplicateOfMatched"].as_bool().unwrap() {
                        problems.push(format!("[{name}] {id} duplicateOfMatched differs"));
                    }
                    if v.in_duplicate_run != w["inDuplicateRun"].as_bool().unwrap() {
                        problems.push(format!("[{name}] {id} inDuplicateRun differs"));
                    }
                }
            }
        }

        // Runs: count, membership, span and total.
        let got_runs = find_duplicate_runs(&leftovers, &matched, run_opts);
        let want_runs = c["out"]["runs"].as_array().unwrap();
        if got_runs.len() != want_runs.len() {
            problems.push(format!(
                "[{name}] run count: rust {}, ts {}",
                got_runs.len(),
                want_runs.len()
            ));
            continue;
        }
        for (g, w) in got_runs.iter().zip(want_runs.iter()) {
            let want_ids: Vec<&str> = w["rows"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x.as_str().unwrap())
                .collect();
            let got_ids: Vec<&str> = g.rows.iter().map(|r| r.id.as_str()).collect();
            if got_ids != want_ids {
                problems.push(format!(
                    "[{name}] run members: rust {got_ids:?}, ts {want_ids:?}"
                ));
            }
            if g.start != date(w["start"].as_str().unwrap())
                || g.end != date(w["end"].as_str().unwrap())
            {
                problems.push(format!("[{name}] run span differs"));
            }
            if g.total != cents(&w["total"]) {
                problems.push(format!(
                    "[{name}] run total: rust {}, ts {}",
                    g.total, w["total"]
                ));
            }
        }
    }

    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The safety mechanism, stated on its own: five twinned rows claim a run, four
/// do not. Dropping this threshold turns "you entered June twice" into advice
/// to delete a real recurring bill.
#[test]
fn a_run_needs_five_twinned_rows() {
    let mk = |n: usize| -> (Vec<LeftoverRow>, Vec<LeftoverRow>) {
        let mut l = Vec::new();
        let mut m = Vec::new();
        for i in 0..n {
            l.push(LeftoverRow {
                id: format!("L{i}"),
                date: date("2026-06-10") + chrono::Duration::days(i as i64),
                name: format!("Vendor {i}"),
                amount: Cents(1000 + i as i64),
                gross: None,
            });
            m.push(LeftoverRow {
                id: format!("M{i}"),
                date: date("2026-05-10") + chrono::Duration::days(i as i64),
                name: format!("Vendor {i}"),
                amount: Cents(1000 + i as i64),
                gross: None,
            });
        }
        (l, m)
    };
    let (l4, m4) = mk(4);
    assert!(find_duplicate_runs(&l4, &m4, RunOptions::default()).is_empty());
    let (l5, m5) = mk(5);
    assert_eq!(
        find_duplicate_runs(&l5, &m5, RunOptions::default()).len(),
        1
    );
}
