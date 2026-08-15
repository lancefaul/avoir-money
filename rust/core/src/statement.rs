//! Statement CSV parsing for reconciliation.
//!
//! Two shapes, chosen from the header rather than by asking the user, because
//! the export already says what it is:
//!
//! - **Card / bank exports** (Chase and friends): a transaction date, an
//!   optional posting date, a description, and one signed amount where negative
//!   is money leaving the account.
//! - **Cash Wallet**: a timestamp, a Transaction Type, a Currency (USD or BTC), a
//!   Net Amount that folds in fees, and a Status that includes rows which never
//!   happened. It needs filtering the card exports do not, so it is a separate
//!   parser rather than a few more column aliases.
//!
//! Both converge on the same [`StatementRow`], signed the same way, so
//! everything downstream — matching, the residual, dedup — is format-blind.
//!
//! **Columns are found by header name, never by position.** A positional parser
//! silently mis-reads a re-ordered export instead of failing, which is the worst
//! of the available behaviours: the rows import at the wrong values and the
//! residual that results looks like a real discrepancy.

use crate::money::Cents;
use chrono::NaiveDate;
use rust_decimal::prelude::*;
use rust_decimal::{Decimal, RoundingStrategy};

/// One line of a statement, in the shape everything downstream reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatementRow {
    pub posted_date: NaiveDate,
    pub transaction_date: NaiveDate,
    pub description: String,
    /// Signed: negative is money leaving the account.
    pub amount: Cents,
    /// The source line, verbatim — the dedupe key and the audit trail.
    pub raw_line: String,
}

/// A refusal, with the 1-based line it happened on (header included).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    pub line: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "line {}: {}", self.line, self.message)
    }
}

impl std::error::Error for ParseError {}

fn err(message: impl Into<String>, line: usize) -> ParseError {
    ParseError {
        message: message.into(),
        line,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub rows: Vec<StatementRow>,
    /// Posted-date coverage — the earliest and latest activity in the file.
    pub period_start: NaiveDate,
    pub period_end: NaiveDate,
}

/// Split one CSV line, honouring double-quoted fields.
///
/// A naive split on commas corrupts any description containing one — common in
/// merchant names — and shifts every later column, so the amount is read from
/// the wrong field and the row imports at the wrong value without complaint.
pub fn split_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                // A doubled quote inside a quoted field is one literal quote.
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' {
            out.push(cur.trim().to_string());
            cur = String::new();
        } else {
            cur.push(ch);
        }
    }
    out.push(cur.trim().to_string());
    out
}

/// A money field as exact cents.
///
/// The currency symbol and thousands separators are stripped, then the value is
/// parsed as a **decimal** rather than a float. For the two-decimal amounts a
/// statement actually contains this gives the same answer as the TypeScript's
/// `Number()` plus a rounding step — measured, and a mutation swapping one for
/// the other changes no test. The difference is that the decimal path does not
/// *depend* on that being true: it is exact by construction rather than exact
/// because the rounding happens to undo the float. An export carrying more
/// precision than cents (a per-unit price, a foreign-currency line) lands
/// correctly here and would need the f64 path to be re-argued.
fn parse_money(raw: &str) -> Option<Cents> {
    let cleaned: String = raw.chars().filter(|c| *c != '$' && *c != ',').collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return None;
    }
    let d = Decimal::from_str(cleaned).ok()?;
    (d * Decimal::ONE_HUNDRED)
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .map(Cents)
}

/// `M/D/YYYY` or `YYYY-MM-DD`, optionally followed by a time.
///
/// **The time is discarded, never converted.** Cash Wallet stamps a full local
/// time — "2026-07-21 13:03:01 CDT" — and the calendar day is all that matters:
/// it is the day the app stored when the same transaction was entered. Applying
/// a timezone offset would shove a late-night row onto the next day and stop it
/// matching anything.
fn parse_date(raw: &str, line: usize) -> Result<NaiveDate, ParseError> {
    let day = raw.get(..10).unwrap_or(raw);
    if let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") {
        return Ok(d);
    }
    // `%-m/%-d/%Y` accepts both `3/5/2026` and `03/05/2026`.
    for fmt in ["%m/%d/%Y", "%-m/%-d/%Y"] {
        if let Ok(d) = NaiveDate::parse_from_str(raw.trim(), fmt) {
            return Ok(d);
        }
    }
    Err(err(format!("Unrecognized date \"{raw}\""), line))
}

