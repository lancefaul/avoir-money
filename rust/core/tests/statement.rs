//! Statement CSV parsing: two export shapes, one row type.

use avoir_core::money::Cents;
use avoir_core::statement::{parse, split_csv_line};
use chrono::NaiveDate;

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

// ═══ CSV splitting ═══

#[test]
fn a_comma_inside_a_quoted_field_does_not_shift_the_columns() {
    // The failure this prevents is silent: a split on commas moves every later
    // column, so the amount is read from the wrong field and the row imports at
    // the wrong value without complaining.
    let cols = split_csv_line(r#"3/5/2026,"SMITH, JONES & CO",-42.50"#);
    assert_eq!(cols, vec!["3/5/2026", "SMITH, JONES & CO", "-42.50"]);
}

#[test]
fn a_doubled_quote_inside_a_quoted_field_is_one_literal_quote() {
    let cols = split_csv_line(r#"a,"He said ""hi""",1.00"#);
    assert_eq!(cols, vec!["a", r#"He said "hi""#, "1.00"]);
}

#[test]
fn empty_fields_survive_as_empty_rather_than_vanishing() {
    // Dropping them would shift every column after the gap.
    assert_eq!(split_csv_line("a,,c"), vec!["a", "", "c"]);
    assert_eq!(split_csv_line(",b,"), vec!["", "b", ""]);
}

// ═══ Card / bank exports ═══

const CARD: &str = "\
Transaction Date,Post Date,Description,Amount
3/5/2026,3/6/2026,COFFEE SHOP,-4.75
3/7/2026,3/8/2026,\"PAYCHECK, INC\",\"$1,250.00\"
";

#[test]
fn a_card_export_parses_both_dates_and_a_signed_amount() {
    let p = parse(CARD).unwrap();
    assert_eq!(p.rows.len(), 2);

    assert_eq!(p.rows[0].transaction_date, d("2026-03-05"));
    assert_eq!(p.rows[0].posted_date, d("2026-03-06"));
    assert_eq!(p.rows[0].description, "COFFEE SHOP");
    assert_eq!(p.rows[0].amount, Cents(-4_75));

    // A currency symbol and thousands separators are stripped, and the value is
    // parsed as a decimal rather than through a float.
    assert_eq!(p.rows[1].amount, Cents(1_250_00));
    assert_eq!(p.rows[1].description, "PAYCHECK, INC");

    // Coverage comes from the POSTED dates — what the bank's period covers.
    assert_eq!(p.period_start, d("2026-03-06"));
    assert_eq!(p.period_end, d("2026-03-08"));
}

#[test]
fn columns_are_found_by_name_however_the_export_orders_them() {
    // A positional parser mis-reads a re-ordered export silently, which is
    // worse than failing.
    let reordered = "\
Amount,Description,Transaction Date
-4.75,COFFEE SHOP,3/5/2026
";
    let p = parse(reordered).unwrap();
    assert_eq!(p.rows[0].amount, Cents(-4_75));
    assert_eq!(p.rows[0].description, "COFFEE SHOP");
    assert_eq!(p.rows[0].transaction_date, d("2026-03-05"));
}

#[test]
fn header_spelling_and_punctuation_do_not_matter() {
    for header in ["Post_Date", "POSTED DATE", "posting date"] {
        let csv = format!("Date,{header},Payee,Value\n3/5/2026,3/6/2026,SHOP,-1.00\n");
        let p = parse(&csv).unwrap_or_else(|e| panic!("{header}: {e}"));
        assert_eq!(p.rows[0].posted_date, d("2026-03-06"), "{header}");
    }
}

#[test]
fn a_missing_posting_date_falls_back_to_the_transaction_date() {
    let csv = "Transaction Date,Description,Amount\n2026-03-05,SHOP,-1.00\n";
    let p = parse(csv).unwrap();
    assert_eq!(p.rows[0].posted_date, d("2026-03-05"));

    // Present as a column but blank on the row: same fallback.
    let csv = "Transaction Date,Post Date,Description,Amount\n2026-03-05,,SHOP,-1.00\n";
    let p = parse(csv).unwrap();
    assert_eq!(p.rows[0].posted_date, d("2026-03-05"));
}

#[test]
fn both_date_spellings_are_accepted() {
    let csv = "Date,Description,Amount\n2026-03-05,A,-1.00\n3/6/2026,B,-2.00\n03/07/2026,C,-3.00\n";
    let p = parse(csv).unwrap();
    let days: Vec<NaiveDate> = p.rows.iter().map(|r| r.transaction_date).collect();
    assert_eq!(
        days,
        vec![d("2026-03-05"), d("2026-03-06"), d("2026-03-07")]
    );
}

#[test]
fn a_bad_row_refuses_the_whole_file_and_names_its_line() {
    // A partially-imported statement produces a residual that looks like a real
    // discrepancy — worse than a refusal the user can act on.
    let csv = "Date,Description,Amount\n2026-03-05,A,-1.00\n2026-03-06,B,not-a-number\n";
    let e = parse(csv).unwrap_err();
    assert_eq!(e.line, 3, "1-based, header included");
    assert!(e.message.contains("Unreadable amount"), "{}", e.message);

    let csv = "Date,Description,Amount\n2026-03-05,A,-1.00\n13/45/2026,B,-2.00\n";
    let e = parse(csv).unwrap_err();
    assert_eq!(e.line, 3);
    assert!(e.message.contains("Unrecognized date"), "{}", e.message);

    let csv = "Date,Description,Amount\n2026-03-05,A\n";
    let e = parse(csv).unwrap_err();
    assert_eq!(e.line, 2);
    assert!(e.message.contains("columns"), "{}", e.message);
}

#[test]
fn a_file_with_no_recognisable_columns_is_refused_at_the_header() {
    for (csv, want) in [
        ("Foo,Bar\n1,2\n", "transaction-date"),
        ("Date,Bar\n2026-03-05,2\n", "description"),
        ("Date,Description\n2026-03-05,x\n", "amount"),
    ] {
        let e = parse(csv).unwrap_err();
        assert_eq!(e.line, 1);
        assert!(e.message.contains(want), "{}: {}", want, e.message);
    }
}

#[test]
fn a_file_with_only_a_header_is_refused() {
    let e = parse("Date,Description,Amount\n").unwrap_err();
    assert_eq!(e.line, 1);
    assert!(e.message.contains("no data rows"), "{}", e.message);
}

#[test]
fn blank_lines_and_windows_endings_are_tolerated() {
    let csv = "Date,Description,Amount\r\n2026-03-05,A,-1.00\r\n\r\n2026-03-06,B,-2.00\r\n";
    let p = parse(csv).unwrap();
    assert_eq!(p.rows.len(), 2);
    assert_eq!(p.rows[1].amount, Cents(-2_00));
}

#[test]
fn the_raw_line_is_kept_verbatim_as_the_dedupe_key() {
    let p = parse(CARD).unwrap();
    assert_eq!(p.rows[0].raw_line, "3/5/2026,3/6/2026,COFFEE SHOP,-4.75");
    // Quoted exactly as the bank wrote it, not as the parser understood it.
    assert!(p.rows[1].raw_line.contains(r#""PAYCHECK, INC""#));
}

// ═══ Cash Wallet ═══

const CASH_APP: &str = "\
Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Net Amount,Status,Notes,Name of sender/receiver
1,2026-07-21 13:03:01 CDT,Purchase,USD,-42.50,-3.00,-45.50,COMPLETE,Coffee run,MERCHANT
2,2026-07-22 09:00:00 CDT,Card Verification,USD,-0.01,0,-0.01,FAILED,,BANK
3,2026-07-23 09:00:00 CDT,Bitcoin Withdrawal,BTC,-1.50000000,0,-1.50000000,COMPLETE,,WALLET
4,2026-07-24 09:00:00 CDT,Bitcoin Buy,USD,-100.00,0,-100.00,COMPLETE,,
5,2026-07-25 09:00:00 CDT,Savings Interest Payment,USD,-1.40,0,-1.40,COMPLETE,,
6,2026-07-26 09:00:00 CDT,Device Login,USD,0,0,0.00,COMPLETE,,
7,2026-07-27 09:00:00 CDT,Payment,USD,25.00,0,25.00,COMPLETE,,ALICE
";

#[test]
fn cash_app_is_detected_from_two_columns_no_card_export_has() {
    let p = parse(CASH_APP).unwrap();
    // Only the purchase, the bitcoin BUY and the payment survive.
    let kept: Vec<&str> = p.rows.iter().map(|r| r.description.as_str()).collect();
    assert_eq!(kept, vec!["Coffee run", "Bitcoin Buy", "ALICE"]);
}

#[test]
fn cash_app_uses_the_fee_inclusive_net_amount() {
    let p = parse(CASH_APP).unwrap();
    // A −$42.50 purchase with a −$3.00 fee left the account by −$45.50.
    assert_eq!(p.rows[0].amount, Cents(-45_50));
}

#[test]
fn cash_app_drops_the_rows_that_never_moved_the_cash_balance() {
    let p = parse(CASH_APP).unwrap();
    let raw: String = p.rows.iter().map(|r| r.raw_line.clone()).collect();

    // Failed auths never happened.
    assert!(!raw.contains("Card Verification"));
    // Bitcoin withdrawals move the holding, not the dollars. The quantity here
    // is deliberately large enough to survive the round-to-cents — with a small
    // one the zero-amount filter drops it and the currency filter is never the
    // thing under test, which is what mutation testing caught.
    assert!(!raw.contains("Bitcoin Withdrawal"));
    // A zero net can pair with nothing.
    assert!(!raw.contains("Device Login"));
    // Savings interest is exported as a NEGATIVE on cash, but the cash balance
    // never moves — keeping it drives the reconciled balance below the
    // statement by the interest, every period.
    assert!(!raw.contains("Savings Interest"));

    // But a bitcoin BUY is Currency=USD: it really did spend dollars.
    assert!(raw.contains("Bitcoin Buy"));
}

#[test]
fn a_cash_app_timestamp_keeps_its_calendar_day() {
    let csv = "Date,Transaction Type,Currency,Net Amount,Status,Notes\n\
               2026-07-21 23:47:00 CDT,Purchase,USD,-5.00,COMPLETE,Late night\n";
    let p = parse(csv).unwrap();
    // A timezone conversion would shove this onto the 22nd and stop it matching
    // the row the app stored.
    assert_eq!(p.rows[0].transaction_date, d("2026-07-21"));
}

#[test]
fn cash_app_falls_back_through_notes_then_name_then_type() {
    let csv = "Date,Transaction Type,Currency,Net Amount,Status,Notes,Name of sender/receiver\n\
               2026-07-21,Purchase,USD,-1.00,COMPLETE,A note,ALICE\n\
               2026-07-22,Purchase,USD,-2.00,COMPLETE,,BOB\n\
               2026-07-23,Refund,USD,3.00,COMPLETE,,\n";
    let p = parse(csv).unwrap();
    let names: Vec<&str> = p.rows.iter().map(|r| r.description.as_str()).collect();
    assert_eq!(names, vec!["A note", "BOB", "Refund"]);
}

#[test]
fn a_cash_app_export_that_filters_to_nothing_is_refused() {
    let csv = "Date,Transaction Type,Currency,Net Amount,Status\n\
               2026-07-21,Bitcoin Withdrawal,BTC,-0.001,COMPLETE\n";
    let e = parse(csv).unwrap_err();
    // The same message as an empty card export: in both cases there is nothing
    // here to reconcile against.
    assert!(e.message.contains("no reconcilable rows"), "{}", e.message);
}

#[test]
fn cash_app_needs_its_currency_and_status_columns() {
    for (csv, want) in [
        (
            "Date,Transaction Type,Net Amount,Status\n2026-07-21,Purchase,-1.00,COMPLETE\n",
            "Currency",
        ),
        (
            "Date,Transaction Type,Currency,Net Amount\n2026-07-21,Purchase,USD,-1.00\n",
            "Status",
        ),
    ] {
        let e = parse(csv).unwrap_err();
        assert_eq!(e.line, 1);
        assert!(e.message.contains(want), "{}: {}", want, e.message);
    }
}

#[test]
fn a_bank_with_a_net_amount_column_is_not_mistaken_for_cash_app() {
    // Detected on Net Amount AND Transaction Type together, so a future export
    // carrying only one is still read as a card statement.
    let csv = "Date,Description,Net Amount,Amount\n2026-03-05,SHOP,-9.99,-9.99\n";
    let p = parse(csv).unwrap();
    assert_eq!(p.rows.len(), 1);
    assert_eq!(p.rows[0].description, "SHOP");
}
