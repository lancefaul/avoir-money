//! `proptest` port of `packages/core/src/utils/debt-calc.property.test.ts`.
//!
//! The five properties below are the same five the fast-check suite asserts,
//! kept in the same order and under the same numbering so the two can be read
//! side by side while both exist.
//!
//! Generator hygiene carried over from QUALITY.md: fast-check needs
//! `noNaN`/`noDefaultInfinity` because its float generators include those by
//! default and one reaching the maths produces a seed-dependent flake (the
//! 2026-07-14 incident). `proptest` over integer ranges cannot produce them at
//! all — which is a real advantage of the cents representation, not just of the
//! framework: there is no float in the input domain to poison.

use avoir_core::debt::*;
use avoir_core::money::{Cents, Percent};
use chrono::NaiveDate;
use proptest::prelude::*;

/// A fixed reference date. The port takes `today` explicitly rather than
/// reading the clock, so these properties are stable across days — the
/// TypeScript's are not.
fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()
}

/// $1.00 … $1,000,000.00
fn balance() -> impl Strategy<Value = Cents> {
    (100i64..100_000_000).prop_map(Cents)
}

/// 0.00% … 35.00%
fn apr() -> impl Strategy<Value = Percent> {
    (0i64..3_500).prop_map(Percent)
}

fn frequency() -> impl Strategy<Value = Option<Frequency>> {
    prop_oneof![
        Just(None),
        Just(Some(Frequency::Weekly)),
        Just(Some(Frequency::Biweekly)),
        Just(Some(Frequency::SemiMonthly)),
        Just(Some(Frequency::Monthly)),
        Just(Some(Frequency::Quarterly)),
        Just(Some(Frequency::Biannual)),
        Just(Some(Frequency::Annual)),
    ]
}

