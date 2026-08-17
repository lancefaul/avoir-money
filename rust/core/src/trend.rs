//! Per-pay-period income/expense trend.
//!
//! Ported from `apps/api/src/lib/income-trend.ts` and the display-status mapping
//! in `schedule-status-map.ts` / `pause.ts`, which the trend and the
//! current-period summary both need.
//!
//! # Three kinds of period, three sources of truth
//!
//! - **Past** — actuals only. What happened is known.
//! - **Current** — actuals so far, plus what is still PENDING for the rest of it.
//! - **Future** — scheduled amounts only, because nothing has happened yet.
//!
//! Mixing them is what makes the chart wrong in the specific way users notice:
//! a current period that counted only actuals would dip toward zero every time
//! it was viewed early, then jump as the bills landed.

use crate::money::Cents;
use chrono::{Datelike, NaiveDate};

// ─── Period classification ───

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeriodKind {
    Past,
    Current,
    Future,
}

impl PeriodKind {
    /// Whether the figures for this period are a projection rather than a record.
    pub fn projected(self) -> bool {
        !matches!(self, PeriodKind::Past)
    }
}

pub fn classify_period(start: NaiveDate, end: NaiveDate, today: NaiveDate) -> PeriodKind {
    if end < today {
        PeriodKind::Past
    } else if start > today {
        PeriodKind::Future
    } else {
        PeriodKind::Current
    }
}

// ─── Totals ───

/// A transaction as the trend sees it. Already filtered to top-level rows.
#[derive(Debug, Clone, Copy)]
pub struct TrendTx<'a> {
    pub amount: Cents,
    /// What the account was actually charged.
    pub net_amount: Cents,
    pub tx_type: &'a str,
    pub date: NaiveDate,
}

/// A scheduled occurrence as the trend sees it.
#[derive(Debug, Clone, Copy)]
pub struct TrendScheduled<'a> {
    pub expected_amount: Cents,
    /// `INCOME` or `EXPENSE`.
    pub source_type: &'a str,
    pub status: &'a str,
    pub due_date: NaiveDate,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Totals {
    pub income: Cents,
    pub expenses: Cents,
    pub trades: Cents,
}

fn in_period(d: NaiveDate, start: NaiveDate, end: NaiveDate) -> bool {
    d >= start && d <= end
}

/// Actuals only.
///
/// Income uses gross `amount` while expenses use `net_amount`: a deposit is
/// worth what arrived, and a charge costs what the account was actually billed.
/// A REFUND subtracts, so a returned purchase does not stay counted as spending.
pub fn compute_past_period_totals(
    transactions: &[TrendTx<'_>],
    start: NaiveDate,
    end: NaiveDate,
) -> Totals {
    let mut t = Totals::default();
    for tx in transactions {
        if !in_period(tx.date, start, end) {
            continue;
        }
        match tx.tx_type {
            "INCOME" => t.income += tx.amount,
            "EXPENSE" => t.expenses += tx.net_amount,
            "TRADE" => t.trades += tx.amount,
            "REFUND" => t.expenses -= tx.net_amount,
            _ => {}
        }
    }
    t
}

/// Actuals so far, plus what is still PENDING.
///
/// Only PENDING is added. A PAID occurrence already has a real transaction
/// counted above, so including it would double the bill; SKIPPED and SNOOZED are
/// deliberate decisions that it is not happening in this period.
pub fn compute_current_period_totals(
    transactions: &[TrendTx<'_>],
    scheduled: &[TrendScheduled<'_>],
    start: NaiveDate,
    end: NaiveDate,
) -> Totals {
    let mut t = compute_past_period_totals(transactions, start, end);
    for s in scheduled {
        if s.status != "PENDING" || !in_period(s.due_date, start, end) {
            continue;
        }
        match s.source_type {
            "INCOME" => t.income += s.expected_amount,
            "EXPENSE" => t.expenses += s.expected_amount,
            _ => {}
        }
    }
    t
}

/// Scheduled amounts only. Trades are never projected — a future trade is a
/// decision nobody has made yet.
pub fn compute_future_period_totals(
    scheduled: &[TrendScheduled<'_>],
    start: NaiveDate,
    end: NaiveDate,
) -> Totals {
    let mut t = Totals::default();
    for s in scheduled {
        if s.status != "PENDING" || !in_period(s.due_date, start, end) {
            continue;
        }
        match s.source_type {
            "INCOME" => t.income += s.expected_amount,
            "EXPENSE" => t.expenses += s.expected_amount,
            _ => {}
        }
    }
    t
}

// ─── Budget projection ───

/// Pay periods per year. Defaults to biweekly — the same fallback the
/// TypeScript used, and the commonest schedule.
pub fn periods_per_year(schedule_type: &str) -> i64 {
    match schedule_type {
        "WEEKLY" => 52,
        "SEMI_MONTHLY" => 24,
        "MONTHLY" => 12,
        _ => 26,
    }
}

/// A monthly budget figure expressed per pay period.
///
/// Rounded half away from zero, once, on the scaled numerator — the same policy
/// as `prediction::prorate_budget`, and for the same reason: this is summed over
/// every budget, so a per-budget rounding error would scale with the number of
/// categories.
pub fn prorate_budget_to_period(monthly_equivalent: Cents, periods_per_year: i64) -> Cents {
    if periods_per_year == 0 {
        return Cents(0);
    }
    let numerator = monthly_equivalent.0 * 12;
    let half = periods_per_year.abs() / 2;
    let adjusted = if numerator >= 0 {
        numerator + half
    } else {
        numerator - half
    };
    Cents(adjusted / periods_per_year)
}

/// Whether a seasonal budget applies to this period.
///
/// An empty month list means year-round. Months here are **0-indexed**, matching
/// the caller that subtracts one from the stored 1-indexed values — a mismatch
/// silently shifts every season by a month, so the indexing is stated rather
/// than inferred.
pub fn is_seasonal_budget_active_for_period(
    active_months: &[u32],
    start: NaiveDate,
    end: NaiveDate,
) -> bool {
    if active_months.is_empty() {
        return true;
    }
    let s = start.month0();
    let e = end.month0();
    active_months.contains(&s) || active_months.contains(&e)
}

// ─── Display status ───

/// What a scheduled occurrence looks like on the dashboard.
///
/// Ported from `schedule-status-map.ts`. The stored status is what the user did;
/// the display status folds in what the calendar has since done to it.
pub fn map_schedule_status(
    status: &str,
    due_date: NaiveDate,
    snoozed_until: Option<NaiveDate>,
    today: NaiveDate,
) -> &'static str {
    match status {
        "PAID" => "PAID",
        "PARTIAL" => "PARTIAL",
        "SKIPPED" => "SKIPPED",
        "SNOOZED" => {
            // An expired snooze falls back to the due/overdue rules — otherwise
            // a bill snoozed once stays quietly hidden forever.
            match snoozed_until {
                Some(until) if until > today => "SNOOZED",
                _ => due_status(due_date, today),
            }
        }
        _ => due_status(due_date, today),
    }
}

fn due_status(due_date: NaiveDate, today: NaiveDate) -> &'static str {
    if due_date < today {
        "OVERDUE"
    } else if due_date > today {
        "UPCOMING"
    } else {
        "DUE"
    }
}

/// Whether a paused source is still paused.
///
/// Strictly greater than: a pause through today has expired by the time today
/// arrives, which is what makes `pausedUntil = today` mean "resumes today".
pub fn is_paused(paused_until: Option<NaiveDate>, today: NaiveDate) -> bool {
    matches!(paused_until, Some(d) if d > today)
}
