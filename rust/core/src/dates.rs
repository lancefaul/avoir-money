//! Pay-period generation — port of `packages/core/src/utils/dates.ts`.
//!
//! **The type does the work that discipline used to.** The TypeScript version
//! carries a `Date`, which is an instant, and must therefore be scrupulous
//! about only ever touching it through `getUTC*` — a rule enforced by a banned
//! -pattern list, a hook, and a zero-tolerance section in QUALITY.md. It was
//! enforced that way because it once failed: a single local-time constructor
//! shifted 243 pay periods by a day and needed a production migration (ADR-003
//! and the pre-history UTC entry — "the most expensive bug in the project's
//! history").
//!
//! `NaiveDate` is a calendar date with no time and no zone. There is no local
//! getter to call by mistake, no midnight to fall across, and no instant to
//! reinterpret. The rule does not need enforcing here because it cannot be
//! broken — the same trade as `Cents` making the rounding rule structural.
//!
//! Ported structurally rather than idiomatically so it stays diffable against
//! the original while both exist. Month arithmetic is the one place the two
//! genuinely differ: JavaScript's months are 0-indexed and chrono's are
//! 1-indexed, which is exactly the kind of detail a port gets wrong, so the
//! differential fixture covers every schedule type across year boundaries.

use chrono::{Datelike, Duration, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayScheduleType {
    Weekly,
    Biweekly,
    SemiMonthly,
    Monthly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GeneratedPeriod {
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub pay_date: NaiveDate,
    pub year: i32,
    pub period_num: u32,
}

#[derive(Debug, Clone)]
pub struct GeneratePeriodsInput {
    pub schedule_type: PayScheduleType,
    /// Required for Weekly and Biweekly — a known pay date to step from.
    pub anchor_date: Option<NaiveDate>,
    /// Required for SemiMonthly and Monthly — first pay day of month (1–31).
    pub first_pay_day: Option<u32>,
    /// Required for SemiMonthly — second pay day of month (1–31).
    pub second_pay_day: Option<u32>,
    pub range_start: NaiveDate,
    pub range_end: NaiveDate,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PeriodError {
    MissingAnchorDate(PayScheduleType),
    MissingPayDay(PayScheduleType),
}

impl std::fmt::Display for PeriodError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PeriodError::MissingAnchorDate(t) => {
                write!(f, "anchorDate is required for {t:?} schedules")
            }
            PeriodError::MissingPayDay(t) => {
                write!(f, "pay day(s) required for {t:?} schedules")
            }
        }
    }
}
impl std::error::Error for PeriodError {}

fn add_days(d: NaiveDate, n: i64) -> NaiveDate {
    d + Duration::days(n)
}

/// Last calendar day of the given month. `month` is 1-indexed (chrono).
fn last_day_of_month(year: i32, month: u32) -> NaiveDate {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(ny, nm, 1).expect("valid first-of-month") - Duration::days(1)
}

/// The requested day, or the last day of the month when it overruns —
/// a "pay on the 31st" schedule in February pays on the 28th/29th.
fn clamp_day(year: i32, month: u32, day: u32) -> NaiveDate {
    let last = last_day_of_month(year, month).day();
    NaiveDate::from_ymd_opt(year, month, day.min(last)).expect("clamped day is valid")
}

fn jan_first(year: i32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, 1, 1).expect("Jan 1 is valid")
}

