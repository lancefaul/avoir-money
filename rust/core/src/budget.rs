//! Budget frequency conversion and the high-water-mark policy.
//!
//! Port of `computeExpenseMonthlyEquivalent` / `convertMonthlyToFrequency` /
//! `applyHighWaterMark` from `apps/api/src/lib/budget-linking.ts` and
//! `lib/budget.ts`.
//!
//! # These are divisions, so they state a rounding policy (ADR-033)
//!
//! Converting between frequencies divides — a weekly amount is a monthly one
//! over 52/12 — and division is the only operation on integer cents that can
//! lose a fraction. Every conversion here rounds half away from zero to the
//! nearest cent and drops the residual, because a converted budget figure is a
//! target rather than a split that has to reconcile against a parent total.
//!
//! The TypeScript rounds `computeExpenseMonthlyEquivalent` and does NOT round
//! `convertMonthlyToFrequency`, whose raw float result is written straight to
//! `BudgetVersion.amount`. That is one of the paths that put sub-cent values
//! into production's supposedly-exact decimal columns.

use crate::money::Cents;

/// How often a recurring item repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    OneTime,
    Weekly,
    Biweekly,
    SemiMonthly,
    Monthly,
    Quarterly,
    Biannual,
    Annual,
}

/// A budget's own frequency. `Yearly` and `Annual` are the same period spelled
/// two ways — the budget enum says YEARLY, the expense enum says ANNUAL, and
/// they must compare equal or a yearly budget linked to an annual expense
/// takes the lossy round-trip path for no reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetFrequency {
    Weekly,
    Biweekly,
    SemiMonthly,
    Monthly,
    Quarterly,
    Biannual,
    Annual,
    Yearly,
}

impl Frequency {
    pub fn from_stored(s: &str) -> Option<Self> {
        Some(match s {
            "ONE_TIME" => Frequency::OneTime,
            "WEEKLY" => Frequency::Weekly,
            "BIWEEKLY" => Frequency::Biweekly,
            "SEMI_MONTHLY" => Frequency::SemiMonthly,
            "MONTHLY" => Frequency::Monthly,
            "QUARTERLY" => Frequency::Quarterly,
            "BIANNUAL" => Frequency::Biannual,
            "ANNUAL" => Frequency::Annual,
            _ => return None,
        })
    }
}

impl BudgetFrequency {
    pub fn from_stored(s: &str) -> Option<Self> {
        Some(match s {
            "WEEKLY" => BudgetFrequency::Weekly,
            "BIWEEKLY" => BudgetFrequency::Biweekly,
            "SEMI_MONTHLY" => BudgetFrequency::SemiMonthly,
            "MONTHLY" => BudgetFrequency::Monthly,
            "QUARTERLY" => BudgetFrequency::Quarterly,
            "BIANNUAL" => BudgetFrequency::Biannual,
            "ANNUAL" => BudgetFrequency::Annual,
            "YEARLY" => BudgetFrequency::Yearly,
            _ => return None,
        })
    }

    /// Does an expense at this frequency repeat on the same period as the
    /// budget? YEARLY and ANNUAL are the same period under two names.
    pub fn matches(self, f: Frequency) -> bool {
        matches!(
            (self, f),
            (BudgetFrequency::Weekly, Frequency::Weekly)
                | (BudgetFrequency::Biweekly, Frequency::Biweekly)
                | (BudgetFrequency::SemiMonthly, Frequency::SemiMonthly)
                | (BudgetFrequency::Monthly, Frequency::Monthly)
                | (BudgetFrequency::Quarterly, Frequency::Quarterly)
                | (BudgetFrequency::Biannual, Frequency::Biannual)
                | (BudgetFrequency::Annual, Frequency::Annual)
                | (BudgetFrequency::Yearly, Frequency::Annual)
        )
    }
}

