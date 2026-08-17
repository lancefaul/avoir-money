//! Insurance policy balances and the OOPM budget spread.
//!
//! Port of the pure half of `apps/api/src/lib/healthcare.ts`.
//!
//! # Deductible and OOPM are one number with two caps
//!
//! Both are computed from the same raw total — every dollar spent under a
//! policy counts toward both — and differ only in where they stop. That is why
//! `RawBalance` carries the figure once and the caps are applied afterwards
//! rather than two sums being maintained in parallel. Two sums that must agree
//! is the failure class ADR-014 was written about.
//!
//! # A null limit means "not tracked", not "zero"
//!
//! Dental and vision policies routinely have no deductible and no OOPM. Their
//! `spent` is `None`, which the UI renders as an absent progress bar. Treating
//! it as zero would draw a full bar the instant anything was spent.

use crate::money::Cents;

/// The uncapped total spent under a policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawBalance {
    pub deductible: Cents,
    pub oopm: Cents,
}

/// What the UI shows: capped figures alongside the raw ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CappedBalance {
    /// `None` when the policy has no deductible limit to measure against.
    pub deductible_spent: Option<Cents>,
    /// `None` when the policy has no OOPM limit.
    pub oopm_spent: Option<Cents>,
    pub deductible_raw: Cents,
    pub oopm_raw: Cents,
}

/// Cap the raw totals at their limits.
///
/// `deductible_override` means secondary insurance is covering the deductible.
/// The deductible is a subset of the OOPM, so an amount somebody else paid on
/// your behalf still counts toward the out-of-pocket maximum — the boost is the
/// part of the deductible not yet reached by actual spending, so the two
/// together always total the full deductible and never more.
pub fn compute_capped_balance(
    raw: RawBalance,
    deductible_limit: Option<Cents>,
    oopm_limit: Option<Cents>,
    deductible_override: bool,
) -> CappedBalance {
    let deductible_spent = deductible_limit.map(|l| Cents(raw.deductible.0.min(l.0)));

    let effective_oopm = match (deductible_override, deductible_limit) {
        (true, Some(limit)) => {
            let actual = Cents(raw.deductible.0.min(limit.0));
            raw.oopm + (limit - actual)
        }
        _ => raw.oopm,
    };

    CappedBalance {
        deductible_spent,
        oopm_spent: oopm_limit.map(|l| Cents(effective_oopm.0.min(l.0))),
        deductible_raw: raw.deductible,
        oopm_raw: raw.oopm,
    }
}

