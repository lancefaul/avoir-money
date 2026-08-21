//! Spend prediction — expected vs actual discretionary spending over a period.
//!
//! Ported from `apps/api/src/lib/spend-prediction.ts`.
//!
//! # The chart is about DISCRETIONARY money only
//!
//! - **Expected** is what is left of each budget once the recurring bills filed
//!   against it are deducted, plus budgets with no recurring bills at all.
//! - **Actual** is one-off spending only; the caller excludes transactions
//!   linked to a recurring expense, because those are already subtracted from
//!   the expected line and counting them again would show every month as an
//!   overspend by exactly the amount of the bills.
//!
//! A budget with recurring bills and no allocation contributes **zero**: it is
//! fully spoken for, so there is no discretionary remainder to spend.

use crate::money::Cents;
use chrono::{Duration, NaiveDate};
use std::collections::{HashMap, HashSet};

/// How many pay periods a year holds, by schedule type.
fn schedule_divisor(schedule_type: &str) -> Option<i64> {
    match schedule_type {
        "WEEKLY" => Some(52),
        "BIWEEKLY" => Some(26),
        "SEMI_MONTHLY" => Some(24),
        "MONTHLY" => Some(12),
        _ => None,
    }
}

/// Whether a budget's period is stated per month or per year.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetPeriod {
    Monthly,
    Yearly,
}

/// Convert a budget allocation to what it is worth in ONE pay period.
///
/// A seasonal budget whose active months do not overlap the period is worth
/// nothing in it — a heating budget contributes to January, not to July.
///
/// **Rounding:** the division is done once, on the scaled numerator, and rounded
/// half-away-from-zero to the cent. Doing it any other way (dividing first, or
/// truncating) loses up to a cent per budget per period, and this figure is then
/// summed across every budget — so the error would scale with how many
/// categories the user keeps.
pub fn prorate_budget(
    amount: Cents,
    period: BudgetPeriod,
    active_months: Option<&[u32]>,
    schedule_type: &str,
    period_start: NaiveDate,
    period_end: NaiveDate,
) -> Cents {
    let Some(divisor) = schedule_divisor(schedule_type) else {
        return Cents(0);
    };

    if let Some(months) = active_months {
        if !months.is_empty() && !season_overlaps(months, period_start, period_end) {
            return Cents(0);
        }
    }

    let numerator = match period {
        BudgetPeriod::Monthly => amount.0 * 12,
        BudgetPeriod::Yearly => amount.0,
    };
    Cents(div_round(numerator, divisor))
}

/// Does any active month fall inside the period?
///
/// Months are 1-indexed. The period can straddle a year boundary (Dec 20 – Jan
/// 3), in which case the range wraps and the test inverts.
fn season_overlaps(months: &[u32], period_start: NaiveDate, period_end: NaiveDate) -> bool {
    use chrono::Datelike;
    let start_month = period_start.month();
    let end_month = period_end.month();

    months.iter().any(|&m| {
        if start_month <= end_month {
            m >= start_month && m <= end_month
        } else {
            m >= start_month || m <= end_month
        }
    })
}

/// Integer division rounded half away from zero.
fn div_round(numerator: i64, divisor: i64) -> i64 {
    if divisor == 0 {
        return 0;
    }
    let half = divisor.abs() / 2;
    if (numerator >= 0) == (divisor >= 0) {
        (numerator + half * numerator.signum()) / divisor
    } else {
        (numerator - half * numerator.signum().abs()) / divisor
    }
}

/// A recurring bill that falls in this period.
#[derive(Debug, Clone)]
pub struct PeriodExpense {
    pub budget_id: String,
    pub amount: Cents,
}

/// One budget's allocation, as the prediction sees it.
#[derive(Debug, Clone)]
pub struct BudgetAllocation {
    pub budget_id: String,
    pub amount: Cents,
    pub period: BudgetPeriod,
    /// `None` means year-round.
    pub active_months: Option<Vec<u32>>,
    /// Whether any recurring expense is filed against this budget.
    pub has_linked_expenses: bool,
}

/// One discretionary transaction.
#[derive(Debug, Clone, Copy)]
pub struct SpendTx {
    pub date: NaiveDate,
    pub amount: Cents,
}

#[derive(Debug, Clone)]
pub struct DailyPoint {
    /// 1-indexed.
    pub day_number: i64,
    pub date: NaiveDate,
    pub expected_cumulative: Cents,
    /// `None` for days that have not happened yet — the chart draws no actual
    /// line into the future rather than a misleading flat one.
    pub actual_cumulative: Option<Cents>,
}

