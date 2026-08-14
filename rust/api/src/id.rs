//! Primary-key and timestamp helpers.
//!
//! The cuid generator itself moved to `avoir_core::ids` when the ledger gate
//! needed it — see that module for why — and is re-exported here so that no
//! call site had to change. What remains is the timestamp and date-string
//! spelling, which is an API-layer concern.

pub use avoir_core::ids::cuid;

/// The current instant as the app stores timestamps: `YYYY-MM-DDTHH:MM:SS.sssZ`.
///
/// Every `createdAt` / `updatedAt` in the imported data is this shape, because
/// that is what Prisma wrote and what the export preserved. SQLite has no date
/// type, so the string IS the value — writing a different spelling would make
/// `ORDER BY "createdAt"` compare mixed formats lexicographically, and the
/// balance chain orders on exactly that column.
pub fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// A calendar date at UTC midnight, the only spelling a date column may hold.
///
/// The TypeScript equivalent is `dates.ts`, whose whole reason for existing is
/// that a local-time constructor once shifted 243 pay periods by a day. Rust
/// makes that specific bug unavailable — `NaiveDate` has no timezone to get
/// wrong — but the stored *format* still has to match, for the same
/// lexicographic-ordering reason as `now_iso`.
pub fn date_at_utc_midnight(d: chrono::NaiveDate) -> String {
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

/// The calendar day out of a stored or submitted date string.
///
/// Takes the leading `YYYY-MM-DD` and ignores whatever follows, which covers
/// every spelling that reaches this layer: a bare date from a form, a full ISO
/// timestamp from `z.coerce.date()`, and the `T00:00:00.000Z` this module
/// writes. There is no timezone conversion because there is nothing to convert
/// — the day is read as written, which is what makes the ADR-003 bug class
/// unavailable rather than merely avoided.
pub fn parse_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cuid shape and uniqueness tests moved to `avoir_core::ids` with the
    // generator itself — a test belongs beside the code it covers, and two of
    // them reached into private helpers that are no longer in this crate.

    #[test]
    fn stored_dates_are_utc_midnight() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
        assert_eq!(date_at_utc_midnight(d), "2026-03-08T00:00:00.000Z");
    }
}
