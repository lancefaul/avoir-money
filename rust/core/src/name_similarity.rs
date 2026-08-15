//! Merchant-name comparison — port of
//! `packages/core/src/reconcile/name-similarity.ts`.
//!
//! Bank descriptors are aliases, not spellings: a card-processor prefix, a
//! store number, a truncated legal entity. Similarity here is only ever used to
//! rank or annotate — **never as the sole key for a match**. `matcher.rs`
//! explains why at length; the short version is that gating on name similarity
//! rejected most genuine matches on real data.

use chrono::NaiveDate;
use std::collections::HashMap;

/// Lowercase, drop punctuation, store numbers, and card-processing noise words.
///
/// The digit rule is `\b\d{3,}\b` — three or more digits standing alone, which
/// catches store and reference numbers while leaving a "24 Market" style name
/// intact only if it is shorter. (It is not: `365` is three digits and is
/// stripped. Faithful to the original, and the reason similarity is a
/// tiebreaker rather than a gate.)
pub fn normalize_name(s: &str) -> String {
    // 1. lowercase, and replace every non-alphanumeric, non-space run with a space
    let lowered: String = s
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect();

    // 2. drop standalone runs of 3+ digits, and the card-processing noise words
    const NOISE: [&str; 7] = [
        "purchase",
        "debit",
        "card",
        "pos",
        "xxxx",
        "payment",
        "recurring",
    ];
    let kept: Vec<&str> = lowered
        .split_whitespace()
        .filter(|w| {
            let all_digits = w.chars().all(|c| c.is_ascii_digit());
            if all_digits && w.len() >= 3 {
                return false;
            }
            !NOISE.contains(w)
        })
        .collect();

    kept.join(" ")
}

/// Dice coefficient over character bigrams — robust to truncation and suffixes,
/// which is most of what a bank descriptor does to a merchant name.
///
/// Returns 0.0 … 1.0. Exact match is 1.0; a prefix relationship short-circuits
/// to 0.9 without computing bigrams, which is what makes a truncated descriptor
/// score highly against the full name.
pub fn name_similarity(a: &str, b: &str) -> f64 {
    let x = normalize_name(a);
    let y = normalize_name(b);
    if x.is_empty() || y.is_empty() {
        return 0.0;
    }
    if x == y {
        return 1.0;
    }
    if x.starts_with(&y) || y.starts_with(&x) {
        return 0.9;
    }

    let bigrams = |s: &str| -> HashMap<(char, char), i32> {
        let cs: Vec<char> = s.chars().collect();
        let mut m = HashMap::new();
        for w in cs.windows(2) {
            *m.entry((w[0], w[1])).or_insert(0) += 1;
        }
        m
    };

    let ba = bigrams(&x);
    let bb = bigrams(&y);
    let mut overlap = 0;
    for (g, n) in &ba {
        overlap += (*n).min(*bb.get(g).unwrap_or(&0));
    }

    // Character counts, not byte lengths — the TypeScript uses `.length` on a
    // JS string, which is UTF-16 code units. For the ASCII that survives
    // `normalize_name` the two agree.
    let total = (x.chars().count() as i64 - 1) + (y.chars().count() as i64 - 1);
    if total > 0 {
        (2 * overlap) as f64 / total as f64
    } else {
        0.0
    }
}

/// Whole days between two dates, always positive.
///
/// The TypeScript parses `YYYY-MM-DD` with an explicit `Z` so the arithmetic is
/// UTC regardless of host timezone — a local parse shifts dates by a day either
/// side of midnight, the class of bug that cost this project 243 pay periods.
/// `NaiveDate` has no timezone at all, so the hazard does not exist here.
pub fn day_diff(a: NaiveDate, b: NaiveDate) -> i64 {
    (a - b).num_days().abs()
}

/// Parse a `YYYY-MM-DD` string as the matcher's inputs carry them.
pub fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}
