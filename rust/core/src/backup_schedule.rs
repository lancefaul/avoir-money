//! When a scheduled backup is due.
//!
//! Pure: it takes the config, the last run and the current time, and answers
//! yes or no. Nothing here reads a clock or a database, so every boundary case
//! is a unit test rather than something you wait a day to observe.
//!
//! # Calendar days, not elapsed hours
//!
//! "Daily" is measured as *a different local calendar day*, not as 24 hours
//! having passed. Elapsed-time is the obvious implementation and it drifts:
//! someone who opens the app at 9am each morning takes a backup at 09:00, and
//! the next day at 08:59 only 23h59m have passed, so nothing runs. The backup
//! slips to whenever they next open it — later each time — and days get skipped
//! entirely. Comparing calendar days makes "opened the app on a new day" the
//! trigger, which is what a person means by daily.
//!
//! Local time is deliberate here, and is not the thing ADR-003 bans. That rule
//! is about *stored* dates, where a local constructor writes the wrong day into
//! the database. This is a live comparison against the user's own notion of
//! "today" — the same reason `backup::create` already stamps filenames with
//! `chrono::Local`.

use chrono::{DateTime, Local, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Daily,
    Weekly,
}

impl Frequency {
    /// Parse the stored value. Unknown strings are rejected rather than
    /// defaulted: a config that says something this code does not understand
    /// should stop the schedule, not silently pick a cadence nobody chose.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "DAILY" => Some(Frequency::Daily),
            "WEEKLY" => Some(Frequency::Weekly),
            _ => None,
        }
    }

    /// How many calendar days must pass before the next run.
    pub fn days(self) -> i64 {
        match self {
            Frequency::Daily => 1,
            Frequency::Weekly => 7,
        }
    }
}

/// Why a scheduled backup did or did not run.
///
/// An enum rather than a bool because the reasons are worth logging
/// individually — "disabled" and "not due yet" look identical in a boolean and
/// mean very different things when someone is asking why no backups exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Due {
    /// Run one.
    Yes,
    /// The user has not turned the schedule on.
    Disabled,
    /// On, but not enough calendar days have passed.
    NotYet,
    /// On, but `frequency` holds a value this build does not understand.
    UnknownFrequency,
    /// The decision could not be made — the config or the backup history could
    /// not be read.
    ///
    /// Distinct from `Disabled` on purpose. Folding a database error into
    /// "the user turned it off" makes a broken schedule indistinguishable from
    /// one nobody wanted, in the logs and in every test that asserts on the
    /// result. This is the only variant that means something is wrong.
    Unavailable,
}

impl Due {
    pub fn should_run(self) -> bool {
        matches!(self, Due::Yes)
    }
}

/// Decide whether to take a scheduled backup.
///
/// `last_run` is when the most recent SCHEDULED backup completed, or `None` if
/// there has never been one — in which case the answer is yes, so enabling the
/// schedule produces a backup immediately rather than a day later. That first
/// backup is the one most likely to matter, because it is taken before the user
/// has any other.
pub fn is_due(
    enabled: bool,
    frequency: &str,
    last_run: Option<DateTime<Local>>,
    now: DateTime<Local>,
) -> Due {
    if !enabled {
        return Due::Disabled;
    }
    let Some(freq) = Frequency::parse(frequency) else {
        return Due::UnknownFrequency;
    };
    let Some(last) = last_run else {
        return Due::Yes;
    };
    days_between(last.date_naive(), now.date_naive(), freq)
}

fn days_between(last: NaiveDate, today: NaiveDate, freq: Frequency) -> Due {
    // A clock that has gone backwards — a timezone move, a manual correction,
    // an NTP step — leaves `last` in the future. Treating that as "due" would
    // take a backup on every launch until real time caught up, so it counts as
    // not yet. The schedule resumes on its own once the dates make sense again.
    let elapsed = (today - last).num_days();
    if elapsed >= freq.days() {
        Due::Yes
    } else {
        Due::NotYet
    }
}