/// Shared body for the two anchor-stepped schedules. `step` is 7 or 14; the
/// period runs `step - 1` days from its pay date.
///
/// `period_num` counts within the calendar year, which is why generation starts
/// at January 1st of the range's start year rather than at the range start —
/// the number of a period in March depends on how many preceded it.
fn generate_stepped(
    anchor: NaiveDate,
    start: NaiveDate,
    end: NaiveDate,
    step: i64,
) -> Vec<GeneratedPeriod> {
    let gen_from = jan_first(start.year());
    let gen_to = add_days(end, step);

    // Walk the anchor back to before gen_from, then forward to the first pay
    // date on or after it, then one step back for safety — same dance as the
    // original, kept deliberately.
    let mut probe = anchor;
    while probe > gen_from {
        probe = add_days(probe, -step);
    }
    while probe < gen_from {
        probe = add_days(probe, step);
    }
    probe = add_days(probe, -step);

    // Collect pay dates per calendar year, in ascending order by construction.
    let mut by_year: Vec<(i32, Vec<NaiveDate>)> = Vec::new();
    let mut pd = probe;
    while pd <= gen_to {
        if pd >= gen_from {
            let y = pd.year();
            match by_year.last_mut() {
                Some((yy, bucket)) if *yy == y => bucket.push(pd),
                _ => by_year.push((y, vec![pd])),
            }
        }
        pd = add_days(pd, step);
    }

    let mut result: Vec<GeneratedPeriod> = Vec::new();
    for (year, pay_dates) in &by_year {
        for (idx, pay_date) in pay_dates.iter().enumerate() {
            if *pay_date >= start && *pay_date <= end {
                result.push(GeneratedPeriod {
                    start_date: *pay_date,
                    end_date: add_days(*pay_date, step - 1),
                    pay_date: *pay_date,
                    year: *year,
                    period_num: idx as u32 + 1,
                });
            }
        }
    }

    result.sort_by_key(|p| p.pay_date);
    result
}

/// Two periods a month: the 1st–14th and the 15th–end, each paid on its
/// configured day. `period_num` runs 1–24 and resets each January.
fn generate_semi_monthly(
    first_pay_day: u32,
    second_pay_day: u32,
    start: NaiveDate,
    end: NaiveDate,
) -> Vec<GeneratedPeriod> {
    let mut result = Vec::new();

    // Starts at January of the range's start year so period_num is right.
    // (The original computes a month-derived period_num first and immediately
    // overwrites it — dead code, not ported.)
    let mut year = start.year();
    let mut month = 1u32;
    let mut period_num = 1u32;

    let end_year = end.year();
    let end_month = end.month();

    while year < end_year || (year == end_year && month <= end_month) {
        let p1_pay = clamp_day(year, month, first_pay_day);
        if p1_pay >= start && p1_pay <= end {
            result.push(GeneratedPeriod {
                start_date: NaiveDate::from_ymd_opt(year, month, 1).unwrap(),
                end_date: NaiveDate::from_ymd_opt(year, month, 14).unwrap(),
                pay_date: p1_pay,
                year,
                period_num,
            });
        }
        period_num += 1;

        let p2_pay = clamp_day(year, month, second_pay_day);
        if p2_pay >= start && p2_pay <= end {
            result.push(GeneratedPeriod {
                start_date: NaiveDate::from_ymd_opt(year, month, 15).unwrap(),
                end_date: last_day_of_month(year, month),
                pay_date: p2_pay,
                year,
                period_num,
            });
        }
        period_num += 1;

        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
            period_num = 1;
        }
    }

    result
}

/// One period per calendar month; `period_num` is the month number.
fn generate_monthly(first_pay_day: u32, start: NaiveDate, end: NaiveDate) -> Vec<GeneratedPeriod> {
    let mut result = Vec::new();
    let mut year = start.year();
    let mut month = 1u32;
    let end_year = end.year();
    let end_month = end.month();

    while year < end_year || (year == end_year && month <= end_month) {
        let pay_date = clamp_day(year, month, first_pay_day);
        if pay_date >= start && pay_date <= end {
            result.push(GeneratedPeriod {
                start_date: NaiveDate::from_ymd_opt(year, month, 1).unwrap(),
                end_date: last_day_of_month(year, month),
                pay_date,
                year,
                period_num: month,
            });
        }
        month += 1;
        if month > 12 {
            month = 1;
            year += 1;
        }
    }

    result
}

