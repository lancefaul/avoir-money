//! Differential test: the Rust port against the live TypeScript it replaces.
//!
//! The property tests next door prove the Rust obeys the invariants I believe
//! the TypeScript obeys. That is not the same as proving the port is faithful —
//! it cannot catch a case where I misread the original, which is the most likely
//! way a port goes wrong.
//!
//! This asserts against 400 vectors whose outputs were produced by running
//! `packages/core/dist` itself. Regenerate with:
//!
//!   node rust/core/tests/fixtures/generate.mjs > rust/core/tests/fixtures/debt_vectors.json
//!
//! The fixture is committed so this runs with no Node in the loop. When the
//! TypeScript is eventually deleted, this test is what licenses that deletion —
//! and it keeps its value afterwards as a frozen record of the old behaviour.

use avoir_core::debt::*;
use avoir_core::money::{Cents, Percent};
use serde_json::Value;

fn freq_from(s: &Value) -> Option<Frequency> {
    match s.as_str() {
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

#[test]
fn rust_matches_typescript_on_every_vector() {
    let raw = include_str!("fixtures/debt_vectors.json");
    let doc: Value = serde_json::from_str(raw).expect("fixture is valid JSON");
    let vectors = doc["vectors"].as_array().expect("fixture has vectors");
    assert!(!vectors.is_empty(), "fixture must not be empty");

    let mut mismatches: Vec<String> = Vec::new();

    for (i, v) in vectors.iter().enumerate() {
        let iv = &v["in"];
        let ov = &v["out"];

        let balance = Cents(iv["balanceCents"].as_i64().unwrap());
        let apr = Percent(iv["aprHundredths"].as_i64().unwrap());
        let payment = Cents(iv["paymentCents"].as_i64().unwrap());
        let freq = freq_from(&iv["freq"]);
        let term = iv["termMonths"].as_i64().unwrap();
        let original = Cents(iv["originalCents"].as_i64().unwrap());
        let minimum = Cents(iv["minimumCents"].as_i64().unwrap());

        // Collected per vector, then folded in — a closure that borrows
        // `mismatches` for the whole body would block the nullity arm below.
        let mut local: Vec<String> = Vec::new();
        let ctx = format!(
            "(bal={} apr={} pay={} freq={} term={term} orig={} min={})",
            balance.0, apr.0, payment.0, iv["freq"], original.0, minimum.0
        );
        let mut check = |name: &str, got: i64, want: i64| {
            if got != want {
                local.push(format!("vector {i} {name}: rust {got}, ts {want}  {ctx}"));
            }
        };

        check(
            "periodsPerYear",
            periods_per_year(freq) as i64,
            ov["periodsPerYear"].as_i64().unwrap(),
        );

        let split = split_payment(balance, apr, payment, freq);
        check(
            "split.principal",
            split.principal.0,
            ov["splitPrincipalCents"].as_i64().unwrap(),
        );
        check(
            "split.interest",
            split.interest.0,
            ov["splitInterestCents"].as_i64().unwrap(),
        );

        let amortized = compute_amortized_payment(original, apr, term, freq);
        let nullity_mismatch = match (amortized, ov["amortizedCents"].as_i64()) {
            (Some(g), Some(w)) => {
                check("computeAmortizedPayment", g.0, w);
                None
            }
            (None, None) => None,
            (g, w) => Some(format!(
                "vector {i} computeAmortizedPayment nullity: rust {g:?}, ts {w:?}"
            )),
        };

        let base = resolve_base_payment(&BasePaymentInput {
            minimum_payment: minimum,
            original_balance: Some(original),
            apr,
            term_months: Some(term),
            frequency: freq,
        });
        check(
            "resolveBasePayment",
            base.0,
            ov["basePaymentCents"].as_i64().unwrap(),
        );

        mismatches.extend(local);
        mismatches.extend(nullity_mismatch);
    }

    if !mismatches.is_empty() {
        panic!(
            "{} of {} vectors disagree with the TypeScript:\n{}",
            mismatches.len(),
            vectors.len(),
            mismatches
                .iter()
                .take(15)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
