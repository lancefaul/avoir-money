//! Which reading governs an occurrence, and what key its amount override uses.
//!
//! Port of `apps/api/src/lib/schedule-amount-resolver.ts`. The Rust generator
//! shipped with a **calendar-month** match instead of these rules, which is a
//! narrower relation than the original and produced phantom bills: an occurrence
//! that should have been pulled onto the previous month's reading — where a PAID
//! row was waiting to suppress it — stayed on its computed date and rendered as
//! overdue. the water utility showed an 08/03 bill that had been paid on 07/31.
//!
//! # The window is what makes a bill's own date win
//!
//! A metered utility does not bill on the recurring item's generic `dueDay`. It
//! bills when the meter was read, which drifts a few days each cycle and
//! routinely lands in the *previous* calendar month — a bill due 06/30 is the one
//! a 07/01 occurrence is about. Matching on the month cannot see that; matching
//! on distance can.
//!
//! ±15 days is half a monthly cycle, so at most one reading can win and the
//! nearest one is unambiguously the right bill.
//!
//! # Two lookups, deliberately not one
//!
//! [`resolve_utility_due_date`] considers only readings that carry a `dueDate`;
//! [`resolve_expected_amount`] falls back to `billDate` when a reading has no
//! `dueDate`. Collapsing them into a single "find the reading" helper reads like
//! an obvious simplification and is wrong: a reading with only a bill date must
//! still price the occurrence, but must never *move* it, because a bill date is
//! when the meter was read rather than when the money is owed.

use crate::money::Cents;
use crate::occurrences::Recurrence;
use chrono::{Datelike, NaiveDate};

/// How far a reading may sit from an occurrence and still be its bill.
///
/// Half a monthly cycle: wide enough for the normal drift in a meter-read date,
/// narrow enough that two consecutive readings can never both match.
pub const MATCH_WINDOW_DAYS: i64 = 15;

/// A reading, reduced to what resolution actually needs.
#[derive(Debug, Clone, Copy)]
pub struct ReadingDates {
    /// When payment is owed. Absent on readings entered before the bill arrived.
    pub due_date: Option<NaiveDate>,
    /// When the meter was read. Always present.
    pub bill_date: NaiveDate,
}

/// Index of the nearest candidate within the window, if any.
///
/// `None` entries are skipped, which is how the due-date lookup excludes
/// readings that have no due date without needing a second code path.
///
/// **Ties go to the earlier entry**, matching the original's strict `<`. It is
/// reachable — two readings equidistant on either side of an occurrence — and
/// arbitrary either way, so it is pinned rather than left to chance.
fn nearest_within_window(candidates: &[Option<NaiveDate>], target: NaiveDate) -> Option<usize> {
    let mut best: Option<(usize, i64)> = None;
    for (i, c) in candidates.iter().enumerate() {
        let Some(d) = c else { continue };
        let dist = (*d - target).num_days().abs();
        if dist <= MATCH_WINDOW_DAYS && best.is_none_or(|(_, b)| dist < b) {
            best = Some((i, dist));
        }
    }
    best.map(|(i, _)| i)
}

/// The due date this occurrence should actually carry.
///
/// `None` means no reading is close enough and the caller keeps its computed
/// date — the generic `dueDay` is the right answer for a bill that has not been
/// read yet.
pub fn resolve_utility_due_date(
    readings: &[ReadingDates],
    occurrence: NaiveDate,
) -> Option<NaiveDate> {
    let candidates: Vec<Option<NaiveDate>> = readings.iter().map(|r| r.due_date).collect();
    let i = nearest_within_window(&candidates, occurrence)?;
    readings[i].due_date
}

/// The reading that prices this occurrence, by index.
///
/// Unlike the due-date lookup this accepts a reading with no `dueDate`, using
/// its `billDate` to measure distance. See the module note on why these are
/// separate.
pub fn resolve_reading_for_amount(
    readings: &[ReadingDates],
    occurrence: NaiveDate,
) -> Option<usize> {
    let candidates: Vec<Option<NaiveDate>> = readings
        .iter()
        .map(|r| Some(r.due_date.unwrap_or(r.bill_date)))
        .collect();
    nearest_within_window(&candidates, occurrence)
}

