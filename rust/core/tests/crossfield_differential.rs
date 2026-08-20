//! Exhaustive differential test for transaction cross-field validation.
//!
//! The input space is a type plus four booleans — 5 x 2^4 = 80 combinations,
//! all of them. Both the SET of issues and their ORDER are compared, because
//! the create path surfaces them as Zod issues in list order.

use avoir_core::transaction_rules::*;
use serde_json::Value;

fn ty(s: &str) -> TransactionType {
    match s {
        "EXPENSE" => TransactionType::Expense,
        "INCOME" => TransactionType::Income,
        "TRANSFER" => TransactionType::Transfer,
        "REFUND" => TransactionType::Refund,
        "TRADE" => TransactionType::Trade,
        o => panic!("unknown transaction type in fixture: {o}"),
    }
}

#[test]
fn cross_field_rules_match_typescript_exhaustively() {
    let doc: Value =
        serde_json::from_str(include_str!("fixtures/crossfield_vectors.json")).unwrap();
    assert_eq!(doc["exhaustive"], true);
    let vectors = doc["vectors"].as_array().unwrap();
    assert_eq!(vectors.len(), 80, "the space is 5 types x 2^4 booleans");

    let mut problems = Vec::new();
    let mut with_issues = 0;

    for (i, v) in vectors.iter().enumerate() {
        let iv = &v["in"];
        let facts = CrossFieldFacts {
            transaction_type: ty(iv["type"].as_str().unwrap()),
            has_funding_account: iv["hasFundingAccount"].as_bool().unwrap(),
            has_trade_metadata: iv["hasTradeMetadata"].as_bool().unwrap(),
            has_bitcoin_metadata: iv["hasBitcoinMetadata"].as_bool().unwrap(),
            is_cash_back: iv["isCashBack"].as_bool().unwrap(),
        };
        let got = cross_field_issues(&facts);
        if !got.is_empty() {
            with_issues += 1;
        }

        let want = v["out"].as_array().unwrap();
        if got.len() != want.len() {
            problems.push(format!(
                "vector {i} {}: rust {} issues, ts {}",
                iv,
                got.len(),
                want.len()
            ));
            continue;
        }
        for (g, w) in got.iter().zip(want.iter()) {
            if g.path != w["path"].as_str().unwrap() || g.message != w["message"].as_str().unwrap()
            {
                problems.push(format!(
                    "vector {i}: rust ({}, {}), ts ({}, {})",
                    g.path, g.message, w["path"], w["message"]
                ));
            }
        }
    }

    assert_eq!(with_issues, 65, "the fixture records 65 of 80 as invalid");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
