//! The clock-dependent branch of `generateAmortization`, which the differential
//! fixture deliberately cannot cover.
//!
//! `remainingTermPeriods` reads `new Date()` in the TypeScript, so any debt with
//! a `maturityDate` or `startDate` + `termMonths` produces a different schedule
//! depending on the day it runs. A committed fixture over that would rot
//! silently. The port takes `today` as an argument instead, which is what makes
//! these tests possible at all.

use avoir_core::debt::*;
use avoir_core::money::{Cents, Percent};
use chrono::NaiveDate;

fn d(y: i32, m: u32, day: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, day).unwrap()
}

fn loan(
    term_months: Option<i64>,
    start: Option<NaiveDate>,
    maturity: Option<NaiveDate>,
) -> DebtInput {
    DebtInput {
        current_balance: Cents(5_000_00),
        apr: Percent(12_00),
        minimum_payment: Cents(500_00),
        frequency: Some(Frequency::Monthly),
        term_months,
        original_balance: None,
        maturity_date: maturity,
        start_date: start,
    }
}

#[test]
fn without_term_or_maturity_the_schedule_runs_to_natural_payoff() {
    let r = generate_amortization(
        &loan(None, None, None),
        Cents::ZERO,
        Cents::ZERO,
        d(2026, 8, 9),
    );
    assert_eq!(
        r.payoff_periods, 11,
        "$5,000 at 12% paying $500 clears in 11 periods"
    );
    assert_eq!(r.entries.last().unwrap().remaining_balance, Cents::ZERO);
}

#[test]
fn an_elapsed_term_collapses_the_schedule_to_a_single_balloon() {
    // start 2025-01-01 with a 6-month term, evaluated 19 months later: the term
    // is long gone, remaining clamps to 1 period, and the whole balance falls
    // due at once. Faithful to the TypeScript, and worth pinning precisely
    // because it looks alarming and is easy to "fix" by accident.
    let debt = loan(Some(6), Some(d(2025, 1, 1)), None);
    let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, d(2026, 8, 9));

    assert_eq!(r.payoff_periods, 1);
    let only = r.entries.last().unwrap();
    assert_eq!(only.principal_amount, Cents(5_000_00), "the entire balance");
    assert_eq!(only.interest_amount, Cents(50_00), "one period of interest");
    assert_eq!(
        only.payment_amount,
        Cents(5_050_00),
        "a balloon, not the $500 minimum"
    );
    assert_eq!(only.remaining_balance, Cents::ZERO);
}

#[test]
fn a_live_term_caps_the_schedule_without_shortening_a_faster_payoff() {
    // 24 months remaining is longer than the 11 the loan needs, so the cap does
    // not bind and the schedule is unchanged.
    let debt = loan(Some(24), Some(d(2026, 8, 1)), None);
    let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, d(2026, 8, 9));
    assert_eq!(r.payoff_periods, 11);
}

#[test]
fn a_short_remaining_term_forces_an_early_balloon() {
    // 3 months left on a loan that would take 11: the third period must clear
    // whatever is outstanding.
    let debt = loan(Some(3), Some(d(2026, 8, 1)), None);
    let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, d(2026, 8, 9));

    assert_eq!(r.payoff_periods, 3);
    let last = r.entries.last().unwrap();
    assert_eq!(last.remaining_balance, Cents::ZERO);
    assert!(
        last.payment_amount > Cents(500_00),
        "the final payment must exceed the minimum to clear the balance, got {}",
        last.payment_amount
    );
}

#[test]
fn maturity_date_drives_the_cap_when_present() {
    let debt = loan(None, None, Some(d(2026, 11, 9))); // 3 months out
    let r = generate_amortization(&debt, Cents::ZERO, Cents::ZERO, d(2026, 8, 9));
    assert_eq!(r.payoff_periods, 3);
}

#[test]
fn remaining_term_periods_never_returns_zero() {
    // max(1, …) in the original: a fully elapsed term still schedules one
    // payment rather than an empty schedule, which would read as "paid off".
    let debt = loan(Some(1), Some(d(2010, 1, 1)), None);
    assert_eq!(remaining_term_periods(&debt, d(2026, 8, 9)), Some(1));
}

#[test]
fn payoff_date_is_the_maturity_date_when_no_extra_is_paid() {
    let maturity = d(2027, 6, 30);
    let debt = loan(None, None, Some(maturity));
    let got = estimate_payoff_date(&debt, d(2026, 8, 9), Cents::ZERO, d(2026, 8, 9));
    assert_eq!(got, Some(maturity));
}

#[test]
fn extra_payments_can_beat_the_maturity_date() {
    let maturity = d(2030, 1, 1);
    let debt = loan(None, None, Some(maturity));
    let got = estimate_payoff_date(&debt, d(2026, 8, 9), Cents(200_00), d(2026, 8, 9)).unwrap();
    assert!(
        got < maturity,
        "extra payment should pay off before maturity, got {got}"
    );
}

#[test]
fn payoff_date_is_none_when_negatively_amortizing() {
    let debt = DebtInput {
        minimum_payment: Cents(1_00), // nowhere near the interest
        ..loan(None, None, None)
    };
    assert_eq!(
        estimate_payoff_date(&debt, d(2026, 8, 9), Cents::ZERO, d(2026, 8, 9)),
        None
    );
}

#[test]
fn add_months_clamps_to_the_end_of_a_short_month() {
    // Jan 31 + 1 month is Feb 28, not March 3. Exercised through the public
    // API: a 1-period schedule from Jan 31 lands on Feb 28.
    let debt = DebtInput {
        current_balance: Cents(100_00),
        minimum_payment: Cents(500_00), // clears in one period
        ..loan(None, None, None)
    };
    let got = estimate_payoff_date(&debt, d(2026, 1, 31), Cents::ZERO, d(2026, 8, 9));
    assert_eq!(got, Some(d(2026, 2, 28)));
}

#[test]
fn months_remaining_is_zero_when_negatively_amortizing() {
    let debt = DebtInput {
        minimum_payment: Cents(1_00),
        ..loan(None, None, None)
    };
    assert_eq!(months_remaining(&debt, Cents::ZERO, d(2026, 8, 9)), 0);
}
