//! Differential test for merchant-name similarity, against the live TypeScript.
//!
//! 30 normalization cases, 900 similarity pairs, 49 date diffs. Descriptors are
//! synthetic by design — see `generate-names.mjs` for why real ones were
//! available and deliberately not used.

use avoir_core::name_similarity::*;
use serde_json::Value;

#[test]
fn normalization_matches_typescript() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/name_vectors.json")).unwrap();
    let mut problems = Vec::new();
    for c in doc["normalized"].as_array().unwrap() {
        let got = normalize_name(c["in"].as_str().unwrap());
        let want = c["out"].as_str().unwrap();
        if got != want {
            problems.push(format!("{:?}: rust {got:?}, ts {want:?}", c["in"]));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn similarity_matches_typescript() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/name_vectors.json")).unwrap();
    let pairs = doc["pairs"].as_array().unwrap();
    assert_eq!(pairs.len(), 900);

    let mut problems = Vec::new();
    let mut worst = 0.0f64;

    for p in pairs {
        let got = name_similarity(p["a"].as_str().unwrap(), p["b"].as_str().unwrap());
        let want = p["sim"].as_f64().unwrap();
        let d = (got - want).abs();
        if d > worst {
            worst = d;
        }
        // Both sides compute the same rational; the only slack is f64
        // formatting through JSON, so the tolerance is tiny by design. A real
        // divergence in the bigram logic dwarfs this.
        if d > 1e-12 {
            problems.push(format!(
                "{:?} vs {:?}: rust {got}, ts {want}",
                p["a"], p["b"]
            ));
        }
    }
    println!("  worst similarity delta: {worst:e}");
    assert!(
        problems.is_empty(),
        "{} pairs differ:\n{}",
        problems.len(),
        problems
            .iter()
            .take(10)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn day_diff_matches_typescript() {
    let doc: Value = serde_json::from_str(include_str!("fixtures/name_vectors.json")).unwrap();
    for p in doc["dayDiffs"].as_array().unwrap() {
        let a = parse_date(p["a"].as_str().unwrap()).unwrap();
        let b = parse_date(p["b"].as_str().unwrap()).unwrap();
        assert_eq!(
            day_diff(a, b),
            p["days"].as_i64().unwrap(),
            "dayDiff({:?}, {:?})",
            p["a"],
            p["b"]
        );
    }
}

/// The prefix short-circuit is what lets a truncated bank descriptor score
/// highly against a full merchant name. Worth its own test — it is the rule a
/// bigram-only reimplementation would silently drop.
#[test]
fn a_truncated_descriptor_scores_as_a_prefix() {
    assert_eq!(name_similarity("WHOLE FOODS MKT", "whole foods"), 0.9);
    assert_eq!(
        name_similarity("Amazon", "AMAZON"),
        1.0,
        "case-insensitive exact"
    );
}

/// Noise words and store numbers are stripped before comparison, which is the
/// whole reason a card-processor prefix does not destroy the match.
#[test]
fn processor_noise_is_stripped() {
    assert_eq!(normalize_name("POS PURCHASE AMAZON"), "amazon");
    assert_eq!(normalize_name("COSTCO WHSE #0429"), "costco whse");
}

/// A masked card number defeats the noise-word strip, and that is faithful.
///
/// The TypeScript strips `xxxx` via `\b(...|xxxx|...)\b`, which needs a word
/// boundary — and `XXXX1234` has none, since `x` and `1` are both word
/// characters. So `CARD PURCHASE XXXX1234 SPOTIFY` normalizes to
/// `xxxx1234 spotify`, not `spotify`, and the leftover token drags the
/// similarity score down against a plain "Spotify".
///
/// Pinned rather than fixed: `XXXX1234` is exactly how real descriptors mask a
/// card number, so this is a live weakness in the normalizer — but changing it
/// changes matching behaviour on real statements, which is a decision to take
/// deliberately rather than as a side effect of a port. The differential
/// fixture agrees with this output, so the two implementations are consistent.
#[test]
fn a_masked_card_number_defeats_the_noise_word_strip() {
    assert_eq!(
        normalize_name("CARD PURCHASE XXXX1234 SPOTIFY"),
        "xxxx1234 spotify"
    );
    // The cost: a descriptor that should be a near-exact match scores low.
    let sim = name_similarity("CARD PURCHASE XXXX1234 SPOTIFY", "Spotify");
    assert!(sim < 0.7, "expected a depressed score, got {sim}");
}
