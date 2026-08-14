//! Lazily materialising the schedule of what is due.
//!
//! Port of `generateSchedule` from `apps/api/src/lib/schedule-generator.ts`.
//!
//! # Rows keep their id across regenerations (ADR-024)
//!
//! The original deleted every PENDING row and recreated it on each GET. With
//! `staleTime: Infinity` the client held a rendered row's id indefinitely, so
//! once anything else regenerated the schedule that id was gone and
//! mark-as-paid returned 404 — intermittently, and only after the app had sat
//! idle. The occurrence's real identity is `(sourceType, sourceId, dueDate)`,
//! so this **inserts only genuinely new occurrences**, refreshes the expected
//! amount on surviving PENDING rows in place, and prunes only PENDING rows
//! that no longer correspond to a computed occurrence.
//!
//! PAID, PARTIAL, SKIPPED and SNOOZED are never touched: the first two are
//! history and the last two are deliberate user choices.
//!
//! # A fulfilled month suppresses its occurrence
//!
//! If a month already has a PAID or PARTIAL row, no new PENDING row is created
//! for it even when the computed due date differs — a utility reading can move
//! the due date after the bill was paid, and without this the paid bill would
//! reappear as still owing on a different day.

use anyhow::Result;
use avoir_core::money::Cents;
use avoir_core::occurrences::{apply_weekend_shift, occurrences, DueRule, Recurrence};
use avoir_core::schedule_amount::{
    resolve_expected_amount, resolve_utility_due_date, ReadingDates,
};
use avoir_core::utility::{total_bill, FeeType};
use chrono::NaiveDate;
use sqlx::SqliteConnection;
use std::collections::{HashMap, HashSet};

/// What the generator was asked to cover.
pub struct Window {
    pub start: NaiveDate,
    pub end: NaiveDate,
    /// Restrict to one source, for the targeted regeneration a single edit
    /// needs.
    pub source_type: Option<String>,
    pub source_id: Option<String>,
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%dT00:00:00.000Z").to_string()
}

