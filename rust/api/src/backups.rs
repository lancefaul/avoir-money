//! `/backups` — snapshot the database, and put one back.
//!
//! The mechanics live in `avoir_db::backup`, which explains why this is a
//! redesign rather than a port. This module is the route layer and the
//! bookkeeping: `Backup` rows, the retention policy, and the confirmations.
//!
//! # Restoring takes effect on the next launch, and the response says so
//!
//! `POST /:id/restore` validates the file, takes a PRE_RESTORE snapshot, stages
//! the chosen file, and returns `{ restartRequired: true }`. It does **not**
//! swap the database underneath a running app. SQLite's guidance is to replace
//! the file with no connections open, and after a restore every frontend cache
//! is stale anyway — a restart is the correct outcome, not a workaround.
//!
//! # The safety snapshot is taken here and its failure aborts the restore
//!
//! Being unable to capture the current state is exactly when destroying it is
//! least acceptable. This was the expensive half of the 2026-08-05 incident, so
//! the snapshot happens before anything is staged and a failure propagates
//! rather than being warned about and stepped over.

use crate::id::{cuid, now_iso};
use crate::{ApiError, Response};
use avoir_core::backup_schedule::{is_due, Due};
use avoir_db::backup::{self, Paths, Source};
use avoir_db::upload_staging;
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::Path;

/// Shown whenever a recorded backup's file is no longer on disk.
const FILE_GONE: &str = "This backup's file is no longer on disk, so it cannot be used. \
It may have been moved, pruned by the retention policy, or lost.";

// ═══ Config ═══

/// The config row, created on first read.
///
/// One row, found or made — the TypeScript did the same thing with
/// `findFirst` + `create`, and the screen needs something to render before the
/// user has ever opened it.
async fn config_row(pool: &SqlitePool) -> Result<ConfigShape, ApiError> {
    let existing = sqlx::query!(
        r#"SELECT "id" AS "id!", "enabled" AS "enabled!: i64", "path" AS "path!",
                  "frequency" AS "frequency!", "retentionCount" AS "retention!: i64",
                  "createdAt" AS "created_at!", "updatedAt" AS "updated_at!"
             FROM "BackupConfig" LIMIT 1"#
    )
    .fetch_optional(pool)
    .await?;

    if let Some(r) = existing {
        return Ok(ConfigShape {
            id: r.id,
            enabled: r.enabled != 0,
            path: r.path,
            frequency: r.frequency,
            retention_count: r.retention,
            created_at: r.created_at,
            updated_at: r.updated_at,
        });
    }

    let id = cuid();
    let now = now_iso();
    let dir = Paths::from_pool(pool).directory.display().to_string();
    sqlx::query!(
        r#"INSERT INTO "BackupConfig"
             ("id","enabled","path","frequency","retentionCount","createdAt","updatedAt")
           VALUES (?, 0, ?, 'DAILY', 7, ?, ?)"#,
        id,
        dir,
        now,
        now
    )
    .execute(pool)
    .await?;

    Ok(ConfigShape {
        id,
        enabled: false,
        path: dir,
        frequency: "DAILY".into(),
        retention_count: 7,
        created_at: now.clone(),
        updated_at: now,
    })
}

/// The backup schedule configuration. Two sites built this from separate
/// `json!` literals — the existing-row case and the freshly-seeded one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigShape {
    id: String,
    enabled: bool,
    path: String,
    frequency: String,
    retention_count: i64,
    created_at: String,
    updated_at: String,
}

/// One backup on disk.
///
/// `available` is checked against the filesystem rather than trusted from the
/// row: a backup the user moved or deleted is still recorded here, and offering
/// to restore from a file that is gone is worse than saying it is missing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupShape {
    id: String,
    filename: String,
    filepath: String,
    size_bytes: i64,
    status: String,
    source: String,
    error: Option<String>,
    completed_at: Option<String>,
    created_at: String,
    available: bool,
}

/// What a staged restore reports. The restore itself happens on next launch —
/// the database is open, so it cannot be swapped underneath a running process.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreStagedShape {
    message: &'static str,
    safety_backup_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    imported_backup_id: Option<String>,
    restart_required: bool,
}

