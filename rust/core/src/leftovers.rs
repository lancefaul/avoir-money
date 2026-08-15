//! Classifying app rows that did not pair — port of
//! `packages/core/src/reconcile/leftovers.ts` (the parts the matcher needs).
//!
//! **Needed by the backend transitively.** Nothing in `apps/api` imports
//! `classifyLeftovers` by name, so a direct-import survey reports it as
//! frontend-only — but `reconcile` calls it, and `reconcile` is backend-only.
//! See the limitation note in `.kiro/docs/PLACEMENT.md`.
//!
//! The module exists so that both callers reach the SAME verdict. The reconcile
//! UI rebuilds its groups from persisted pairings, which carry no
//! classification, so it must re-derive these rules — and two derivations
//! drifted apart once already.

use crate::money::Cents;
use crate::name_similarity::{day_diff, normalize_name};
use chrono::NaiveDate;
use std::collections::{HashMap, HashSet};

/// Days after the period end within which an unposted row is still expected.
pub const DEFAULT_PENDING_GRACE_DAYS: i64 = 5;
/// How far apart two copies of the same purchase may be dated and still read as
/// one double entry.
pub const DEFAULT_DUPLICATE_WINDOW_DAYS: i64 = 7;
/// How many twinned leftovers it takes before a re-entered period is claimed.
///
/// **This number is the entire safety mechanism.** With the date window
/// dropped, a single leftover with a far-dated matched twin is evidence of
/// nothing — a monthly recurring charge has exactly that shape, and calling it
/// a duplicate is advice to delete a real bill.
pub const DEFAULT_RUN_MIN_ROWS: usize = 5;
/// The widest a single re-entered period may span.
pub const DEFAULT_RUN_MAX_TWIN_SPAN_DAYS: i64 = 45;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeftoverRow {
    pub id: String,
    pub date: NaiveDate,
    pub name: String,
    /// Net of rewards and gift cards — what the bank charged.
    pub amount: Cents,
    /// What the purchase cost before rewards and gift cards, when it differs.
    ///
    /// Duplicate detection uses this, not `amount`: two rows are the same
    /// transaction entered twice only if they are the same *purchase*. Netting
    /// to the same figure by different routes — one paid in full, one part-paid
    /// with rewards — is not a double entry.
    pub gross: Option<Cents>,
}

impl LeftoverRow {
    fn gross_or_amount(&self) -> Cents {
        self.gross.unwrap_or(self.amount)
    }

    /// The identity two rows must share to be the same transaction entered
    /// twice: normalized name, exact cents, exact date.
    fn identity(&self) -> String {
        format!(
            "{}|{}|{}",
            normalize_name(&self.name),
            self.gross_or_amount(),
            self.date
        )
    }
}