fn parse(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

/// Whether a stored `pausedUntil` is still in effect today.
///
/// An unparseable value counts as paused: it is not a date this code
/// understands, and treating "I cannot read this" as "not paused" would put an
/// item back on the schedule on the strength of a value nobody can explain.
fn is_paused(paused_until: Option<&str>) -> bool {
    match paused_until {
        None => false,
        Some(s) => match parse(s) {
            Some(d) => avoir_core::pause::is_paused(Some(d), avoir_core::dates::today()),
            None => true,
        },
    }
}

/// One expense's readings, in the two parallel shapes resolution wants.
///
/// Parallel rather than a struct-of-pairs because the resolver is pure date
/// logic in core and has no business knowing what a bill costs — it returns the
/// index of the reading it picked, and the total is looked up beside it.
#[derive(Default)]
struct Readings {
    dates: Vec<ReadingDates>,
    totals: Vec<Cents>,
}

/// One computed occurrence, before it meets the database.
struct Occurrence {
    source_type: &'static str,
    source_id: String,
    due_date: NaiveDate,
    expected: Cents,
}

/// Load every utility reading that belongs to an expense-linked service.
///
/// These do two things: they override the generic `dueDay` with the bill's own
/// due date, and they supply the expected amount. A metered bill is not the
/// same figure every month, so the recurring item's stored amount is only a
/// fallback.
async fn load_readings(conn: &mut SqliteConnection) -> Result<HashMap<String, Readings>> {
    let rows = sqlx::query!(
        r#"SELECT s."expenseId" AS "expense_id!", r."cost" AS "cost!: i64",
                  r."convenienceFee" AS "fee: i64",
                  r."convenienceFeeType" AS "fee_type: String",
                  r."otherFees" AS "other: i64",
                  r."dueDate" AS "due_date: String", r."billDate" AS "bill_date!"
             FROM "UtilityReading" r
             JOIN "UtilityService" s ON s."id" = r."serviceId"
            WHERE s."expenseId" IS NOT NULL"#
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut out: HashMap<String, Readings> = HashMap::new();
    for r in rows {
        // A reading with an unparseable bill date has no position in time, so
        // it can neither move an occurrence nor be shown to price one.
        let Some(bill_date) = parse(&r.bill_date) else {
            continue;
        };
        let slot = out.entry(r.expense_id).or_default();
        slot.dates.push(ReadingDates {
            due_date: r.due_date.as_deref().and_then(parse),
            bill_date,
        });
        slot.totals.push(total_bill(
            Cents(r.cost),
            r.fee.map(Cents),
            FeeType::from_stored(r.fee_type.as_deref()),
            r.other.map(Cents),
        ));
    }
    Ok(out)
}

/// The empty set, for an item that is not utility-linked.
static NO_READINGS: Readings = Readings {
    dates: Vec::new(),
    totals: Vec::new(),
};

/// An `amountSchedule` column, parsed once per item rather than per occurrence.
fn parse_schedule(raw: Option<&str>) -> Option<serde_json::Value> {
    serde_json::from_str(raw?).ok()
}

/// Look one key up in a parsed `amountSchedule`.
///
/// Values are stored as dollars, so they convert on the way out — the column
/// predates the move to integer cents and was not rewritten by it.
fn schedule_lookup(sched: Option<&serde_json::Value>) -> impl Fn(&str) -> Option<Cents> + '_ {
    move |key| {
        sched?
            .get(key)
            .and_then(|v| v.as_f64())
            .map(Cents::from_dollars_f64)
    }
}

/// Regenerate the schedule for a window. Returns the number of NEW rows.
///
/// The return value means "rows created", not "rows regenerated" — a no-op
/// regeneration returns 0, which is the ADR-024 behaviour change.
pub async fn generate(conn: &mut SqliteConnection, w: &Window) -> Result<u64> {
    use chrono::Datelike;

    let from = iso(w.start);
    let to = iso(w.end);
    let readings = load_readings(&mut *conn).await?;

    // Months (and exact dates) that already have a fulfilled row. A paid bill
    // must not reappear as owing because a utility reading moved its due date.
    let fulfilled = sqlx::query!(
        r#"SELECT "sourceType" AS "source_type!", "sourceId" AS "source_id!",
                  "dueDate" AS "due_date!"
             FROM "ScheduledTransaction"
            WHERE "dueDate" >= ?1 AND "dueDate" <= ?2
              AND "status" IN ('PAID','PARTIAL')"#,
        from,
        to
    )
    .fetch_all(&mut *conn)
    .await?;

    let mut fulfilled_months: HashSet<String> = HashSet::new();
    let mut fulfilled_dates: HashSet<String> = HashSet::new();
    for r in &fulfilled {
        if let Some(d) = parse(&r.due_date) {
            fulfilled_months.insert(format!(
                "{}:{}:{}-{}",
                r.source_type,
                r.source_id,
                d.year(),
                d.month()
            ));
            fulfilled_dates.insert(format!("{}:{}:{}", r.source_type, r.source_id, d));
        }
    }

    let mut computed: Vec<Occurrence> = Vec::new();

    // ─── Expenses ───
    if w.source_type.as_deref().unwrap_or("EXPENSE") == "EXPENSE" {
        let only = w
            .source_id
            .clone()
            .filter(|_| w.source_type.as_deref() == Some("EXPENSE"));
        let rows = sqlx::query!(
            r#"SELECT "id" AS "id!", "amount" AS "amount!: i64", "frequency" AS "frequency!",
                      "dueDay" AS "due_day: i64", "dueWeekday" AS "due_weekday: i64",
                      "dueOrdinal" AS "due_ordinal: i64",
                      "amountSchedule" AS "schedule: String",
                      "startDate" AS "start: String", "endDate" AS "end: String",
                      "pausedUntil" AS "paused: String", "skipWeekend" AS "skip!: i64"
                 FROM "Expense"
                WHERE "frequency" <> 'ONE_TIME' AND "archivedAt" IS NULL
                  AND (?1 IS NULL OR "id" = ?1)"#,
            only
        )
        .fetch_all(&mut *conn)
        .await?;

        for e in rows {
            // A paused item is not due. Its schedule rows were already cleared
            // when it was paused; this stops them being recreated.
            //
            // The DATE is compared, not merely tested for presence. The
            // reference calls `isPaused(pausedUntil, now)`, and a pause is a
            // duration — "pause for 2 months" has to end on its own or the
            // duration means nothing and the item is gone until someone
            // remembers to resume it. Suppressing on non-null alone made every
            // pause permanent, which went unnoticed because pausing was itself
            // a no-op until the write harness found it.
            if is_paused(e.paused.as_deref()) {
                continue;
            }
            let Some(freq) = Recurrence::from_stored(&e.frequency) else {
                continue;
            };
            let start = e.start.as_deref().and_then(parse);
            let due = DueRule {
                day: e.due_day.map(|v| v as u32),
                weekday: e.due_weekday.map(|v| v as u32),
                ordinal: e.due_ordinal.map(|v| v as i32),
            };
            let sched = parse_schedule(e.schedule.as_deref());
            let rd = readings.get(&e.id).unwrap_or(&NO_READINGS);

            for raw in occurrences(
                freq,
                due,
                start,
                e.end.as_deref().and_then(parse),
                w.start,
                w.end,
            ) {
                let mut date = apply_weekend_shift(raw, e.skip != 0);

                // A utility bill's own due date beats the generic dueDay, so
                // the schedule shows the date actually printed on the bill.
                //
                // This runs on the weekend-shifted date, not the raw one: the
                // shift is about when a payment can clear, and the reading then
                // overrides it outright with the date the biller stated.
                if let Some(d) = resolve_utility_due_date(&rd.dates, date) {
                    date = d;
                }
                if date < w.start || date > w.end {
                    continue;
                }

                // Weekly and biweekly dedup on the exact date — several
                // occurrences share a month and suppressing the month would
                // drop the rest.
                let key_month = format!("EXPENSE:{}:{}-{}", e.id, date.year(), date.month());
                let key_date = format!("EXPENSE:{}:{}", e.id, date);
                let dup = if matches!(freq, Recurrence::Weekly | Recurrence::Biweekly) {
                    fulfilled_dates.contains(&key_date)
                } else {
                    fulfilled_months.contains(&key_month)
                };
                if dup {
                    continue;
                }

                // Priced against the *resolved* date, so a bill that moved is
                // priced by the reading it moved onto.
                let expected = resolve_expected_amount(
                    Cents(e.amount),
                    schedule_lookup(sched.as_ref()),
                    date,
                    freq,
                    start,
                    &rd.dates,
                    &rd.totals,
                );
                // Nothing is due this period. A zero row is noise on the
                // dashboard and cannot be paid.
                if expected.0 == 0 {
                    continue;
                }

                computed.push(Occurrence {
                    source_type: "EXPENSE",
                    source_id: e.id.clone(),
                    due_date: date,
                    expected,
                });
            }
        }
    }

    // ─── Incomes ───
    if w.source_type.as_deref().unwrap_or("INCOME") == "INCOME" {
        let only = w
            .source_id
            .clone()
            .filter(|_| w.source_type.as_deref() == Some("INCOME"));
        let rows = sqlx::query!(
            r#"SELECT "id" AS "id!", "amount" AS "amount!: i64", "frequency" AS "frequency!",
                      "amountSchedule" AS "schedule: String",
                      "startDate" AS "start: String", "endDate" AS "end: String",
                      "pausedUntil" AS "paused: String"
                 FROM "Income"
                WHERE "frequency" <> 'ONE_TIME' AND "archivedAt" IS NULL
                  AND (?1 IS NULL OR "id" = ?1)"#,
            only
        )
        .fetch_all(&mut *conn)
        .await?;

        for i in rows {
            // Same expiry rule as expenses above.
            if is_paused(i.paused.as_deref()) {
                continue;
            }
            let Some(freq) = Recurrence::from_stored(&i.frequency) else {
                continue;
            };
            let start = i.start.as_deref().and_then(parse);
            let sched = parse_schedule(i.schedule.as_deref());

            // Income has no due-day fields — it lands on its own rhythm from
            // the start date.
            for date in occurrences(
                freq,
                DueRule::default(),
                start,
                i.end.as_deref().and_then(parse),
                w.start,
                w.end,
            ) {
                let key_month = format!("INCOME:{}:{}-{}", i.id, date.year(), date.month());
                let key_date = format!("INCOME:{}:{}", i.id, date);
                let dup = if matches!(freq, Recurrence::Weekly | Recurrence::Biweekly) {
                    fulfilled_dates.contains(&key_date)
                } else {
                    fulfilled_months.contains(&key_month)
                };
                if dup {
                    continue;
                }

                // Income is never utility-linked, but it does alternate: a
                // biweekly paycheque keys off its own start date.
                let expected = resolve_expected_amount(
                    Cents(i.amount),
                    schedule_lookup(sched.as_ref()),
                    date,
                    freq,
                    start,
                    &NO_READINGS.dates,
                    &NO_READINGS.totals,
                );
                if expected.0 == 0 {
                    continue;
                }
                computed.push(Occurrence {
                    source_type: "INCOME",
                    source_id: i.id.clone(),
                    due_date: date,
                    expected,
                });
            }
        }
    }

    // ─── Reconcile against what is already stored ───

    let existing = sqlx::query!(
        r#"SELECT "id" AS "id!", "sourceType" AS "source_type!", "sourceId" AS "source_id!",
                  "dueDate" AS "due_date!", "status" AS "status!",
                  "expectedAmount" AS "expected!: i64"
             FROM "ScheduledTransaction"
            WHERE "dueDate" >= ?1 AND "dueDate" <= ?2"#,
        from,
        to
    )
    .fetch_all(&mut *conn)
    .await?;

    /// A stored row, as reconciliation needs it.
    struct Stored {
        id: String,
        status: String,
        expected: i64,
        source_type: String,
        source_id: String,
    }

    let mut by_key: HashMap<String, Stored> = HashMap::new();
    for r in existing {
        by_key.insert(
            format!("{}:{}:{}", r.source_type, r.source_id, r.due_date),
            Stored {
                id: r.id,
                status: r.status,
                expected: r.expected,
                source_type: r.source_type,
                source_id: r.source_id,
            },
        );
    }

    let mut created = 0u64;
    let mut wanted: HashSet<String> = HashSet::new();

    for occ in &computed {
        let due = iso(occ.due_date);
        let key = format!("{}:{}:{}", occ.source_type, occ.source_id, due);
        wanted.insert(key.clone());

        match by_key.get(&key) {
            // The row survives with its id intact. Only the amount is
            // refreshed, and only while it is still PENDING — rewriting a PAID
            // row's expected amount would rewrite history.
            Some(s) => {
                if s.status == "PENDING" && s.expected != occ.expected.0 {
                    sqlx::query!(
                        r#"UPDATE "ScheduledTransaction" SET "expectedAmount" = ?1 WHERE "id" = ?2"#,
                        occ.expected.0,
                        s.id
                    )
                    .execute(&mut *conn)
                    .await?;
                }
            }
            None => {
                let id = format!("sch_{}", crate::next_id());
                let now = chrono::Utc::now()
                    .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                    .to_string();
                let (expense_id, income_id) = if occ.source_type == "EXPENSE" {
                    (Some(occ.source_id.clone()), None)
                } else {
                    (None, Some(occ.source_id.clone()))
                };
                sqlx::query!(
                    r#"INSERT INTO "ScheduledTransaction"
                         ("id","sourceType","sourceId","dueDate","expectedAmount","status",
                          "expenseId","incomeId","createdAt","updatedAt")
                       VALUES (?,?,?,?,?,'PENDING',?,?,?,?)"#,
                    id,
                    occ.source_type,
                    occ.source_id,
                    due,
                    occ.expected.0,
                    expense_id,
                    income_id,
                    now,
                    now
                )
                .execute(&mut *conn)
                .await?;
                created += 1;
            }
        }
    }

    // Prune PENDING rows that no longer correspond to any computed occurrence
    // — a due day moved, or the source stopped recurring. Only PENDING:
    // everything else is either history or a deliberate choice.
    //
    // **Scoped to what this run actually computed.** A targeted regeneration
    // (one expense, after an edit) only builds occurrences for that source, so
    // pruning everything in the window would delete every *other* source's
    // pending rows — they are absent from `wanted` because they were never
    // computed, not because they are stale. That deleted four years of future
    // rows for two of the three the water utility services on the first run
    // after the reading-match fix.
    for (key, s) in &by_key {
        let in_scope = w.source_type.as_deref().is_none_or(|t| t == s.source_type)
            && w.source_id.as_deref().is_none_or(|i| i == s.source_id);
        if in_scope && s.status == "PENDING" && !wanted.contains(key) {
            sqlx::query!(
                r#"DELETE FROM "ScheduledTransaction" WHERE "id" = ?"#,
                &s.id
            )
            .execute(&mut *conn)
            .await?;
        }
    }

    Ok(created)
}
