//! When a paused recurring item comes back.
//!
//! Ported from `apps/api/src/lib/pause.ts`.
//!
//! # Why this exists at all
//!
//! The port had no equivalent. Its `pause` handler read a `pausedUntil` field
//! off the request body — an API the frontend has never spoken. `PauseModal`
//! sends `{ duration, unit }` or `{ indefinite: true }` and expects the server
//! to work out the date, exactly as the reference does. So `pausedUntil` was
//! always absent, always deserialised to `None`, and pausing a recurring
//! expense wrote NULL: **the button did nothing at all**, quietly, on every
//! click. Found by the write harness on its second run.

use crate::dates::today;
use chrono::{Datelike, NaiveDate};

/// The "paused forever" date: 9999-12-31.
///
/// A sentinel rather than a nullable column because `pausedUntil` already
/// distinguishes "not paused" (NULL) from "paused until X", and indefinite is
/// the second of those with no end in sight. Comparisons then need no special
/// case — `pausedUntil > now` is true for it until the year 9999.
pub fn sentinel() -> NaiveDate {
    NaiveDate::from_ymd_opt(9999, 12, 31).expect("9999-12-31 is a date")
}

/// The date a pause of `duration` `unit`s from today expires.
///
/// Returns `None` when the request specifies neither `indefinite` nor a
/// complete duration+unit pair, which is the reference's `.refine()` rejecting
/// the body.
pub fn compute_paused_until(
    duration: Option<i64>,
    unit: Option<&str>,
    indefinite: bool,
) -> Option<NaiveDate> {
    if indefinite {
        return Some(sentinel());
    }
    let (duration, unit) = (duration?, unit?);
    let from = today();
    match unit {
        "days" => from.checked_add_signed(chrono::Duration::days(duration)),
        "weeks" => from.checked_add_signed(chrono::Duration::days(duration * 7)),
        "months" => Some(add_months_js(from, duration)),
        "years" => Some(add_months_js(from, duration * 12)),
        // Not one of the four the reference's enum allows. The TypeScript's
        // `switch` has no default, so an unknown unit falls through and returns
        // the date unchanged — but it can never get that far, because Zod
        // rejects the body first. Rejecting here is the same outcome.
        _ => None,
    }
}

/// Add months the way JavaScript's `setUTCMonth` does — by OVERFLOWING.
///
/// This deliberately does not reuse `debt::add_months`, which CLAMPS: there,
/// Jan 31 plus a month is Feb 28, because a loan payment due on the 31st is due
/// on the last day of a short month. `setUTCMonth` instead constructs
/// "Feb 31" and lets it roll into March 3, and this function has to match it or
/// a pause set on the 29th, 30th or 31st expires on a different day in the two
/// backends. Same operation by name, opposite answers at the month end, and
/// only one of them is what the reference does.
fn add_months_js(date: NaiveDate, months: i64) -> NaiveDate {
    let total = date.year() as i64 * 12 + (date.month() as i64 - 1) + months;
    let year = total.div_euclid(12) as i32;
    let month = total.rem_euclid(12) as u32 + 1;

    // Day-of-month is kept, then any excess rolls forward — which is what
    // constructing an out-of-range day in JavaScript does.
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("first of a month is a date");
    first + chrono::Duration::days(date.day() as i64 - 1)
}

/// Whether a `pausedUntil` is still in effect.
pub fn is_paused(paused_until: Option<NaiveDate>, now: NaiveDate) -> bool {
    paused_until.is_some_and(|p| p > now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indefinite_is_the_sentinel() {
        assert_eq!(compute_paused_until(None, None, true), Some(sentinel()));
        // And it beats a duration, matching the reference's early return.
        assert_eq!(
            compute_paused_until(Some(3), Some("days"), true),
            Some(sentinel())
        );
    }

    #[test]
    fn an_incomplete_request_yields_nothing() {
        // The reference's `.refine()` requires indefinite=true OR both fields.
        assert_eq!(compute_paused_until(Some(3), None, false), None);
        assert_eq!(compute_paused_until(None, Some("days"), false), None);
        assert_eq!(compute_paused_until(None, None, false), None);
    }

    #[test]
    fn months_overflow_rather_than_clamp() {
        // The whole reason this does not reuse `debt::add_months`. JavaScript:
        //   new Date(Date.UTC(2026,0,31)).setUTCMonth(1) -> 2026-03-03
        let jan31 = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(
            add_months_js(jan31, 1),
            NaiveDate::from_ymd_opt(2026, 3, 3).unwrap(),
            "Feb 31 rolls into March, it does not clamp to Feb 28"
        );
        // An ordinary case, where clamping and overflowing agree.
        let mar15 = NaiveDate::from_ymd_opt(2026, 3, 15).unwrap();
        assert_eq!(
            add_months_js(mar15, 2),
            NaiveDate::from_ymd_opt(2026, 5, 15).unwrap()
        );
    }

    #[test]
    fn years_cross_a_leap_day_the_same_way() {
        // new Date(Date.UTC(2028,1,29)).setUTCFullYear(2029) -> 2029-03-01
        let leap = NaiveDate::from_ymd_opt(2028, 2, 29).unwrap();
        assert_eq!(
            add_months_js(leap, 12),
            NaiveDate::from_ymd_opt(2029, 3, 1).unwrap()
        );
    }

    #[test]
    fn a_pause_in_the_past_is_over() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 11).unwrap();
        assert!(!is_paused(None, now));
        assert!(!is_paused(NaiveDate::from_ymd_opt(2026, 8, 10), now));
        assert!(
            !is_paused(Some(now), now),
            "expiring today is expired: the reference compares with >"
        );
        assert!(is_paused(NaiveDate::from_ymd_opt(2026, 8, 12), now));
        assert!(is_paused(Some(sentinel()), now));
    }
}
