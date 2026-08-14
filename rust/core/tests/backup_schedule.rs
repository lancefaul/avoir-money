//! When a scheduled backup is due.

use avoir_core::backup_schedule::{is_due, Due, Frequency};
use chrono::{Local, NaiveDate, TimeZone};

/// A local timestamp, so the calendar-day comparison is exercised in the same
/// zone the real code uses.
fn at(date: &str, hour: u32, min: u32) -> chrono::DateTime<Local> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
    Local
        .from_local_datetime(&d.and_hms_opt(hour, min, 0).unwrap())
        .single()
        .expect("an unambiguous local time")
}

#[test]
fn a_schedule_that_is_off_never_runs() {
    assert_eq!(
        is_due(false, "DAILY", None, at("2026-08-10", 9, 0)),
        Due::Disabled
    );
}

#[test]
fn turning_the_schedule_on_takes_a_backup_immediately() {
    // The first backup is the one most likely to matter, because until it
    // exists the user has none at all. Waiting a day for it would leave the
    // riskiest window uncovered.
    assert_eq!(
        is_due(true, "DAILY", None, at("2026-08-10", 9, 0)),
        Due::Yes
    );
    assert_eq!(
        is_due(true, "WEEKLY", None, at("2026-08-10", 9, 0)),
        Due::Yes
    );
}

#[test]
fn a_second_run_on_the_same_day_is_not_due() {
    let last = at("2026-08-10", 9, 0);
    assert_eq!(
        is_due(true, "DAILY", Some(last), at("2026-08-10", 23, 59)),
        Due::NotYet
    );
}

#[test]
fn opening_the_app_on_a_new_day_is_what_triggers_a_daily_backup() {
    // The reason this is a calendar comparison rather than elapsed hours. At
    // 08:59 the next morning only 23h59m have passed, so a 24-hour rule would
    // decline — and then decline again slightly later each day, skipping days
    // entirely for anyone with a routine.
    let last = at("2026-08-10", 9, 0);
    assert_eq!(
        is_due(true, "DAILY", Some(last), at("2026-08-11", 8, 59)),
        Due::Yes
    );
}

#[test]
fn a_backup_a_minute_before_midnight_still_lets_the_next_day_run() {
    // The pathological case for a calendar rule, and it is the right answer: a
    // backup at 23:59 and another at 00:01 are two different days of data, even
    // though two minutes separate them.
    let last = at("2026-08-10", 23, 59);
    assert_eq!(
        is_due(true, "DAILY", Some(last), at("2026-08-11", 0, 1)),
        Due::Yes
    );
}

#[test]
fn weekly_waits_seven_calendar_days() {
    let last = at("2026-08-10", 9, 0);
    for (day, expected) in [
        ("2026-08-11", Due::NotYet),
        ("2026-08-16", Due::NotYet),
        ("2026-08-17", Due::Yes),
        ("2026-09-01", Due::Yes),
    ] {
        assert_eq!(
            is_due(true, "WEEKLY", Some(last), at(day, 9, 0)),
            expected,
            "on {day}"
        );
    }
}

#[test]
fn a_long_absence_produces_exactly_one_backup_not_one_per_missed_day() {
    // Opening the app after three weeks away takes ONE backup. There is no
    // backlog to work through: the data did not change while the app was shut,
    // so the missed runs would all have been identical to the last one.
    let last = at("2026-07-20", 9, 0);
    assert_eq!(
        is_due(true, "DAILY", Some(last), at("2026-08-10", 9, 0)),
        Due::Yes
    );
}

#[test]
fn a_clock_that_went_backwards_does_not_back_up_on_every_launch() {
    // A timezone move or an NTP step can leave the last run in the future.
    // Treating that as due would take a backup every single launch until real
    // time caught up.
    let last = at("2026-08-10", 9, 0);
    assert_eq!(
        is_due(true, "DAILY", Some(last), at("2026-08-01", 9, 0)),
        Due::NotYet
    );
}

#[test]
fn a_frequency_this_build_cannot_read_stops_the_schedule() {
    // Rejected rather than defaulted. A config naming a cadence this code does
    // not understand should not quietly get some other cadence — most likely it
    // was written by a newer version, and guessing would be worse than pausing.
    assert_eq!(
        is_due(true, "HOURLY", None, at("2026-08-10", 9, 0)),
        Due::UnknownFrequency
    );
    assert_eq!(
        is_due(true, "", None, at("2026-08-10", 9, 0)),
        Due::UnknownFrequency
    );
}

#[test]
fn only_yes_is_a_reason_to_run() {
    assert!(Due::Yes.should_run());
    for d in [
        Due::Disabled,
        Due::NotYet,
        Due::UnknownFrequency,
        Due::Unavailable,
    ] {
        assert!(!d.should_run(), "{d:?}");
    }
}

#[test]
fn the_frequencies_are_the_two_the_schema_permits() {
    assert_eq!(Frequency::parse("DAILY"), Some(Frequency::Daily));
    assert_eq!(Frequency::parse("WEEKLY"), Some(Frequency::Weekly));
    assert_eq!(Frequency::parse("MONTHLY"), None);
    assert_eq!(Frequency::Daily.days(), 1);
    assert_eq!(Frequency::Weekly.days(), 7);
}