#[derive(Debug, Clone)]
pub struct SpendPrediction {
    pub expected_period_spend: Cents,
    pub over_under_amount: Cents,
    pub period_start_date: NaiveDate,
    pub period_end_date: NaiveDate,
    pub current_day_number: i64,
    pub total_days: i64,
    pub daily_data: Vec<DailyPoint>,
}

pub struct PredictionInput<'a> {
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
    pub today: NaiveDate,
    pub schedule_type: &'a str,
    pub period_expenses: &'a [PeriodExpense],
    pub budget_allocations: &'a [BudgetAllocation],
    pub transactions: &'a [SpendTx],
}

pub fn compute_spend_prediction(input: PredictionInput<'_>) -> SpendPrediction {
    let total_days = (input.period_end - input.period_start).num_days() + 1;
    let current_day_number =
        ((input.today - input.period_start).num_days() + 1).min(total_days.max(1));

    // ── What each budget already owes to recurring bills ──
    let mut recurring: HashMap<&str, Cents> = HashMap::new();
    for e in input.period_expenses {
        let slot = recurring.entry(e.budget_id.as_str()).or_insert(Cents(0));
        *slot += e.amount;
    }

    // ── What each budget is worth this period ──
    let mut allocation: HashMap<&str, Cents> = HashMap::new();
    let mut linked: HashSet<&str> = HashSet::new();
    for cb in input.budget_allocations {
        let prorated = prorate_budget(
            cb.amount,
            cb.period,
            cb.active_months.as_deref(),
            input.schedule_type,
            input.period_start,
            input.period_end,
        );
        let slot = allocation.entry(cb.budget_id.as_str()).or_insert(Cents(0));
        *slot += prorated;
        if cb.has_linked_expenses {
            linked.insert(cb.budget_id.as_str());
        }
    }

    // ── The discretionary total ──
    let mut expected_period_spend = Cents(0);
    let ids: HashSet<&str> = recurring.keys().chain(allocation.keys()).copied().collect();
    for id in ids {
        let recurring_amount = recurring.get(id).copied().unwrap_or(Cents(0));
        let budget = allocation.get(id).copied().unwrap_or(Cents(0));

        if linked.contains(id) {
            // Linked: only what survives the bills, floored at zero. A budget
            // overrun by its own recurring bills does not lend negative room to
            // the others.
            let remainder = budget - recurring_amount;
            if remainder.0 > 0 {
                expected_period_spend += remainder;
            }
        } else if budget.0 > 0 {
            // Unlinked: nothing is spoken for, so all of it is discretionary.
            expected_period_spend += budget;
        }
        // Recurring bills with no allocation contribute nothing.
    }

    // ── Actual spending, bucketed by day ──
    let mut by_day: HashMap<i64, Cents> = HashMap::new();
    for tx in input.transactions {
        let day = (tx.date - input.period_start).num_days() + 1;
        if day >= 1 && day <= total_days {
            let slot = by_day.entry(day).or_insert(Cents(0));
            *slot += tx.amount;
        }
    }

    // ── The two lines ──
    //
    // The expected line is `total × day / total_days`, computed from the total
    // each time rather than by accumulating a per-day rate. Accumulating would
    // round once per day and drift, so the last point would miss the period
    // total by up to `total_days` half-cents — on a chart whose whole purpose is
    // "am I on track for the total".
    let mut daily_data = Vec::with_capacity(total_days.max(0) as usize);
    let mut running = Cents(0);
    for i in 0..total_days {
        let day_number = i + 1;
        let date = input.period_start + Duration::days(i);
        let expected_cumulative = if total_days > 0 {
            Cents(div_round(expected_period_spend.0 * day_number, total_days))
        } else {
            Cents(0)
        };

        let actual_cumulative = if day_number <= current_day_number {
            running += by_day.get(&day_number).copied().unwrap_or(Cents(0));
            Some(running)
        } else {
            None
        };

        daily_data.push(DailyPoint {
            day_number,
            date,
            expected_cumulative,
            actual_cumulative,
        });
    }

    let over_under_amount = daily_data
        .get((current_day_number - 1).max(0) as usize)
        .map(|d| d.actual_cumulative.unwrap_or(Cents(0)) - d.expected_cumulative)
        .unwrap_or(Cents(0));

    SpendPrediction {
        expected_period_spend,
        over_under_amount,
        period_start_date: input.period_start,
        period_end_date: input.period_end,
        current_day_number,
        total_days,
        daily_data,
    }
}
