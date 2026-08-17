//! Reconciliation matcher — port of `packages/core/src/reconcile/matcher.ts`.
//!
//! Pure and deterministic. Compares a bank statement export against the app's
//! transactions for one account and classifies every row on both sides. It
//! prepares findings only; it never mutates anything.
//!
//! **App-specific rules the caller must respect** — each produces false
//! positives if missed:
//!  - **Split parents only.** A $120 charge split three ways is ONE bank line
//!    but a parent plus three children in the app. Children must be excluded
//!    upstream.
//!  - **Card payments are TRANSFERs** whose card side is `toAccountId`, so they
//!    must be supplied as inbound rows or every payment reads as missing.
//!  - **Match on gross `amount`, not `netAmount`.** Rewards and gift-card
//!    offsets reduce recorded cash movement, but the bank prints the full charge.

use crate::leftovers::{classify_leftovers, LeftoverKind, LeftoverRow, RunOptions};
use crate::money::Cents;
use crate::name_similarity::{day_diff, name_similarity};
use crate::reconcile::Direction;
use chrono::NaiveDate;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatementLine {
    /// The caller's stable identifier, carried through untouched.
    ///
    /// Without it callers must re-identify lines by value, and
    /// (date, description) is emphatically not unique — five identical-merchant
    /// charges on one day are ordinary. Collapsing them assigns every finding to
    /// whichever row happened to be last and orphans the rest.
    pub id: Option<String>,
    pub date: NaiveDate,
    pub description: String,
    /// Absolute value; `direction` carries the sign.
    pub amount: Cents,
    pub direction: Direction,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppTx {
    pub id: String,
    pub date: NaiveDate,
    pub name: String,
    /// Gross — what the statement would show, not `netAmount`.
    pub amount: Cents,
    pub direction: Direction,
    /// True when this row is a securities trade.
    ///
    /// The matcher needs it because a trade's amount is *computed* — the app
    /// stores `unitPrice × quantity` rounded, while the broker settles at the
    /// actual fill — so the two legitimately disagree by a few cents on an
    /// otherwise perfect match. That drift is a property of the app row only: a
    /// statement line carries no type, so the relaxation it enables can never
    /// key off the statement side.
    pub is_trade: bool,
}

// No `Eq`: the thresholds are f64. Options are compared by construction in
// tests, never for equality at run time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReconcileOptions {
    pub date_window_days: i64,
    pub amount_tolerance: Cents,
    /// Far tighter than `amount_tolerance`: this is the one pairing where the
    /// amount carries the entire key.
    pub trade_amount_tolerance: Cents,
    pub name_threshold: f64,
    pub strong_name_threshold: f64,
    pub sum_date_window_days: i64,
    /// At least one part must clear this. Zero disables the gate.
    pub sum_name_threshold: f64,
    pub max_sum_parts: usize,
    pub pending_grace_days: i64,
    /// Ordinary posting lag. Within it an exact-cent pairing outranks an
    /// approximate-amount one; beyond it that preference inverts.
    pub posting_lag_days: i64,
}

