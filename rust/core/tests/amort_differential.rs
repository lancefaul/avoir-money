//! Differential test for `generateAmortization` — the one place in the port
//! where exact agreement with the TypeScript was deliberately rejected.
//!
//! The TypeScript runs its whole loop in unrounded `f64` and rounds only when
//! writing an entry, so sub-cent fractions accumulate through the balance. This
//! port runs in whole cents. Reproducing the drift would mean carrying forward
//! exactly the defect ADR-033 exists to remove, so instead this test MEASURES
//! the disagreement and fails only if it exceeds a stated tolerance.
//!
//! The measurement is the point. A tolerance that silently widens is worthless,
//! so the observed maximum is printed on every run and the assertions are set
//! just above what the data actually shows.
//!
//! Only the clock-free path is covered — see `generate-amort.mjs` for why.

use avoir_core::debt::*;
use avoir_core::money::{Cents, Percent};
use chrono::NaiveDate;
use serde_json::Value;

fn freq(v: &Value) -> Option<Frequency> {
    match v.as_str() {
        Some("WEEKLY") => Some(Frequency::Weekly),
        Some("BIWEEKLY") => Some(Frequency::Biweekly),
        Some("SEMI_MONTHLY") => Some(Frequency::SemiMonthly),
        Some("MONTHLY") => Some(Frequency::Monthly),
        Some("QUARTERLY") => Some(Frequency::Quarterly),
        Some("BIANNUAL") => Some(Frequency::Biannual),
        Some("ANNUAL") => Some(Frequency::Annual),
        _ => None,
    }
}

/// Irrelevant to these vectors — every debt omits maturity/start, so the term
/// cap is never consulted — but the port requires it explicitly by design.
fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()
}

#[test]
fn amortization_agrees_with_typescript_within_a_measured_tolerance() {
    let raw = include_str!("fixtures/amort_vectors.json");
    let doc: Value = serde_json::from_str(raw).expect("fixture is valid JSON");
    assert_eq!(
        doc["clockFree"], true,
        "these vectors must avoid the clock-reading branch to be reproducible"
    );
    let vectors = doc["vectors"].as_array().unwrap();

    let mut hard_failures: Vec<String> = Vec::new();
    let (mut max_entry_delta, mut max_total_delta, mut max_period_delta) = (0i64, 0i64, 0i64);
    let (mut worst_entry, mut worst_total) = (String::new(), String::new());
    let mut entries_compared = 0usize;

    for v in vectors {
        let name = v["name"].as_str().unwrap_or("?");
        let iv = &v["in"];
        let ov = &v["out"];

        let debt = DebtInput {
            current_balance: Cents(iv["balanceCents"].as_i64().unwrap()),
            apr: Percent(iv["aprHundredths"].as_i64().unwrap()),
            minimum_payment: Cents(iv["minCents"].as_i64().unwrap()),
            frequency: freq(&iv["freq"]),
            term_months: None,
            original_balance: None,
            maturity_date: None,
            start_date: None,
        };
        let got = generate_amortization(
            &debt,
            Cents(iv["extraCents"].as_i64().unwrap()),
            Cents(iv["escrowCents"].as_i64().unwrap()),
            today(),
        );

        // Negative amortization is a classification, not a number: it must
        // agree exactly, because the two sides disagreeing means one of them
        // shows a schedule that cannot exist.
        let want_neg = ov["isNegativelyAmortizing"].as_bool().unwrap();
        if got.is_negatively_amortizing != want_neg {
            hard_failures.push(format!(
                "[{name}] negative-amortization flag: rust {}, ts {want_neg}",
                got.is_negatively_amortizing
            ));
            continue;
        }
        if want_neg {
            continue;
        }

        let want_periods = ov["payoffMonths"].as_i64().unwrap();
        let d = (got.payoff_periods as i64 - want_periods).abs();
        if d > max_period_delta {
            max_period_delta = d;
        }

        let d = (got.total_interest.0 - ov["totalInterestCents"].as_i64().unwrap()).abs();
        if d > max_total_delta {
            max_total_delta = d;
            worst_total = format!("[{name}] totalInterest off by {d} cents");
        }

        let want_entries = ov["entries"].as_array().unwrap();
        for (g, w) in got.entries.iter().zip(want_entries.iter()) {
            entries_compared += 1;
            for (field, gv, wv) in [
                (
                    "principal",
                    g.principal_amount.0,
                    w["principalCents"].as_i64().unwrap(),
                ),
                (
                    "interest",
                    g.interest_amount.0,
                    w["interestCents"].as_i64().unwrap(),
                ),
                (
                    "remaining",
                    g.remaining_balance.0,
                    w["remainingCents"].as_i64().unwrap(),
                ),
            ] {
                let d = (gv - wv).abs();
                if d > max_entry_delta {
                    max_entry_delta = d;
                    worst_entry =
                        format!("[{name}] period {} {field}: rust {gv}, ts {wv}", g.period);
                }
                // The bound scales with position: each period rounds to the
                // cent, so drift against an unrounded reference accumulates
                // with schedule length. A flat tolerance would either fail on
                // long mortgages or be meaningless on short loans.
                //
                // Measured drift is ~0.2 cents per period, so the allowance is
                // one fifth of a cent per period plus 2. Worst observed: 6
                // cents at period 39 (bound 9) and 37 at period 598 (bound
                // 121). A systematic error — a missing term cap, a wrong
                // interest formula — diverges far faster than this and is
                // still caught.
                let bound = 2 + (g.period as i64) / 5;
                if d > bound {
                    hard_failures.push(format!(
                        "[{name}] period {} {field} off by {d} cents, bound {bound}: rust {gv}, ts {wv}",
                        g.period
                    ));
                }
            }
        }

        // The property the cents port GAINS and the TypeScript lacks: a
        // schedule's rows sum to its stated total. Asserted exactly.
        let summed: Cents = got.entries.iter().map(|e| e.interest_amount).sum();
        if summed != got.total_interest {
            hard_failures.push(format!(
                "[{name}] rust totals are internally inconsistent: entries sum {summed}, total {}",
                got.total_interest
            ));
        }
    }

    println!("\n  amortization divergence from the TypeScript, measured:");
    println!("    entries compared     {entries_compared}");
    println!("    max per-entry delta  {max_entry_delta} cents   {worst_entry}");
    println!("    max total delta      {max_total_delta} cents   {worst_total}");
    println!("    max period-count delta {max_period_delta}");

    assert!(hard_failures.is_empty(), "{}", hard_failures.join("\n"));

    // Schedule LENGTH must agree exactly. Drift in a rounded amount is
    // expected; a different number of payments is a different loan, and it is
    // what a missing term cap or balloon would show up as.
    assert_eq!(
        max_period_delta, 0,
        "schedule length diverged by {max_period_delta} periods — that is a behaviour change, not rounding"
    );
}
