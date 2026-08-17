//! Line-item tax computation — port of `computeLineTotal` from
//! `packages/core/src/schemas/child-transaction.ts`.
//!
//! Splits a child transaction (a receipt line) into pre-tax, tax and total.
//! Tax may be given as an absolute amount OR as a rate, never both — that
//! mutual exclusion is a real rule, enforced in the TypeScript twice: once by a
//! Zod refinement on the request body and once by a throw inside the function.
//! Modelled here as an enum, so the invalid state cannot be constructed at all
//! and neither guard is needed.
//!
//! Used by `routes/transactions.children.ts` at two call sites.

use crate::money::{js_round, Cents, Percent};

/// How tax was supplied for this line. The TypeScript takes two optional
/// fields and rejects the both-present case at run time; an enum makes that
/// case unrepresentable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaxInput {
    /// An absolute tax amount, as entered.
    Amount(Cents),
    /// A percentage rate applied to the pre-tax amount.
    Rate(Percent),
    /// No tax on this line.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineTotal {
    pub pre_tax_amount: Cents,
    pub tax_amount: Cents,
    pub line_total: Cents,
}

/// Compute a line's pre-tax, tax and total.
///
/// In cents every branch except `Rate` is exact addition, so the TypeScript's
/// `round2` calls on already-clean inputs simply disappear. `Rate` is the one
/// division-shaped operation and is rounded to the cent, matching
/// `round2((preTaxAmount * taxRate) / 100)`.
///
/// Note the total is built from the ROUNDED tax rather than the raw product,
/// which is what keeps `pre_tax + tax == line_total` exactly. Doing it the
/// other way — rounding the total independently — is how a receipt's parts stop
/// summing to its whole.
pub fn compute_line_total(pre_tax_amount: Cents, tax: TaxInput) -> LineTotal {
    let tax_amount = match tax {
        TaxInput::Amount(a) => a,
        TaxInput::Rate(r) => {
            // TS: round2((preTaxAmount * taxRate) / 100)
            Cents(js_round(pre_tax_amount.0 as f64 * r.as_percent_f64() / 100.0) as i64)
        }
        TaxInput::None => Cents::ZERO,
    };

    LineTotal {
        pre_tax_amount,
        tax_amount,
        line_total: pre_tax_amount + tax_amount,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absolute_tax_is_carried_through() {
        let r = compute_line_total(Cents(10_00), TaxInput::Amount(Cents(87)));
        assert_eq!(r.pre_tax_amount, Cents(10_00));
        assert_eq!(r.tax_amount, Cents(87));
        assert_eq!(r.line_total, Cents(10_87));
    }

    #[test]
    fn rate_is_applied_and_rounded_to_the_cent() {
        // 9.45% of $10.00 = $0.945 → $0.95 (halves go up, matching Math.round)
        let r = compute_line_total(Cents(10_00), TaxInput::Rate(Percent(945)));
        assert_eq!(r.tax_amount, Cents(95));
        assert_eq!(r.line_total, Cents(10_95));
    }

    #[test]
    fn no_tax_leaves_the_total_equal_to_the_pre_tax_amount() {
        let r = compute_line_total(Cents(42_50), TaxInput::None);
        assert_eq!(r.tax_amount, Cents::ZERO);
        assert_eq!(r.line_total, Cents(42_50));
    }

    #[test]
    fn parts_always_sum_to_the_whole() {
        // The property that matters: whatever rounding happens to the tax, the
        // line's parts reconcile to its total exactly.
        for pre in [1i64, 99, 100, 3_33, 1_234_56, -50] {
            for rate in [0i64, 1, 825, 945, 10_00] {
                let r = compute_line_total(Cents(pre), TaxInput::Rate(Percent(rate)));
                assert_eq!(
                    r.pre_tax_amount + r.tax_amount,
                    r.line_total,
                    "parts did not sum for pre={pre} rate={rate}"
                );
            }
        }
    }
}
