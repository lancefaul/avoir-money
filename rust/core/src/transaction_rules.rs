//! Cross-field validation for transactions — port of
//! `transactionCrossFieldIssues` from `packages/core/src/schemas/transaction.ts`.
//!
//! **Why these rules take facts rather than a payload.** They originally lived
//! only in `CreateTransactionSchema`'s `superRefine`, so every one of them was
//! enforced on create and silently skipped on update — `UpdateTransactionSchema`
//! is a `.partial()` and carries no refinement. An update could strip a TRADE's
//! funding account or mark an EXPENSE as cash back. Neither was reachable from
//! the UI, which is why it went unnoticed until v0.8.
//!
//! On update, "does this have trade metadata?" is answered by the stored row's
//! relation, not by the request body. Taking booleans lets the route merge
//! stored state with incoming changes and ask exactly the question the create
//! path asks, so the two cannot drift apart again.
//!
//! A partial update may not send `type` at all, so **the caller must resolve it
//! against the stored row first.** Refining the partial directly would evaluate
//! every rule against `undefined` and pass everything — the trap this shape
//! exists to avoid.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransactionType {
    Expense,
    Income,
    Transfer,
    Refund,
    Trade,
}

/// The resolved facts a transaction presents, whether it is being created or
/// updated. Deliberately booleans, not a DTO — see the module note.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrossFieldFacts {
    pub transaction_type: TransactionType,
    pub has_funding_account: bool,
    pub has_trade_metadata: bool,
    pub has_bitcoin_metadata: bool,
    pub is_cash_back: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrossFieldIssue {
    /// The field the issue belongs to, matching the create path's `path` entries.
    pub path: &'static str,
    pub message: &'static str,
}

/// All cross-field problems with a transaction, in a stable order.
///
/// Empty means valid. The order matters only because it is asserted against the
/// TypeScript, which builds the list top to bottom.
pub fn cross_field_issues(f: &CrossFieldFacts) -> Vec<CrossFieldIssue> {
    use TransactionType::*;
    let mut issues = Vec::new();
    let is_trade = f.transaction_type == Trade;

    if is_trade && !f.has_trade_metadata {
        issues.push(CrossFieldIssue {
            path: "tradeMetadata",
            message: "Trade metadata is required for TRADE transactions",
        });
    }
    if !is_trade && f.has_trade_metadata {
        issues.push(CrossFieldIssue {
            path: "tradeMetadata",
            message: "Trade metadata should only be provided for TRADE transactions",
        });
    }

    // A trade must be funded from a tracked account. The web form already
    // forces this, but the API path did not — which is how NULL-accountId
    // trades slipped in, the Cash Wallet BTC buys whose cash was never debited.
    if is_trade && !f.has_funding_account {
        issues.push(CrossFieldIssue {
            path: "accountId",
            message: "A funding account is required for TRADE transactions",
        });
    }

    // Cash back is a statement about income — a rebate on spending rather than
    // money earned. On any other type the flag has no meaning, and a row
    // carrying a meaningless flag is one nobody can interpret later.
    if f.is_cash_back && f.transaction_type != Income {
        issues.push(CrossFieldIssue {
            path: "isCashBack",
            message: "Cash back can only be set on INCOME transactions",
        });
    }

    if f.has_bitcoin_metadata {
        if is_trade {
            issues.push(CrossFieldIssue {
                path: "bitcoinMetadata",
                message:
                    "Bitcoin metadata is not allowed for TRADE transactions; use tradeMetadata",
            });
        }
        if f.transaction_type == Transfer {
            issues.push(CrossFieldIssue {
                path: "bitcoinMetadata",
                message:
                    "Bitcoin metadata is not allowed for TRANSFER transactions; use the transfer endpoint",
            });
        }
        if f.has_funding_account {
            issues.push(CrossFieldIssue {
                path: "bitcoinMetadata",
                message: "Cannot provide both bitcoinMetadata and accountId",
            });
        }
    }

    issues
}