/// Find a column by any of its known spellings.
///
/// Headers are normalised to lowercase letters only, so "Post Date",
/// "post_date" and "POSTDATE" are one name.
fn find_column(header: &[String], candidates: &[&str]) -> Option<usize> {
    let normalized: Vec<String> = header
        .iter()
        .map(|h| {
            h.chars()
                .filter(|c| c.is_ascii_alphabetic())
                .collect::<String>()
                .to_lowercase()
        })
        .collect();
    candidates
        .iter()
        .find_map(|c| normalized.iter().position(|n| n == c))
}

/// Cash Wallet's export carries two columns no card statement does.
///
/// Detected on **both**, not either, so a future bank's "Net Amount" column
/// cannot be mistaken for Cash Wallet.
fn is_cash_app(header: &[String]) -> bool {
    find_column(header, &["netamount"]).is_some()
        && find_column(header, &["transactiontype"]).is_some()
}

fn parse_card_rows(lines: &[&str], header: &[String]) -> Result<Vec<StatementRow>, ParseError> {
    let tx_col = find_column(header, &["transactiondate", "date", "tradedate"])
        .ok_or_else(|| err("No transaction-date column found", 1))?;
    let desc_col = find_column(header, &["description", "payee", "name", "merchant"])
        .ok_or_else(|| err("No description column found", 1))?;
    let amt_col = find_column(header, &["amount", "debitcredit", "value"])
        .ok_or_else(|| err("No amount column found", 1))?;
    let post_col = find_column(header, &["postdate", "posteddate", "postingdate"]);

    let need = tx_col.max(desc_col).max(amt_col);
    let mut rows = Vec::new();

    for (i, raw_line) in lines.iter().enumerate().skip(1) {
        if raw_line.trim().is_empty() {
            continue;
        }
        let line_no = i + 1;
        let cols = split_csv_line(raw_line);
        if cols.len() <= need {
            return Err(err(
                format!(
                    "Expected at least {} columns, found {}",
                    need + 1,
                    cols.len()
                ),
                line_no,
            ));
        }

        let amount = parse_money(&cols[amt_col])
            .ok_or_else(|| err(format!("Unreadable amount \"{}\"", cols[amt_col]), line_no))?;
        let transaction_date = parse_date(&cols[tx_col], line_no)?;
        // Not every export carries a posting date.
        let posted_date = match post_col {
            Some(p) if cols.get(p).is_some_and(|v| !v.is_empty()) => parse_date(&cols[p], line_no)?,
            _ => transaction_date,
        };

        rows.push(StatementRow {
            posted_date,
            transaction_date,
            description: cols[desc_col].clone(),
            amount,
            raw_line: (*raw_line).to_string(),
        });
    }
    Ok(rows)
}

/// A savings-interest sweep, which the cash balance never actually paid.
///
/// Matched on the exact transaction type rather than anything looser, because
/// **the failure directions are not symmetric**: too loose and a real
/// transaction is silently dropped and never reconciles, which is unrecoverable
/// without noticing; too strict and the row reappears as an unmatched line,
/// which is visible and asks its own question. A sub-dollar amount test is
/// deliberately NOT part of it — a small real transaction must still reconcile,
/// and the interest will exceed a dollar as the balance grows.
fn is_savings_interest(transaction_type: Option<&str>) -> bool {
    transaction_type
        .map(|t| t.trim().to_lowercase() == "savings interest payment")
        .unwrap_or(false)
}