/// 1-based count of biweekly periods between the anchor and this occurrence.
///
/// Measured from the anchor rather than from the query window, so the key is the
/// same figure no matter what range the schedule was generated for. A key that
/// depended on the window would give one occurrence two different amounts
/// depending on which page asked for it.
fn absolute_biweekly_index(occurrence: NaiveDate, anchor: NaiveDate) -> i64 {
    let days = (occurrence - anchor).num_days();
    // `Math.round(days / 14) + 1`, in integers. JavaScript rounds a half toward
    // positive infinity, so `floor(x + 1/2)` — not Rust's `f64::round`, which
    // rounds a half away from zero and disagrees on every negative half-step.
    // The two differ at `days ≡ 7 (mod 14)`, which flips the index's parity and
    // therefore selects the *other* amount.
    (2 * days + 14).div_euclid(28) + 1
}

/// The `amountSchedule` key for this occurrence.
///
/// Biweekly alternates between two amounts by position from the anchor;
/// semi-monthly splits on the 15th; everything else is keyed by month.
pub fn amount_schedule_key(
    frequency: Recurrence,
    occurrence: NaiveDate,
    anchor: Option<NaiveDate>,
) -> String {
    match (frequency, anchor) {
        (Recurrence::Biweekly, Some(a)) => {
            let idx = absolute_biweekly_index(occurrence, a);
            // Truncating remainder, matching the original's `% 2 === 1`. A
            // negative index — an occurrence before its own anchor — yields -1,
            // which is not 1, so it takes the second slot. `rem_euclid` would
            // quietly disagree there.
            if idx % 2 == 1 {
                "1".into()
            } else {
                "2".into()
            }
        }
        // Biweekly *without* an anchor falls through to the month key rather
        // than the semi-monthly split, because the original's condition is on
        // the pair. Preserved deliberately: it is reachable via a recurring item
        // with no start date.
        (Recurrence::SemiMonthly, _) => {
            if occurrence.day() <= 15 {
                "1".into()
            } else {
                "2".into()
            }
        }
        _ => occurrence.month().to_string(),
    }
}