/// What an upload accepted.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadShape {
    upload_id: String,
    size_bytes: usize,
    table_count: i64,
    archive_created_at: Option<String>,
    source_database: Option<String>,
}

pub async fn get_config(pool: &SqlitePool) -> Result<Response, ApiError> {
    Ok(Response::ok(config_row(pool).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ConfigPatch {
    enabled: Option<bool>,
    frequency: Option<String>,
    #[serde(rename = "retentionCount")]
    retention_count: Option<i64>,
    /// Accepted and ignored — see below.
    #[allow(dead_code)]
    path: Option<String>,
}

pub async fn update_config(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    let b: ConfigPatch = crate::body_of(body)?;
    if let Some(f) = &b.frequency {
        if f != "DAILY" && f != "WEEKLY" {
            return Err(ApiError::bad_request(format!("Unknown frequency: {f}")));
        }
    }
    if b.retention_count.is_some_and(|n| n < 1) {
        return Err(ApiError::bad_request("retentionCount must be at least 1"));
    }

    // `path` is accepted so the existing request shape still parses, and
    // deliberately not applied. The backup directory is derived from where the
    // database actually is; letting a request move it would mean a backup and
    // the restore that follows could name different places, which is the one
    // way this feature can lose data. The TypeScript's `validateBackupPath`
    // already returned `null` unconditionally for the same reason.
    let existing = config_row(pool).await?;
    let id = existing.id;
    let now = now_iso();
    sqlx::query!(
        r#"UPDATE "BackupConfig"
              SET "enabled" = COALESCE(?1, "enabled"),
                  "frequency" = COALESCE(?2, "frequency"),
                  "retentionCount" = COALESCE(?3, "retentionCount"),
                  "updatedAt" = ?4
            WHERE "id" = ?5"#,
        b.enabled,
        b.frequency,
        b.retention_count,
        now,
        id
    )
    .execute(pool)
    .await?;
    Ok(Response::ok(config_row(pool).await?))
}

// ═══ Listing ═══

#[allow(clippy::too_many_arguments)]
fn backup_json(
    id: &str,
    filename: &str,
    filepath: &str,
    size: i64,
    status: &str,
    source: &str,
    error: Option<&str>,
    completed_at: Option<&str>,
    created_at: &str,
    available: bool,
) -> BackupShape {
    BackupShape {
        id: id.to_string(),
        filename: filename.to_string(),
        filepath: filepath.to_string(),
        size_bytes: size,
        status: status.to_string(),
        source: source.to_string(),
        error: error.map(str::to_string),
        completed_at: completed_at.map(str::to_string),
        created_at: created_at.to_string(),
        available,
    }
}

pub async fn list(pool: &SqlitePool) -> Result<Response, ApiError> {
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "filename" AS "filename!", "filepath" AS "filepath!",
                  "sizeBytes" AS "size!: i64", "status" AS "status!", "source" AS "source!",
                  "error", "completedAt" AS completed_at, "createdAt" AS "created_at!"
             FROM "Backup" ORDER BY "createdAt" DESC"#
    )
    .fetch_all(pool)
    .await?;

    Ok(Response::ok(
        rows.into_iter()
            .map(|r| {
                // `status` records how the run went, not what became of the
                // file. A COMPLETED row whose file has since been pruned is
                // unrestorable and nothing in the record says so, so the screen
                // is told before the user commits to anything.
                let available = r.status == "COMPLETED" && Path::new(&r.filepath).exists();
                backup_json(
                    &r.id,
                    &r.filename,
                    &r.filepath,
                    r.size,
                    &r.status,
                    &r.source,
                    r.error.as_deref(),
                    completed_at_ref(&r.completed_at),
                    &r.created_at,
                    available,
                )
            })
            .collect::<Vec<_>>(),
    ))
}

fn completed_at_ref(v: &Option<String>) -> Option<&str> {
    v.as_deref()
}

// ═══ Running a backup ═══

/// Record a backup and prune what the retention policy no longer keeps.
async fn record(
    pool: &SqlitePool,
    created: &backup::Created,
    source: Source,
) -> Result<BackupShape, ApiError> {
    let id = cuid();
    let now = now_iso();
    let filepath = created.filepath.display().to_string();
    let src = source.as_str();
    sqlx::query!(
        r#"INSERT INTO "Backup"
             ("id","filename","filepath","sizeBytes","status","source","completedAt","createdAt")
           VALUES (?,?,?,?, 'COMPLETED', ?, ?, ?)"#,
        id,
        created.filename,
        filepath,
        created.size_bytes,
        src,
        now,
        now
    )
    .execute(pool)
    .await?;

    Ok(backup_json(
        &id,
        &created.filename,
        &filepath,
        created.size_bytes,
        "COMPLETED",
        src,
        None,
        Some(&now),
        &now,
        true,
    ))
}

/// Delete the oldest backups of one source beyond the retention count.
///
/// **Retention is per source, and a source only ever evicts its own.** A
/// PRE_RESTORE snapshot is the rollback point for the restore that just ran, and
/// an IMPORTED file was supplied by hand because it existed nowhere else —
/// deleting either to make room for a routine backup would destroy the only copy
/// of something unrecoverable, so neither is eligible at all.
///
/// MANUAL and SCHEDULED are both pruned, but never by each other. Sharing one
/// bucket would mean a daily schedule at the default retention of 7 deletes
/// every deliberate backup within a week — including the one taken immediately
/// before a risky import, which is the exact moment the feature exists for.
/// Excluding the other sources from the *count* as well as the deletion is what
/// stops importing a file silently evicting a real backup.
async fn enforce_retention(pool: &SqlitePool, keep: i64, source: Source) -> Result<(), ApiError> {
    let src = source.as_str();
    debug_assert!(
        matches!(source, Source::Manual | Source::Scheduled),
        "PRE_RESTORE and IMPORTED are never auto-evicted"
    );
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!", "filepath" AS "filepath!" FROM "Backup"
            WHERE "status" = 'COMPLETED' AND "source" = ?
            ORDER BY "createdAt" DESC"#,
        src
    )
    .fetch_all(pool)
    .await?;

    for r in rows.into_iter().skip(keep.max(0) as usize) {
        backup::delete_file(Path::new(&r.filepath)).map_err(ApiError::from)?;
        sqlx::query!(r#"DELETE FROM "Backup" WHERE "id" = ?"#, r.id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Take a backup, record it, and prune that source's older ones.
///
/// Shared by the manual route and the scheduler so the two cannot drift on the
/// parts that matter — that a failure is recorded rather than only returned, and
/// that retention runs afterwards.
async fn take(pool: &SqlitePool, source: Source) -> Result<BackupShape, ApiError> {
    let config = config_row(pool).await?;
    let keep = config.retention_count;
    let paths = Paths::from_pool(pool);

    match backup::create(pool, &paths, source).await {
        Ok(created) => {
            let body = record(pool, &created, source).await?;
            enforce_retention(pool, keep, source).await?;
            Ok(body)
        }
        Err(e) => {
            // The failure is recorded, not just returned. A backup that did not
            // happen is exactly the thing a user needs to be able to see later —
            // and for a scheduled run, the record is the ONLY way they could
            // ever find out, because nobody was watching when it ran.
            let id = cuid();
            let now = now_iso();
            let msg = format!("{e:#}");
            let src = source.as_str();
            sqlx::query!(
                r#"INSERT INTO "Backup"
                     ("id","filename","filepath","sizeBytes","status","source","error","createdAt")
                   VALUES (?, '', '', 0, 'FAILED', ?, ?, ?)"#,
                id,
                src,
                msg,
                now
            )
            .execute(pool)
            .await?;
            Err(ApiError::new(500, msg))
        }
    }
}

pub async fn run(pool: &SqlitePool) -> Result<Response, ApiError> {
    Ok(Response::created(take(pool, Source::Manual).await?))
}

// ═══ The schedule ═══

/// Take a scheduled backup if one is due, and report what happened.
///
/// Called by the desktop shell — at launch, and then on a timer while the app
/// is open. It is deliberately a library function rather than a route: the
/// frontend has no reason to trigger it, and an endpoint nobody calls is
/// surface with no owner.
///
/// # Why "catch up at launch" is enough
///
/// A desktop app only runs when it is open, so nothing can fire while it is
/// closed. That sounds like a gap and mostly is not: if the app is not open,
/// the data is not changing, so the backup that did not happen would have been
/// identical to the last one. Opening the app after three weeks away takes one
/// backup immediately, which is exactly the state that needed capturing.
///
/// Errors are logged and swallowed rather than propagated. There is no caller
/// to return them to — the shell spawned this and moved on — and a failed
/// scheduled backup already leaves a FAILED row the user can see. Taking the
/// app down over it would be worse than the thing it is reporting.
pub async fn run_if_due(pool: &SqlitePool) -> Due {
    let config = match config_row(pool).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[backup] could not read the schedule config: {e}");
            return Due::Unavailable;
        }
    };
    let enabled = config.enabled;
    let frequency = config.frequency.as_str();

    let last = match last_scheduled_at(pool).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[backup] could not read the last scheduled backup: {e}");
            return Due::Unavailable;
        }
    };

    let due = is_due(enabled, frequency, last, Local::now());
    if !due.should_run() {
        return due;
    }

    match take(pool, Source::Scheduled).await {
        Ok(b) => eprintln!("[backup] scheduled backup written: {}", b.filename),
        Err(e) => eprintln!("[backup] scheduled backup FAILED and was recorded: {e}"),
    }
    due
}

