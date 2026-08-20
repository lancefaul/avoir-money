//! Differential test for pay-period generation, against the live TypeScript.
//!
//! 129 cases / 4,919 generated periods, compared field by field. This is the
//! module where a subtle port error is most expensive — the pre-history UTC
//! incident shifted 243 pay periods by one day and required a production
//! migration — so every period's four dates and both counters are checked, not
//! just the count.

use avoir_core::dates::*;
use chrono::NaiveDate;
use serde_json::Value;

fn date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("fixture dates are ISO")
}

fn schedule(s: &str) -> PayScheduleType {
    match s {
        "WEEKLY" => PayScheduleType::Weekly,
        "BIWEEKLY" => PayScheduleType::Biweekly,
        "SEMI_MONTHLY" => PayScheduleType::SemiMonthly,
        "MONTHLY" => PayScheduleType::Monthly,
        other => panic!("unknown schedule type in fixture: {other}"),
    }
}

#[test]
fn pay_periods_match_typescript_on_every_vector() {
    let raw = include_str!("fixtures/date_vectors.json");
    let doc: Value = serde_json::from_str(raw).expect("fixture is valid JSON");
    let vectors = doc["vectors"].as_array().expect("fixture has vectors");
    assert!(!vectors.is_empty());

    let mut problems: Vec<String> = Vec::new();
    let mut compared = 0usize;

    for v in vectors {
        let name = v["name"].as_str().unwrap_or("?");
        let iv = &v["in"];

        let input = GeneratePeriodsInput {
            schedule_type: schedule(iv["scheduleType"].as_str().unwrap()),
            anchor_date: iv["anchorDate"].as_str().map(date),
            first_pay_day: iv["firstPayDay"].as_u64().map(|n| n as u32),
            second_pay_day: iv["secondPayDay"].as_u64().map(|n| n as u32),
            range_start: date(iv["rangeStart"].as_str().unwrap()),
            range_end: date(iv["rangeEnd"].as_str().unwrap()),
        };

        let got = match generate_pay_periods(&input) {
            Ok(p) => p,
            Err(e) => {
                // The TypeScript throws for the same missing-config cases; the
                // fixture records the message. A Rust error where TS succeeded
                // (or vice versa) is a real divergence.
                if v["error"].is_null() {
                    problems.push(format!("[{name}] rust errored ({e}) where ts succeeded"));
                }
                continue;
            }
        };

        if !v["error"].is_null() {
            problems.push(format!(
                "[{name}] ts threw ({}) where rust succeeded with {} periods",
                v["error"],
                got.len()
            ));
            continue;
        }

        let want = v["out"].as_array().unwrap();
        if got.len() != want.len() {
            problems.push(format!(
                "[{name}] period count: rust {}, ts {}",
                got.len(),
                want.len()
            ));
            continue;
        }

        for (i, (g, w)) in got.iter().zip(want.iter()).enumerate() {
            compared += 1;
            let expect = |field: &str, got_v: String, want_v: &str| -> Option<String> {
                if got_v != want_v {
                    Some(format!(
                        "[{name}] period {i} {field}: rust {got_v}, ts {want_v}"
                    ))
                } else {
                    None
                }
            };
            problems.extend(expect(
                "startDate",
                g.start_date.to_string(),
                w["startDate"].as_str().unwrap(),
            ));
            problems.extend(expect(
                "endDate",
                g.end_date.to_string(),
                w["endDate"].as_str().unwrap(),
            ));
            problems.extend(expect(
                "payDate",
                g.pay_date.to_string(),
                w["payDate"].as_str().unwrap(),
            ));
            problems.extend(expect(
                "year",
                g.year.to_string(),
                &w["year"].as_i64().unwrap().to_string(),
            ));
            problems.extend(expect(
                "periodNum",
                g.period_num.to_string(),
                &w["periodNum"].as_u64().unwrap().to_string(),
            ));
        }
    }

    assert!(
        compared > 4_000,
        "expected thousands of period comparisons, got {compared}"
    );

    if !problems.is_empty() {
        panic!(
            "{} divergences from the TypeScript ({} periods compared):\n{}",
            problems.len(),
            compared,
            problems
                .iter()
                .take(20)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