proptest! {
    /// Property 6 — principal + interest equals the payment.
    ///
    /// Holds only when the payment covers the interest. Below that the split
    /// floors principal at zero, so the parts exceed the payment; that is
    /// negative amortization and is asserted separately in Property 11.
    #[test]
    fn p6_principal_plus_interest_equals_payment(
        bal in balance(), rate in apr(), pay in 1i64..10_000_00, freq in frequency()
    ) {
        let payment = Cents(pay);
        let s = split_payment(bal, rate, payment, freq);
        if s.interest < payment {
            prop_assert_eq!(s.principal + s.interest, payment);
        } else {
            prop_assert_eq!(s.principal, Cents::ZERO);
        }
    }

    /// Interest is never negative for a non-negative balance and rate, and
    /// principal is never negative under any input.
    #[test]
    fn p6b_split_parts_are_never_negative(
        bal in balance(), rate in apr(), pay in 0i64..10_000_00, freq in frequency()
    ) {
        let s = split_payment(bal, rate, Cents(pay), freq);
        prop_assert!(s.interest.0 >= 0);
        prop_assert!(s.principal.0 >= 0);
    }

    /// Property 9 — a schedule terminates at a zero balance, and its length
    /// matches the reported payoff period count.
    #[test]
    fn p9_schedule_terminates_at_zero(
        bal in balance(), rate in apr(), freq in frequency()
    ) {
        // A payment guaranteed to clear interest: 5% of balance, min $50.
        let pay = std::cmp::max(bal.0 / 20, 5_000);
        let debt = DebtInput {
            current_balance: bal, apr: rate, minimum_payment: Cents(pay),
            frequency: freq, term_months: None, original_balance: None,
            maturity_date: None, start_date: None,
        };
        let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, today());

        if !r.is_negatively_amortizing && !r.entries.is_empty() {
            prop_assert_eq!(r.entries.len() as u32, r.payoff_periods);
            let last = r.entries.last().unwrap();
            // Either paid off, or stopped at the ADR-011 safety cap.
            let capped = r.payoff_periods >= (MAX_MONTHS * periods_per_year(freq)) / 12;
            prop_assert!(last.remaining_balance.0 <= 0 || capped);
        }
    }

    /// The schedule's balance is monotonically non-increasing. A ledger that
    /// walks backwards is the failure this guards.
    #[test]
    fn p9b_balance_never_increases(
        bal in balance(), rate in apr(), freq in frequency()
    ) {
        let pay = std::cmp::max(bal.0 / 20, 5_000);
        let debt = DebtInput {
            current_balance: bal, apr: rate, minimum_payment: Cents(pay),
            frequency: freq, term_months: None, original_balance: None,
            maturity_date: None, start_date: None,
        };
        let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, today());
        let mut prev = bal;
        for e in &r.entries {
            prop_assert!(e.remaining_balance <= prev);
            prev = e.remaining_balance;
        }
    }

    /// Property 10 — an extra payment never lengthens the payoff.
    #[test]
    fn p10_extra_payment_never_lengthens_payoff(
        bal in balance(), rate in apr(), extra in 1i64..50_000
    ) {
        let pay = std::cmp::max(bal.0 / 20, 5_000);
        let mk = || DebtInput {
            current_balance: bal, apr: rate, minimum_payment: Cents(pay),
            frequency: Some(Frequency::Monthly), term_months: None, original_balance: None,
            maturity_date: None, start_date: None,
        };
        let base = generate_amortization(&mk(), Cents::ZERO, Cents::ZERO, today());
        let with = generate_amortization(&mk(), Cents(extra), Cents::ZERO, today());

        if !base.is_negatively_amortizing && !with.is_negatively_amortizing {
            prop_assert!(with.payoff_periods <= base.payoff_periods);
        }
    }

    /// Property 11 — negative amortization is detected, not iterated.
    ///
    /// When the payment cannot cover the first period's interest, the schedule
    /// must come back empty and flagged rather than running to the cap.
    #[test]
    fn p11_negative_amortization_is_flagged(
        bal in 10_000_00i64..100_000_00, rate in 1_000i64..3_500
    ) {
        // A payment far below the period interest, by construction.
        let interest = split_payment(Cents(bal), Percent(rate), Cents(0), Some(Frequency::Monthly)).interest;
        let debt = DebtInput {
            current_balance: Cents(bal), apr: Percent(rate),
            minimum_payment: Cents(std::cmp::max(interest.0 / 2, 1)),
            frequency: Some(Frequency::Monthly), term_months: None, original_balance: None,
            maturity_date: None, start_date: None,
        };
        let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, today());
        prop_assert!(r.is_negatively_amortizing);
        prop_assert!(r.entries.is_empty());
        prop_assert_eq!(r.payoff_periods, 0);
    }

    /// Property 12 — a derived P&I payment either amortizes the loan it was
    /// derived from, or is correctly refused as negative amortization.
    ///
    /// **This originally asserted `payment > first_interest` unconditionally,
    /// and that is stronger than the system's actual contract.** proptest found
    /// the counterexample on 2026-08-14: principal $1,479.40, 19.95% APR, a
    /// 474-month term. The exact PMT there sits a hair above the period
    /// interest, and `js_round` — deliberately mirroring the TypeScript's
    /// `Math.round` — rounds it DOWN onto it. Payment and interest both land on
    /// $24.60.
    ///
    /// The reference implementation does exactly the same thing (verified, not
    /// assumed), so this is a property of the shared algorithm at a rounding
    /// boundary rather than a port defect. Changing the rounding to `ceil` would
    /// diverge from the reference and shift every derived payment — including
    /// the one ADR-023/031 depend on — to satisfy a region no real loan occupies
    /// (a 39-year term at 19.95%).
    ///
    /// Crucially the downstream contract already covers it: `generate_amortization`
    /// guards on `period_interest >= period_payment` — note `>=`, not `>` — and
    /// returns an empty schedule flagged `is_negatively_amortizing`. The equal
    /// case is handled, on purpose, and predates this property.
    ///
    /// So the fix is to assert the real contract over the WHOLE input domain
    /// rather than to shrink the domain until the over-statement holds. This
    /// version is strictly stronger than a narrowed range: it still demands
    /// amortization everywhere it is possible, and demands a correct refusal
    /// everywhere it is not.
    #[test]
    fn p12_derived_payment_amortizes(
        principal in 1_000_00i64..500_000_00, rate in 1i64..2_000, term in 12i64..480
    ) {
        let p = Cents(principal);
        let r = Percent(rate);
        let payment = compute_amortized_payment(p, r, term, Some(Frequency::Monthly));
        prop_assert!(payment.is_some());
        let payment = payment.unwrap();

        let first_interest = split_payment(p, r, payment, Some(Frequency::Monthly)).interest;

        if payment > first_interest {
            // The ordinary case: it amortizes, so a schedule must be produced.
            let debt = DebtInput {
                current_balance: p, apr: r, minimum_payment: payment,
                frequency: Some(Frequency::Monthly), term_months: Some(term),
                original_balance: Some(p), maturity_date: None, start_date: None,
            };
            let sched = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, today());
            prop_assert!(!sched.is_negatively_amortizing);
            prop_assert!(!sched.entries.is_empty());
        } else {
            // The boundary case. It must never be silently iterated — the
            // schedule has to come back empty and flagged.
            prop_assert_eq!(
                payment, first_interest,
                "a derived payment may equal the period interest at a rounding \
                 boundary, but must never fall BELOW it"
            );
            let debt = DebtInput {
                current_balance: p, apr: r, minimum_payment: payment,
                frequency: Some(Frequency::Monthly), term_months: Some(term),
                original_balance: Some(p), maturity_date: None, start_date: None,
            };
            let sched = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, today());
            prop_assert!(sched.is_negatively_amortizing);
            prop_assert!(sched.entries.is_empty());
        }
    }

    /// A zero rate takes the straight-line branch, so the payment is exactly
    /// the principal spread over the term. This is the branch that made the
    /// the zero-APR loan match by coincidence (ADR-031) and is worth pinning.
    #[test]
    fn p12b_zero_rate_is_straight_line(
        principal in 1_000_00i64..500_000_00, term in 12i64..480
    ) {
        let payment = compute_amortized_payment(
            Cents(principal), Percent::ZERO, term, Some(Frequency::Monthly)
        ).unwrap();
        let expected = Cents(((principal as f64) / (term as f64) + 0.5).floor() as i64);
        prop_assert_eq!(payment, expected);
    }

    /// ADR-031's precedence, as a property: a recorded payment always wins over
    /// the reconstruction, whatever the loan terms say.
    #[test]
    fn adr031_recorded_payment_outranks_reconstruction(
        minimum in 1i64..10_000_00, original in 1_000_00i64..500_000_00,
        rate in 0i64..2_000, term in 1i64..480
    ) {
        let got = resolve_base_payment(&BasePaymentInput {
            minimum_payment: Cents(minimum),
            original_balance: Some(Cents(original)),
            apr: Percent(rate),
            term_months: Some(term),
            frequency: Some(Frequency::Monthly),
        });
        prop_assert_eq!(got, Cents(minimum));
    }
}