/// When the most recent **successful** scheduled backup ran.
///
/// Failures are excluded on purpose. Counting a FAILED row as "last run" would
/// make one bad night suppress every retry until the next window — the schedule
/// would go quiet precisely because backups had stopped working.
async fn last_scheduled_at(pool: &SqlitePool) -> Result<Option<DateTime<Local>>, ApiError> {
    let row = sqlx::query_scalar!(
        r#"SELECT "createdAt" FROM "Backup"
            WHERE "source" = 'SCHEDULED' AND "status" = 'COMPLETED'
            ORDER BY "createdAt" DESC LIMIT 1"#
    )
    .fetch_optional(pool)
    .await?;

    // `createdAt` is written by `now_iso()`, which is UTC in RFC 3339. Converted
    // to local here because the due check compares calendar days as the user
    // experiences them, not as UTC does.
    Ok(row.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .ok()
            .map(|d| d.with_timezone(&Local))
    }))
}

// ═══ Restoring ═══

#[derive(Deserialize, Default)]
#[serde(default)]
struct RestoreBody {
    #[serde(rename = "confirmText")]
    confirm_text: String,
}

pub async fn restore(
    pool: &SqlitePool,
    id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: RestoreBody = crate::body_of(body)?;
    if b.confirm_text != "RESTORE" {
        return Err(ApiError::bad_request("Type RESTORE to confirm"));
    }

    let row = sqlx::query!(
        r#"SELECT "filepath" AS "filepath!", "status" AS "status!" FROM "Backup" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Backup"))?;

    if row.status != "COMPLETED" {
        return Err(ApiError::bad_request(
            "Can only restore from completed backups",
        ));
    }

    let source_path = std::path::PathBuf::from(&row.filepath);
    if !source_path.exists() {
        return Err(ApiError::new(404, FILE_GONE));
    }

    // Validated before anything destructive, and before the safety snapshot —
    // a restore that was never going to run should not leave a snapshot behind
    // suggesting one did.
    if let Err(rejected) = backup::validate(&source_path).await {
        return Err(ApiError::bad_request(rejected.to_string()));
    }

    let paths = Paths::from_pool(pool);
    let safety = backup::create(pool, &paths, Source::PreRestore)
        .await
        .map_err(|e| {
            ApiError::new(
                500,
                format!("Could not take a safety snapshot, so nothing was changed: {e:#}"),
            )
        })?;
    let safety_body = record(pool, &safety, Source::PreRestore).await?;

    backup::stage_restore(&paths, &source_path).map_err(ApiError::from)?;

    Ok(Response::ok(RestoreStagedShape {
        message: "Restore staged. Restart Avoir Money to complete it.",
        safety_backup_id: safety_body.id,
        imported_backup_id: None,
        restart_required: true,
    }))
}

pub async fn delete(pool: &SqlitePool, id: &str) -> Result<Response, ApiError> {
    let row = sqlx::query!(
        r#"SELECT "filepath" AS "filepath!" FROM "Backup" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Backup"))?;

    backup::delete_file(Path::new(&row.filepath)).map_err(ApiError::from)?;
    sqlx::query!(r#"DELETE FROM "Backup" WHERE "id" = ?"#, id)
        .execute(pool)
        .await?;
    Ok(Response::no_content())
}

// ─── Uploading a database from elsewhere ───

/// Stage an uploaded database and report what it is.
///
/// The bytes arrive already read — framing a multipart body is the transport's
/// job and lives in `avoir-server`, which keeps this function callable from a
/// test without constructing an HTTP request.
///
/// **Nothing here trusts the client.** The file's own name is discarded, the
/// destination is chosen by `upload_staging`, and the caller receives an opaque
/// id rather than a path.
pub async fn upload(pool: &SqlitePool, bytes: &[u8]) -> Result<Response, ApiError> {
    // An abandoned upload holds a full copy of a database in the temp
    // directory, so stale ones are swept whenever a new upload arrives.
    upload_staging::sweep_stale();

    if bytes.is_empty() {
        return Err(ApiError::bad_request("That file is empty."));
    }
    if bytes.len() as u64 > upload_staging::MAX_UPLOAD_BYTES {
        return Err(ApiError::bad_request(format!(
            "That file is larger than the {}MB limit.",
            upload_staging::MAX_UPLOAD_BYTES / 1024 / 1024
        )));
    }

    let staged = upload_staging::stage(bytes).map_err(ApiError::from)?;

    // The same validation a restore runs, applied before the file is offered as
    // restorable at all: magic bytes, an integrity check, and the tables that
    // make it this application's database rather than merely some SQLite file.
    if let Err(rejected) = backup::validate(&staged.filepath).await {
        // A rejected file is never left on disk — it cannot be restored, so
        // keeping it only leaves a copy of someone's data in a temp directory.
        upload_staging::discard(&staged.upload_id);
        return Err(ApiError::bad_request(rejected.to_string()));
    }

    let summary = describe(&staged.filepath).await;
    let _ = pool;

    Ok(Response::created(UploadShape {
        upload_id: staged.upload_id,
        size_bytes: bytes.len(),
        table_count: summary.table_count,
        archive_created_at: summary.created_at,
        source_database: summary.source,
    }))
}

struct Summary {
    table_count: i64,
    created_at: Option<String>,
    source: Option<String>,
}

/// What to tell the user about a file they are about to restore from.
///
/// Best-effort by design: the file has already passed validation, so a failure
/// to read a nicety must not turn a restorable database into an error. The
/// figures are for a human deciding whether this is the right file.
async fn describe(path: &Path) -> Summary {
    use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions};
    let mut out = Summary {
        table_count: 0,
        created_at: None,
        source: None,
    };
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false);
    let Ok(mut conn) = opts.connect().await else {
        return out;
    };
    if let Ok(n) = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_one(&mut conn)
    .await
    {
        out.table_count = n;
    }
    // The newest row in the ledger dates the file far better than its mtime,
    // which a copy or a download resets.
    out.created_at =
        sqlx::query_scalar::<_, Option<String>>(r#"SELECT MAX("createdAt") FROM "Transaction""#)
            .fetch_one(&mut conn)
            .await
            .ok()
            .flatten();
    out.source = Some("Avoir Money".into());
    out
}

/// Restore from a previously uploaded database.
pub async fn restore_upload(
    pool: &SqlitePool,
    upload_id: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let b: RestoreBody = crate::body_of(body)?;
    if b.confirm_text != "RESTORE" {
        return Err(ApiError::bad_request("Type RESTORE to confirm"));
    }

    // The only place a client string becomes a path, and it is refused unless
    // it is a plain token resolving inside the staging root.
    let Some(filepath) = upload_staging::resolve(upload_id) else {
        return Err(ApiError::new(
            404,
            "That upload has expired. Please upload the file again.",
        ));
    };

    // Re-validated rather than trusted from the upload step. The verdict is
    // what stands between this file and the live database, and re-running it
    // costs one read of a file already on disk.
    if let Err(rejected) = backup::validate(&filepath).await {
        upload_staging::discard(upload_id);
        return Err(ApiError::bad_request(rejected.to_string()));
    }

    let paths = Paths::from_pool(pool);
    let safety = backup::create(pool, &paths, Source::PreRestore)
        .await
        .map_err(|e| {
            ApiError::new(
                500,
                format!("Could not take a safety snapshot, so nothing was changed: {e:#}"),
            )
        })?;
    let safety_body = record(pool, &safety, Source::PreRestore).await?;

    // Adopted as an IMPORTED backup before the restore is staged. A database
    // supplied by hand exists nowhere else, and recording it afterwards would
    // lose it if anything failed in between.
    let adopted = adopt_upload(pool, &paths, &filepath).await;

    let staged = backup::stage_restore(&paths, &filepath).map_err(ApiError::from);
    upload_staging::discard(upload_id);
    staged?;

    Ok(Response::ok(RestoreStagedShape {
        message: "Restore staged. Restart Avoir Money to complete it.",
        safety_backup_id: safety_body.id,
        imported_backup_id: adopted,
        restart_required: true,
    }))
}

/// Keep an uploaded database as an IMPORTED backup.
///
/// Best-effort: failing to file a copy must not block the restore the user
/// asked for. ADR-028's retention rules never evict IMPORTED, precisely because
/// a hand-supplied file exists nowhere else.
async fn adopt_upload(pool: &SqlitePool, paths: &Paths, from: &Path) -> Option<String> {
    let dir = &paths.directory;
    std::fs::create_dir_all(dir).ok()?;
    let filename = format!(
        "avoir_imported_{}.db",
        chrono::Local::now().format("%Y%m%d_%H%M%S")
    );
    let dest = dir.join(&filename);
    std::fs::copy(from, &dest).ok()?;

    let size = std::fs::metadata(&dest).ok()?.len() as i64;
    let id = cuid();
    let now = now_iso();
    let path_str = dest.to_string_lossy().to_string();
    sqlx::query!(
        r#"INSERT INTO "Backup"
             ("id","filename","filepath","sizeBytes","status","source","completedAt","createdAt")
           VALUES (?,?,?,?,'COMPLETED','IMPORTED',?,?)"#,
        id,
        filename,
        path_str,
        size,
        now,
        now
    )
    .execute(pool)
    .await
    .ok()?;
    Some(id)
}

/// The bytes of a completed backup, and the name to offer them under.
///
/// Returns the pair rather than a `Response` because the body is binary and
/// `Response` carries JSON — the transport assembles the download in
/// `avoir-server`.
/// A completed backup's bytes, encrypted when a passphrase is supplied.
///
/// The passphrase arrives in a POST body rather than a query string, which is
/// why this is no longer a `GET` a browser can navigate to. That change pays for
/// itself twice: a secret in a URL lands in history, in referrers and in any
/// proxy log, and the old route put the API KEY there for the same reason —
/// an anchor click cannot set an Authorization header. A `fetch` can.
///
/// Encryption is optional and the caller decides, matching the export
/// (ADR-038). This is the moment the file leaves, so it is the right moment to
/// ask; but a plain copy is legitimate — inspecting one, or restoring it on a
/// machine without the passphrase to hand.
pub async fn download(
    pool: &SqlitePool,
    id: &str,
    passphrase: Option<&str>,
) -> Result<(String, Vec<u8>), ApiError> {
    let row = sqlx::query!(
        r#"SELECT "filename" AS "filename!", "filepath" AS "filepath!",
                  "status" AS "status!" FROM "Backup" WHERE "id" = ?"#,
        id
    )
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("Backup"))?;

    if row.status != "COMPLETED" {
        return Err(ApiError::bad_request("Can only download completed backups"));
    }

    let bytes = std::fs::read(&row.filepath).map_err(|_| ApiError::new(404, FILE_GONE))?;

    match passphrase {
        Some(p) if !p.is_empty() => {
            let sealed = avoir_db::portable::encrypt(&bytes, p)
                .map_err(|e| ApiError::new(500, format!("could not encrypt the backup: {e}")))?;
            // The suffix is part of the contract, not decoration: it tells
            // whoever finds this file later that `age -d` opens it.
            let name = format!("{}{}", row.filename, avoir_db::portable::ENCRYPTED_SUFFIX);
            Ok((name, sealed))
        }
        _ => Ok((row.filename, bytes)),
    }
}