/// Same merchant and same purchase price, ignoring the date.
fn same_thing(a: &LeftoverRow, b: &LeftoverRow) -> bool {
    normalize_name(&a.name) == normalize_name(&b.name) && a.gross_or_amount() == b.gross_or_amount()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftoverKind {
    /// An identical app row whose twin already matched a statement line.
    DuplicateInApp,
    /// In the app, not yet posted — within the pending grace window.
    MissingInBankPending,
    /// In the app, absent from the statement, and too old to be pending.
    MissingInBankPhantom,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LeftoverVerdict {
    pub kind: LeftoverKind,
    pub duplicate_of_matched: bool,
    pub in_duplicate_run: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateRun {
    pub rows: Vec<LeftoverRow>,
    pub twins: Vec<LeftoverRow>,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub total: Cents,
}

#[derive(Debug, Clone, Copy)]
pub struct RunOptions {
    pub min_rows: usize,
    pub max_twin_span_days: i64,
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions {
            min_rows: DEFAULT_RUN_MIN_ROWS,
            max_twin_span_days: DEFAULT_RUN_MAX_TWIN_SPAN_DAYS,
        }
    }
}

/// Periods that appear to have been entered twice.
pub fn find_duplicate_runs(
    leftovers: &[LeftoverRow],
    matched: &[LeftoverRow],
    options: RunOptions,
) -> Vec<DuplicateRun> {
    if options.min_rows == 0 || leftovers.is_empty() || matched.is_empty() {
        return Vec::new();
    }

    // Each leftover keeps its NEAREST matched twin: with a month entered twice
    // the same merchant and amount recur, and pairing against an arbitrary one
    // reports a span wider than the mistake actually was.
    let mut candidates: Vec<(&LeftoverRow, &LeftoverRow)> = Vec::new();
    for row in leftovers {
        let mut best: Option<&LeftoverRow> = None;
        for m in matched {
            if !same_thing(m, row) {
                continue;
            }
            match best {
                Some(b) if day_diff(m.date, row.date) >= day_diff(b.date, row.date) => {}
                _ => best = Some(m),
            }
        }
        if let Some(b) = best {
            candidates.push((row, b));
        }
    }
    if candidates.len() < options.min_rows {
        return Vec::new();
    }

    // Greedy split by twin date. Two separate re-entered months fall into
    // separate runs rather than one impossibly wide claim; the span cap does
    // the splitting on its own, so no gap parameter is needed.
    candidates.sort_by_key(|a| a.1.date);

    let mut runs = Vec::new();
    let mut group: Vec<(&LeftoverRow, &LeftoverRow)> = Vec::new();

    let flush = |group: &Vec<(&LeftoverRow, &LeftoverRow)>, runs: &mut Vec<DuplicateRun>| {
        if group.len() < options.min_rows {
            return;
        }
        let mut twin_dates: Vec<NaiveDate> = group.iter().map(|c| c.1.date).collect();
        twin_dates.sort();
        runs.push(DuplicateRun {
            rows: group.iter().map(|c| c.0.clone()).collect(),
            twins: group.iter().map(|c| c.1.clone()).collect(),
            start: twin_dates[0],
            end: *twin_dates.last().unwrap(),
            total: group.iter().map(|c| c.0.amount).sum(),
        });
    };

    for c in &candidates {
        if !group.is_empty() && day_diff(group[0].1.date, c.1.date) > options.max_twin_span_days {
            flush(&group, &mut runs);
            group.clear();
        }
        group.push(*c);
    }
    flush(&group, &mut runs);

    runs
}

/// Classify every unpaired app row.
///
/// `matched` is the set of app rows that DID pair, and is required rather than
/// optional: a duplicate is only recognisable by its twin, and the twin is by
/// definition the row that matched. Omitting it is the bug this module exists
/// to prevent — the leftover reads as an ordinary unmatched row and the double
/// entry survives the reconciliation.
pub fn classify_leftovers(
    leftovers: &[LeftoverRow],
    matched: &[LeftoverRow],
    end_date: NaiveDate,
    pending_grace_days: i64,
    duplicate_window_days: i64,
    run_options: RunOptions,
) -> HashMap<String, LeftoverVerdict> {
    let mut seen: HashMap<String, u32> = HashMap::new();
    let mut out = HashMap::new();

    // Run detection lives here rather than beside the hints because both
    // callers must reach the same verdict — that is why the module exists.
    let mut in_run: HashSet<String> = HashSet::new();
    for run in find_duplicate_runs(leftovers, matched, run_options) {
        for r in &run.rows {
            in_run.insert(r.id.clone());
        }
    }

    for row in leftovers {
        let key = row.identity();
        let n = seen.entry(key).or_insert(0);
        *n += 1;
        let repeated = *n > 1;

        // Order matters: a matched twin is checked first so its stronger
        // evidence is what gets reported, even when a second leftover
        // lookalike also exists. Dated within a window rather than on the same
        // day — a purchase entered twice a few days apart is the ordinary way a
        // double entry happens.
        let duplicate_of_matched = matched
            .iter()
            .any(|m| same_thing(m, row) && day_diff(m.date, row.date) <= duplicate_window_days);

        // A run outranks the pending window. A copy dated near the period end
        // would otherwise read as "not posted yet" — the one verdict that
        // excuses a row from the remainder, and exactly the wrong answer for a
        // row that should not exist at all.
        let in_duplicate_run = in_run.contains(&row.id);
        let is_duplicate = duplicate_of_matched || in_duplicate_run || repeated;

        let kind = if is_duplicate {
            LeftoverKind::DuplicateInApp
        } else if day_diff(row.date, end_date) <= pending_grace_days {
            LeftoverKind::MissingInBankPending
        } else {
            LeftoverKind::MissingInBankPhantom
        };

        out.insert(
            row.id.clone(),
            LeftoverVerdict {
                kind,
                duplicate_of_matched,
                in_duplicate_run,
            },
        );
    }

    out
}
