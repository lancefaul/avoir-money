//! Pay-period extension — port of `extendByOne` from
//! `apps/api/src/lib/pay-periods.ts`, driven by the pay-period hook
//! (priority 40).
//!
//! Recording a transaction against a RECURRING income or expense extends the
//! generated schedule by one period, so the horizon keeps moving ahead of use
//! rather than running out and silently leaving later transactions unassigned.
//!
//! **One deliberate divergence.** The TypeScript's `extendByOne` calls `prisma`
//! directly rather than the hook's transaction client, so its write escapes the
//! caller's transaction — a reconcile merge that rolls back leaves the extra
//! period behind. Harmless in itself (a spare period is inert), but it is the
//! only hook write that does not roll back with its caller, and the
//! inconsistency is the kind that stops being harmless once something else
//! starts depending on it. This port takes the connection like every other
//! hook, so it joins the enclosing transaction.

use anyhow::Result;
use avoir_core::dates::{generate_pay_periods, GeneratePeriodsInput, PayScheduleType};
use chrono::{Duration, NaiveDate};
use sqlx::SqliteConnection;

fn schedule_type(s: &str) -> Option<PayScheduleType> {
    match s {
        "WEEKLY" => Some(PayScheduleType::Weekly),
        "BIWEEKLY" => Some(PayScheduleType::Biweekly),
        "SEMI_MONTHLY" => Some(PayScheduleType::SemiMonthly),
        "MONTHLY" => Some(PayScheduleType::Monthly),
        _ => None,
    }
}

/// Append one pay period after the current latest. Returns the id if one was
/// created.
///
/// Returns `None` — not an error — when there is no default schedule, no
/// existing period to extend from, or the next period already exists. All three
/// are ordinary states, and the last is what makes this safe to call on every
/// recurring transaction rather than once.
pub async fn extend_by_one(conn: &mut SqliteConnection) -> Result<Option<String>> {
    let schedule = sqlx::query!(
        r#"SELECT "id" AS "id!: String", "type" AS "sched_type!: String",
                  "anchorDate" AS "anchor!: String",
                  "firstPayDay" AS first_pay_day, "secondPayDay" AS second_pay_day
           FROM "PaySchedule" WHERE "isDefault" = 1 LIMIT 1"#
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(schedule) = schedule else {
        return Ok(None);
    };

    let latest = sqlx::query!(
        r#"SELECT "endDate" AS "end_date!: String" FROM "PayPeriod"
           WHERE "scheduleId" = ? ORDER BY "endDate" DESC LIMIT 1"#,
        schedule.id
    )
    .fetch_optional(&mut *conn)
    .await?;
    let Some(latest) = latest else {
        return Ok(None);
    };

    let Some(ty) = schedule_type(&schedule.sched_type) else {
        return Ok(None);
    };
    let Some(end) = parse_date(&latest.end_date) else {
        return Ok(None);
    };
    let Some(anchor) = parse_date(&schedule.anchor) else {
        return Ok(None);
    };

    // A generous 60-day window so at least one period lands in it regardless of
    // frequency — the TypeScript's choice, kept.
    let next_start = end + Duration::days(1);
    let next_end = next_start + Duration::days(60);

    let generated = generate_pay_periods(&GeneratePeriodsInput {
        schedule_type: ty,
        anchor_date: Some(anchor),
        first_pay_day: schedule.first_pay_day.map(|d| d as u32),
        second_pay_day: schedule.second_pay_day.map(|d| d as u32),
        range_start: next_start,
        range_end: next_end,
    })?;

    let Some(next) = generated.first() else {
        return Ok(None);
    };

    // The unique key is (scheduleId, year, periodNum). Checking it rather than
    // relying on the constraint keeps this a no-op instead of an error, which
    // is what lets every recurring transaction call it.
    let year = next.year as i64;
    let period_num = next.period_num as i64;
    let existing = sqlx::query!(
        r#"SELECT "id" AS "id!: String" FROM "PayPeriod"
           WHERE "scheduleId" = ? AND "year" = ? AND "periodNum" = ?"#,
        schedule.id,
        year,
        period_num
    )
    .fetch_optional(&mut *conn)
    .await?;
    if existing.is_some() {
        return Ok(None);
    }

    let id = format!("pp_{}_{}_{}", schedule.id, next.year, next.period_num);
    let start = next.start_date.to_string();
    let end_s = next.end_date.to_string();
    let pay = next.pay_date.to_string();
    sqlx::query!(
        r#"INSERT INTO "PayPeriod" ("id","scheduleId","startDate","endDate","payDate","year","periodNum")
           VALUES (?,?,?,?,?,?,?)"#,
        id,
        schedule.id,
        start,
        end_s,
        pay,
        year,
        period_num,
    )
    .execute(&mut *conn)
    .await?;

    Ok(Some(id))
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    // Stored dates may carry a time component from the Postgres export.
    NaiveDate::parse_from_str(&s[..10.min(s.len())], "%Y-%m-%d").ok()
}
