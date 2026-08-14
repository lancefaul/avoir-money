//! `/backups` — snapshot, list, restore, prune.
//!
//! These run against a real on-disk database rather than `sqlite::memory:`,
//! because the whole feature is about files: `VACUUM INTO` has nowhere to write
//! from an in-memory database, and a restore is a file swap.

use avoir_api::{dispatch, ApiError, Response};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::PathBuf;

/// A pool over a real file in a temp directory, torn down with the test.
struct Fixture {
    pool: SqlitePool,
    dir: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn fixture() -> Fixture {
    let dir = std::env::temp_dir().join(format!(
        "avoir-backup-test-{}-{}",
        std::process::id(),
        rand_suffix()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let url = format!("sqlite:{}", dir.join("avoir.db").display());
    let pool = avoir_db::connect(&url).await.expect("test db");
    Fixture { pool, dir }
}

fn rand_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static N: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        N.fetch_add(1, Ordering::Relaxed)
    )
}

async fn call(
    pool: &SqlitePool,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    dispatch(pool, method, path, body).await
}

/// Something in the database worth backing up, so a restore has an observable
/// effect.
async fn make_account(pool: &SqlitePool, name: &str) -> String {
    call(
        pool,
        "POST",
        "/accounts",
        Some(json!({ "name": name, "type": "CHECKING", "openingBalance": 100.00 })),
    )
    .await
    .unwrap()
    .body["id"]
        .as_str()
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn a_backup_is_a_real_sqlite_database_not_a_dump() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;

    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    assert_eq!(r.status, 201);
    assert_eq!(r.body["status"], json!("COMPLETED"));
    assert_eq!(r.body["source"], json!("MANUAL"));
    assert_eq!(r.body["available"], json!(true));

    let path = PathBuf::from(r.body["filepath"].as_str().unwrap());
    assert!(path.exists());
    assert!(r.body["sizeBytes"].as_i64().unwrap() > 0);

    // `VACUUM INTO` produces a database, so the backup can simply be opened and
    // queried — no external binary, and the account is in it.
    let backup_pool = avoir_db::connect(&format!("sqlite:{}", path.display()))
        .await
        .unwrap();
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Account""#)
        .fetch_one(&backup_pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    backup_pool.close().await;
}

#[tokio::test]
async fn a_backup_is_a_snapshot_and_does_not_follow_later_changes() {
    let f = fixture().await;
    make_account(&f.pool, "Before").await;

    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let path = r.body["filepath"].as_str().unwrap().to_string();

    make_account(&f.pool, "After").await;

    let backup_pool = avoir_db::connect(&format!("sqlite:{path}")).await.unwrap();
    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Account""#)
        .fetch_all(&backup_pool)
        .await
        .unwrap();
    assert_eq!(
        names,
        vec!["Before"],
        "the snapshot is frozen at its moment"
    );
    backup_pool.close().await;
}

#[tokio::test]
async fn two_backups_in_the_same_second_do_not_become_one() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;

    let a = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let b = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();

    // The filename carries a second's resolution, so without a collision
    // suffix `VACUUM INTO` would refuse the second — or worse, its row would
    // point at the first's bytes.
    assert_ne!(a.body["filepath"], b.body["filepath"]);
    assert!(PathBuf::from(a.body["filepath"].as_str().unwrap()).exists());
    assert!(PathBuf::from(b.body["filepath"].as_str().unwrap()).exists());
}

#[tokio::test]
async fn a_backup_whose_file_is_gone_is_listed_as_unavailable() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    std::fs::remove_file(r.body["filepath"].as_str().unwrap()).unwrap();

    // `status` records how the run went, not what became of the file. The
    // screen needs to know before the user commits to a restore.
    let list = call(&f.pool, "GET", "/backups", None).await.unwrap();
    assert_eq!(list.body[0]["status"], json!("COMPLETED"));
    assert_eq!(list.body[0]["available"], json!(false));
}

#[tokio::test]
async fn restoring_from_a_missing_file_is_refused_before_anything_happens() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    std::fs::remove_file(r.body["filepath"].as_str().unwrap()).unwrap();

    let err = call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 404);

    // No safety snapshot was taken, because no restore was ever going to run.
    let n: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM "Backup" WHERE "source" = 'PRE_RESTORE'"#)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn restoring_stages_the_file_and_snapshots_what_it_will_replace() {
    let f = fixture().await;
    make_account(&f.pool, "Original").await;

    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();

    // The state that must be recoverable if the restore turns out to be wrong.
    make_account(&f.pool, "Added since").await;

    let r = call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["restartRequired"], json!(true));

    // The live database is untouched — the swap happens at next launch.
    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Account" ORDER BY "name""#)
        .fetch_all(&f.pool)
        .await
        .unwrap();
    assert_eq!(names, vec!["Added since", "Original"]);

    // The staged file is a copy, not a reference: pruning the backup it came
    // from must not empty the restore.
    let pending = f.dir.join("avoir.restore-pending");
    assert!(pending.exists(), "expected {}", pending.display());

    // And the rollback point exists, with the state as it was a moment ago.
    let safety_id = r.body["safetyBackupId"].as_str().unwrap();
    let safety_path: String =
        sqlx::query_scalar(r#"SELECT "filepath" FROM "Backup" WHERE "id" = ?"#)
            .bind(safety_id)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    let safety_pool = avoir_db::connect(&format!("sqlite:{safety_path}"))
        .await
        .unwrap();
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Account""#)
        .fetch_one(&safety_pool)
        .await
        .unwrap();
    assert_eq!(n, 2, "the snapshot caught the state being replaced");
    safety_pool.close().await;
}