/// What this occurrence is expected to cost.
///
/// Priority: the governing utility reading, then the `amountSchedule` override,
/// then the item's base amount. A metered bill differs every cycle, so the
/// stored amount is only ever a fallback.
///
/// `readings` is empty for anything that is not utility-linked — income never
/// has readings at all.
///
/// The override arrives as a lookup rather than a parsed document so this crate
/// stays free of a JSON dependency: the logic worth testing is *which key* to
/// ask for, and that is decided here.
pub fn resolve_expected_amount(
    base: Cents,
    schedule: impl Fn(&str) -> Option<Cents>,
    occurrence: NaiveDate,
    frequency: Recurrence,
    anchor: Option<NaiveDate>,
    readings: &[ReadingDates],
    reading_totals: &[Cents],
) -> Cents {
    if let Some(i) = resolve_reading_for_amount(readings, occurrence) {
        if let Some(total) = reading_totals.get(i) {
            return *total;
        }
    }

    let key = amount_schedule_key(frequency, occurrence, anchor);
    if let Some(v) = schedule(&key) {
        return v;
    }

    base
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn reading(due: Option<NaiveDate>, bill: NaiveDate) -> ReadingDates {
        ReadingDates {
            due_date: due,
            bill_date: bill,
        }
    }

    /// The the water utility case, which is what sent us here.
    ///
    /// A monthly bill due on the 1st, skip-weekend on. August 1st 2026 is a
    /// Saturday, so it shifts to Monday the 3rd — but the bill it is about was
    /// due 07/31 and has already been paid. Resolution must pull it back three
    /// days onto that reading, where the fulfilled-month check suppresses it.
    #[test]
    fn an_occurrence_moves_back_onto_the_previous_months_reading() {
        let readings = [
            reading(Some(d(2026, 7, 31)), d(2026, 7, 31)),
            reading(Some(d(2026, 6, 30)), d(2026, 6, 30)),
        ];
        assert_eq!(
            resolve_utility_due_date(&readings, d(2026, 8, 3)),
            Some(d(2026, 7, 31)),
            "the 08/03 occurrence belongs to the bill due 07/31"
        );
    }

    /// The regression this replaces: a calendar-month match finds nothing in
    /// August and leaves the occurrence stranded on its computed date.
    #[test]
    fn month_matching_would_have_missed_it() {
        let readings = [reading(Some(d(2026, 7, 31)), d(2026, 7, 31))];
        let resolved = resolve_utility_due_date(&readings, d(2026, 8, 3)).unwrap();
        assert_ne!(
            resolved.month(),
            8,
            "the governing reading is in a different calendar month than the occurrence"
        );
    }

    #[test]
    fn nothing_matches_beyond_the_window() {
        let readings = [reading(Some(d(2026, 7, 31)), d(2026, 7, 31))];
        // 16 days: one past the edge.
        assert_eq!(resolve_utility_due_date(&readings, d(2026, 8, 16)), None);
        // 15 days: the boundary itself is inclusive.
        assert_eq!(
            resolve_utility_due_date(&readings, d(2026, 8, 15)),
            Some(d(2026, 7, 31))
        );
    }

    #[test]
    fn the_nearest_reading_wins_not_the_first() {
        let readings = [
            reading(Some(d(2026, 7, 20)), d(2026, 7, 20)),
            reading(Some(d(2026, 7, 30)), d(2026, 7, 30)),
        ];
        assert_eq!(
            resolve_utility_due_date(&readings, d(2026, 8, 1)),
            Some(d(2026, 7, 30))
        );
    }

    #[test]
    fn a_tie_goes_to_the_earlier_reading() {
        let readings = [
            reading(Some(d(2026, 7, 27)), d(2026, 7, 27)),
            reading(Some(d(2026, 8, 6)), d(2026, 8, 6)),
        ];
        assert_eq!(
            resolve_utility_due_date(&readings, d(2026, 8, 1)),
            Some(d(2026, 7, 27)),
            "both are five days out; the first listed wins"
        );
    }

    /// The distinction the two lookups exist for.
    #[test]
    fn a_reading_without_a_due_date_prices_but_does_not_move() {
        let readings = [reading(None, d(2026, 7, 30))];
        assert_eq!(
            resolve_utility_due_date(&readings, d(2026, 8, 1)),
            None,
            "a bill date says when the meter was read, not when money is owed"
        );
        assert_eq!(
            resolve_reading_for_amount(&readings, d(2026, 8, 1)),
            Some(0),
            "but it is still the bill this occurrence is about"
        );
    }

    #[test]
    fn a_reading_with_a_due_date_is_measured_by_it_not_the_bill_date() {
        // Read on the 1st, due on the 20th. An occurrence on the 18th is two
        // days from the due date and seventeen from the bill date; only the
        // former is inside the window.
        let readings = [reading(Some(d(2026, 7, 20)), d(2026, 7, 1))];
        assert_eq!(
            resolve_reading_for_amount(&readings, d(2026, 7, 18)),
            Some(0)
        );
    }

    /// A schedule holding one key, as the generator's closure presents it.
    fn sched(k: &'static str, cents: i64) -> impl Fn(&str) -> Option<Cents> {
        move |q| (q == k).then_some(Cents(cents))
    }

    #[test]
    fn the_reading_total_outranks_the_stored_amount() {
        let readings = [reading(Some(d(2026, 7, 31)), d(2026, 7, 31))];
        let totals = [Cents(2923)];
        let got = resolve_expected_amount(
            Cents(2823),
            // An override exists for August and must lose anyway: the reading
            // is the bill that was actually issued.
            sched("8", 4550),
            d(2026, 8, 3),
            Recurrence::Monthly,
            None,
            &readings,
            &totals,
        );
        assert_eq!(got, Cents(2923), "the metered bill, not the generic amount");
    }

    #[test]
    fn without_a_reading_in_range_the_schedule_override_applies() {
        let got = resolve_expected_amount(
            Cents(2823),
            sched("8", 4550),
            d(2026, 8, 3),
            Recurrence::Monthly,
            None,
            &[],
            &[],
        );
        assert_eq!(got, Cents(4550));
    }

    #[test]
    fn a_month_with_no_override_falls_back_to_the_base_amount() {
        let got = resolve_expected_amount(
            Cents(2823),
            sched("7", 4550),
            d(2026, 8, 3),
            Recurrence::Monthly,
            None,
            &[],
            &[],
        );
        assert_eq!(got, Cents(2823));
    }

    #[test]
    fn semi_monthly_splits_on_the_fifteenth() {
        for (day, key) in [(1, "1"), (15, "1"), (16, "2"), (31, "2")] {
            assert_eq!(
                amount_schedule_key(Recurrence::SemiMonthly, d(2026, 8, day), None),
                key
            );
        }
    }

    #[test]
    fn biweekly_alternates_from_its_anchor() {
        let anchor = d(2026, 1, 1);
        // Index 1, 2, 3, 4 → keys 1, 2, 1, 2.
        for (weeks, key) in [(0, "1"), (2, "2"), (4, "1"), (6, "2")] {
            let occ = anchor + chrono::Duration::weeks(weeks);
            assert_eq!(
                amount_schedule_key(Recurrence::Biweekly, occ, Some(anchor)),
                key,
                "{weeks} weeks after the anchor"
            );
        }
    }

    /// The key must not depend on which window generated the occurrence.
    #[test]
    fn a_biweekly_key_is_stable_far_from_the_anchor() {
        let anchor = d(2026, 1, 1);
        let occ = anchor + chrono::Duration::weeks(52);
        assert_eq!(
            amount_schedule_key(Recurrence::Biweekly, occ, Some(anchor)),
            "1",
            "26 periods out is an odd index, whatever range asked for it"
        );
    }

    /// JavaScript rounds a half toward positive infinity; Rust's `f64::round`
    /// rounds away from zero. They disagree exactly here, and the disagreement
    /// changes which amount is charged.
    #[test]
    fn a_negative_half_step_rounds_the_javascript_way() {
        let anchor = d(2026, 6, 1);
        let occ = anchor - chrono::Duration::days(7);
        // days = -7 → -7/14 = -0.5 → JS rounds to -0 → index 1 → key "1".
        // f64::round would give -1 → index 0 → key "2".
        assert_eq!(
            amount_schedule_key(Recurrence::Biweekly, occ, Some(anchor)),
            "1"
        );
    }

    /// The other half of matching JavaScript: a **negative** index takes the
    /// second slot, because `-1 % 2` is `-1` and not `1`. `rem_euclid` would
    /// return `1` and silently pick the other amount.
    ///
    /// Reaching it needs an occurrence at least three weeks before its own
    /// anchor — one week short is index 1, where every remainder rule agrees,
    /// which is why the neighbouring test does not pin this.
    ///
    /// **Not reachable through the generator today**, since `occurrences` is
    /// bounded below by the same start date used as the anchor. It is pinned
    /// because the function is public and the semantics are ported: if a caller
    /// ever does hand it an earlier date, it should behave like the original
    /// rather than like whichever remainder operator was typed.
    #[test]
    fn an_index_before_the_anchor_takes_the_second_slot() {
        let anchor = d(2026, 6, 1);
        let occ = anchor - chrono::Duration::weeks(4);
        assert_eq!(
            amount_schedule_key(Recurrence::Biweekly, occ, Some(anchor)),
            "2"
        );
    }

    #[test]
    fn biweekly_without_an_anchor_uses_the_month_key() {
        assert_eq!(
            amount_schedule_key(Recurrence::Biweekly, d(2026, 8, 3), None),
            "8",
            "the original keys on the frequency and anchor together"
        );
    }

    #[test]
    fn an_empty_reading_list_is_simply_no_match() {
        assert_eq!(resolve_utility_due_date(&[], d(2026, 8, 3)), None);
        assert_eq!(resolve_reading_for_amount(&[], d(2026, 8, 3)), None);
    }
}
