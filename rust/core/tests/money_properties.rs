//! Properties of the `Cents` type itself.
//!
//! These are the guarantees that let ADR-033 delete most of QUALITY.md's
//! monetary-arithmetic rule: if addition is exact and splitting is exact, there
//! is nothing left for a developer to remember to round.

use avoir_core::money::{Cents, Percent};
use proptest::prelude::*;

proptest! {
    /// Summing is exact and order-independent — the property that fails for
    /// floats and is the whole reason the ledger moved to integers. Under f64,
    /// `0.1 + 0.2 != 0.3`; here reassociating cannot change the result.
    #[test]
    fn addition_is_exact_and_associative(v in prop::collection::vec(-1_000_000_00i64..1_000_000_00, 0..64)) {
        let cents: Vec<Cents> = v.iter().copied().map(Cents).collect();
        let forward: Cents = cents.iter().copied().sum();
        let backward: Cents = cents.iter().rev().copied().sum();
        prop_assert_eq!(forward, backward);
        prop_assert_eq!(forward.0, v.iter().sum::<i64>());
    }

    /// Splitting never loses or invents a cent.
    ///
    /// This is exactly what ADR-030's payment legs require: the legs of a split
    /// purchase must sum to the parent total, so the residual has to land on
    /// one of them rather than being dropped.
    #[test]
    fn split_evenly_sums_back_to_the_original(
        total in -1_000_000_00i64..1_000_000_00, n in 1u32..64
    ) {
        let parts = Cents(total).split_evenly(n);
        prop_assert_eq!(parts.len(), n as usize);
        prop_assert_eq!(parts.iter().copied().sum::<Cents>(), Cents(total));
    }

    /// The parts of a split differ by at most one cent, so the residual is
    /// spread rather than dumped on a single leg.
    #[test]
    fn split_evenly_is_balanced(total in -1_000_000_00i64..1_000_000_00, n in 1u32..64) {
        let parts = Cents(total).split_evenly(n);
        let max = parts.iter().map(|c| c.0).max().unwrap();
        let min = parts.iter().map(|c| c.0).min().unwrap();
        prop_assert!(max - min <= 1, "spread {} exceeds one cent", max - min);
    }

    /// Display round-trips through the string form without losing a cent.
    #[test]
    fn display_round_trips(c in -1_000_000_00i64..1_000_000_00) {
        let s = Cents(c).to_string();
        let neg = s.starts_with('-');
        let body = s.trim_start_matches('-');
        let (d, f) = body.split_once('.').expect("always has a decimal point");
        let parsed = d.parse::<i64>().unwrap() * 100 + f.parse::<i64>().unwrap();
        prop_assert_eq!(if neg { -parsed } else { parsed }, c);
    }

    /// Percent keeps its scale-2 meaning in both directions.
    #[test]
    fn percent_conversions_agree(p in 0i64..10_000) {
        let pct = Percent(p);
        prop_assert!((pct.as_percent_f64() - pct.as_fraction_f64() * 100.0).abs() < 1e-9);
    }
}

#[test]
fn display_formats_cents_with_two_places() {
    assert_eq!(Cents(0).to_string(), "0.00");
    assert_eq!(Cents(5).to_string(), "0.05");
    assert_eq!(Cents(-5).to_string(), "-0.05");
    assert_eq!(Cents(156_144_26).to_string(), "156144.26");
    assert_eq!(Cents(-1_314_768).to_string(), "-13147.68");
}

#[test]
fn split_evenly_handles_the_indivisible_case() {
    // 10 cents across 3 ways: 4 + 3 + 3, not 3 + 3 + 3 with one lost.
    let parts = Cents(10).split_evenly(3);
    assert_eq!(parts, vec![Cents(4), Cents(3), Cents(3)]);
    assert_eq!(parts.iter().copied().sum::<Cents>(), Cents(10));

    // Negative totals spread the same way rather than rounding toward zero.
    let neg = Cents(-10).split_evenly(3);
    assert_eq!(neg.iter().copied().sum::<Cents>(), Cents(-10));
}