#[tokio::test]
async fn a_staged_restore_becomes_the_database_at_the_next_launch() {
    let f = fixture().await;
    make_account(&f.pool, "Original").await;
    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();
    make_account(&f.pool, "Added since").await;

    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();

    // Simulate the restart: close everything, then run what `main()` runs.
    f.pool.close().await;
    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    let applied = avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap();
    assert!(applied);
    assert!(!paths.pending_restore().exists(), "the marker is consumed");

    let pool = avoir_db::connect(&format!("sqlite:{}", paths.database.display()))
        .await
        .unwrap();
    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Account""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(names, vec!["Original"], "the backup is now the database");
    pool.close().await;
}

#[tokio::test]
async fn applying_a_restore_when_none_is_staged_does_nothing() {
    let f = fixture().await;
    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    // Every launch calls this, so the no-op path is the common one.
    assert!(!avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap());
}

#[tokio::test]
async fn a_staged_file_that_is_not_a_database_is_refused_at_launch() {
    let f = fixture().await;
    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    std::fs::write(paths.pending_restore(), b"not a database at all").unwrap();

    // Loudly, and without deleting the file: proceeding silently would leave
    // the user on a database they believe was replaced.
    let err = avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap_err();
    assert!(format!("{err:#}").contains("not usable"), "{err:#}");
    assert!(paths.pending_restore().exists(), "the file is kept");
}

#[tokio::test]
async fn restoring_needs_the_confirmation_word() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();

    for body in [
        json!({}),
        json!({ "confirmText": "restore" }),
        json!({ "confirmText": "yes" }),
    ] {
        let err = call(
            &f.pool,
            "POST",
            &format!("/backups/{id}/restore"),
            Some(body),
        )
        .await
        .unwrap_err();
        assert_eq!(err.status, 400);
    }
    assert!(!f.dir.join("avoir.restore-pending").exists());
}

#[tokio::test]
async fn a_damaged_backup_is_refused_rather_than_staged() {
    let f = fixture().await;
    // Enough rows that the file is mostly data pages. A near-empty database is
    // mostly free space, and flipping bytes there is genuinely not corruption —
    // `integrity_check` is right to pass it, and a test built on one would be
    // asserting something false.
    for i in 0..400 {
        sqlx::query(
            r#"INSERT INTO "Transaction" ("id","type","name","amount","netAmount","date",
                 "createdAt","imported","isCashBack")
               VALUES (?, 'EXPENSE', 'Padding row with a reasonably long name', 1234, 1234,
                       '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',0,0)"#,
        )
        .bind(format!("pad{i:06}"))
        .execute(&f.pool)
        .await
        .unwrap();
    }

    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    let path = r.body["filepath"].as_str().unwrap().to_string();

    // The SQLite header is left intact so the cheap magic-byte check passes and
    // `integrity_check` is what has to catch this — which is the whole reason
    // for running it. The Postgres version could not check a dump's contents at
    // all without restoring it first.
    let mut bytes = std::fs::read(&path).unwrap();
    let at = bytes.len() / 5;
    for b in bytes.iter_mut().skip(at).take(4096) {
        *b ^= 0xFF;
    }
    std::fs::write(&path, &bytes).unwrap();

    let err = call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(err.error.contains("damaged"), "{}", err.error);
    assert!(!f.dir.join("avoir.restore-pending").exists());
}

#[tokio::test]
async fn a_truncated_backup_is_refused_rather_than_staged() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    let path = r.body["filepath"].as_str().unwrap().to_string();

    // A file cut short — an interrupted copy, a full disk, a partial download.
    // Caught when the database is opened rather than by `integrity_check`, so
    // this covers a different branch from the corruption test above.
    let bytes = std::fs::read(&path).unwrap();
    std::fs::write(&path, &bytes[..bytes.len().saturating_sub(8192)]).unwrap();

    let err = call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    assert!(!f.dir.join("avoir.restore-pending").exists());
}