/// Cash Wallet export.
///
/// Four kinds of row are dropped, because each would invent a discrepancy the
/// bank never made:
///
/// 1. **Status other than COMPLETE** — failed card auths never moved money, and
///    Cash Wallet emits a great many ($0.01 verification pings).
/// 2. **Currency other than USD** — bitcoin deposits, withdrawals and lightning
///    payments move the bitcoin holding, not the USD cash balance. A bitcoin
///    BUY or SELL *is* Currency=USD, because it spends or receives dollars, and
///    stays in.
/// 3. **A net of zero** — device-login notices and $0 loyalty pings move nothing
///    and can pair with nothing.
/// 4. **Savings Interest Payment** — see [`is_savings_interest`].
///
/// The figure used is **Net Amount**, not Amount: fees reduce the cash balance
/// and Net already folds them in (a −$42.50 purchase with a −$3.00 fee left the
/// account by −$45.50). Its sign already matches the card convention, so nothing
/// is flipped.
fn parse_cash_app_rows(lines: &[&str], header: &[String]) -> Result<Vec<StatementRow>, ParseError> {
    let date_col = find_column(header, &["date"]).ok_or_else(|| err("No Date column found", 1))?;
    let currency_col =
        find_column(header, &["currency"]).ok_or_else(|| err("No Currency column found", 1))?;
    let status_col =
        find_column(header, &["status"]).ok_or_else(|| err("No Status column found", 1))?;
    // Net Amount is fee-inclusive; fall back to Amount only if there is no Net.
    let amount_col = find_column(header, &["netamount"])
        .or_else(|| find_column(header, &["amount"]))
        .ok_or_else(|| err("No amount column found", 1))?;
    let notes_col = find_column(header, &["notes"]);
    let name_col = find_column(header, &["nameofsenderreceiver"]);
    let type_col = find_column(header, &["transactiontype"]);

    let need = date_col.max(amount_col).max(currency_col).max(status_col);
    let mut rows = Vec::new();

    for (i, raw_line) in lines.iter().enumerate().skip(1) {
        if raw_line.trim().is_empty() {
            continue;
        }
        let line_no = i + 1;
        let cols = split_csv_line(raw_line);
        if cols.len() <= need {
            return Err(err(
                format!(
                    "Expected at least {} columns, found {}",
                    need + 1,
                    cols.len()
                ),
                line_no,
            ));
        }

        if !cols[status_col].eq_ignore_ascii_case("COMPLETE") {
            continue;
        }
        if !cols[currency_col].eq_ignore_ascii_case("USD") {
            continue;
        }
        if is_savings_interest(type_col.map(|c| cols[c].as_str())) {
            continue;
        }

        let amount = parse_money(&cols[amount_col]).ok_or_else(|| {
            err(
                format!("Unreadable amount \"{}\"", cols[amount_col]),
                line_no,
            )
        })?;
        if amount.0 == 0 {
            continue;
        }

        let date = parse_date(&cols[date_col], line_no)?;
        let pick = |c: Option<usize>| {
            c.and_then(|i| cols.get(i))
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
        };
        let description = pick(notes_col)
            .or_else(|| pick(name_col))
            .or_else(|| pick(type_col))
            .unwrap_or("Cash Wallet")
            .to_string();

        rows.push(StatementRow {
            posted_date: date,
            transaction_date: date,
            description,
            amount,
            raw_line: (*raw_line).to_string(),
        });
    }
    Ok(rows)
}

/// Parse a statement export, detecting the format from its header.
///
/// **Refuses rather than skipping bad rows.** A partially-imported statement
/// produces a residual that looks like a real discrepancy, which is worse than
/// a refusal the user can act on.
pub fn parse(csv: &str) -> Result<Parsed, ParseError> {
    let normalized = csv.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.trim().split('\n').collect();
    if lines.len() < 2 {
        return Err(err("Statement has no data rows", 1));
    }

    let header = split_csv_line(lines[0]);
    let rows = if is_cash_app(&header) {
        parse_cash_app_rows(&lines, &header)?
    } else {
        parse_card_rows(&lines, &header)?
    };

    if rows.is_empty() {
        // For Cash Wallet this can mean every row was filtered out — all failed,
        // all bitcoin. The message is deliberately the same, because in both
        // cases there is nothing here to reconcile against.
        return Err(err("Statement has no reconcilable rows", 1));
    }

    let period_start = rows.iter().map(|r| r.posted_date).min().expect("non-empty");
    let period_end = rows.iter().map(|r| r.posted_date).max().expect("non-empty");
    Ok(Parsed {
        rows,
        period_start,
        period_end,
    })
}
