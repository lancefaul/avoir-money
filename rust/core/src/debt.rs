//! Debt calculations — port of `packages/core/src/utils/debt-calc.ts`.
//!
//! Ported deliberately close to the original rather than idiomatically, because
//! its behaviour is load-bearing and hard-won: ADR-023 and ADR-031 are both
//! about getting the payment figure right, and both were written after the app
//! displayed a payment the user had never made. The differential tests compare
//! this against the live TypeScript on shared inputs, which only means something
//! if the two are structurally comparable.

use crate::money::{js_round, Cents, Percent};
use chrono::{Datelike, NaiveDate};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Weekly,
    Biweekly,
    SemiMonthly,
    Monthly,
    Quarterly,
    Biannual,
    Annual,
}

/// Payment periods per year. `None` means monthly — matching the TypeScript's
/// `default:` arm, which catches both an absent frequency and MONTHLY.
impl Frequency {
    /// The stored spelling. `None` for anything unrecognised — including
    /// MONTHLY's absence, which `periods_per_year` already treats as monthly.
    pub fn from_stored(s: &str) -> Option<Self> {
        Some(match s {
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

pub fn periods_per_year(freq: Option<Frequency>) -> u32 {
    match freq {
        Some(Frequency::Weekly) => 52,
        Some(Frequency::Biweekly) => 26,
        Some(Frequency::SemiMonthly) => 24,
        Some(Frequency::Quarterly) => 4,
        Some(Frequency::Biannual) => 2,
        Some(Frequency::Annual) => 1,
        Some(Frequency::Monthly) | None => 12,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaymentSplit {
    pub principal: Cents,
    pub interest: Cents,
}

/// Split a payment into principal and interest for one period.
///
/// Interest is the rounded period interest on the current balance; principal is
/// whatever is left, floored at zero so an under-payment never reports negative
/// principal. Note the consequence, which the TypeScript shares: when the
/// payment does not cover interest, `principal + interest > payment`. That is
/// negative amortization, and `generate_amortization` refuses to build a
/// schedule for it rather than letting it run.
pub fn split_payment(
    current_balance: Cents,
    apr: Percent,
    payment_amount: Cents,
    frequency: Option<Frequency>,
) -> PaymentSplit {
    let pp_year = periods_per_year(frequency) as f64;

    // TS: Math.round(((balance * apr) / 100 / ppYear) * 100) / 100
    // In cents that is the same expression without the ×100/÷100 dance.
    let interest_cents =
        js_round(current_balance.0 as f64 * apr.as_percent_f64() / 100.0 / pp_year);
    let interest = Cents(interest_cents as i64);

    let mut principal = payment_amount - interest;
    if principal.is_negative() {
        principal = Cents::ZERO;
    }
    PaymentSplit {
        principal,
        interest,
    }
}

/// The fixed periodic P&I payment from the standard amortization (PMT) formula:
///
/// ```text
///   M = P · [ r(1+r)^n ] / [ (1+r)^n − 1 ]
/// ```
///
/// Returns `None` when the terms cannot amortize (non-positive principal or
/// term), signalling the caller to fall back to the stored payment.
///
/// **On the float in here.** `(1+r)^n` is genuinely transcendental and there is
/// no exact-decimal form of it. ADR-033 governs how money is *stored* and
/// *aggregated*, not a prohibition on float inside a closed-form formula — and
/// the rule it does impose is honoured: the result is rounded to whole cents
/// before it leaves this function, so nothing downstream ever sees a fraction.
pub fn compute_amortized_payment(
    original_balance: Cents,
    apr: Percent,
    term_months: i64,
    frequency: Option<Frequency>,
) -> Option<Cents> {
    if original_balance.0 <= 0 || term_months <= 0 {
        return None;
    }
    let pp_year = periods_per_year(frequency);
    // TS: Math.round((termMonths * ppYear) / 12)
    let n = js_round((term_months as f64 * pp_year as f64) / 12.0);
    if n <= 0.0 {
        return None;
    }
    let r = apr.as_fraction_f64() / pp_year as f64;

    if r <= 0.0 {
        // Zero or negative interest: straight-line principal repayment.
        return Some(Cents(js_round(original_balance.0 as f64 / n) as i64));
    }

    let factor = (1.0 + r).powf(n);
    let payment = (original_balance.0 as f64 * (r * factor)) / (factor - 1.0);
    if !payment.is_finite() {
        return None;
    }
    Some(Cents(js_round(payment) as i64))
}

pub struct BasePaymentInput {
    pub minimum_payment: Cents,
    pub original_balance: Option<Cents>,
    pub apr: Percent,
    pub term_months: Option<i64>,
    pub frequency: Option<Frequency>,
}

/// The payment to amortize against and to display.
///
/// **The recorded payment outranks the reconstructed one** (ADR-031, amending
/// ADR-023). `minimum_payment` is what the lender actually charges; the PMT
/// formula is a reconstruction that only reproduces it when the stored terms
/// are exactly the lender's, and in production they are not — `termMonths: 71`
/// on both auto loans is months-remaining rather than the full schedule. The
/// reconstruction stayed wrong by $6.63 and $8.15 on real loans.
///
/// The reconstruction remains the fallback for a debt with no recorded payment,
/// where it is genuinely right: a mortgage's P&I cannot be read off the bill,
/// because the bill is PITI.
///
/// **Safety note carried over from ADR-031:** because the stored payment is
/// trusted, nothing downstream can detect escrow hidden inside it. The guarantee
/// lives at the debt form, which stores derived P&I rather than PITI. A test
/// pins that a contaminated `minimum_payment` *would* double-count, so the risk
/// stays visible if that form ever changes.
pub fn resolve_base_payment(debt: &BasePaymentInput) -> Cents {
    if debt.minimum_payment.0 > 0 {
        return debt.minimum_payment;
    }
    compute_amortized_payment(
        debt.original_balance.unwrap_or(Cents::ZERO),
        debt.apr,
        debt.term_months.unwrap_or(0),
        debt.frequency,
    )
    .unwrap_or(debt.minimum_payment)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AmortizationEntry {
    pub period: u32,
    pub payment_amount: Cents,
    pub principal_amount: Cents,
    pub interest_amount: Cents,
    pub escrow_amount: Cents,
    pub remaining_balance: Cents,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmortizationResult {
    pub entries: Vec<AmortizationEntry>,
    pub total_interest: Cents,
    pub total_payments: Cents,
    pub total_escrow: Cents,
    pub payoff_periods: u32,
    pub is_negatively_amortizing: bool,
}

/// Hard ceiling on schedule length (ADR-011). 600 months exceeds any realistic
/// mortgage, and the cap is what makes this function safe to fuzz: without it,
/// a negatively-amortizing input produces an unbounded schedule.
pub const MAX_MONTHS: u32 = 600;

pub struct DebtInput {
    pub current_balance: Cents,
    pub apr: Percent,
    pub minimum_payment: Cents,
    pub frequency: Option<Frequency>,
    pub term_months: Option<i64>,
    pub original_balance: Option<Cents>,
    /// Fixed-term debts only. With `start_date`, caps the schedule length.
    pub maturity_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
}

impl DebtInput {
    /// An open-ended debt (a credit card): no term, no maturity, so the
    /// schedule runs to natural payoff or the ADR-011 cap.
    pub fn revolving(current_balance: Cents, apr: Percent, minimum_payment: Cents) -> Self {
        DebtInput {
            current_balance,
            apr,
            minimum_payment,
            frequency: Some(Frequency::Monthly),
            term_months: None,
            original_balance: None,
            maturity_date: None,
            start_date: None,
        }
    }
}

/// How many payment periods remain on a fixed-term debt, or `None` for an
/// open-ended one (a credit card).
///
/// **Takes `today` rather than reading the clock.** The TypeScript calls
/// `new Date()` inside `remainingTermPeriods`, which makes
/// `generateAmortization` impure: the same debt produces a different schedule
/// tomorrow. That is invisible until it matters — with `startDate 2025-01-01`
/// and `termMonths 6`, the term is already elapsed, `remaining` clamps to 1,
/// and the whole balance becomes a single balloon payment. Passing the date in
/// makes the behaviour testable and the dependency obvious at every call site.
pub fn remaining_term_periods(debt: &DebtInput, today: NaiveDate) -> Option<u32> {
    let pp_year = periods_per_year(debt.frequency) as i64;

    if let Some(maturity) = debt.maturity_date {
        let months = diff_months(maturity, today);
        let periods = div_ceil_i64(months * pp_year, 12);
        return Some(periods.max(1) as u32);
    }
    if let (Some(start), Some(term)) = (debt.start_date, debt.term_months) {
        if term > 0 {
            let elapsed = diff_months(today, start);
            let remaining_months = (term - elapsed).max(0);
            let periods = div_ceil_i64(remaining_months * pp_year, 12);
            return Some(periods.max(1) as u32);
        }
    }
    None
}

/// Whole months between two dates, by calendar position — matches the
/// TypeScript's `(y2-y1)*12 + (m2-m1)`, which ignores the day of month.
fn diff_months(a: NaiveDate, b: NaiveDate) -> i64 {
    (a.year() as i64 - b.year() as i64) * 12 + (a.month() as i64 - b.month() as i64)
}

fn div_ceil_i64(n: i64, d: i64) -> i64 {
    if n <= 0 {
        0
    } else {
        (n + d - 1) / d
    }
}

/// Convert payment periods to months, rounding up.
fn periods_to_months(periods: u32, freq: Option<Frequency>) -> i64 {
    div_ceil_i64(periods as i64 * 12, periods_per_year(freq) as i64)
}

/// Generate a full amortization schedule, one entry per payment period.
///
/// Returns an empty schedule with `is_negatively_amortizing: true` when the
/// period interest meets or exceeds the payment — the balance would never fall,
/// so there is no schedule to show.
///
/// **Deliberate divergence from the TypeScript, and the one place in this port
/// where exact agreement was rejected.** The original runs the whole loop in
/// unrounded `f64` — interest, principal and the running balance all carry
/// sub-cent fractions, and rounding happens only when an entry is written. Its
/// own totals disagree with its own rows as a result: for a $5,000 / 12% /
/// $500 schedule it reports `totalInterest` 294.92 while the entries sum to
/// 294.93.
///
/// This runs in whole cents throughout, so the parts always sum to the total.
/// Reproducing the float drift would mean deliberately carrying forward exactly
/// the defect ADR-033 exists to remove. The differential test therefore
/// measures the divergence against the TypeScript rather than asserting
/// equality, and that measurement is the honest statement of what changed.
pub fn generate_amortization(
    debt: &DebtInput,
    extra_payment: Cents,
    escrow_amount: Cents,
    today: NaiveDate,
) -> AmortizationResult {
    let pp_year = periods_per_year(debt.frequency);

    let base = resolve_base_payment(&BasePaymentInput {
        minimum_payment: debt.minimum_payment,
        original_balance: debt.original_balance,
        apr: debt.apr,
        term_months: debt.term_months,
        frequency: debt.frequency,
    });
    let period_payment = base + extra_payment;

    let empty = |negative: bool| AmortizationResult {
        entries: Vec::new(),
        total_interest: Cents::ZERO,
        total_payments: Cents::ZERO,
        total_escrow: Cents::ZERO,
        payoff_periods: 0,
        is_negatively_amortizing: negative,
    };

    // The negative-amortization test uses the period interest on the OPENING
    // balance, matching the TypeScript's pre-loop check.
    let period_interest = period_interest_cents(debt.current_balance, debt.apr, pp_year);
    if period_interest >= period_payment {
        return empty(true);
    }
    if debt.current_balance.0 <= 0 {
        return empty(false);
    }

    let max_periods = div_ceil_i64(MAX_MONTHS as i64 * pp_year as i64, 12) as u32;
    let effective_max = remaining_term_periods(debt, today)
        .map(|t| t.min(max_periods))
        .unwrap_or(max_periods);

    let mut balance = debt.current_balance;
    let mut entries = Vec::new();
    let (mut total_interest, mut total_payments, mut total_escrow) =
        (Cents::ZERO, Cents::ZERO, Cents::ZERO);
    let mut period = 0u32;

    while balance.0 > 0 && period < effective_max {
        period += 1;
        let interest = period_interest_cents(balance, debt.apr, pp_year);
        let mut payment = period_payment;
        let mut principal = payment - interest;

        // Final period — natural payoff OR the term cap forcing a balloon.
        let is_last = period == effective_max && balance > principal;
        if principal >= balance || is_last {
            principal = balance;
            payment = principal + interest;
        }

        balance -= principal;
        total_interest += interest;
        let entry_payment = payment + escrow_amount;
        total_payments += entry_payment;
        total_escrow += escrow_amount;

        entries.push(AmortizationEntry {
            period,
            payment_amount: entry_payment,
            principal_amount: principal,
            interest_amount: interest,
            escrow_amount,
            remaining_balance: balance,
        });
    }

    AmortizationResult {
        entries,
        total_interest,
        total_payments,
        total_escrow,
        payoff_periods: period,
        is_negatively_amortizing: false,
    }
}

/// One period's interest on a balance: `balance × apr / 100 / periodsPerYear`,
/// rounded to the cent.
fn period_interest_cents(balance: Cents, apr: Percent, pp_year: u32) -> Cents {
    Cents(js_round(balance.0 as f64 * apr.as_percent_f64() / 100.0 / pp_year as f64) as i64)
}

/// The date a debt is paid off, or `None` if it never is.
///
/// Takes `from` explicitly for the same reason `remaining_term_periods` does.
pub fn estimate_payoff_date(
    debt: &DebtInput,
    from: NaiveDate,
    extra_payment: Cents,
    today: NaiveDate,
) -> Option<NaiveDate> {
    let result = generate_amortization(debt, extra_payment, Cents::ZERO, today);
    if result.is_negatively_amortizing {
        return None;
    }
    if result.payoff_periods == 0 {
        return Some(from);
    }

    let months = periods_to_months(result.payoff_periods, debt.frequency);
    let payoff = add_months(from, months);

    match debt.maturity_date {
        // A fixed-term debt with no extra payments pays off at maturity.
        Some(m) if extra_payment.0 == 0 => Some(m),
        // With extra payments, whichever comes first.
        Some(m) => Some(if payoff < m { payoff } else { m }),
        None => Some(payoff),
    }
}

/// Add months, clamping to the end of the target month so Jan 31 + 1 month is
/// Feb 28 rather than overflowing into March.
fn add_months(date: NaiveDate, months: i64) -> NaiveDate {
    let total = date.year() as i64 * 12 + (date.month() as i64 - 1) + months;
    let (y, m) = (
        (total.div_euclid(12)) as i32,
        (total.rem_euclid(12)) as u32 + 1,
    );
    let last = last_day_of(y, m);
    NaiveDate::from_ymd_opt(y, m, date.day().min(last)).expect("clamped date is valid")
}

fn last_day_of(year: i32, month: u32) -> u32 {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    (NaiveDate::from_ymd_opt(ny, nm, 1).unwrap() - chrono::Duration::days(1)).day()
}

/// Payment periods until payoff. Zero when negatively amortizing — callers
/// check `is_negatively_amortizing` separately.
pub fn months_remaining(debt: &DebtInput, extra_payment: Cents, today: NaiveDate) -> u32 {
    generate_amortization(debt, extra_payment, Cents::ZERO, today).payoff_periods
}
