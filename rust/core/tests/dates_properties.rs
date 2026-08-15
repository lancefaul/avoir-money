//! Structural properties of pay-period generation.
//!
//! The differential test proves the port matches the TypeScript. These assert
//! things that must be true of *any* correct implementation, so they keep their
//! value after the TypeScript is deleted and the fixture stops being a
//! reference.

use avoir_core::dates::*;
use chrono::{Datelike, NaiveDate};
use proptest::prelude::*;

fn a_date() -> impl Strategy<Value = NaiveDate> {
    (2015i32..2035, 1u32..13, 1u32..29)
        .prop_map(|(y, m, d)| NaiveDate::from_ymd_opt(y, m, d).unwrap())
}

fn pay_day() -> impl Strategy<Value = u32> {
    1u32..32
}

fn schedule_and_config(
) -> impl Strategy<Value = (PayScheduleType, Option<NaiveDate>, Option<u32>, Option<u32>)> {
    prop_oneof![
        a_date().prop_map(|d| (PayScheduleType::Weekly, Some(d), None, None)),
        a_date().prop_map(|d| (PayScheduleType::Biweekly, Some(d), None, None)),
        (pay_day(), pay_day()).prop_map(|(f, s)| (
            PayScheduleType::SemiMonthly,
            None,
            Some(f),
            Some(s)
        )),
        pay_day().prop_map(|f| (PayScheduleType::Monthly, None, Some(f), None)),
    ]
}

fn build(
    cfg: (PayScheduleType, Option<NaiveDate>, Option<u32>, Option<u32>),
    start: NaiveDate,
    end: NaiveDate,
) -> GeneratePeriodsInput {
    GeneratePeriodsInput {
        schedule_type: cfg.0,
        anchor_date: cfg.1,
        first_pay_day: cfg.2,
        second_pay_day: cfg.3,
        range_start: start,
        range_end: end,
    }
}