/// Generate pay periods for a schedule over a date range. Pure — no I/O.
pub fn generate_pay_periods(
    input: &GeneratePeriodsInput,
) -> Result<Vec<GeneratedPeriod>, PeriodError> {
    let start = input.range_start;
    let end = input.range_end;
    if end < start {
        return Ok(Vec::new());
    }

    match input.schedule_type {
        PayScheduleType::Weekly => {
            let a = input
                .anchor_date
                .ok_or(PeriodError::MissingAnchorDate(PayScheduleType::Weekly))?;
            Ok(generate_stepped(a, start, end, 7))
        }
        PayScheduleType::Biweekly => {
            let a = input
                .anchor_date
                .ok_or(PeriodError::MissingAnchorDate(PayScheduleType::Biweekly))?;
            Ok(generate_stepped(a, start, end, 14))
        }
        PayScheduleType::SemiMonthly => {
            let (f, s) = match (input.first_pay_day, input.second_pay_day) {
                (Some(f), Some(s)) => (f, s),
                _ => return Err(PeriodError::MissingPayDay(PayScheduleType::SemiMonthly)),
            };
            Ok(generate_semi_monthly(f, s, start, end))
        }
        PayScheduleType::Monthly => {
            let f = input
                .first_pay_day
                .ok_or(PeriodError::MissingPayDay(PayScheduleType::Monthly))?;
            Ok(generate_monthly(f, start, end))
        }
    }
}

/// The period containing `date`, or `None` if no supplied period covers it.
pub fn find_period_for_date(
    date: NaiveDate,
    periods: &[GeneratedPeriod],
) -> Option<GeneratedPeriod> {
    periods
        .iter()
        .find(|p| p.start_date <= date && date <= p.end_date)
        .copied()
}

/// Normalise a date string into the storage format: `%Y-%m-%dT%H:%M:%S%.3fZ`.
///
/// Every date column in this database is TEXT, and **SQLite compares TEXT
/// lexicographically**. That is fine while every value has the same shape and
/// silently wrong the moment one does not: `'2026-08-10'` is a prefix of
/// `'2026-08-10T00:00:00.000Z'`, so it sorts *below* every same-day row. A
/// transaction entered through the form landed at the bottom of the list for
/// exactly that reason — the browser's date input sends a bare `YYYY-MM-DD` and
/// it was stored verbatim beside 2,545 full timestamps.
///
/// Display order is the mild symptom. The balance chain orders by
/// `(date, createdAt, id)`, so a row whose date sorts wrongly takes its
/// `balanceBefore`/`balanceAfter` from the wrong neighbour — the ADR-014 chain
/// computed against a sequence that is not the real one.
///
/// **A bare date becomes UTC midnight**, which is the project's rule for a
/// calendar date (ADR-003) and what every stored value already is. This is the
/// deliberate difference from the importer's `canonical_timestamp`, which
/// refuses bare dates: there, the input might be a note that merely looks like a
/// date; here, the caller has told us this is a date column.
///
/// Returns `None` for anything unparseable, so a caller can reject rather than
/// invent a timestamp.
pub fn canonical_date(s: &str) -> Option<String> {
    use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
    const OUT: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

    // Offsets are honoured and converted, not truncated, so a value carrying
    // `+02:00` lands on the correct instant rather than two hours early.
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc).format(OUT).to_string());
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt.format(OUT).to_string());
        }
    }
    // The case the importer refuses and this one exists for.
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.format("%Y-%m-%dT00:00:00.000Z").to_string());
    }
    None
}

#[cfg(test)]
mod canonical_date_tests {
    use super::canonical_date;

    /// The case that put a transaction at the bottom of the list.
    #[test]
    fn a_bare_date_becomes_utc_midnight() {
        assert_eq!(
            canonical_date("2026-08-10").as_deref(),
            Some("2026-08-10T00:00:00.000Z")
        );
    }

    /// And the reason it matters: the result must sort beside its neighbours.
    #[test]
    fn the_result_sorts_with_the_stored_format() {
        let fixed = canonical_date("2026-08-10").unwrap();
        assert!(
            fixed.as_str() > "2026-08-09T00:00:00.000Z",
            "later day sorts later"
        );
        assert!(
            fixed.as_str() >= "2026-08-10T00:00:00.000Z",
            "same day no longer sorts below itself"
        );
        // The bug, stated directly.
        assert!(
            "2026-08-10" < "2026-08-10T00:00:00.000Z",
            "a bare date is a prefix and therefore sorts lower — this is why \
             canonicalising is required, not cosmetic"
        );
    }

