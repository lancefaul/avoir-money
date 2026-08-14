//! Exhaustive differential test for `appTxDirection`.
//!
//! All 30 combinations. This one matters disproportionately for its size: it is
//! one of only four pieces of logic in `packages/core` used by BOTH the API and
//! the web, so a divergence here means the two sides disagree about which way
//! money moved on the same row.

use avoir_core::reconcile::*;
use serde_json::Value;

#[test]
fn direction_matches_typescript_exhaustively() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/direction_vectors.json")).unwrap();
    assert_eq!(doc["exhaustive"], true);
    let vectors = doc["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), 30);

    let mut problems = Vec::new();
    let mut credits = 0;

    for v in vectors {
        let iv = &v["in"];
        let dir = match iv["tradeDirection"].as_str() {
            Some("BUY") => Some(TradeDirection::Buy),
            Some("SELL") => Some(TradeDirection::Sell),
            _ => None,
        };
        let got = app_tx_direction(
            iv["type"].as_str().unwrap(),
            iv["inbound"].as_bool().unwrap(),
            dir,
        );
        if got == Direction::Credit {
            credits += 1;
        }
        let want = match v["out"].as_str().unwrap() {
            "credit" => Direction::Credit,
            "charge" => Direction::Charge,
            o => panic!("unknown direction in fixture: {o}"),
        };
        if got != want {
            problems.push(format!("{iv}: rust {got:?}, ts {want:?}"));
        }
    }

    assert_eq!(credits, 22, "22 of 30 combinations are credits");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The TRADE/SELL case, stated on its own because it is the non-obvious rule
/// and the one a reimplementation would most likely drop.
#[test]
fn a_trade_sell_is_a_credit_but_a_trade_buy_is_not() {
    assert_eq!(
        app_tx_direction("TRADE", false, Some(TradeDirection::Sell)),
        Direction::Credit,
        "a sell returns money to the funding account"
    );
    assert_eq!(
        app_tx_direction("TRADE", false, Some(TradeDirection::Buy)),
        Direction::Charge
    );
    assert_eq!(app_tx_direction("TRADE", false, None), Direction::Charge);
}

/// Inbound wins over everything — the destination side of a transfer is a
/// credit regardless of the row's own type.
#[test]
fn inbound_overrides_the_type() {
    for t in ["EXPENSE", "TRANSFER", "TRADE", "INCOME", "REFUND"] {
        assert_eq!(
            app_tx_direction(t, true, Some(TradeDirection::Buy)),
            Direction::Credit,
            "{t} inbound should be a credit"
        );
    }
}
