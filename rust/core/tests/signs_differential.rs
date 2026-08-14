//! Differential test for CSV sign normalization, against the live TypeScript.
//!
//! Exhaustive: all 96 config combinations × 5 transaction types × 9 boundary
//! amounts = 4,320 vectors, of which 608 must come back excluded. Because the
//! input space is enumerated rather than sampled, agreement here is total —
//! there is no unexplored corner of the config space.

use avoir_core::money::Cents;
use avoir_core::sign_convention::*;
use serde_json::Value;

fn pos_expense(s: &str) -> PositiveExpenseMeaning {
    match s {
        "money_out" => PositiveExpenseMeaning::MoneyOut,
        "money_in" => PositiveExpenseMeaning::MoneyIn,
        o => panic!("unknown positive expense meaning: {o}"),
    }
}

fn neg_expense(s: &str) -> NegativeExpenseMeaning {
    match s {
        "refund" => NegativeExpenseMeaning::Refund,
        "ignore" => NegativeExpenseMeaning::Ignore,
        "spending" => NegativeExpenseMeaning::Spending,
        o => panic!("unknown negative expense meaning: {o}"),
    }
}

fn pos_income(s: &str) -> PositiveIncomeMeaning {
    match s {
        "money_in" => PositiveIncomeMeaning::MoneyIn,
        "money_out" => PositiveIncomeMeaning::MoneyOut,
        o => panic!("unknown positive income meaning: {o}"),
    }
}

fn neg_income(s: &str) -> NegativeIncomeMeaning {
    match s {
        "flip_sign" => NegativeIncomeMeaning::FlipSign,
        "ignore" => NegativeIncomeMeaning::Ignore,
        o => panic!("unknown negative income meaning: {o}"),
    }
}

fn ty(s: &str) -> TransactionType {
    match s {
        "EXPENSE" => TransactionType::Expense,
        "INCOME" => TransactionType::Income,
        "TRANSFER" => TransactionType::Transfer,
        "TRADE" => TransactionType::Trade,
        "REFUND" => TransactionType::Refund,
        o => panic!("unknown transaction type: {o}"),
    }
}

#[test]
fn sign_normalization_matches_typescript_exhaustively() {
    let raw = include_str!("fixtures/sign_vectors.json");
    let doc: Value = serde_json::from_str(raw).expect("fixture is valid JSON");
    assert_eq!(
        doc["exhaustive"], true,
        "this test's guarantee depends on the fixture enumerating the space"
    );
    let vectors = doc["vectors"].as_array().expect("fixture has vectors");

    let mut problems = Vec::new();
    let mut excluded_seen = 0usize;

    for (i, v) in vectors.iter().enumerate() {
        let iv = &v["in"];
        let c = &iv["config"];

        let config = SignConventionConfig {
            expense: ExpenseSignRule {
                positive_meaning: pos_expense(c["expense"]["positiveMeaning"].as_str().unwrap()),
                negative_meaning: neg_expense(c["expense"]["negativeMeaning"].as_str().unwrap()),
            },
            income: IncomeSignRule {
                positive_meaning: pos_income(c["income"]["positiveMeaning"].as_str().unwrap()),
                negative_meaning: neg_income(c["income"]["negativeMeaning"].as_str().unwrap()),
            },
            transfer: TransferSignRule {
                positive_meaning: match c["transfer"]["positiveMeaning"].as_str().unwrap() {
                    "withdrawal" => PositiveTransferMeaning::Withdrawal,
                    "deposit" => PositiveTransferMeaning::Deposit,
                    o => panic!("unknown transfer meaning: {o}"),
                },
            },
            trade: TradeSignRule {
                positive_meaning: match c["trade"]["positiveMeaning"].as_str().unwrap() {
                    "buy" => PositiveTradeMeaning::Buy,
                    "sell" => PositiveTradeMeaning::Sell,
                    o => panic!("unknown trade meaning: {o}"),
                },
            },
        };

        let got = normalize_amount(
            Cents(iv["cents"].as_i64().unwrap()),
            ty(iv["type"].as_str().unwrap()),
            &config,
        );

        let ov = &v["out"];
        let want_excluded = ov["excluded"].as_bool().unwrap_or(false);

        match (got, want_excluded) {
            (NormalizeResult::Excluded, true) => excluded_seen += 1,
            (NormalizeResult::Amount(a), false) => {
                let want = ov["cents"].as_i64().unwrap();
                if a.0 != want {
                    problems.push(format!(
                        "vector {i}: rust {} cents, ts {want} cents (in: {} {} {})",
                        a.0,
                        iv["cents"],
                        iv["type"],
                        c
                    ));
                }
            }
            (g, _) => problems.push(format!(
                "vector {i} exclusion disagreement: rust {g:?}, ts excluded={want_excluded} (in: {} {})",
                iv["cents"], iv["type"]
            )),
        }
    }

    assert_eq!(
        excluded_seen, 608,
        "expected the known 608 excluded outcomes; the fixture or the rules changed"
    );

    if !problems.is_empty() {
        panic!(
            "{} of {} exhaustive vectors disagree with the TypeScript:\n{}",
            problems.len(),
            vectors.len(),
            problems
                .iter()
                .take(15)
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        );
    }
}