    #[test]
    fn an_already_canonical_value_is_unchanged() {
        let s = "2026-08-10T00:00:00.000Z";
        assert_eq!(canonical_date(s).as_deref(), Some(s));
    }

    #[test]
    fn an_offset_is_converted_rather_than_truncated() {
        assert_eq!(
            canonical_date("2026-08-10T02:00:00+02:00").as_deref(),
            Some("2026-08-10T00:00:00.000Z")
        );
    }

    #[test]
    fn a_space_separated_timestamp_is_accepted() {
        assert_eq!(
            canonical_date("2026-08-10 13:45:00").as_deref(),
            Some("2026-08-10T13:45:00.000Z")
        );
    }

    #[test]
    fn nonsense_is_refused_rather_than_invented() {
        for s in ["", "not a date", "08/10/2026", "2026-13-45"] {
            assert_eq!(canonical_date(s), None, "{s:?} must not parse");
        }
    }
}

/// Which zone answers "what day is it".
///
/// A seam, not a feature. Today the answer is always the machine's zone,
/// because a single-user desktop app runs where its user is. It exists so that
/// a per-user or per-request zone — the moment one process serves more than one
/// person — is a change here rather than at every call site again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    /// The machine's configured zone. Honours DST via the system tz database.
    System,
    /// A fixed offset from UTC. Does NOT observe DST, so it is for tests and
    /// for a caller that genuinely means a fixed offset — not a substitute for
    /// a named zone.
    Fixed(chrono::FixedOffset),
}

/// The zone the app answers date questions in.
///
/// `AVOIR_TZ` overrides it as `±HH:MM`, which exists so a test or a support
/// session can reproduce a user's day without changing the machine's clock.
/// Anything unparseable falls back to the system zone rather than failing: a
/// bad environment variable should not stop the app knowing what day it is.
pub fn app_zone() -> Zone {
    match std::env::var("AVOIR_TZ") {
        Ok(v) => parse_offset(&v).map(Zone::Fixed).unwrap_or(Zone::System),
        Err(_) => Zone::System,
    }
}

/// `+09:00` / `-05:00` / `+0930` into an offset.
fn parse_offset(s: &str) -> Option<chrono::FixedOffset> {
    let s = s.trim();
    let (sign, rest) = match s.as_bytes().first()? {
        b'+' => (1, &s[1..]),
        b'-' => (-1, &s[1..]),
        _ => return None,
    };
    let digits: String = rest.chars().filter(|c| c.is_ascii_digit()).collect();
    let (h, m) = match digits.len() {
        2 => (digits.parse::<i32>().ok()?, 0),
        4 => (digits[..2].parse().ok()?, digits[2..].parse().ok()?),
        _ => return None,
    };
    if h > 23 || m > 59 {
        return None;
    }
    chrono::FixedOffset::east_opt(sign * (h * 3600 + m * 60))
}

/// Today, as the calendar day the **user** is living in.
///
/// `Utc::now().date_naive()` is the obvious spelling and it is wrong. It returns
/// the calendar day in UTC, which is not the user's day for a good part of every
/// evening: at 21:17 in America/Chicago it is already 02:17 the next morning in
/// UTC, so the app declares tomorrow, marks today's bills overdue, and rolls the
/// current month a day early on the 31st.
///
/// This is what the TypeScript's `today()` does, and it does it deliberately —
/// it reads the LOCAL calendar fields and stamps them as UTC midnight:
///
/// ```js
/// const now = new Date();
/// return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
/// ```
///
/// Those local getters look like an ADR-003 violation and are the one place the
/// rule inverts. ADR-003 bans local getters on dates that came **out of the
/// database**, because those are stored as UTC midnight and reading them locally
/// shifts the day. This is the opposite direction: turning the wall clock into a
/// calendar day, which is a question only a zone can answer.
///
/// **The distinction to hold on to:** a *timestamp* (`createdAt`, `exportedAt`)
/// is an instant and stays UTC — 62 columns do. A *calendar date* — a
/// transaction's date, a bill's due date, a pay period boundary — has no time
/// and no zone at all, and 24 columns hold those. Calendar dates are never
/// converted between zones; doing so is what moved 243 pay periods by a day.
/// Only this function, turning *now* into *a day*, needs a zone.
pub fn today() -> chrono::NaiveDate {
    today_at(chrono::Utc::now(), app_zone())
}

