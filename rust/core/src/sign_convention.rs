//! CSV import sign conventions — port of
//! `packages/core/src/schemas/sign-convention.ts`.
//!
//! Every bank exports signs differently: some write spending as a negative,
//! some as a positive, and credit-card statements often invert the lot. This
//! turns a raw CSV amount into the app's internal convention, or reports that
//! the row should be skipped.
//!
//! **The user-facing model is deliberately flipped** (ADR-015). The config asks
//! "spending appears as: positive / negative", not "what does a positive number
//! mean?" — the latter requires understanding CSV semantics, and confused
//! people. `negative_expense_meaning` therefore carries a `Spending` variant
//! that replaced the old `Ignore` option for end users.
//!
//! Ported faithfully, including two behaviours that are arguably defects; see
//! `normalize_income`.

use crate::money::Cents;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositiveExpenseMeaning {
    MoneyOut,
    MoneyIn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NegativeExpenseMeaning {
    Refund,
    Ignore,
    /// Added by ADR-015: a negative row is ordinary spending, which is how most
    /// banks export credit-card statements.
    Spending,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositiveIncomeMeaning {
    MoneyIn,
    MoneyOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NegativeIncomeMeaning {
    FlipSign,
    Ignore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositiveTransferMeaning {
    Withdrawal,
    Deposit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PositiveTradeMeaning {
    Buy,
    Sell,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseSignRule {
    pub positive_meaning: PositiveExpenseMeaning,
    pub negative_meaning: NegativeExpenseMeaning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomeSignRule {
    pub positive_meaning: PositiveIncomeMeaning,
    pub negative_meaning: NegativeIncomeMeaning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSignRule {
    pub positive_meaning: PositiveTransferMeaning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeSignRule {
    pub positive_meaning: PositiveTradeMeaning,
}

/// Note there is no `refund` field. The TypeScript config has one, but its
/// schema is `z.literal('money_in')` — a single possible value that
/// `normalizeRefund` then ignores, so it carries no information. Deliberately
/// dropped rather than modelled as a one-variant enum.
///
/// **This matters when serde is wired up**: the committed
/// `tools/import/sign-conventions.json` still has a `refund` key, so
/// deserialization must tolerate and discard it rather than reject the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
// An unknown `refund` key is ignored on the way in — serde does that by
// default, and refusing a file the app itself wrote would be worse than
// discarding a field carrying no information (its schema is
// `z.literal('money_in')`, one possible value, which `normalizeRefund` ignores).
//
// NOT `#[serde(default)]`. That was here briefly and was wrong twice over: it
// was never needed for the unknown key, and it made all four rules optional, so
// a partial PUT would have silently reset the ones it omitted. The reference
// requires every rule and 400s otherwise.
pub struct SignConventionConfig {
    pub expense: ExpenseSignRule,
    pub income: IncomeSignRule,
    pub transfer: TransferSignRule,
    pub trade: TradeSignRule,
}

impl Default for SignConventionConfig {
    /// Matches `DEFAULT_SIGN_CONVENTION_CONFIG` and the committed
    /// `tools/import/sign-conventions.json`.
    fn default() -> Self {
        SignConventionConfig {
            expense: ExpenseSignRule {
                positive_meaning: PositiveExpenseMeaning::MoneyOut,
                negative_meaning: NegativeExpenseMeaning::Refund,
            },
            income: IncomeSignRule {
                positive_meaning: PositiveIncomeMeaning::MoneyIn,
                negative_meaning: NegativeIncomeMeaning::FlipSign,
            },
            transfer: TransferSignRule {
                positive_meaning: PositiveTransferMeaning::Withdrawal,
            },
            trade: TradeSignRule {
                positive_meaning: PositiveTradeMeaning::Buy,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionType {
    Expense,
    Income,
    Transfer,
    Trade,
    Refund,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizeResult {
    Amount(Cents),
    /// The row should be skipped entirely, not imported as zero.
    Excluded,
}

fn normalize_expense(raw: Cents, rule: ExpenseSignRule) -> NormalizeResult {
    if raw.0 > 0 {
        return match rule.positive_meaning {
            PositiveExpenseMeaning::MoneyOut => NormalizeResult::Amount(-raw.abs()),
            PositiveExpenseMeaning::MoneyIn => NormalizeResult::Amount(raw.abs()),
        };
    }
    // raw < 0
    match rule.negative_meaning {
        NegativeExpenseMeaning::Refund | NegativeExpenseMeaning::Spending => {
            NormalizeResult::Amount(raw.abs())
        }
        NegativeExpenseMeaning::Ignore => NormalizeResult::Excluded,
    }
}

/// **Reproduces a defect deliberately.** The TypeScript takes the income rule
/// as `_rule` and returns `Math.abs(raw)` unconditionally, so BOTH configured
/// options are dead: `positiveMeaning: 'money_out'` behaves identically to
/// `'money_in'`, and `negativeMeaning: 'ignore'` never excludes anything — a
/// negative income row is imported as positive either way.
///
/// Not fixed here, because a port that quietly diverges is worse than one that
/// carries a known defect forward: the differential fixture would then be
/// asserting my opinion rather than the app's behaviour. The live config uses
/// `money_in` / `flip_sign`, so nothing is currently mis-imported.
///
/// Recorded in BACKLOG.md as a real fix to make in the TypeScript first, so
/// both sides can move together.
fn normalize_income(raw: Cents, _rule: IncomeSignRule) -> NormalizeResult {
    NormalizeResult::Amount(raw.abs())
}

fn normalize_transfer(raw: Cents, rule: TransferSignRule) -> NormalizeResult {
    let withdrawal = rule.positive_meaning == PositiveTransferMeaning::Withdrawal;
    if raw.0 > 0 {
        return if withdrawal {
            NormalizeResult::Amount(-raw.abs())
        } else {
            NormalizeResult::Amount(raw.abs())
        };
    }
    // raw < 0: the opposite of the positive meaning
    if withdrawal {
        NormalizeResult::Amount(raw.abs())
    } else {
        NormalizeResult::Amount(-raw.abs())
    }
}

fn normalize_trade(raw: Cents, rule: TradeSignRule) -> NormalizeResult {
    let buy = rule.positive_meaning == PositiveTradeMeaning::Buy;
    if raw.0 > 0 {
        return if buy {
            NormalizeResult::Amount(-raw.abs())
        } else {
            NormalizeResult::Amount(raw.abs())
        };
    }
    if buy {
        NormalizeResult::Amount(raw.abs())
    } else {
        NormalizeResult::Amount(-raw.abs())
    }
}

/// Refunds always land positive; the rule is a single literal and carries no
/// choice, so like income it is ignored — but here that is correct rather than
/// accidental.
fn normalize_refund(raw: Cents) -> NormalizeResult {
    NormalizeResult::Amount(raw.abs())
}

/// Normalize a raw CSV amount into the app's internal sign convention.
///
/// A zero amount is excluded rather than imported — a zero-value row carries no
/// money and is almost always a header artefact or a placeholder.
pub fn normalize_amount(
    raw_amount: Cents,
    ty: TransactionType,
    config: &SignConventionConfig,
) -> NormalizeResult {
    if raw_amount.0 == 0 {
        return NormalizeResult::Excluded;
    }
    match ty {
        TransactionType::Expense => normalize_expense(raw_amount, config.expense),
        TransactionType::Income => normalize_income(raw_amount, config.income),
        TransactionType::Transfer => normalize_transfer(raw_amount, config.transfer),
        TransactionType::Trade => normalize_trade(raw_amount, config.trade),
        TransactionType::Refund => normalize_refund(raw_amount),
    }
}
