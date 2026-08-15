//! When a recurring item falls due.
//!
//! Port of `occurrences` / `applyWeekendShift` from
//! `apps/api/src/lib/recurring.ts`, plus the weekday helpers from
//! `weekday-calc.ts`.
//!
//! Pure date arithmetic with the window passed in, so it is testable without a
//! database and without a clock. The TypeScript reaches for `new Date()` in
//! several sibling functions; every date here is an argument.
//!
//! # `NaiveDate` removes an entire bug class
//!
//! ADR-003 and the "Pre-history" UTC entry exist because a single local-time
//! `Date` constructor shifted 243 pay periods by a day and needed a production
//! migration. `NaiveDate` has no timezone to get wrong, so that failure is not
//! available here — which is why this module has no UTC ceremony at all.

use chrono::{Datelike, Duration, NaiveDate, Weekday};

/// How a recurring item repeats. `OneTime` never yields — it is not recurring,
/// and the generator filters it out before reaching here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recurrence {
    OneTime,
    Weekly,
    Biweekly,
    SemiMonthly,
    Monthly,
    Quarterly,
    Biannual,
    Annual,
}

impl Recurrence {
    pub fn from_stored(s: &str) -> Option<Self> {
        Some(match s {
            "ONE_TIME" => Recurrence::OneTime,
            "WEEKLY" => Recurrence::Weekly,
            "BIWEEKLY" => Recurrence::Biweekly,
            "SEMI_MONTHLY" => Recurrence::SemiMonthly,
            "MONTHLY" => Recurrence::Monthly,
            "QUARTERLY" => Recurrence::Quarterly,
            "BIANNUAL" => Recurrence::Biannual,
            "ANNUAL" => Recurrence::Annual,
            _ => return None,
        })
    }
}

/// Which day of the month an item is due, in the three ways it can be stated.
#[derive(Debug, Clone, Copy, Default)]
pub struct DueRule {
    /// "the 15th". Clamped to the month's length, so 31 lands on the 28th in
    /// February rather than rolling into March.
    pub day: Option<u32>,
    /// 0 = Sunday. Paired with `ordinal`.
    pub weekday: Option<u32>,
    /// 1 = first, 2 = second, … and **0 means EVERY** matching weekday, which
    /// is how "every Friday" is expressed on a monthly item.
    pub ordinal: Option<i32>,
}

