//! What survived of `packages/core/src/utils/aggregation.ts` — one function.
//!
//! **Most of `packages/core`'s small utilities do not need porting at all**, and
//! establishing that was worth more than porting them would have been. A usage
//! sweep of all 11 exports across `escrow.ts`, `aggregation.ts`,
//! `validation.ts` and `transaction-log-sort.ts` found:
//!
//! | Export | Verdict |
//! |---|---|
//! | `getActiveEscrowRecord` | dead — exported, never imported |
//! | `sumBy`, `groupAndSum`, `sortedTotals` | dead |
//! | `isValidDateRange`, `hasRequiredPayDays`, `isDayValidForMonth` | dead (all of `validation.ts`) |
//! | `computeEscrowChange`, `shouldShowEscrowReminder` | frontend-only |
//! | `sortTransactionLog` | frontend-only |
//! | `groupBy` | backend, but a language idiom — see below |
//! | `percentage` | backend + frontend — ported here |
//!
//! Seven dead exports is a QUALITY.md "Dead Code Prevention" finding in its own
//! right ("only export what's imported elsewhere"); they should be deleted from
//! the TypeScript rather than carried across. The frontend-only three stay in
//! TypeScript with the frontend that survives the port, exactly like the
//! currency formatters.
//!
//! `groupBy` is deliberately not ported despite three backend call sites. It is
//! a shape TypeScript needs and Rust does not — the idiomatic equivalent is a
//! fold into a `HashMap` at the call site. Porting it 1:1 would carry a foreign
//! idiom into the new codebase to save three lines, and those call sites are
//! being rewritten in step 4 anyway.

/// What percentage `part` is of `whole`, to one decimal place.
///
/// Ported because unlike its neighbours it encodes a decision rather than a
/// language convenience: the one-decimal rounding, and returning zero for a
/// zero denominator instead of `NaN` or a division error.
///
/// Display-only — this is a ratio for a progress bar or a budget breakdown, and
/// nothing downstream should compute money from the result.
pub fn percentage(part: f64, whole: f64) -> f64 {
    if whole == 0.0 {
        return 0.0;
    }
    // TS: Math.round((part / whole) * 1000) / 10
    crate::money::js_round((part / whole) * 1000.0) / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_typescript_rules() {
        assert_eq!(percentage(0.0, 0.0), 0.0, "zero denominator returns zero");
        assert_eq!(
            percentage(50.0, 0.0),
            0.0,
            "zero denominator wins over a non-zero part"
        );
        assert_eq!(percentage(1.0, 3.0), 33.3, "rounds to one decimal");
        assert_eq!(percentage(2.0, 3.0), 66.7);
        assert_eq!(percentage(1.0, 2.0), 50.0);
        assert_eq!(percentage(3.0, 3.0), 100.0);
        // Over-budget ratios are not clamped — a budget can exceed 100%.
        assert_eq!(percentage(5.0, 4.0), 125.0);
        // Negative parts pass through rather than being floored at zero.
        assert_eq!(percentage(-1.0, 4.0), -25.0);
    }
}