impl Default for ReconcileOptions {
    fn default() -> Self {
        ReconcileOptions {
            date_window_days: 3,
            amount_tolerance: Cents(50),
            // A few cents — observed drift is 2¢ on a $99.72 buy and 2¢ on a
            // $402.23 sell, clearing it with margin while staying far below the
            // 50¢ typo tolerance. A PROPORTIONAL band was rejected: it widens
            // exactly where a wrong pairing costs most.
            trade_amount_tolerance: Cents(5),
            name_threshold: 0.55,
            strong_name_threshold: 0.7,
            sum_date_window_days: 3,
            sum_name_threshold: 0.35,
            max_sum_parts: 8,
            pending_grace_days: 5,
            posting_lag_days: 10,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FindingKind {
    Matched,
    NameMismatch,
    AmountMismatch,
    SignFlip,
    DateFar,
    AmountDiffers,
    GroupedInApp,
    GroupedInBank,
    MissingInApp,
    DuplicateInApp,
    MissingInBankPending,
    MissingInBankPhantom,
}

impl FindingKind {
    /// The wire name, which the frontend keys the summary on.
    ///
    /// These strings are the TypeScript enum's values, not a Rust rendering of
    /// the variant — `RunMatchResultSchema` types the summary as an open
    /// `Record<string, number>`, so a mis-spelled key would deserialize cleanly
    /// and simply report zero for a category that has findings.
    ///
    /// Safe to share with `matcher_differential`, whose expectations come from
    /// TypeScript-generated fixtures rather than from this list: a wrong name
    /// here fails that test against the fixture, so the independence that
    /// matters is preserved.
    pub fn as_str(self) -> &'static str {
        use FindingKind::*;
        match self {
            Matched => "matched",
            NameMismatch => "name_mismatch",
            AmountMismatch => "amount_mismatch",
            SignFlip => "sign_flip",
            DateFar => "date_far",
            AmountDiffers => "amount_differs",
            GroupedInApp => "grouped_in_app",
            GroupedInBank => "grouped_in_bank",
            MissingInApp => "missing_in_app",
            DuplicateInApp => "duplicate_in_app",
            MissingInBankPending => "missing_in_bank_pending",
            MissingInBankPhantom => "missing_in_bank_phantom",
        }
    }

    /// Whether a finding of this kind represents a pairing worth persisting.
    ///
    /// The four "missing"/"duplicate" kinds are statements *about* a row rather
    /// than links between two, so there is nothing to store. Everything else
    /// names both sides, including the disagreements — an amount mismatch is
    /// still the assertion that these two rows are the same event.
    pub fn is_pairing(self) -> bool {
        use FindingKind::*;
        matches!(
            self,
            Matched
                | NameMismatch
                | GroupedInApp
                | GroupedInBank
                | AmountMismatch
                | SignFlip
                | DateFar
                | AmountDiffers
        )
    }

    /// How confident the stored pairing is, in `ReconciliationMatch.matchType`
    /// terms.
    pub fn match_type(self) -> &'static str {
        use FindingKind::*;
        match self {
            Matched | NameMismatch => "EXACT",
            GroupedInApp | GroupedInBank => "SUM",
            _ => "FUZZY",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub kind: FindingKind,
    pub statement: Option<StatementLine>,
    pub statements: Vec<StatementLine>,
    pub app: Option<AppTx>,
    pub apps: Vec<AppTx>,
    pub delta: Cents,
    pub note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReconcileResult {
    pub findings: Vec<Finding>,
    pub remainder: Cents,
    pub summary: HashMap<FindingKind, usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PairKind {
    Matched,
    SignFlip,
    DateFar,
    AmountMismatch,
    AmountDiffers,
}

/// Preference order when several pairings compete for the same row.
///
/// The question that matters: is an EXACT cent match dated a few days off
/// better evidence than an APPROXIMATE amount dated close? Within ordinary
/// posting lag, decisively yes — a $25.44 charge posting five days after it was
/// recorded is routine, while a $25.44 line explained by an $25.00 row is a
/// guess that two different amounts are the same purchase. Ranking the guess
/// first consumed the statement row and orphaned the real match, producing a
/// false "amounts differ" AND a false "missing" from one transaction.
fn kind_weight(k: PairKind) -> i64 {
    match k {
        PairKind::Matched => 0,
        PairKind::SignFlip => 1,
        PairKind::DateFar => 2,
        PairKind::AmountMismatch => 3,
        PairKind::AmountDiffers => 5,
    }
}

/// `date_far` drops below `amount_mismatch` once the gap exceeds ordinary lag.
const DATE_FAR_BEYOND_LAG: i64 = 4;

fn signed(amount: Cents, direction: Direction) -> Cents {
    match direction {
        Direction::Charge => -amount,
        Direction::Credit => amount,
    }
}

struct Candidate {
    si: usize,
    ai: usize,
    kind: PairKind,
    score: f64,
}

/// A subset of `items` summing exactly to `target`, or `None`.
///
/// Integer cents throughout — summing floats and comparing to a float target
/// fails on values individually exact whose sum is not (0.1 + 0.2). That is
/// free here, since money is already integer.
fn find_subset(items: &[(usize, Cents)], target: Cents, max_parts: usize) -> Option<Vec<usize>> {
    let pool: Vec<(usize, Cents)> = items.iter().take(12).copied().collect(); // bound the search
    let mut out: Vec<usize> = Vec::new();

    fn walk(
        pool: &[(usize, Cents)],
        start: usize,
        remaining: i64,
        depth: usize,
        out: &mut Vec<usize>,
    ) -> bool {
        if remaining == 0 && out.len() >= 2 {
            return true;
        }
        if depth == 0 || remaining < 0 {
            return false;
        }
        for i in start..pool.len() {
            out.push(pool[i].0);
            if walk(pool, i + 1, remaining - pool[i].1 .0, depth - 1, out) {
                return true;
            }
            out.pop();
        }
        false
    }

    if walk(&pool, 0, target.0, max_parts, &mut out) {
        Some(out)
    } else {
        None
    }
}

/// Classify every statement line and app transaction.
///
/// Assignment is global best-first rather than a per-row lookup: identical
/// amounts recur constantly (two $3.48 charges at one merchant on one day), and
/// a greedy per-row pass pairs those wrong and cascades the error.
pub fn reconcile(
    statement: &[StatementLine],
    app: &[AppTx],
    end_date: NaiveDate,
    o: &ReconcileOptions,
) -> ReconcileResult {
    // ── Pass 1: score every plausible pairing ──
    let mut candidates: Vec<Candidate> = Vec::new();

    for (si, s) in statement.iter().enumerate() {
        for (ai, a) in app.iter().enumerate() {
            let sim = name_similarity(&s.description, &a.name);
            let dd = day_diff(s.date, a.date);
            let amount_eq = s.amount == a.amount;
            let diff = (s.amount.0 - a.amount.0).abs();
            let amount_close = diff <= o.amount_tolerance.0;
            let same_dir = s.direction == a.direction;

            // Name is a TIEBREAKER, not a gate. Bank descriptors are aliases,
            // not spellings; gating on similarity rejected most genuine matches
            // on real data. An exact cent amount in the same direction within a
            // few days is already a strong key.
            //
            // `amount_mismatch` is the exception — once the amount may differ
            // the key is no longer pinned, so a name gate is required. And that
            // exception has its own exception for TRADEs, whose descriptors
            // ("Purchase of Acme Variable Rate Perpetual Stretch Preferred
            // Stock" vs "Buy TCKC") score near zero. The gate is replaced
            // rather than removed: a tolerance a tenth as wide still pins it.
            let named_near_miss = amount_close && sim >= o.name_threshold;
            let trade_near_miss = a.is_trade && diff <= o.trade_amount_tolerance.0;

            let kind = if amount_eq && same_dir && dd <= o.date_window_days {
                Some(PairKind::Matched)
            } else if amount_eq && !same_dir && dd <= o.date_window_days {
                Some(PairKind::SignFlip)
            } else if amount_eq && same_dir && dd <= 30 {
                Some(PairKind::DateFar)
            } else if same_dir && dd <= o.date_window_days && (named_near_miss || trade_near_miss) {
                Some(PairKind::AmountMismatch)
            } else if same_dir && dd <= 1 && sim >= o.strong_name_threshold {
                Some(PairKind::AmountDiffers)
            } else {
                None
            };

            let Some(kind) = kind else { continue };
            let weight = if kind == PairKind::DateFar && dd > o.posting_lag_days {
                DATE_FAR_BEYOND_LAG
            } else {
                kind_weight(kind)
            };
            candidates.push(Candidate {
                si,
                ai,
                kind,
                score: weight as f64 * 1000.0 - sim * 100.0 + dd as f64,
            });
        }
    }

    candidates.sort_by(|x, y| {
        x.score
            .partial_cmp(&y.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(x.si.cmp(&y.si))
            .then(x.ai.cmp(&y.ai))
    });

    let mut used_s: HashSet<usize> = HashSet::new();
    let mut used_a: HashSet<usize> = HashSet::new();
    let mut findings: Vec<Finding> = Vec::new();

    // `amount_differs` is DEFERRED until after N:1 sum matching. It is the
    // weakest classification and exactly the shape a grouped entry presents:
    // one app row of 76.00 looks like a near-miss against any one of the bank's
    // six returns. Consuming the app row here starved the sum pass, turning one
    // clean grouping into 1 mispair + 5 "missing" rows and a bogus remainder.
    let deferred: Vec<&Candidate> = candidates
        .iter()
        .filter(|c| c.kind == PairKind::AmountDiffers)
        .collect();

    // ── Pass 2: commit the strong pairings ──
    for c in candidates
        .iter()
        .filter(|c| c.kind != PairKind::AmountDiffers)
    {
        if used_s.contains(&c.si) || used_a.contains(&c.ai) {
            continue;
        }
        used_s.insert(c.si);
        used_a.insert(c.ai);

        let s = &statement[c.si];
        let a = &app[c.ai];
        let mut delta = Cents::ZERO;
        let mut note = None;
        let mut kind = match c.kind {
            PairKind::Matched => FindingKind::Matched,
            PairKind::SignFlip => FindingKind::SignFlip,
            PairKind::DateFar => FindingKind::DateFar,
            PairKind::AmountMismatch => FindingKind::AmountMismatch,
            PairKind::AmountDiffers => unreachable!("deferred"),
        };

        match c.kind {
            PairKind::Matched if name_similarity(&s.description, &a.name) < o.name_threshold => {
                // Balance is correct; only the label disagrees.
                kind = FindingKind::NameMismatch;
                note = Some(format!(
                    "bank calls it \"{}\", app has \"{}\"",
                    s.description, a.name
                ));
            }
            PairKind::AmountMismatch => {
                delta = signed(s.amount, s.direction) - signed(a.amount, a.direction);
                // The delta is still reported. Pairing a trade EXPLAINS the
                // difference; it does not absorb it.
                note = Some(if a.is_trade {
                    format!(
                        "statement {} vs app {} — a trade's recorded unit price × quantity drifts from the settled amount",
                        s.amount, a.amount
                    )
                } else {
                    format!("statement {} vs app {}", s.amount, a.amount)
                });
            }
            PairKind::SignFlip => {
                delta = signed(s.amount, s.direction) - signed(a.amount, a.direction);
                note = Some(format!(
                    "direction differs — app has {}, statement has {}",
                    dir_str(a.direction),
                    dir_str(s.direction)
                ));
            }
            PairKind::DateFar => {
                note = Some(format!("dated {} days apart", day_diff(s.date, a.date)));
            }
            _ => {}
        }

        findings.push(Finding {
            kind,
            statement: Some(s.clone()),
            statements: Vec::new(),
            app: Some(a.clone()),
            apps: Vec::new(),
            delta,
            note,
        });
    }

    // ── Pass 3: N:1 sum matching ──
    //
    // One statement line can legitimately be several app rows: a $136.90
    // utility payment entered as separate Water / Sewage / Garbage rows.
    // Without this pass that reports as 1 missing + 3 phantoms — four findings
    // for zero discrepancy. Guarded tightly because with ~120 rows an
    // unconstrained subset-sum finds spurious groups easily.
    let has_name_signal = |sims: &[f64]| -> bool {
        o.sum_name_threshold <= 0.0 || sims.iter().any(|s| *s >= o.sum_name_threshold)
    };

    // One statement line ← several app rows.
    for (si, s) in statement.iter().enumerate() {
        if used_s.contains(&si) {
            continue;
        }
        let mut pool: Vec<(usize, Cents, f64)> = app
            .iter()
            .enumerate()
            .filter(|(i, a)| {
                !used_a.contains(i)
                    && a.direction == s.direction
                    && day_diff(a.date, s.date) <= o.sum_date_window_days
            })
            .map(|(i, a)| (i, a.amount, name_similarity(&s.description, &a.name)))
            .collect();
        pool.sort_by(|x, y| {
            y.2.partial_cmp(&x.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(x.0.cmp(&y.0))
        });

        let items: Vec<(usize, Cents)> = pool.iter().map(|(i, c, _)| (*i, *c)).collect();
        let Some(combo) = find_subset(&items, s.amount, o.max_sum_parts) else {
            continue;
        };

        let sims: Vec<f64> = combo
            .iter()
            .map(|i| name_similarity(&s.description, &app[*i].name))
            .collect();
        if !has_name_signal(&sims) {
            continue;
        }

        used_s.insert(si);
        for i in &combo {
            used_a.insert(*i);
        }
        let parts: Vec<AppTx> = combo.iter().map(|i| app[*i].clone()).collect();
        findings.push(Finding {
            kind: FindingKind::GroupedInApp,
            statement: Some(s.clone()),
            statements: Vec::new(),
            app: None,
            note: Some(format!(
                "one statement line of {} entered as {} app rows summing to it exactly",
                s.amount,
                parts.len()
            )),
            apps: parts,
            delta: Cents::ZERO,
        });
    }

    // One app row ← several statement lines.
    for (ai, a) in app.iter().enumerate() {
        if used_a.contains(&ai) {
            continue;
        }
        let mut pool: Vec<(usize, Cents, f64)> = statement
            .iter()
            .enumerate()
            .filter(|(i, s)| {
                !used_s.contains(i)
                    && s.direction == a.direction
                    && day_diff(s.date, a.date) <= o.sum_date_window_days
            })
            .map(|(i, s)| (i, s.amount, name_similarity(&s.description, &a.name)))
            .collect();
        pool.sort_by(|x, y| {
            y.2.partial_cmp(&x.2)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(x.0.cmp(&y.0))
        });

        let items: Vec<(usize, Cents)> = pool.iter().map(|(i, c, _)| (*i, *c)).collect();
        let Some(combo) = find_subset(&items, a.amount, o.max_sum_parts) else {
            continue;
        };

        let sims: Vec<f64> = combo
            .iter()
            .map(|i| name_similarity(&statement[*i].description, &a.name))
            .collect();
        if !has_name_signal(&sims) {
            continue;
        }

        used_a.insert(ai);
        for i in &combo {
            used_s.insert(*i);
        }
        let parts: Vec<StatementLine> = combo.iter().map(|i| statement[*i].clone()).collect();
        findings.push(Finding {
            kind: FindingKind::GroupedInBank,
            statement: None,
            note: Some(format!(
                "one app row of {} covers {} statement lines summing to it exactly",
                a.amount,
                parts.len()
            )),
            statements: parts,
            app: Some(a.clone()),
            apps: Vec::new(),
            delta: Cents::ZERO,
        });
    }

    // ── Pass 4: leftover near-misses that grouping could not explain ──
    for c in &deferred {
        if used_s.contains(&c.si) || used_a.contains(&c.ai) {
            continue;
        }
        used_s.insert(c.si);
        used_a.insert(c.ai);
        let s = &statement[c.si];
        let a = &app[c.ai];
        findings.push(Finding {
            kind: FindingKind::AmountDiffers,
            note: Some(format!(
                "same merchant and date, but statement {} vs app {} (diff {})",
                s.amount,
                a.amount,
                Cents((s.amount.0 - a.amount.0).abs())
            )),
            statement: Some(s.clone()),
            statements: Vec::new(),
            app: Some(a.clone()),
            apps: Vec::new(),
            delta: signed(s.amount, s.direction) - signed(a.amount, a.direction),
        });
    }

    // ── Pass 5: unmatched statement lines ──
    for (si, s) in statement.iter().enumerate() {
        if used_s.contains(&si) {
            continue;
        }
        findings.push(Finding {
            kind: FindingKind::MissingInApp,
            delta: signed(s.amount, s.direction),
            statement: Some(s.clone()),
            statements: Vec::new(),
            app: None,
            apps: Vec::new(),
            note: None,
        });
    }

    // ── Pass 6: unmatched app rows ──
    //
    // Delegated to `classify_leftovers` because the reconcile UI needs the same
    // verdicts and cannot get them from here — it rebuilds its groups from the
    // persisted pairings, which carry no classification. Two derivations of
    // this rule drifted once already; there is now one.
    let to_leftover = |a: &AppTx| LeftoverRow {
        id: a.id.clone(),
        date: a.date,
        name: a.name.clone(),
        amount: a.amount,
        gross: None,
    };
    let leftover_app: Vec<(usize, &AppTx)> = app
        .iter()
        .enumerate()
        .filter(|(i, _)| !used_a.contains(i))
        .collect();
    let leftover_rows: Vec<LeftoverRow> =
        leftover_app.iter().map(|(_, a)| to_leftover(a)).collect();
    let matched_rows: Vec<LeftoverRow> = app
        .iter()
        .enumerate()
        .filter(|(i, _)| used_a.contains(i))
        .map(|(_, a)| to_leftover(a))
        .collect();

    let verdicts = classify_leftovers(
        &leftover_rows,
        &matched_rows,
        end_date,
        o.pending_grace_days,
        crate::leftovers::DEFAULT_DUPLICATE_WINDOW_DAYS,
        RunOptions::default(),
    );

    for (_, a) in &leftover_app {
        let v = verdicts.get(&a.id).expect("every leftover gets a verdict");
        let kind = match v.kind {
            LeftoverKind::DuplicateInApp => FindingKind::DuplicateInApp,
            LeftoverKind::MissingInBankPending => FindingKind::MissingInBankPending,
            LeftoverKind::MissingInBankPhantom => FindingKind::MissingInBankPhantom,
        };
        findings.push(Finding {
            kind,
            // Pending rows are expected, so they do not count against the
            // remainder.
            delta: if kind == FindingKind::MissingInBankPending {
                Cents::ZERO
            } else {
                -signed(a.amount, a.direction)
            },
            note: match kind {
                FindingKind::DuplicateInApp => {
                    Some("an identical app transaction already matched this statement line".into())
                }
                FindingKind::MissingInBankPending => {
                    Some("within grace window — likely not posted yet".into())
                }
                _ => None,
            },
            statement: None,
            statements: Vec::new(),
            app: Some((*a).clone()),
            apps: Vec::new(),
        });
    }

    let mut summary: HashMap<FindingKind, usize> = HashMap::new();
    for f in &findings {
        *summary.entry(f.kind).or_insert(0) += 1;
    }
    let remainder: Cents = findings.iter().map(|f| f.delta).sum();

    ReconcileResult {
        findings,
        remainder,
        summary,
    }
}

fn dir_str(d: Direction) -> &'static str {
    match d {
        Direction::Charge => "charge",
        Direction::Credit => "credit",
    }
}
