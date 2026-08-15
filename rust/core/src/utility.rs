//! What a utility bill actually costs.
//!
//! Port of `computeUtilityTotalBill` from `apps/api/src/lib/recurring.ts`.
//! It lives in core rather than the API layer because two callers need it and
//! they must agree: the readings route (which pushes the total onto the linked
//! transaction) and the schedule generator (which uses it as the expected
//! amount for the occurrence). Two implementations of "what does this bill
//! come to" is precisely the two-writers shape that ADR-014 exists about.

use crate::money::Cents;

/// How `convenienceFee` should be read.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FeeType {
    /// A flat amount in cents.
    Flat,
    /// A percentage OF the cost, stored scaled by 100 like every other
    /// percentage column — `250` means 2.5%.
    Percent,
}

impl FeeType {
    /// The stored spelling.
    ///
    /// Production holds only `'dollar'` and NULL — **no row has ever been
    /// `'percent'`**, so that branch has never executed against real data. It
    /// is ported because the TypeScript has it and the UI can still produce
    /// it, not because it is exercised.
    pub fn from_stored(s: Option<&str>) -> Self {
        match s {
            Some("percent") => FeeType::Percent,
            _ => FeeType::Flat,
        }
    }
}

/// `cost + convenience fee + other fees`.
///
/// **Rounding policy (ADR-033).** The percentage branch is a division, and
/// division is the only operation on integer cents that can lose a fraction.
/// It rounds half away from zero to the nearest cent, and the residual is
/// dropped rather than carried — a convenience fee is a single terminal
/// figure, not a split that has to reconcile against a parent total, so there
/// is nowhere for a remainder to go.
///
/// The TypeScript rounds nothing here and returns a float, which is one of the
/// paths that put 769 sub-cent values into production's "exact decimal"
/// columns. Rounding at the point of division is the correction.
pub fn total_bill(
    cost: Cents,
    fee: Option<Cents>,
    fee_type: FeeType,
    other: Option<Cents>,
) -> Cents {
    let fee = fee.unwrap_or(Cents::ZERO);
    let other = other.unwrap_or(Cents::ZERO);

    let convenience = match fee_type {
        FeeType::Flat => fee,
        FeeType::Percent => {
            // cost_cents × (fee/100)% = cost_cents × fee / 10_000.
            // i128 for the intermediate: a large bill times a large percentage
            // overflows i64 well before either operand is implausible.
            let numer = cost.0 as i128 * fee.0 as i128;
            let denom = 10_000i128;
            let rounded = if numer >= 0 {
                (numer + denom / 2) / denom
            } else {
                (numer - denom / 2) / denom
            };
            Cents(rounded as i64)
        }
    };

    cost + convenience + other
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_fee_is_added_as_is() {
        // The only shape production actually holds: 'dollar' type, $1.60 fee.
        let total = total_bill(Cents(12345), Some(Cents(160)), FeeType::Flat, None);
        assert_eq!(total, Cents(12505));
    }

    #[test]
    fn missing_fees_are_zero_not_an_error() {
        assert_eq!(
            total_bill(Cents(10000), None, FeeType::Flat, None),
            Cents(10000)
        );
    }

    #[test]
    fn other_fees_are_added_on_top() {
        let total = total_bill(
            Cents(10000),
            Some(Cents(150)),
            FeeType::Flat,
            Some(Cents(275)),
        );
        assert_eq!(total, Cents(10425));
    }

    #[test]
    fn a_percentage_fee_is_taken_of_the_cost() {
        // 2.5% of $100.00 is $2.50.
        let total = total_bill(Cents(10000), Some(Cents(250)), FeeType::Percent, None);
        assert_eq!(total, Cents(10250));
    }

    #[test]
    fn a_percentage_that_lands_between_cents_rounds_to_the_nearest() {
        // 2.5% of $10.01 = 25.025 cents → 25 cents.
        assert_eq!(
            total_bill(Cents(1001), Some(Cents(250)), FeeType::Percent, None),
            Cents(1026)
        );
        // 3% of $10.05 = 30.15 cents → 30 cents.
        assert_eq!(
            total_bill(Cents(1005), Some(Cents(300)), FeeType::Percent, None),
            Cents(1035)
        );
        // Exactly half a cent rounds away from zero: 1% of $0.50 = 0.5 → 1.
        assert_eq!(
            total_bill(Cents(50), Some(Cents(100)), FeeType::Percent, None),
            Cents(51)
        );
    }

    #[test]
    fn an_unknown_fee_type_is_treated_as_flat() {
        // The stored value is 'dollar', not 'flat', and NULL is common. Only
        // the exact string 'percent' selects the percentage branch — anything
        // else must not silently reinterpret a dollar amount as a rate.
        assert_eq!(FeeType::from_stored(Some("dollar")), FeeType::Flat);
        assert_eq!(FeeType::from_stored(None), FeeType::Flat);
        assert_eq!(FeeType::from_stored(Some("percent")), FeeType::Percent);
    }

    #[test]
    fn a_large_bill_with_a_large_rate_does_not_overflow() {
        // $1,000,000.00 at 99.99% — the i128 intermediate is what keeps this
        // from wrapping, since the product exceeds i64 long before either
        // operand looks unreasonable.
        let total = total_bill(
            Cents(100_000_000),
            Some(Cents(9999)),
            FeeType::Percent,
            None,
        );
        assert_eq!(total, Cents(100_000_000 + 99_990_000));
    }
}