#[tokio::test]
async fn someone_elses_sqlite_database_is_refused() {
    let f = fixture().await;

    // A perfectly valid SQLite file that is not this app's database.
    let foreign = f.dir.join("foreign.db");
    let other = avoir_db::connect_in_memory().await.unwrap();
    drop(other);
    let pool = sqlx::SqlitePool::connect(&format!("sqlite:{}?mode=rwc", foreign.display()))
        .await
        .unwrap();
    sqlx::query("CREATE TABLE notes (id INTEGER PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let rejected = avoir_db::backup::validate(&foreign).await.unwrap_err();
    assert!(
        matches!(rejected, avoir_db::backup::Rejected::NotThisApp(_)),
        "{rejected:?}"
    );
    // "not a database", "damaged", and "someone else's database" are three
    // different things to tell a user, and collapsing them is what the Postgres
    // version did.
    assert!(rejected.to_string().contains("not an Avoir Money backup"));

    // A file that is not a database at all reads as exactly that, rather than
    // as a damaged one — the magic-byte check is what makes the message right,
    // since opening it would fail either way.
    let junk = f.dir.join("notes.txt");
    std::fs::write(&junk, b"just some text, definitely not a database").unwrap();
    let rejected = avoir_db::backup::validate(&junk).await.unwrap_err();
    assert_eq!(rejected, avoir_db::backup::Rejected::NotSqlite);
    assert!(rejected.to_string().contains("not a database"));
}

// ═══ Retention ═══

#[tokio::test]
async fn retention_keeps_the_newest_and_deletes_the_rest() {
    let f = fixture().await;
    call(
        &f.pool,
        "PUT",
        "/backups/config",
        Some(json!({ "retentionCount": 2 })),
    )
    .await
    .unwrap();

    let mut paths = Vec::new();
    for _ in 0..4 {
        let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
            .await
            .unwrap();
        paths.push(r.body["filepath"].as_str().unwrap().to_string());
    }

    let list = call(&f.pool, "GET", "/backups", None).await.unwrap();
    assert_eq!(list.body.as_array().unwrap().len(), 2);
    // The files go too, not just the rows — otherwise retention frees nothing.
    assert!(!PathBuf::from(&paths[0]).exists());
    assert!(!PathBuf::from(&paths[1]).exists());
    assert!(PathBuf::from(&paths[3]).exists());
}

#[tokio::test]
async fn retention_never_evicts_a_rollback_point() {
    let f = fixture().await;
    call(
        &f.pool,
        "PUT",
        "/backups/config",
        Some(json!({ "retentionCount": 1 })),
    )
    .await
    .unwrap();

    let first = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = first.body["id"].as_str().unwrap().to_string();
    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();

    // Two more routine backups, with retention set to one.
    for _ in 0..2 {
        call(&f.pool, "POST", "/backups/run", Some(json!({})))
            .await
            .unwrap();
    }

    // A PRE_RESTORE snapshot is the only copy of the state a restore replaced.
    // Deleting it to make room for a routine backup would destroy something
    // unrecoverable — so it is excluded from the count as well as the deletion.
    let rows: Vec<(String, String)> =
        sqlx::query_as(r#"SELECT "source", "filepath" FROM "Backup" ORDER BY "createdAt""#)
            .fetch_all(&f.pool)
            .await
            .unwrap();
    let pre: Vec<_> = rows.iter().filter(|(s, _)| s == "PRE_RESTORE").collect();
    assert_eq!(pre.len(), 1);
    assert!(PathBuf::from(&pre[0].1).exists());
    assert_eq!(rows.iter().filter(|(s, _)| s == "MANUAL").count(), 1);
}

// ═══ Config ═══

#[tokio::test]
async fn the_config_row_is_created_on_first_read() {
    let f = fixture().await;
    let r = call(&f.pool, "GET", "/backups/config", None).await.unwrap();
    assert_eq!(r.body["enabled"], json!(false));
    assert_eq!(r.body["frequency"], json!("DAILY"));
    assert_eq!(r.body["retentionCount"], json!(7));
    // The path is where backups actually go, derived from the database.
    assert!(r.body["path"].as_str().unwrap().ends_with("backups"));

    // Read twice, one row.
    call(&f.pool, "GET", "/backups/config", None).await.unwrap();
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "BackupConfig""#)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn a_requested_backup_path_is_accepted_and_ignored() {
    let f = fixture().await;
    let r = call(
        &f.pool,
        "PUT",
        "/backups/config",
        Some(json!({ "enabled": true, "path": "/tmp/somewhere-else" })),
    )
    .await
    .unwrap();
    assert_eq!(r.body["enabled"], json!(true));
    // Letting a request move the directory means a backup and the restore that
    // follows could name different places, which is the one way this feature
    // can lose data.
    assert_ne!(r.body["path"], json!("/tmp/somewhere-else"));
}

#[tokio::test]
async fn an_impossible_config_is_refused() {
    let f = fixture().await;
    for body in [
        json!({ "frequency": "HOURLY" }),
        json!({ "retentionCount": 0 }),
    ] {
        let err = call(&f.pool, "PUT", "/backups/config", Some(body))
            .await
            .unwrap_err();
        assert_eq!(err.status, 400);
    }
}

#[tokio::test]
async fn deleting_a_backup_removes_the_file_and_the_row() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    let path = r.body["filepath"].as_str().unwrap().to_string();

    let d = call(&f.pool, "DELETE", &format!("/backups/{id}"), None)
        .await
        .unwrap();
    assert_eq!(d.status, 204);
    assert!(!PathBuf::from(&path).exists());

    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Backup""#)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn deleting_a_backup_whose_file_is_already_gone_still_succeeds() {
    let f = fixture().await;
    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = r.body["id"].as_str().unwrap().to_string();
    std::fs::remove_file(r.body["filepath"].as_str().unwrap()).unwrap();

    // The end state is the same, so a missing file is success rather than a
    // row nobody can ever clear.
    let d = call(&f.pool, "DELETE", &format!("/backups/{id}"), None)
        .await
        .unwrap();
    assert_eq!(d.status, 204);
}

#[tokio::test]
async fn a_missing_backup_is_a_404() {
    let f = fixture().await;
    for (method, path, body) in [
        ("DELETE", "/backups/nope", None),
        (
            "POST",
            "/backups/nope/restore",
            Some(json!({ "confirmText": "RESTORE" })),
        ),
    ] {
        let err = call(&f.pool, method, path, body).await.unwrap_err();
        assert_eq!(err.status, 404, "{method} {path}");
    }
}

#[tokio::test]
async fn a_restore_removes_the_journal_belonging_to_the_database_it_replaced() {
    let f = fixture().await;
    make_account(&f.pool, "Original").await;
    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();
    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    f.pool.close().await;

    // A crash can leave any of the three sidecars behind. SQLite would apply
    // one to whatever file it finds beside it — which after a restore is a
    // different database entirely.
    let db = f.dir.join("avoir.db");
    let sidecars: Vec<PathBuf> = ["-journal", "-wal", "-shm"]
        .iter()
        .map(|s| {
            let mut p = db.clone().into_os_string();
            p.push(s);
            PathBuf::from(p)
        })
        .collect();
    for s in &sidecars {
        std::fs::write(s, b"stale").unwrap();
    }

    let paths = avoir_db::backup::Paths {
        database: db,
        directory: f.dir.join("backups"),
    };
    assert!(avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap());
    for s in &sidecars {
        assert!(!s.exists(), "left behind: {}", s.display());
    }
}

// ═══ Credentials are not in a backup, and a restore does not clear them ═══

/// A stored Finnhub key.
async fn store_credential(pool: &SqlitePool, secret: &str) {
    sqlx::query(
        r#"INSERT INTO "ConnectedService"
             ("id","provider","secret","hint","createdAt","updatedAt")
           VALUES ('cs1','finnhub', ?, 'po60',
                   '2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z')
           ON CONFLICT("provider") DO UPDATE SET "secret" = excluded."secret""#,
    )
    .bind(secret)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn a_backup_carries_no_credentials() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    store_credential(&f.pool, "Y2lwaGVydGV4dA==").await;

    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let path = r.body["filepath"].as_str().unwrap().to_string();

    let backup_pool = avoir_db::connect(&format!("sqlite:{path}")).await.unwrap();
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
        .fetch_one(&backup_pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "the file that travels holds no credential");
    // Everything else is still there — only the credentials are removed.
    let accounts: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "Account""#)
        .fetch_one(&backup_pool)
        .await
        .unwrap();
    assert_eq!(accounts, 1);
    backup_pool.close().await;

    // The live database is untouched.
    let live: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
        .fetch_one(&f.pool)
        .await
        .unwrap();
    assert_eq!(live, 1);
}

#[tokio::test]
async fn the_ciphertext_is_not_left_in_the_backups_freed_pages() {
    let f = fixture().await;
    // Long enough to find, and distinctive enough that a match cannot be
    // coincidence.
    let secret = "Y0lQaEVyVGVYdF9tQXJrRXJfMDEyMzQ1Njc4OWFiY2RlZg".repeat(4);
    store_credential(&f.pool, &secret).await;

    let r = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let bytes = std::fs::read(r.body["filepath"].as_str().unwrap()).unwrap();

    // A bare DELETE frees the page and leaves the bytes in the file, where a
    // hex editor finds them. The VACUUM afterwards is what makes the removal
    // real — this is the assertion that tells the two apart.
    let needle = secret.as_bytes();
    let found = bytes.windows(needle.len()).any(|w| w == needle);
    assert!(!found, "the ciphertext is still in the backup file");
}

#[tokio::test]
async fn restoring_keeps_the_credential_the_backup_never_held() {
    let f = fixture().await;
    make_account(&f.pool, "Original").await;
    store_credential(&f.pool, "Y2lwaGVydGV4dA==").await;

    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();
    make_account(&f.pool, "Added since").await;

    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    f.pool.close().await;

    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    assert!(avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap());

    let pool = avoir_db::connect(&format!("sqlite:{}", paths.database.display()))
        .await
        .unwrap();
    let names: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "Account""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(names, vec!["Original"], "the data was restored");

    // The backup said nothing about credentials, so the restore must not read
    // that silence as an instruction to clear them.
    let (provider, secret): (String, String) =
        sqlx::query_as(r#"SELECT "provider","secret" FROM "ConnectedService""#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(provider, "finnhub");
    assert_eq!(secret, "Y2lwaGVydGV4dA==");
    pool.close().await;
}

#[tokio::test]
async fn a_restore_with_no_credential_stored_still_works() {
    let f = fixture().await;
    make_account(&f.pool, "Original").await;
    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();

    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    f.pool.close().await;

    // Nothing to carry is the common case, and must not be an error path.
    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    assert!(avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap());

    let pool = avoir_db::connect(&format!("sqlite:{}", paths.database.display()))
        .await
        .unwrap();
    let n: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM "ConnectedService""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    pool.close().await;
}

#[tokio::test]
async fn a_carried_credential_wins_over_one_inside_an_older_backup() {
    let f = fixture().await;
    let made = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();
    let path = made.body["filepath"].as_str().unwrap().to_string();

    // A backup taken before credentials were stripped still has a row in it.
    let old = avoir_db::connect(&format!("sqlite:{path}")).await.unwrap();
    store_credential(&old, "T0xEX2NpcGhlcnRleHQ=").await;
    old.close().await;

    store_credential(&f.pool, "TkVXX2NpcGhlcnRleHQ=").await;
    call(
        &f.pool,
        "POST",
        &format!("/backups/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    f.pool.close().await;

    let paths = avoir_db::backup::Paths {
        database: f.dir.join("avoir.db"),
        directory: f.dir.join("backups"),
    };
    assert!(avoir_db::backup::apply_staged_restore(&paths)
        .await
        .unwrap());

    let pool = avoir_db::connect(&format!("sqlite:{}", paths.database.display()))
        .await
        .unwrap();
    // `provider` is unique, so the two collide. The carried row wins: it is the
    // one this install is actually using.
    let secrets: Vec<String> = sqlx::query_scalar(r#"SELECT "secret" FROM "ConnectedService""#)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(secrets, vec!["TkVXX2NpcGhlcnRleHQ="]);
    pool.close().await;
}

// ═══ The schedule ═══

/// Turn the schedule on with a given frequency and retention.
async fn enable_schedule(pool: &SqlitePool, frequency: &str, retention: i64) {
    call(
        pool,
        "PUT",
        "/backups/config",
        Some(json!({ "enabled": true, "frequency": frequency, "retentionCount": retention })),
    )
    .await
    .unwrap();
}

async fn backups_of(pool: &SqlitePool, source: &str) -> Vec<Value> {
    call(pool, "GET", "/backups", None)
        .await
        .unwrap()
        .body
        .as_array()
        .unwrap()
        .iter()
        .filter(|b| b["source"] == source)
        .cloned()
        .collect()
}

/// Backdate every SCHEDULED backup so the next check sees a new calendar day.
async fn age_scheduled_backups(pool: &SqlitePool, days: i64) {
    let when = (chrono::Utc::now() - chrono::Duration::days(days))
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    sqlx::query(r#"UPDATE "Backup" SET "createdAt" = ? WHERE "source" = 'SCHEDULED'"#)
        .bind(&when)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_disabled_schedule_takes_nothing() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;

    // The config defaults to disabled, which is what the Settings toggle showed
    // while the feature did nothing at all.
    let due = avoir_api::backups::run_if_due(&f.pool).await;
    assert_eq!(due, avoir_core::backup_schedule::Due::Disabled);
    assert!(backups_of(&f.pool, "SCHEDULED").await.is_empty());
}

#[tokio::test]
async fn enabling_the_schedule_takes_a_backup_on_the_next_check() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;

    let due = avoir_api::backups::run_if_due(&f.pool).await;
    assert_eq!(due, avoir_core::backup_schedule::Due::Yes);

    let taken = backups_of(&f.pool, "SCHEDULED").await;
    assert_eq!(taken.len(), 1);
    assert_eq!(taken[0]["status"], "COMPLETED");
    assert_eq!(taken[0]["available"], true);
    // A real database, same as a manual one — the source is bookkeeping, not a
    // different kind of file.
    assert!(PathBuf::from(taken[0]["filepath"].as_str().unwrap()).exists());
}

#[tokio::test]
async fn the_hourly_tick_does_not_take_a_backup_every_hour() {
    // The tick is how finely the app notices a day boundary, not the backup
    // frequency. Ticking must be nearly free and must not accumulate files.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;

    for _ in 0..5 {
        avoir_api::backups::run_if_due(&f.pool).await;
    }
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 1);
}

#[tokio::test]
async fn a_new_calendar_day_takes_the_next_backup() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;
    avoir_api::backups::run_if_due(&f.pool).await;

    age_scheduled_backups(&f.pool, 1).await;
    assert_eq!(
        avoir_api::backups::run_if_due(&f.pool).await,
        avoir_core::backup_schedule::Due::Yes
    );
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 2);
}

#[tokio::test]
async fn a_weekly_schedule_ignores_a_day_and_acts_on_a_week() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "WEEKLY", 7).await;
    avoir_api::backups::run_if_due(&f.pool).await;

    age_scheduled_backups(&f.pool, 3).await;
    assert_eq!(
        avoir_api::backups::run_if_due(&f.pool).await,
        avoir_core::backup_schedule::Due::NotYet
    );
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 1);

    age_scheduled_backups(&f.pool, 8).await;
    avoir_api::backups::run_if_due(&f.pool).await;
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 2);
}