/// `numerator / denominator`, rounded half away from zero to the cent.
///
/// i128 intermediate: a large annual budget times 12 exceeds i64 well before
/// either figure looks unreasonable.
fn div_round(numerator: i128, denominator: i128) -> i64 {
    debug_assert!(denominator != 0, "frequency conversion divides by zero");
    let half = denominator / 2;
    let r = if (numerator >= 0) == (denominator > 0) {
        (numerator + half) / denominator
    } else {
        (numerator - half) / denominator
    };
    r as i64
}

/// What one expense contributes to a monthly budget.
///
/// `OneTime` contributes **nothing**: a one-off purchase is not part of a
/// recurring baseline, and folding it in would inflate the budget permanently
/// under the high-water-mark policy, which never decreases on its own.
pub fn expense_monthly_equivalent(amount: Cents, frequency: Frequency) -> Cents {
    let a = amount.0 as i128;
    Cents(match frequency {
        Frequency::OneTime => return Cents::ZERO,
        Frequency::Weekly => div_round(a * 52, 12),
        Frequency::Biweekly => div_round(a * 26, 12),
        Frequency::SemiMonthly => a as i64 * 2,
        Frequency::Monthly => a as i64,
        Frequency::Quarterly => div_round(a, 3),
        Frequency::Biannual => div_round(a, 6),
        Frequency::Annual => div_round(a, 12),
    })
}

/// A budget's monthly equivalent, stated in its own frequency.
///
/// The forward direction of [`convert_monthly_to_frequency`], and the port of
/// the TypeScript's `computeMonthlyEquivalent`. Distinct from
/// [`expense_monthly_equivalent`] in two ways that matter: a budget has no
/// `OneTime`, and a **yearly** budget divides by its active months rather than
/// always by twelve — a budget that runs for four months of the year costs a
/// third of its annual figure each of those months, not a twelfth.
pub fn budget_monthly_equivalent(
    amount: Cents,
    frequency: BudgetFrequency,
    active_months: Option<usize>,
) -> Cents {
    let a = amount.0 as i128;
    Cents(match frequency {
        BudgetFrequency::Weekly => div_round(a * 52, 12),
        BudgetFrequency::Biweekly => div_round(a * 26, 12),
        BudgetFrequency::SemiMonthly => a as i64 * 2,
        BudgetFrequency::Monthly => a as i64,
        BudgetFrequency::Quarterly => div_round(a, 3),
        BudgetFrequency::Biannual => div_round(a, 6),
        BudgetFrequency::Annual | BudgetFrequency::Yearly => {
            let months = active_months.filter(|n| *n > 0).unwrap_or(12) as i128;
            div_round(a, months)
        }
    })
}

/// The inverse: a monthly figure expressed in the budget's own frequency.
///
/// `active_months` applies only to yearly budgets — a budget that runs for
/// four months of the year is that monthly figure times four, not times
/// twelve. Zero or absent means the full year.
pub fn convert_monthly_to_frequency(
    monthly: Cents,
    frequency: BudgetFrequency,
    active_months: Option<usize>,
) -> Cents {
    let m = monthly.0 as i128;
    Cents(match frequency {
        BudgetFrequency::Weekly => div_round(m * 12, 52),
        BudgetFrequency::Biweekly => div_round(m * 12, 26),
        BudgetFrequency::SemiMonthly => div_round(m, 2),
        BudgetFrequency::Monthly => m as i64,
        BudgetFrequency::Quarterly => m as i64 * 3,
        BudgetFrequency::Biannual => m as i64 * 6,
        BudgetFrequency::Annual | BudgetFrequency::Yearly => {
            let months = active_months.filter(|n| *n > 0).unwrap_or(12) as i128;
            (m * months) as i64
        }
    })
}