/// The calendar day a given instant falls on, in a given zone.
///
/// Pure, and takes the instant — so the boundary behaviour is testable without
/// touching the machine clock or its timezone. That is the whole reason this is
/// split out of [`today`].
pub fn today_at(instant: chrono::DateTime<chrono::Utc>, zone: Zone) -> chrono::NaiveDate {
    use chrono::TimeZone;
    match zone {
        Zone::System => chrono::Local
            .from_utc_datetime(&instant.naive_utc())
            .date_naive(),
        Zone::Fixed(off) => instant.with_timezone(&off).date_naive(),
    }
}

#[cfg(test)]
mod today_tests {
    use super::{parse_offset, today_at, Zone};
    use chrono::{FixedOffset, NaiveDate, TimeZone, Utc};

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }
    fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }
    fn chicago() -> Zone {
        Zone::Fixed(FixedOffset::west_opt(5 * 3600).unwrap())
    }

    /// The reported bug, at the instant it was reported.
    ///
    /// 21:17 on the 10th in Chicago is already 02:17 on the 11th in UTC. The
    /// app was answering with the second one.
    #[test]
    fn a_late_evening_is_still_today_locally_and_already_tomorrow_in_utc() {
        let instant = at(2026, 8, 11, 2, 17);
        assert_eq!(
            today_at(instant, chicago()),
            ymd(2026, 8, 10),
            "the user's day"
        );
        assert_eq!(
            instant.date_naive(),
            ymd(2026, 8, 11),
            "what UTC would have said"
        );
    }

    /// The other side of the same boundary: east of UTC, the user is ahead.
    #[test]
    fn an_early_morning_east_of_utc_is_already_tomorrow() {
        let tokyo = Zone::Fixed(FixedOffset::east_opt(9 * 3600).unwrap());
        let instant = at(2026, 8, 10, 22, 0); // 07:00 on the 11th in Tokyo
        assert_eq!(today_at(instant, tokyo), ymd(2026, 8, 11));
    }

    /// Month and year rollovers are where an off-by-one day is most expensive —
    /// it moves the budget month and the year plan, not just a row's position.
    #[test]
    fn the_zone_decides_the_month_and_the_year() {
        assert_eq!(today_at(at(2026, 9, 1, 3, 0), chicago()), ymd(2026, 8, 31));
        assert_eq!(today_at(at(2027, 1, 1, 3, 0), chicago()), ymd(2026, 12, 31));
    }

    #[test]
    fn midday_agrees_everywhere() {
        let instant = at(2026, 8, 10, 12, 0);
        assert_eq!(today_at(instant, chicago()), ymd(2026, 8, 10));
        assert_eq!(instant.date_naive(), ymd(2026, 8, 10));
    }

    #[test]
    fn offsets_parse_in_the_forms_people_write_them() {
        assert_eq!(parse_offset("-05:00"), FixedOffset::west_opt(5 * 3600));
        assert_eq!(parse_offset("+09:00"), FixedOffset::east_opt(9 * 3600));
        assert_eq!(
            parse_offset("+0930"),
            FixedOffset::east_opt(9 * 3600 + 30 * 60)
        );
        assert_eq!(parse_offset("-06"), FixedOffset::west_opt(6 * 3600));
    }

    /// A bad override must not stop the app knowing what day it is.
    #[test]
    fn nonsense_offsets_are_refused_rather_than_guessed() {
        for s in ["", "utc", "America/Chicago", "05:00", "+99:00", "+00:99"] {
            assert_eq!(parse_offset(s), None, "{s:?} must not parse");
        }
    }
}