#[tokio::test]
async fn a_schedule_turned_back_off_stops() {
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;
    avoir_api::backups::run_if_due(&f.pool).await;

    call(
        &f.pool,
        "PUT",
        "/backups/config",
        Some(json!({ "enabled": false })),
    )
    .await
    .unwrap();

    age_scheduled_backups(&f.pool, 30).await;
    assert_eq!(
        avoir_api::backups::run_if_due(&f.pool).await,
        avoir_core::backup_schedule::Due::Disabled
    );
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 1);
}

#[tokio::test]
async fn a_schedule_never_evicts_a_backup_you_took_yourself() {
    // THE reason SCHEDULED is a separate source. Sharing one bucket would mean a
    // daily schedule at the default retention deletes every deliberate backup
    // within a week — including one taken immediately before a risky import,
    // which is the exact moment this feature exists for.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;

    let manual = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap()
        .body;
    let manual_path = PathBuf::from(manual["filepath"].as_str().unwrap());

    enable_schedule(&f.pool, "DAILY", 2).await;
    for day in 0..5 {
        avoir_api::backups::run_if_due(&f.pool).await;
        age_scheduled_backups(&f.pool, day + 1).await;
    }

    // The schedule pruned itself down to its own retention…
    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 2);
    // …and never touched the manual one, on disk or in the record.
    let manuals = backups_of(&f.pool, "MANUAL").await;
    assert_eq!(manuals.len(), 1);
    assert_eq!(manuals[0]["id"], manual["id"]);
    assert!(manual_path.exists(), "the manual backup's file survived");
}