/// The high-water mark: a budget derived from linked expenses never decreases
/// on its own.
///
/// Deliberate policy, not an accident of the maths. If a linked expense drops
/// for one month, the budget holding its previous level means the surplus
/// shows as underspend rather than the target quietly following the spend
/// downward — which would make every month look on-target by construction.
/// Lowering it is a manual act.
pub fn apply_high_water_mark(derived_baseline: Cents, current_mark: Cents) -> Cents {
    if derived_baseline.0 >= current_mark.0 {
        derived_baseline
    } else {
        current_mark
    }
}

/// Where spending sits against its allocation.
///
/// `None` when there is no allocation to compare against — a budget of zero has
/// no "under" or "over", and reporting `under` for it would paint every
/// unallocated category green.
///
/// The 80% boundary is the only judgement here: below it is `Under`, above the
/// allocation is `Over`, and the band between is `Near` — a warning that the
/// month is going to be tight while there is still time to act on it.
pub fn compute_budget_status(actual: Cents, monthly_equivalent: Cents) -> Option<&'static str> {
    if monthly_equivalent.0 == 0 {
        return None;
    }
    // `actual * 10 < allocation * 8` rather than `actual < 0.8 * allocation`:
    // the same comparison without a float, so a budget of exactly 80% lands on
    // the same side every time instead of on whichever side rounding chose.
    if actual.0 * 10 < monthly_equivalent.0 * 8 {
        Some("under")
    } else if actual.0 > monthly_equivalent.0 {
        Some("over")
    } else {
        Some("near")
    }
}