/// The anchor for a biweekly item with no start date of its own: the global
/// pay-schedule anchor.
const BIWEEKLY_FALLBACK_ANCHOR: (i32, u32, u32) = (2026, 3, 20);

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (y, m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(y, m, 1)
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

/// The given day of a month, clamped to the month's length.
///
/// A bill due on the 31st is due on the 28th in February — not the 3rd of
/// March, which is what letting the date roll over would produce.
fn clamp_day(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(year, month, day.min(last_day_of_month(year, month)))
}

fn weekday_from(n: u32) -> Weekday {
    match n % 7 {
        0 => Weekday::Sun,
        1 => Weekday::Mon,
        2 => Weekday::Tue,
        3 => Weekday::Wed,
        4 => Weekday::Thu,
        5 => Weekday::Fri,
        _ => Weekday::Sat,
    }
}

/// Every occurrence of one weekday in a month.
pub fn all_weekdays_of_month(year: i32, month: u32, weekday: u32) -> Vec<NaiveDate> {
    let target = weekday_from(weekday);
    let last = last_day_of_month(year, month);
    (1..=last)
        .filter_map(|d| NaiveDate::from_ymd_opt(year, month, d))
        .filter(|d| d.weekday() == target)
        .collect()
}

/// The nth occurrence of a weekday in a month.
///
/// `n = -1` means the LAST one, which is how "the last Friday" is expressed.
/// Returns `None` when the month has no nth occurrence — a fifth Friday does
/// not exist every month, and inventing one would put a bill in the wrong week.
pub fn nth_weekday_of_month(year: i32, month: u32, weekday: u32, n: i32) -> Option<NaiveDate> {
    let all = all_weekdays_of_month(year, month, weekday);
    if n < 0 {
        return all.last().copied();
    }
    all.get((n as usize).checked_sub(1)?).copied()
}

/// Shift a weekend date to the following Monday.
///
/// Only when the item asks for it: a bill due Saturday is often paid Monday,
/// but an item that genuinely falls on a weekend should not be silently moved.
pub fn apply_weekend_shift(date: NaiveDate, skip_weekend: bool) -> NaiveDate {
    if !skip_weekend {
        return date;
    }
    match date.weekday() {
        Weekday::Sat => date + Duration::days(2),
        Weekday::Sun => date + Duration::days(1),
        _ => date,
    }
}

/// Advance one calendar month, keeping the year in step.
fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

/// Every due date for one recurring item inside `[from, to]`.
///
/// `start`/`end` narrow the window: an item that begins in June yields nothing
/// in May, and one that ended last year yields nothing at all.
pub fn occurrences(
    recurrence: Recurrence,
    due: DueRule,
    start: Option<NaiveDate>,
    end: Option<NaiveDate>,
    from: NaiveDate,
    to: NaiveDate,
) -> Vec<NaiveDate> {
    let range_start = start.filter(|s| *s > from).unwrap_or(from);
    let range_end = end.filter(|e| *e < to).unwrap_or(to);
    if range_start > range_end {
        return Vec::new();
    }

    // The due date(s) within one month, in whichever way the item states them.
    let monthly = |year: i32, month: u32| -> Vec<NaiveDate> {
        if let (Some(wd), Some(ord)) = (due.weekday, due.ordinal) {
            // Ordinal 0 means EVERY matching weekday — "every Friday".
            if ord == 0 {
                return all_weekdays_of_month(year, month, wd);
            }
            return nth_weekday_of_month(year, month, wd, ord)
                .into_iter()
                .collect();
        }
        due.day
            .and_then(|d| clamp_day(year, month, d))
            .into_iter()
            .collect()
    };

    let mut out = Vec::new();
    let push_if_in_range = |d: NaiveDate, out: &mut Vec<NaiveDate>| {
        if d >= range_start && d <= range_end {
            out.push(d);
        }
    };

    match recurrence {
        Recurrence::OneTime => {}

        Recurrence::Weekly => {
            // Anchored to Sunday, matching the TypeScript.
            let mut d = range_start;
            while d.weekday() != Weekday::Sun {
                d += Duration::days(1);
            }
            while d <= range_end {
                out.push(d);
                d += Duration::days(7);
            }
        }

        Recurrence::Biweekly => {
            // Anchored on the item's own start date when it has one. Without
            // that, every biweekly item in the app would land on the same
            // fortnight regardless of when it actually began.
            let anchor = start.unwrap_or_else(|| {
                let (y, m, d) = BIWEEKLY_FALLBACK_ANCHOR;
                NaiveDate::from_ymd_opt(y, m, d).expect("valid anchor")
            });
            let mut d = anchor;
            while d > range_start {
                d -= Duration::days(14);
            }
            while d < range_start {
                d += Duration::days(14);
            }
            while d <= range_end {
                out.push(d);
                d += Duration::days(14);
            }
        }

        Recurrence::Monthly => {
            let (mut y, mut m) = (range_start.year(), range_start.month());
            while y < range_end.year() || (y == range_end.year() && m <= range_end.month()) {
                for d in monthly(y, m) {
                    push_if_in_range(d, &mut out);
                }
                (y, m) = next_month(y, m);
            }
        }

        Recurrence::Quarterly | Recurrence::Biannual => {
            // The cycle is anchored on the START month, not on January. A
            // quarterly bill beginning in February is due Feb/May/Aug/Nov.
            let step = if recurrence == Recurrence::Quarterly {
                3
            } else {
                6
            };
            let start_month = start.map(|s| s.month()).unwrap_or(1);
            let months: Vec<u32> = (0..(12 / step))
                .map(|i| ((start_month - 1 + i * step) % 12) + 1)
                .collect();

            let (mut y, mut m) = (range_start.year(), range_start.month());
            while y < range_end.year() || (y == range_end.year() && m <= range_end.month()) {
                if months.contains(&m) {
                    for d in monthly(y, m) {
                        push_if_in_range(d, &mut out);
                    }
                }
                (y, m) = next_month(y, m);
            }
        }

        Recurrence::Annual => {
            // Needs a start date to know WHICH month. Without one there is no
            // answer, so it yields nothing rather than guessing January.
            let Some(s) = start else { return out };
            let day = due.day.unwrap_or_else(|| s.day());
            for y in range_start.year()..=range_end.year() {
                if let Some(d) = clamp_day(y, s.month(), day) {
                    push_if_in_range(d, &mut out);
                }
            }
        }

        Recurrence::SemiMonthly => {
            // Twice a month: the stated day and the 15th.
            let first_day = due.day.unwrap_or(1);
            let (mut y, mut m) = (range_start.year(), range_start.month());
            while y < range_end.year() || (y == range_end.year() && m <= range_end.month()) {
                if let Some(d) = clamp_day(y, m, first_day) {
                    push_if_in_range(d, &mut out);
                }
                if let Some(d) = clamp_day(y, m, 15) {
                    push_if_in_range(d, &mut out);
                }
                (y, m) = next_month(y, m);
            }
        }
    }

    out.sort_unstable();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn day_rule(n: u32) -> DueRule {
        DueRule {
            day: Some(n),
            ..Default::default()
        }
    }

    #[test]
    fn a_monthly_bill_lands_on_its_day_each_month() {
        let got = occurrences(
            Recurrence::Monthly,
            day_rule(15),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 3, 31),
        );
        assert_eq!(got, vec![d(2026, 1, 15), d(2026, 2, 15), d(2026, 3, 15)]);
    }

    #[test]
    fn the_31st_clamps_rather_than_rolling_into_the_next_month() {
        let got = occurrences(
            Recurrence::Monthly,
            day_rule(31),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 4, 30),
        );
        // February has no 31st. Letting the date roll would put the bill on
        // 3 March — a different month, which breaks every month-based rollup.
        assert_eq!(
            got,
            vec![
                d(2026, 1, 31),
                d(2026, 2, 28),
                d(2026, 3, 31),
                d(2026, 4, 30)
            ]
        );
    }

    #[test]
    fn february_29_exists_in_a_leap_year() {
        let got = occurrences(
            Recurrence::Monthly,
            day_rule(31),
            None,
            None,
            d(2028, 2, 1),
            d(2028, 2, 29),
        );
        assert_eq!(got, vec![d(2028, 2, 29)]);
    }

    #[test]
    fn a_start_date_narrows_the_window_and_an_end_date_closes_it() {
        let got = occurrences(
            Recurrence::Monthly,
            day_rule(10),
            Some(d(2026, 3, 1)),
            Some(d(2026, 5, 31)),
            d(2026, 1, 1),
            d(2026, 12, 31),
        );
        assert_eq!(got, vec![d(2026, 3, 10), d(2026, 4, 10), d(2026, 5, 10)]);
    }

    #[test]
    fn an_item_that_has_not_started_yields_nothing() {
        let got = occurrences(
            Recurrence::Monthly,
            day_rule(10),
            Some(d(2027, 1, 1)),
            None,
            d(2026, 1, 1),
            d(2026, 12, 31),
        );
        assert!(got.is_empty());
    }

    #[test]
    fn biweekly_anchors_on_the_items_own_start_date() {
        // Anchored 2026-01-02, so 16 Jan, 30 Jan, 13 Feb.
        let got = occurrences(
            Recurrence::Biweekly,
            DueRule::default(),
            Some(d(2026, 1, 2)),
            None,
            d(2026, 1, 1),
            d(2026, 2, 20),
        );
        assert_eq!(
            got,
            vec![
                d(2026, 1, 2),
                d(2026, 1, 16),
                d(2026, 1, 30),
                d(2026, 2, 13)
            ]
        );
    }

    #[test]
    fn biweekly_walks_backward_from_the_fallback_anchor() {
        // With no start date the anchor is the global pay-schedule date
        // (2026-03-20), which is AFTER this window. The backward walk is what
        // lets the fortnight still land correctly in January — without it the
        // item yields nothing for a period it was genuinely due in.
        let got = occurrences(
            Recurrence::Biweekly,
            DueRule::default(),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 1, 31),
        );
        // 2026-03-20 stepped back by fortnights: 3-06, 2-20, 2-06, 1-23, 1-09.
        assert_eq!(got, vec![d(2026, 1, 9), d(2026, 1, 23)]);
    }

    #[test]
    fn a_start_date_is_a_lower_bound_as_well_as_an_anchor() {
        // An item that begins in June is not due in May, even though the
        // fortnightly rhythm would otherwise reach back there. `start` bounds
        // the window; it does not merely phase it.
        let got = occurrences(
            Recurrence::Biweekly,
            DueRule::default(),
            Some(d(2026, 6, 5)),
            None,
            d(2026, 5, 1),
            d(2026, 5, 31),
        );
        assert!(got.is_empty());
    }

    #[test]
    fn weekly_lands_on_sundays() {
        let got = occurrences(
            Recurrence::Weekly,
            DueRule::default(),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 1, 31),
        );
        assert!(got.iter().all(|x| x.weekday() == Weekday::Sun));
        assert_eq!(got.first(), Some(&d(2026, 1, 4)));
    }

    #[test]
    fn quarterly_counts_from_the_start_month_not_from_january() {
        // Beginning in February means Feb/May/Aug/Nov, not Jan/Apr/Jul/Oct.
        let got = occurrences(
            Recurrence::Quarterly,
            day_rule(1),
            Some(d(2026, 2, 1)),
            None,
            d(2026, 1, 1),
            d(2026, 12, 31),
        );
        assert_eq!(
            got,
            vec![d(2026, 2, 1), d(2026, 5, 1), d(2026, 8, 1), d(2026, 11, 1)]
        );
    }

    #[test]
    fn biannual_is_six_months_from_the_start() {
        let got = occurrences(
            Recurrence::Biannual,
            day_rule(1),
            Some(d(2026, 3, 1)),
            None,
            d(2026, 1, 1),
            d(2026, 12, 31),
        );
        assert_eq!(got, vec![d(2026, 3, 1), d(2026, 9, 1)]);
    }

    #[test]
    fn annual_needs_a_start_date_and_yields_nothing_without_one() {
        let none = occurrences(
            Recurrence::Annual,
            day_rule(1),
            None,
            None,
            d(2026, 1, 1),
            d(2027, 12, 31),
        );
        assert!(
            none.is_empty(),
            "guessing January would be worse than nothing"
        );

        let got = occurrences(
            Recurrence::Annual,
            DueRule::default(),
            Some(d(2024, 7, 4)),
            None,
            d(2026, 1, 1),
            d(2027, 12, 31),
        );
        assert_eq!(got, vec![d(2026, 7, 4), d(2027, 7, 4)]);
    }

    #[test]
    fn semi_monthly_pays_twice_a_month() {
        let got = occurrences(
            Recurrence::SemiMonthly,
            day_rule(1),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 2, 28),
        );
        assert_eq!(
            got,
            vec![d(2026, 1, 1), d(2026, 1, 15), d(2026, 2, 1), d(2026, 2, 15)]
        );
    }

    #[test]
    fn the_nth_weekday_rule_finds_the_right_week() {
        // Third Tuesday of March 2026.
        let got = occurrences(
            Recurrence::Monthly,
            DueRule {
                day: None,
                weekday: Some(2),
                ordinal: Some(3),
            },
            None,
            None,
            d(2026, 3, 1),
            d(2026, 3, 31),
        );
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].weekday(), Weekday::Tue);
        assert_eq!(got[0], d(2026, 3, 17));
    }

    #[test]
    fn ordinal_zero_means_every_matching_weekday() {
        let got = occurrences(
            Recurrence::Monthly,
            DueRule {
                day: None,
                weekday: Some(5),
                ordinal: Some(0),
            },
            None,
            None,
            d(2026, 5, 1),
            d(2026, 5, 31),
        );
        // Every Friday in May 2026 — five of them.
        assert_eq!(got.len(), 5);
        assert!(got.iter().all(|x| x.weekday() == Weekday::Fri));
    }

    #[test]
    fn a_fifth_weekday_that_does_not_exist_yields_nothing_rather_than_the_fourth() {
        // February 2026 has four Sundays. Asking for the fifth must not
        // silently return the fourth and put a bill in the wrong week.
        let got = occurrences(
            Recurrence::Monthly,
            DueRule {
                day: None,
                weekday: Some(0),
                ordinal: Some(5),
            },
            None,
            None,
            d(2026, 2, 1),
            d(2026, 2, 28),
        );
        assert!(got.is_empty());
    }

    #[test]
    fn the_last_weekday_is_addressable() {
        let got = nth_weekday_of_month(2026, 5, 5, -1);
        assert_eq!(got, Some(d(2026, 5, 29)), "the last Friday of May 2026");
    }

    #[test]
    fn the_weekend_shift_only_applies_when_asked() {
        let saturday = d(2026, 5, 2);
        let sunday = d(2026, 5, 3);
        assert_eq!(apply_weekend_shift(saturday, true), d(2026, 5, 4));
        assert_eq!(apply_weekend_shift(sunday, true), d(2026, 5, 4));
        assert_eq!(apply_weekend_shift(saturday, false), saturday);
        // A weekday is never moved.
        assert_eq!(apply_weekend_shift(d(2026, 5, 1), true), d(2026, 5, 1));
    }

    #[test]
    fn one_time_never_recurs() {
        let got = occurrences(
            Recurrence::OneTime,
            day_rule(1),
            None,
            None,
            d(2026, 1, 1),
            d(2026, 12, 31),
        );
        assert!(got.is_empty());
    }
}