#[tokio::test]
async fn a_manual_run_never_evicts_a_scheduled_one_either() {
    // The rule is symmetric: neither source may prune the other.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 1).await;
    avoir_api::backups::run_if_due(&f.pool).await;

    for _ in 0..3 {
        call(&f.pool, "POST", "/backups/run", Some(json!({})))
            .await
            .unwrap();
    }

    assert_eq!(backups_of(&f.pool, "SCHEDULED").await.len(), 1);
    assert_eq!(backups_of(&f.pool, "MANUAL").await.len(), 1);
}

#[tokio::test]
async fn a_pre_restore_snapshot_is_never_pruned_by_the_schedule() {
    // It is the rollback point for the restore that just ran. Deleting it to
    // make room for a routine backup would destroy the only copy of the state
    // the user might need to get back to.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    let target = call(&f.pool, "POST", "/backups/run", Some(json!({})))
        .await
        .unwrap()
        .body["id"]
        .as_str()
        .unwrap()
        .to_string();
    call(
        &f.pool,
        "POST",
        &format!("/backups/{target}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();
    assert_eq!(backups_of(&f.pool, "PRE_RESTORE").await.len(), 1);

    enable_schedule(&f.pool, "DAILY", 1).await;
    for day in 0..4 {
        avoir_api::backups::run_if_due(&f.pool).await;
        age_scheduled_backups(&f.pool, day + 1).await;
    }

    assert_eq!(
        backups_of(&f.pool, "PRE_RESTORE").await.len(),
        1,
        "the rollback point survived"
    );
}

#[tokio::test]
async fn the_schema_refuses_a_frequency_the_code_cannot_read() {
    // `run_if_due` has an UnknownFrequency arm, and this is why it cannot be
    // reached from here: the CHECK constraint already rejects anything but
    // DAILY and WEEKLY, so the two agree by construction. That arm is a guard
    // against a NEWER build writing a cadence this one does not know, which is
    // exercised where it can be — `is_due` in avoir-core, with "HOURLY".
    let f = fixture().await;
    let written = sqlx::query(r#"UPDATE "BackupConfig" SET "frequency" = 'HOURLY'"#)
        .execute(&f.pool)
        .await;
    // Nothing to update before the config row exists; create it, then retry.
    call(&f.pool, "GET", "/backups/config", None).await.unwrap();
    let _ = written;
    let rejected = sqlx::query(r#"UPDATE "BackupConfig" SET "frequency" = 'HOURLY'"#)
        .execute(&f.pool)
        .await;
    assert!(rejected.is_err(), "the CHECK constraint held");

    // And the route refuses it before SQLite has to.
    let e = call(
        &f.pool,
        "PUT",
        "/backups/config",
        Some(json!({ "frequency": "HOURLY" })),
    )
    .await
    .expect_err("route rejects it");
    assert_eq!(e.status, 400);
}

#[tokio::test]
async fn a_failed_scheduled_backup_does_not_count_as_the_last_run() {
    // Otherwise one bad night suppresses every retry until the next window: the
    // schedule would go quiet precisely BECAUSE backups had stopped working,
    // which is the opposite of what should happen.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;

    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();
    sqlx::query(
        r#"INSERT INTO "Backup"
             ("id","filename","filepath","sizeBytes","status","source","error","createdAt")
           VALUES ('failed-1', '', '', 0, 'FAILED', 'SCHEDULED', 'disk full', ?)"#,
    )
    .bind(&now)
    .execute(&f.pool)
    .await
    .unwrap();

    assert_eq!(
        avoir_api::backups::run_if_due(&f.pool).await,
        avoir_core::backup_schedule::Due::Yes,
        "a failure today must not block today's retry"
    );
    let completed: Vec<Value> = backups_of(&f.pool, "SCHEDULED")
        .await
        .into_iter()
        .filter(|b| b["status"] == "COMPLETED")
        .collect();
    assert_eq!(completed.len(), 1);
}

#[tokio::test]
async fn a_database_error_is_not_reported_as_a_disabled_schedule() {
    // Folding one into the other makes a BROKEN schedule indistinguishable from
    // one nobody switched on — in the log, and in every test that asserts on
    // the result. Forced by closing the pool out from under the check.
    let f = fixture().await;
    make_account(&f.pool, "Checking").await;
    enable_schedule(&f.pool, "DAILY", 7).await;
    f.pool.close().await;

    assert_eq!(
        avoir_api::backups::run_if_due(&f.pool).await,
        avoir_core::backup_schedule::Due::Unavailable
    );
}

// ─── Uploading a database from elsewhere ───

/// A real Avoir database as bytes: take a backup of a live one and read it.
async fn a_valid_database(f: &Fixture) -> Vec<u8> {
    let made = call(&f.pool, "POST", "/backups/run", None).await.unwrap();
    let path = made.body["filepath"]
        .as_str()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            // `filepath` is not serialized; find it from the row instead.
            f.dir.join("backups")
        });
    if path.is_file() {
        return std::fs::read(&path).unwrap();
    }
    let dir = f.dir.join("backups");
    let first = std::fs::read_dir(&dir)
        .expect("a backups directory")
        .flatten()
        .next()
        .expect("a backup file");
    std::fs::read(first.path()).unwrap()
}

fn staged_dirs() -> usize {
    std::fs::read_dir(std::env::temp_dir().join("avoir-uploads"))
        .map(|d| d.flatten().count())
        .unwrap_or(0)
}

#[tokio::test]
async fn an_uploaded_database_is_staged_and_described() {
    let f = fixture().await;
    let bytes = a_valid_database(&f).await;

    let r = avoir_api::backups::upload(&f.pool, &bytes).await.unwrap();
    assert_eq!(r.status, 201);
    let id = r.body["uploadId"].as_str().expect("an opaque id");
    assert!(
        !id.contains('/') && !id.contains(".."),
        "the id is a token, not a path: {id}"
    );
    assert_eq!(r.body["sizeBytes"], json!(bytes.len()));
    assert!(
        r.body["tableCount"].as_i64().unwrap() > 30,
        "a real schema was counted, got {}",
        r.body["tableCount"]
    );
    avoir_db::upload_staging::discard(id);
}

/// Three refusals, each a different thing to tell a user. The Postgres version
/// collapsed the last two into one message.
#[tokio::test]
async fn a_file_that_is_not_this_apps_database_is_refused() {
    let f = fixture().await;

    let e = avoir_api::backups::upload(&f.pool, b"").await.unwrap_err();
    assert_eq!(e.status, 400);
    assert!(e.error.contains("empty"), "{}", e.error);

    let e = avoir_api::backups::upload(&f.pool, b"not a database at all")
        .await
        .unwrap_err();
    assert!(e.error.contains("not a database"), "{}", e.error);

    // A genuine SQLite file, but somebody else's.
    let other = f.dir.join("other.db");
    let opts = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&other)
        .create_if_missing(true);
    let p2 = SqlitePool::connect_with(opts).await.unwrap();
    sqlx::query("CREATE TABLE unrelated (x INTEGER)")
        .execute(&p2)
        .await
        .unwrap();
    p2.close().await;
    let e = avoir_api::backups::upload(&f.pool, &std::fs::read(&other).unwrap())
        .await
        .unwrap_err();
    assert!(e.error.contains("not an Avoir Money backup"), "{}", e.error);
}

/// A rejected upload leaves nothing on disk. It cannot be restored, so keeping
/// it only leaves a copy of someone's data in a temp directory.
#[tokio::test]
async fn a_rejected_upload_is_not_left_lying_around() {
    let f = fixture().await;
    let before = staged_dirs();
    let _ = avoir_api::backups::upload(&f.pool, b"not a database at all").await;
    assert_eq!(staged_dirs(), before, "no staging directory survived");
}

#[tokio::test]
async fn restoring_an_upload_stages_it_and_keeps_a_copy() {
    let f = fixture().await;
    let bytes = a_valid_database(&f).await;
    let up = avoir_api::backups::upload(&f.pool, &bytes).await.unwrap();
    let id = up.body["uploadId"].as_str().unwrap().to_string();

    let r = call(
        &f.pool,
        "POST",
        &format!("/backups/upload/{id}/restore"),
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap();

    assert_eq!(r.status, 200);
    assert_eq!(r.body["restartRequired"], json!(true));
    assert!(r.body["safetyBackupId"].is_string(), "a rollback point");
    // ADR-028: IMPORTED is never evicted by retention, because a file supplied
    // by hand exists nowhere else.
    assert!(r.body["importedBackupId"].is_string(), "kept as IMPORTED");

    assert!(
        avoir_db::upload_staging::resolve(&id).is_none(),
        "staging cleaned up either way"
    );
}

#[tokio::test]
async fn restoring_an_upload_needs_the_confirmation_and_a_real_id() {
    let f = fixture().await;
    let bytes = a_valid_database(&f).await;
    let up = avoir_api::backups::upload(&f.pool, &bytes).await.unwrap();
    let id = up.body["uploadId"].as_str().unwrap().to_string();

    let e = call(
        &f.pool,
        "POST",
        &format!("/backups/upload/{id}/restore"),
        Some(json!({ "confirmText": "yes" })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.status, 400, "the confirmation is required");
    avoir_db::upload_staging::discard(&id);

    // An id that is not a plain token never becomes a path.
    let e = call(
        &f.pool,
        "POST",
        "/backups/upload/nonexistent-upload-id/restore",
        Some(json!({ "confirmText": "RESTORE" })),
    )
    .await
    .unwrap_err();
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn a_completed_backup_downloads_its_own_bytes() {
    let f = fixture().await;
    let made = call(&f.pool, "POST", "/backups/run", None).await.unwrap();
    let id = made.body["id"].as_str().unwrap();

    let (filename, bytes) = avoir_api::backups::download(&f.pool, id, None)
        .await
        .unwrap();
    assert!(filename.ends_with(".db"), "{filename}");
    assert_eq!(&bytes[..16], b"SQLite format 3\0", "a real database");

    let e = avoir_api::backups::download(&f.pool, "nope", None)
        .await
        .unwrap_err();
    assert_eq!(e.status, 404);
}

#[tokio::test]
async fn a_download_with_a_passphrase_is_encrypted_and_named_as_such() {
    let f = fixture().await;
    let made = call(&f.pool, "POST", "/backups/run", None).await.unwrap();
    let id = made.body["id"].as_str().unwrap().to_string();

    let (plain_name, plain) = avoir_api::backups::download(&f.pool, &id, None)
        .await
        .unwrap();
    let (sealed_name, sealed) = avoir_api::backups::download(&f.pool, &id, Some("a passphrase"))
        .await
        .unwrap();

    // The suffix is part of the contract, not decoration: it is how the person
    // who finds this file later knows `age -d` opens it.
    assert!(plain_name.ends_with(".db"), "{plain_name}");
    assert_eq!(sealed_name, format!("{plain_name}.age"));

    // A real age file, so any age implementation can recover it — the whole
    // reason ADR-038 chose that format over something bespoke.
    assert!(sealed.starts_with(b"age-encryption.org/v1"));
    assert_ne!(sealed, plain);
    assert_eq!(
        avoir_db::portable::decrypt(&sealed, "a passphrase").unwrap(),
        plain,
        "decrypting returns the byte-identical database"
    );

    // An empty passphrase downloads plain rather than producing a file that
    // merely looks protected.
    let (name, bytes) = avoir_api::backups::download(&f.pool, &id, Some(""))
        .await
        .unwrap();
    assert_eq!(name, plain_name);
    assert_eq!(bytes, plain);
}

// ─── /sign-conventions ───
//
// The route the port never had. The frontend's `SignConventionForm` has always
// called it, and opening that form against the packaged app got a 404 — a gap
// neither differential harness can see, because both take their route list from
// the routes the Rust HAS.

#[tokio::test]
async fn sign_conventions_default_when_nothing_is_configured() {
    let f = fixture().await;
    let tmp = std::env::temp_dir().join(format!("sc-absent-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    std::env::set_var("SIGN_CONVENTION_CONFIG_PATH", &tmp);

    let r = call(&f.pool, "GET", "/sign-conventions", None)
        .await
        .unwrap();
    // A missing file means "never configured", not an error — the defaults are
    // what the importer has always assumed.
    assert_eq!(
        r.body["expense"]["positiveMeaning"],
        serde_json::json!("money_out")
    );
    assert_eq!(
        r.body["income"]["negativeMeaning"],
        serde_json::json!("flip_sign")
    );
    assert_eq!(
        r.body["transfer"]["positiveMeaning"],
        serde_json::json!("withdrawal")
    );
    assert_eq!(r.body["trade"]["positiveMeaning"], serde_json::json!("buy"));
    std::env::remove_var("SIGN_CONVENTION_CONFIG_PATH");
}

#[tokio::test]
async fn sign_conventions_round_trip_and_tolerate_the_legacy_refund_key() {
    let f = fixture().await;
    let tmp = std::env::temp_dir().join(format!("sc-rt-{}.json", std::process::id()));
    std::env::set_var("SIGN_CONVENTION_CONFIG_PATH", &tmp);

    // The committed config carries a `refund` key whose schema is one possible
    // value. Rejecting a file the app itself wrote would be a worse failure than
    // discarding a field that carries no information.
    std::fs::write(
        &tmp,
        r#"{"expense":{"positiveMeaning":"money_in","negativeMeaning":"spending"},
            "income":{"positiveMeaning":"money_in","negativeMeaning":"ignore"},
            "transfer":{"positiveMeaning":"deposit"},
            "trade":{"positiveMeaning":"sell"},
            "refund":{"positiveMeaning":"money_in"}}"#,
    )
    .unwrap();

    let r = call(&f.pool, "GET", "/sign-conventions", None)
        .await
        .unwrap();
    assert_eq!(
        r.body["expense"]["negativeMeaning"],
        serde_json::json!("spending")
    );
    assert_eq!(
        r.body["trade"]["positiveMeaning"],
        serde_json::json!("sell")
    );
    // `refund` IS echoed back, and must be: `SignConventionConfigSchema`
    // requires all five keys and the frontend parses every response with it, so
    // a four-key body throws in the browser — the same failure as the missing
    // `lineTotal`. It carries no information (one possible value), which is why
    // `avoir_core` does not model it and the wire shape reconstructs it.
    assert_eq!(
        r.body["refund"]["positiveMeaning"],
        serde_json::json!("money_in")
    );

    let saved = call(
        &f.pool,
        "PUT",
        "/sign-conventions",
        Some(serde_json::json!({
            "expense": { "positiveMeaning": "money_out", "negativeMeaning": "refund" },
            "income": { "positiveMeaning": "money_out", "negativeMeaning": "flip_sign" },
            "transfer": { "positiveMeaning": "withdrawal" },
            "trade": { "positiveMeaning": "buy" }
        })),
    )
    .await
    .unwrap();
    assert_eq!(
        saved.body["income"]["positiveMeaning"],
        serde_json::json!("money_out")
    );

    // And it survives a re-read, which is the whole point of a file.
    let again = call(&f.pool, "GET", "/sign-conventions", None)
        .await
        .unwrap();
    assert_eq!(again.body, saved.body);

    // Every rule is REQUIRED. A partial body is refused rather than silently
    // resetting the rules it omits — which is what `#[serde(default)]` on the
    // config struct did until the edge-case checklist caught it.
    let partial = call(
        &f.pool,
        "PUT",
        "/sign-conventions",
        Some(serde_json::json!({
            "expense": { "positiveMeaning": "money_out", "negativeMeaning": "refund" }
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(partial.status, 400, "a partial config is refused");
    let untouched = call(&f.pool, "GET", "/sign-conventions", None)
        .await
        .unwrap();
    assert_eq!(untouched.body, saved.body, "and changed nothing");

    // A malformed body does not replace a working config with rubbish.
    let err = call(
        &f.pool,
        "PUT",
        "/sign-conventions",
        Some(serde_json::json!({ "expense": 7 })),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status, 400);
    let intact = call(&f.pool, "GET", "/sign-conventions", None)
        .await
        .unwrap();
    assert_eq!(
        intact.body, saved.body,
        "the rejected write changed nothing"
    );

    std::env::remove_var("SIGN_CONVENTION_CONFIG_PATH");
    let _ = std::fs::remove_file(&tmp);
}