/// Whether a seasonal budget applies in a given month.
///
/// Months are **1-indexed** here, matching the stored `activeMonths`. An empty
/// list means the budget is not seasonal at all, so it is always active.
pub fn is_seasonal_active_in_month(active_months: &[u32], month: u32) -> bool {
    active_months.is_empty() || active_months.contains(&month)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_one_time_expense_contributes_nothing() {
        // Folding a one-off into a recurring baseline would raise the budget
        // permanently, because the high-water mark never comes back down.
        assert_eq!(
            expense_monthly_equivalent(Cents(500_00), Frequency::OneTime),
            Cents::ZERO
        );
    }

    #[test]
    fn weekly_and_biweekly_use_the_calendar_not_four_weeks() {
        // $100/week is 52 payments over 12 months = $433.33, not $400.
        assert_eq!(
            expense_monthly_equivalent(Cents(100_00), Frequency::Weekly),
            Cents(433_33)
        );
        // $100 every two weeks is 26 over 12 = $216.67.
        assert_eq!(
            expense_monthly_equivalent(Cents(100_00), Frequency::Biweekly),
            Cents(216_67)
        );
    }

    #[test]
    fn the_longer_periods_divide() {
        assert_eq!(
            expense_monthly_equivalent(Cents(300_00), Frequency::Quarterly),
            Cents(100_00)
        );
        assert_eq!(
            expense_monthly_equivalent(Cents(600_00), Frequency::Biannual),
            Cents(100_00)
        );
        assert_eq!(
            expense_monthly_equivalent(Cents(1200_00), Frequency::Annual),
            Cents(100_00)
        );
        assert_eq!(
            expense_monthly_equivalent(Cents(50_00), Frequency::SemiMonthly),
            Cents(100_00)
        );
    }

    #[test]
    fn division_rounds_to_the_nearest_cent_not_toward_zero() {
        // $100.00 / 3 = 33.333… → 33.33
        assert_eq!(
            expense_monthly_equivalent(Cents(100_00), Frequency::Quarterly),
            Cents(33_33)
        );
        // $100.01 / 3 = 33.336… → 33.34
        assert_eq!(
            expense_monthly_equivalent(Cents(100_01), Frequency::Quarterly),
            Cents(33_34)
        );
        // Negative amounts round away from zero symmetrically.
        assert_eq!(
            expense_monthly_equivalent(Cents(-100_01), Frequency::Quarterly),
            Cents(-33_34)
        );
    }

    #[test]
    fn the_round_trip_error_is_bounded_by_the_conversion_ratio_not_by_a_cent() {
        // Converting out and back cannot be lossless — each direction rounds
        // to the cent — and the error is NOT bounded by one cent. Going to a
        // SMALLER unit first (monthly to weekly divides by 52/12 ~ 4.33) means
        // the half-cent rounded away there is multiplied back up on the return
        // trip. 7c monthly becomes 2c weekly becomes 9c monthly.
        //
        // So the honest bound is the ratio, and code needing exactness sums
        // native amounts instead — which is why recompute_budget_from_links
        // has a same-frequency fast path rather than always round-tripping.
        for cents in [100_00, 33_33, 7, 1_234_56] {
            let monthly = Cents(cents);
            let weekly = convert_monthly_to_frequency(monthly, BudgetFrequency::Weekly, None);
            let back = expense_monthly_equivalent(weekly, Frequency::Weekly);
            // ceil(52/12) = 5 cents of headroom covers the amplified half-cent.
            assert!(
                (back.0 - monthly.0).abs() <= 5,
                "{cents}c -> {}c weekly -> {}c monthly",
                weekly.0,
                back.0
            );
        }

        // Monthly to a LARGER unit and back is exact, because multiplying
        // cannot lose a fraction and the return divide is exact too.
        for cents in [100_00, 33_33, 7, 1_234_56] {
            let monthly = Cents(cents);
            let quarterly = convert_monthly_to_frequency(monthly, BudgetFrequency::Quarterly, None);
            assert_eq!(
                expense_monthly_equivalent(quarterly, Frequency::Quarterly),
                monthly,
                "scaling up then back down is exact"
            );
        }
    }

    #[test]
    fn a_yearly_budget_scales_by_its_active_months() {
        let monthly = Cents(100_00);
        assert_eq!(
            convert_monthly_to_frequency(monthly, BudgetFrequency::Yearly, None),
            Cents(1200_00)
        );
        // A budget that only runs for four months of the year is 4x, not 12x —
        // treating it as a full year would over-allocate by a factor of three.
        assert_eq!(
            convert_monthly_to_frequency(monthly, BudgetFrequency::Yearly, Some(4)),
            Cents(400_00)
        );
        // Zero active months means "unset", not "no budget".
        assert_eq!(
            convert_monthly_to_frequency(monthly, BudgetFrequency::Yearly, Some(0)),
            Cents(1200_00)
        );
    }

    #[test]
    fn yearly_and_annual_are_the_same_period_under_two_names() {
        // The budget enum says YEARLY and the expense enum says ANNUAL. If
        // these did not compare equal, a yearly budget linked to an annual
        // expense would take the lossy monthly round-trip for no reason.
        assert!(BudgetFrequency::Yearly.matches(Frequency::Annual));
        assert!(BudgetFrequency::Annual.matches(Frequency::Annual));
        assert!(!BudgetFrequency::Yearly.matches(Frequency::Monthly));
    }

    #[test]
    fn the_high_water_mark_only_ever_rises() {
        assert_eq!(
            apply_high_water_mark(Cents(120_00), Cents(100_00)),
            Cents(120_00)
        );
        // The point of the policy: a dip does NOT pull the budget down, so the
        // surplus shows as underspend instead of the target following spend
        // downward and making every month on-target by construction.
        assert_eq!(
            apply_high_water_mark(Cents(80_00), Cents(100_00)),
            Cents(100_00)
        );
        assert_eq!(
            apply_high_water_mark(Cents(100_00), Cents(100_00)),
            Cents(100_00)
        );
    }

    #[test]
    fn large_annual_figures_do_not_overflow() {
        // $10,000,000.00 monthly × 12 exceeds i64 cents only well beyond this,
        // but the i128 intermediate is what keeps the multiply safe.
        let big = Cents(1_000_000_000_00);
        assert_eq!(
            convert_monthly_to_frequency(big, BudgetFrequency::Yearly, None),
            Cents(1_000_000_000_00 * 12)
        );
    }
}
