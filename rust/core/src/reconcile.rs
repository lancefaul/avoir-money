//! Statement reconciliation — port of `packages/core/src/reconcile/`.
//!
//! **Placement note (see `.kiro/docs/PLACEMENT.md`).** This module is split
//! across the wire in the TypeScript, and the split is not obvious:
//!
//! - `reconcile` (the matcher) is imported by `apps/api` and **not** by the web.
//! - The hints (`findDuplicates`, `findReversals`, `findCombinations`,
//!   `findClusters`, `findDuplicateRuns`, `classifyLeftovers`) are **frontend
//!   only** and are therefore NOT ported — they stay in TypeScript with the
//!   frontend that survives the rewrite.
//! - `appTxDirection` is used by **both** sides. It is one of only four pieces
//!   of genuinely shared logic in the whole of `packages/core`, which is why it
//!   is worth being careful with: the two sides must agree on it or a statement
//!   line and its app row will disagree about which way the money moved.

/// Which way money moved, from the statement's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Money into the account.
    Credit,
    /// Money out of the account.
    Charge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TradeDirection {
    Buy,
    Sell,
}

/// The direction an app transaction represents.
///
/// `inbound` marks the destination side of a transfer — the same row is a
/// charge to the source account and a credit to the destination, so direction
/// cannot be read from `type` alone (ADR-018 is the ledger-side version of the
/// same fact).
///
/// The TRADE arm is the subtle one: a SELL puts money back into the funding
/// account, so it reads as a credit even though a trade is normally an outflow.
/// The comment at `reconciliations.ts:285` calls this out specifically — it is
/// what lets a Cash Wallet sell reconcile against a statement credit.
pub fn app_tx_direction(
    tx_type: &str,
    inbound: bool,
    trade_direction: Option<TradeDirection>,
) -> Direction {
    if inbound || tx_type == "REFUND" || tx_type == "INCOME" {
        return Direction::Credit;
    }
    if tx_type == "TRADE" && trade_direction == Some(TradeDirection::Sell) {
        return Direction::Credit;
    }
    Direction::Charge
}
