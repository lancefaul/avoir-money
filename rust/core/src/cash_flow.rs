//! Cash-flow classification and the pay-period summary.
//!
//! Ported from the pure half of `apps/api/src/lib/cash-flow.ts`. The database
//! helpers that live alongside it there stay in the API layer, because they are
//! queries rather than rules.
//!
//! The question this answers is "how much cash do I need to get through this
//! period", which is not the same as "how much am I spending". Money on a credit
//! card is spent now and paid later; money in an HSA is not spendable at all.

use crate::money::Cents;

/// Where an expense's money actually comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpenseKind {
    /// Draws down spendable cash this period.
    Cash,
    /// Charged now, paid off later — it belongs to next period's cash need.
    Credit,
    /// Neither. See `CASH_EXCLUDED_TYPES`.
    Excluded,
}

impl ExpenseKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExpenseKind::Cash => "cash",
            ExpenseKind::Credit => "credit",
            ExpenseKind::Excluded => "excluded",
        }
    }
}

/// Account types whose balances are NOT spendable cash.
///
/// - `HSA` — trapped, medical-only.
/// - `Rewards` — a rewards account (a child of a card) holds redeemable
///   rewards, not cash; redeeming them is a payment leg on that account rather
///   than cash spending.
///
/// They count as neither cash income, cash spending, nor part of the cash pool.
pub const CASH_EXCLUDED_TYPES: [&str; 2] = ["HSA", "Rewards"];

/// Classify an expense from the account type it is paid from.
///
/// Everything unrecognised — including `None`, `Checking`, `Savings` and
/// `Gift Card` — is cash. That default is deliberate: an unknown account type
/// showing up as cash overstates the cash need, which is the safe direction to
/// be wrong in.
pub fn classify_expense(account_type: Option<&str>) -> ExpenseKind {
    match account_type {
        Some("Credit Card") => ExpenseKind::Credit,
        Some(t) if CASH_EXCLUDED_TYPES.contains(&t) => ExpenseKind::Excluded,
        _ => ExpenseKind::Cash,
    }
}

/// One expense line, as the summary sees it.
#[derive(Debug, Clone, Copy)]
pub struct CashFlowItem {
    pub kind: ExpenseKind,
    pub amount: Cents,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CashFlowSummary {
    pub cash_expenses: Cents,
    pub credit_expenses: Cents,
    /// What last period's credit spending left owing — due this period.
    pub previous_period_credit_expenses: Cents,
    pub previous_period_bank_balance: Cents,
    /// `cash_expenses + previous_period_credit_expenses`.
    pub cash_needed: Cents,
    pub credit_card_payments: Cents,
}

/// Partition this period's expenses and derive the cash requirement.
///
/// Pure by design — every figure that needs the database is passed in, so the
/// rule can be tested without one.
pub fn compute_cash_flow_summary(
    items: &[CashFlowItem],
    previous_period_credit_total: Cents,
    previous_period_bank_balance: Cents,
    credit_card_payments: Cents,
) -> CashFlowSummary {
    let mut cash_expenses = Cents(0);
    let mut credit_expenses = Cents(0);

    for item in items {
        match item.kind {
            ExpenseKind::Cash => cash_expenses += item.amount,
            ExpenseKind::Credit => credit_expenses += item.amount,
            // Trapped cash counts toward neither total.
            ExpenseKind::Excluded => {}
        }
    }

    CashFlowSummary {
        cash_expenses,
        credit_expenses,
        previous_period_credit_expenses: previous_period_credit_total,
        previous_period_bank_balance,
        cash_needed: cash_expenses + previous_period_credit_total,
        credit_card_payments,
    }
}