/// How much to budget per month for the rest of the year to reach the OOPM.
///
/// `current_month` is 1-based. Returns zero when there is no limit to reach,
/// when secondary insurance is covering it, or when it has already been met.
///
/// **The division's rounding policy, per ADR-033.** This is a monthly target
/// rather than an allocation, so nothing has to sum back to the remaining
/// balance and there is no residual to place. It rounds half away from zero to
/// the cent and the last month absorbs whatever is left — which is the correct
/// behaviour anyway, because the figure is recomputed every month from the
/// balance as it then stands.
pub fn compute_oopm_spread(
    oopm_limit: Option<Cents>,
    oopm_spent: Cents,
    oopm_override: bool,
    current_month: u32,
) -> Cents {
    let Some(limit) = oopm_limit else {
        return Cents::ZERO;
    };
    if oopm_override || oopm_spent.0 >= limit.0 {
        return Cents::ZERO;
    }
    let remaining = limit.0 - oopm_spent.0;
    // December is one month, not zero, and a month outside 1..=12 cannot make
    // this divide by zero.
    let months = (12i64 - current_month as i64 + 1).max(1);
    Cents((remaining as f64 / months as f64).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(d: i64, o: i64) -> RawBalance {
        RawBalance {
            deductible: Cents(d),
            oopm: Cents(o),
        }
    }

    #[test]
    fn spending_is_capped_at_each_limit() {
        let c = compute_capped_balance(
            raw(5_000_00, 5_000_00),
            Some(Cents(1_500_00)),
            Some(Cents(4_000_00)),
            false,
        );
        assert_eq!(c.deductible_spent, Some(Cents(1_500_00)));
        assert_eq!(c.oopm_spent, Some(Cents(4_000_00)));
        // The raw figures survive the cap — the UI shows both.
        assert_eq!(c.deductible_raw, Cents(5_000_00));
        assert_eq!(c.oopm_raw, Cents(5_000_00));
    }

    #[test]
    fn a_policy_with_no_limits_reports_no_progress_rather_than_zero() {
        let c = compute_capped_balance(raw(200_00, 200_00), None, None, false);
        assert_eq!(c.deductible_spent, None);
        assert_eq!(c.oopm_spent, None);
        // Dental and vision routinely have neither, and a zero would draw a
        // full progress bar the moment anything was spent.
        assert_eq!(c.deductible_raw, Cents(200_00));
    }

    #[test]
    fn a_covered_deductible_still_counts_toward_the_oopm() {
        // $500 spent against a $1,500 deductible that somebody else is paying.
        // The remaining $1,000 is money that will be paid on your behalf, and
        // the deductible is a subset of the OOPM, so it counts.
        let c = compute_capped_balance(
            raw(500_00, 500_00),
            Some(Cents(1_500_00)),
            Some(Cents(4_000_00)),
            true,
        );
        assert_eq!(c.oopm_spent, Some(Cents(1_500_00)));
        // The raw figure is what was actually spent, and does not move.
        assert_eq!(c.oopm_raw, Cents(500_00));
    }

    #[test]
    fn the_override_boost_never_exceeds_the_deductible() {
        // Spending already past the deductible leaves nothing to boost, so the
        // covered amount cannot be counted twice.
        let c = compute_capped_balance(
            raw(2_000_00, 2_000_00),
            Some(Cents(1_500_00)),
            Some(Cents(9_000_00)),
            true,
        );
        assert_eq!(c.oopm_spent, Some(Cents(2_000_00)));
    }

    #[test]
    fn the_spread_divides_what_is_left_over_the_months_that_remain() {
        // $3,000 left in July: six months including July.
        assert_eq!(
            compute_oopm_spread(Some(Cents(4_000_00)), Cents(1_000_00), false, 7),
            Cents(500_00)
        );
    }

    #[test]
    fn december_is_one_month_not_zero() {
        assert_eq!(
            compute_oopm_spread(Some(Cents(1_200_00)), Cents::ZERO, false, 12),
            Cents(1_200_00)
        );
    }

    #[test]
    fn nothing_is_budgeted_once_the_maximum_is_met_or_covered() {
        assert_eq!(
            compute_oopm_spread(Some(Cents(4_000_00)), Cents(4_000_00), false, 1),
            Cents::ZERO
        );
        // Secondary insurance is covering it, so budgeting for it would set
        // money aside for a bill that will not arrive.
        assert_eq!(
            compute_oopm_spread(Some(Cents(4_000_00)), Cents::ZERO, true, 1),
            Cents::ZERO
        );
        assert_eq!(
            compute_oopm_spread(None, Cents::ZERO, false, 1),
            Cents::ZERO
        );
    }

    #[test]
    fn a_spread_that_does_not_divide_evenly_rounds_to_the_cent() {
        // $100 over 3 months is 33.333…; the target is a whole number of cents
        // and is recomputed next month from the balance as it then stands, so
        // there is no residual to carry.
        assert_eq!(
            compute_oopm_spread(Some(Cents(100_00)), Cents::ZERO, false, 10),
            Cents(33_33)
        );
    }

    #[test]
    fn a_month_outside_the_year_cannot_divide_by_zero() {
        // Not reachable through the routes, but the guard is what makes that a
        // statement about the caller rather than a latent panic.
        assert_eq!(
            compute_oopm_spread(Some(Cents(1_200_00)), Cents::ZERO, false, 99),
            Cents(1_200_00)
        );
    }
}