proptest! {
    /// Every generated pay date lies inside the requested range. A period
    /// leaking outside its range is how a schedule silently double-pays a month.
    #[test]
    fn pay_dates_stay_within_the_range(
        cfg in schedule_and_config(), a in a_date(), b in a_date()
    ) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let periods = generate_pay_periods(&build(cfg, start, end)).unwrap();
        for p in &periods {
            prop_assert!(p.pay_date >= start, "pay date {} before range start {}", p.pay_date, start);
            prop_assert!(p.pay_date <= end, "pay date {} after range end {}", p.pay_date, end);
        }
    }

    /// A period never ends before it starts. True of every schedule type.
    #[test]
    fn periods_are_well_formed(
        cfg in schedule_and_config(), a in a_date(), b in a_date()
    ) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let periods = generate_pay_periods(&build(cfg, start, end)).unwrap();
        for p in &periods {
            prop_assert!(p.start_date <= p.end_date);
        }
    }

    /// The anchor-stepped schedules are sorted by pay date. The calendar
    /// schedules are NOT, and asserting otherwise was wrong.
    ///
    /// This property originally covered all four types and failed, with
    /// proptest shrinking to `SemiMonthly, first=24, second=1`. That is not a
    /// port defect — the TypeScript sorts only `generateWeekly` and
    /// `generateBiweekly`; semi-monthly and monthly return in period order. The
    /// two coincide whenever `firstPayDay <= secondPayDay`, which is the only
    /// sane configuration, but nothing enforces it: with the days inverted,
    /// period 1 is paid on the 24th and period 2 on the 1st, so the list comes
    /// back out of chronological order AND each pay date falls outside its own
    /// period. Production runs BIWEEKLY, so this is unreachable there today.
    #[test]
    fn stepped_schedules_are_ordered_by_pay_date(
        anchor in a_date(), a in a_date(), b in a_date(), biweekly in any::<bool>()
    ) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let ty = if biweekly { PayScheduleType::Biweekly } else { PayScheduleType::Weekly };
        let periods = generate_pay_periods(&build((ty, Some(anchor), None, None), start, end)).unwrap();
        for w in periods.windows(2) {
            prop_assert!(w[0].pay_date <= w[1].pay_date, "not ordered by pay date");
        }
    }

    /// Calendar schedules are ordered by pay date whenever configured sanely
    /// (`first <= second`) — which pins the coincidence above as a real
    /// guarantee for every configuration a user would actually choose.
    #[test]
    fn calendar_schedules_are_ordered_when_configured_sanely(
        f in pay_day(), extra in 0u32..8, a in a_date(), b in a_date()
    ) {
        let s = (f + extra).min(31);
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let periods = generate_pay_periods(
            &build((PayScheduleType::SemiMonthly, None, Some(f), Some(s)), start, end)
        ).unwrap();
        for w in periods.windows(2) {
            prop_assert!(w[0].pay_date <= w[1].pay_date);
        }
    }

    /// `period_num` stays inside the range its schedule allows. Weekly can
    /// reach 53 in a year that carries an extra pay date; biweekly 27.
    #[test]
    fn period_numbers_stay_in_range(
        cfg in schedule_and_config(), a in a_date(), b in a_date()
    ) {
        let ty = cfg.0;
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let periods = generate_pay_periods(&build(cfg, start, end)).unwrap();
        let max = match ty {
            PayScheduleType::Weekly => 53,
            PayScheduleType::Biweekly => 27,
            PayScheduleType::SemiMonthly => 24,
            PayScheduleType::Monthly => 12,
        };
        for p in &periods {
            prop_assert!(p.period_num >= 1 && p.period_num <= max,
                "period_num {} outside 1..={} for {:?}", p.period_num, max, ty);
        }
    }

    /// Generation is deterministic — the same input yields the same output.
    /// Pay periods are persisted, so instability here would rewrite history.
    #[test]
    fn generation_is_deterministic(
        cfg in schedule_and_config(), a in a_date(), b in a_date()
    ) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let first = generate_pay_periods(&build(cfg, start, end)).unwrap();
        let second = generate_pay_periods(&build(cfg, start, end)).unwrap();
        prop_assert_eq!(first, second);
    }

    /// An inverted range produces nothing rather than erroring or wrapping.
    #[test]
    fn inverted_range_is_empty(cfg in schedule_and_config(), a in a_date(), b in a_date()) {
        let (early, late) = if a <= b { (a, b) } else { (b, a) };
        if early < late {
            let periods = generate_pay_periods(&build(cfg, late, early)).unwrap();
            prop_assert!(periods.is_empty());
        }
    }

    /// A monthly schedule's pay date always falls in the month it belongs to,
    /// clamped when the requested day overruns — the "pay on the 31st in
    /// February" case.
    #[test]
    fn monthly_pay_date_is_clamped_into_its_month(day in pay_day(), y in 2015i32..2035) {
        let start = NaiveDate::from_ymd_opt(y, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(y, 12, 31).unwrap();
        let periods = generate_pay_periods(&GeneratePeriodsInput {
            schedule_type: PayScheduleType::Monthly,
            anchor_date: None,
            first_pay_day: Some(day),
            second_pay_day: None,
            range_start: start,
            range_end: end,
        }).unwrap();

        prop_assert_eq!(periods.len(), 12, "a full year must yield 12 monthly periods");
        for p in &periods {
            prop_assert_eq!(p.pay_date.month(), p.period_num);
            prop_assert!(p.pay_date.day() <= day, "pay day was moved forward, not clamped");
            prop_assert!(p.pay_date >= p.start_date && p.pay_date <= p.end_date);
        }
    }

    /// Any date inside a generated period is found by `find_period_for_date`,
    /// and the period it returns actually contains it.
    #[test]
    fn find_period_locates_a_containing_period(
        cfg in schedule_and_config(), a in a_date(), b in a_date()
    ) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        let periods = generate_pay_periods(&build(cfg, start, end)).unwrap();
        for p in periods.iter().take(8) {
            let found = find_period_for_date(p.start_date, &periods);
            prop_assert!(found.is_some());
            let f = found.unwrap();
            prop_assert!(f.start_date <= p.start_date && p.start_date <= f.end_date);
        }
    }

    /// A missing anchor is an error, never a silently empty schedule — the
    /// difference between "you forgot to configure this" and "you are not paid".
    #[test]
    fn missing_anchor_is_an_error(a in a_date(), b in a_date()) {
        let (start, end) = if a <= b { (a, b) } else { (b, a) };
        for ty in [PayScheduleType::Weekly, PayScheduleType::Biweekly] {
            let r = generate_pay_periods(&GeneratePeriodsInput {
                schedule_type: ty, anchor_date: None,
                first_pay_day: None, second_pay_day: None,
                range_start: start, range_end: end,
            });
            prop_assert!(r.is_err());
        }
    }
}
