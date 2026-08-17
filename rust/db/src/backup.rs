//! Backups, redesigned for SQLite rather than ported from Postgres.
//!
//! # Why this is not a port
//!
//! `apps/api/src/lib/backup.ts` shells out to `pg_dump` and `pg_restore` inside
//! a Docker container named `budget-tracker-db`. None of those three things
//! exists in a desktop app: no Docker, no server, no container name. Porting it
//! literally would mean shipping PostgreSQL client binaries to run against a
//! database that is not PostgreSQL.
//!
//! It also had a standing cost. The container name is why two test suites could
//! never pass in CI (the ERRORS.md entry "a gated job hides everything
//! downstream of it"), because GitHub generates its own service container names
//! and the literal could not match.
//!
//! # What replaces it
//!
//! **Backup is `VACUUM INTO`.** One statement, and it is SQLite's own
//! recommended way to copy a live database: it takes a read transaction, so the
//! copy is a consistent snapshot even while the app is writing, and the result
//! is compacted. A plain file copy is *not* equivalent — it can catch pages
//! mid-write and produce a file that opens fine and is subtly wrong.
//!
//! **Restore is a file swap staged for the next launch.** SQLite's own guidance
//! is to replace the file with no connections open, so the swap happens in
//! `main()` before the pool exists rather than trying to close and reopen one
//! underneath live requests. That is also the honest behaviour: after a restore
//! every query result and every cache in the frontend is stale, so a restart is
//! the correct outcome rather than an inconvenience. The marker is idempotent,
//! so a crash mid-swap leaves the restore pending rather than half-applied.
//!
//! **Validation gets stronger, not weaker.** The Postgres version ran
//! `pg_restore --list` and looked at the table names. Here a candidate file is
//! opened as a database and asked `PRAGMA integrity_check`, which verifies every
//! page and index — something the pg path could not do without restoring first.

use anyhow::{bail, Context, Result};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{Connection, SqliteConnection, SqlitePool};
use std::path::{Path, PathBuf};

/// The first 16 bytes of every SQLite database file.
const MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// Tables a file must have to be *this* application's database.
///
/// Not the whole schema — a handful that no other SQLite file would plausibly
/// carry together. Checking all 40 would reject a backup taken one migration
/// ago, which is exactly when a backup is most wanted.
const REQUIRED_TABLES: [&str; 4] = ["Transaction", "Account", "Budget", "_sqlx_migrations"];

/// Where the live database is, and where its backups go.
///
/// Derived from the pool rather than configured, so there is no way to point a
/// backup at one database and a restore at another.
#[derive(Debug, Clone)]
pub struct Paths {
    pub database: PathBuf,
    pub directory: PathBuf,
}

impl Paths {
    /// Read the live database's location out of the pool that opened it.
    pub fn from_pool(pool: &SqlitePool) -> Paths {
        let database = pool.connect_options().get_filename().to_path_buf();
        let directory = database
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("backups");
        Paths {
            database,
            directory,
        }
    }

    /// The file whose presence tells `main()` a restore is waiting.
    ///
    /// A sibling of the database rather than a temp file: it has to survive a
    /// reboot, because "restart the app" is how the restore completes.
    pub fn pending_restore(&self) -> PathBuf {
        self.database.with_extension("restore-pending")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Manual,
    PreRestore,
    Imported,
    /// Taken by the schedule rather than asked for.
    ///
    /// A distinct source, not a flavour of Manual, because retention evicts
    /// within a source: sharing the bucket would let a daily schedule delete
    /// the backup a user took deliberately before a risky import.
    Scheduled,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Manual => "MANUAL",
            Source::PreRestore => "PRE_RESTORE",
            Source::Imported => "IMPORTED",
            Source::Scheduled => "SCHEDULED",
        }
    }

    fn prefix(self) -> &'static str {
        match self {
            Source::Manual => "avoir_backup",
            Source::PreRestore => "pre_restore",
            Source::Imported => "imported",
            Source::Scheduled => "scheduled",
        }
    }
}

/// A backup that was written to disk.
#[derive(Debug, Clone)]
pub struct Created {
    pub filename: String,
    pub filepath: PathBuf,
    pub size_bytes: i64,
}

/// A backup's filename: source, then the moment to the millisecond.
///
/// **Milliseconds, not seconds, and the reason is not tidiness.** With
/// second resolution a name recurs, and a name that recurs can be *reused* once
/// retention has freed it — which is exactly what happens, because retention
/// runs immediately after each backup. A recorded `Backup` row whose file was
/// removed by hand would then be silently re-pointed at a different backup's
/// bytes, and the row would claim to be something it is not. Milliseconds make
/// reuse effectively impossible; the collision loop in `create` remains as a
/// backstop rather than as the mechanism.
fn filename_for(source: Source, now: chrono::DateTime<chrono::Local>) -> String {
    format!("{}_{}.db", source.prefix(), now.format("%Y%m%d_%H%M%S_%3f"))
}

/// Snapshot the live database into the backup directory.
///
/// `VACUUM INTO` refuses to overwrite, which is a feature: two backups in the
/// same second would otherwise silently become one, and the second's row would
/// point at the first's bytes.
pub async fn create(pool: &SqlitePool, paths: &Paths, source: Source) -> Result<Created> {
    std::fs::create_dir_all(&paths.directory)
        .with_context(|| format!("creating {}", paths.directory.display()))?;

    // A backstop. `VACUUM INTO` refuses to overwrite, so a name that somehow
    // recurs gets a suffix rather than the backup failing.
    let base = filename_for(source, chrono::Local::now());
    let stem = base.trim_end_matches(".db");
    let mut name = base.clone();
    let mut filepath = paths.directory.join(&name);
    for n in 1..=100 {
        if !filepath.exists() {
            break;
        }
        name = format!("{stem}_{n}.db");
        filepath = paths.directory.join(&name);
    }
    if filepath.exists() {
        bail!("could not find an unused backup filename");
    }

    // The path is interpolated because `VACUUM INTO` takes a literal, not a
    // bound parameter. Single quotes are doubled — the only metacharacter that
    // matters inside a SQL string literal — and the path is one this process
    // built from the app-data directory and a generated filename, never from a
    // request.
    let escaped = filepath.display().to_string().replace('\'', "''");
    sqlx::query(sqlx::AssertSqlSafe(format!("VACUUM INTO '{escaped}'")))
        .execute(pool)
        .await
        .with_context(|| format!("VACUUM INTO {}", filepath.display()))?;

    strip_credentials(&filepath).await?;

    let size = std::fs::metadata(&filepath)
        .with_context(|| format!("stat {}", filepath.display()))?
        .len() as i64;

    Ok(Created {
        filename: name,
        filepath,
        size_bytes: size,
    })
}

/// Remove every stored third-party credential from a backup copy.
///
/// Driven by [`crate::CREDENTIAL_TABLES`] rather than a name written here, so a
/// table added to that list is stripped by both this and the JSON export
/// without either being edited.
///
/// # The backup is the thing that travels, so the credential is not in it
///
/// Backups get downloaded, moved between machines, and kept in cloud storage.
/// That is the entire threat `secrets.rs` was written against, and encrypting
/// the key was the previous answer to it. Taking the key out of the file
/// outright is a better one: an encrypted secret in a travelling file is a
/// secret whose safety depends on a cipher and on where its key lives, and a
/// secret that was never in the file depends on nothing.
///
/// The encryption stays. It defends the database at rest, which is a different
/// question — this only settles what leaves the machine.
///
/// **`DELETE` alone would not do it.** SQLite frees the pages but the bytes
/// remain in the file until something overwrites them, so a deleted ciphertext
/// still travels — visible to anyone who opens the file in a hex editor. The
/// `VACUUM` afterwards is what makes the removal real: it rebuilds the database
/// into a fresh file and moves it over the original, and freed pages are not
/// carried across.
async fn strip_credentials(path: &Path) -> Result<()> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&opts)
        .await
        .with_context(|| format!("opening {} to strip credentials", path.display()))?;

    for table in crate::CREDENTIAL_TABLES {
        // The table name comes from a compile-time constant, never a request.
        let sql = format!(r#"DELETE FROM "{table}""#);
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut conn)
            .await
            .with_context(|| format!("clearing {table} from the backup"))?;
    }
    sqlx::query("VACUUM")
        .execute(&mut conn)
        .await
        .context("vacuuming the backup so the freed pages do not travel")?;

    conn.close().await.ok();
    Ok(())
}

/// The credential rows as they stand, so a restore does not clear them.
///
/// A backup contains no credentials, so it has nothing to say about them — and
/// a restore must not take silence for an instruction. Clearing the key on
/// restore would be the backup asserting something it does not contain.
async fn read_credentials(path: &Path) -> Result<Vec<ConnectedService>> {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&opts).await?;
    let rows = sqlx::query_as::<_, ConnectedService>(
        r#"SELECT "id","provider","secret","hint","createdAt","updatedAt"
             FROM "ConnectedService""#,
    )
    .fetch_all(&mut conn)
    .await?;
    conn.close().await.ok();
    Ok(rows)
}

async fn write_credentials(path: &Path, rows: &[ConnectedService]) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&opts).await?;
    for r in rows {
        // The restored database may already hold a row for this provider if the
        // backup predates the strip. `provider` is unique, so the carried-over
        // row wins — it is the one the running install can actually decrypt.
        sqlx::query(
            r#"INSERT INTO "ConnectedService"
                 ("id","provider","secret","hint","createdAt","updatedAt")
               VALUES (?1,?2,?3,?4,?5,?6)
               ON CONFLICT("provider") DO UPDATE SET
                 "secret" = ?3, "hint" = ?4, "updatedAt" = ?6"#,
        )
        .bind(&r.id)
        .bind(&r.provider)
        .bind(&r.secret)
        .bind(&r.hint)
        .bind(&r.created_at)
        .bind(&r.updated_at)
        .execute(&mut conn)
        .await?;
    }
    conn.close().await.ok();
    Ok(())
}

/// A stored credential, carried across a restore rather than backed up.
///
/// **These queries are `query_as`, not the checked macros**, because the struct
/// is built by hand — so nothing here would fail to compile if a column were
/// renamed. It happened once already: migration 0004 replaced three columns with
/// one and the build stayed green, with the failure waiting until a restore ran.
/// A column added to this table in future is dropped on restore rather than
/// carried, and the compiler will not say so.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ConnectedService {
    pub id: String,
    pub provider: String,
    /// `None` for a row with no usable key — which every row is immediately
    /// after migration 0004.
    pub secret: Option<String>,
    pub hint: String,
    #[sqlx(rename = "createdAt")]
    pub created_at: String,
    #[sqlx(rename = "updatedAt")]
    pub updated_at: String,
}

/// Why a candidate file cannot be restored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rejected {
    Unreadable(String),
    NotSqlite,
    Corrupt(String),
    NotThisApp(String),
}

impl std::fmt::Display for Rejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Rejected::Unreadable(e) => write!(f, "That file could not be read: {e}"),
            Rejected::NotSqlite => write!(
                f,
                "That file is not a database. Backups made by this app are SQLite files."
            ),
            Rejected::Corrupt(e) => write!(f, "That database file is damaged: {e}"),
            Rejected::NotThisApp(t) => write!(
                f,
                "That database is not an Avoir Money backup — it has no {t} table."
            ),
        }
    }
}

/// Everything that must be true before a file is allowed to replace the live
/// database.
///
/// Ordered cheapest first, and each step's failure is distinguishable: "not a
/// database", "damaged", and "someone else's database" are three different
/// things to tell a user, and the Postgres version collapsed the last two.
pub async fn validate(path: &Path) -> Result<(), Rejected> {
    use std::io::Read;

    let mut head = [0u8; 16];
    let mut f = std::fs::File::open(path).map_err(|e| Rejected::Unreadable(e.to_string()))?;
    match f.read_exact(&mut head) {
        Ok(()) => {}
        // A file too short to hold the magic is not an unreadable file, it is
        // not a database — which is a different thing to tell someone, and the
        // one they can act on.
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Err(Rejected::NotSqlite),
        Err(e) => return Err(Rejected::Unreadable(e.to_string())),
    }
    if &head != MAGIC {
        return Err(Rejected::NotSqlite);
    }

    // Opened read-only and with foreign keys off: this is an inspection, and a
    // damaged file must not be written to or have its constraints evaluated.
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .create_if_missing(false);
    let mut conn = SqliteConnection::connect_with(&opts)
        .await
        .map_err(|e| Rejected::Corrupt(e.to_string()))?;

    let verdict: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut conn)
        .await
        .map_err(|e| Rejected::Corrupt(e.to_string()))?;
    if verdict != "ok" {
        return Err(Rejected::Corrupt(verdict));
    }

    for table in REQUIRED_TABLES {
        let found: Option<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
                .bind(table)
                .fetch_optional(&mut conn)
                .await
                .map_err(|e| Rejected::Corrupt(e.to_string()))?;
        if found.is_none() {
            return Err(Rejected::NotThisApp(table.to_string()));
        }
    }

    let _ = conn.close().await;
    Ok(())
}

/// Mark a validated file as the one to become the database at next launch.
///
/// Copied into place rather than recorded by path, so pruning the backup it
/// came from — or restarting days later — cannot leave the marker pointing at
/// a file that is gone.
pub fn stage_restore(paths: &Paths, from: &Path) -> Result<()> {
    let pending = paths.pending_restore();
    std::fs::copy(from, &pending)
        .with_context(|| format!("staging {} for restore", from.display()))?;
    Ok(())
}

/// Apply a staged restore, if one is waiting. Called before the pool is opened.
///
/// Returns whether anything was applied, so the shell can log it.
///
/// **The order matters and is the whole safety argument.** The staged file is
/// validated again here — it has been sitting on disk across a shutdown — then
/// moved over the database, and only then are the sidecar journal files removed.
/// A journal left beside a replaced database is the one way this can corrupt
/// data: SQLite would apply it to the *new* file, undoing or redoing writes that
/// belonged to the old one.
///
/// All three sidecars are removed, not just the WAL pair. The pool opens in
/// SQLite's default `delete` journal mode today, whose artifact is `-journal`
/// — so cleaning only `-wal`/`-shm` would have removed the files that never
/// exist and left the one that does. `-wal` and `-shm` are kept in the list
/// because switching the pool to WAL is a plausible future change and this is
/// not the place it should surface as data loss.
pub async fn apply_staged_restore(paths: &Paths) -> Result<bool> {
    let pending = paths.pending_restore();
    if !pending.exists() {
        return Ok(false);
    }

    if let Err(rejected) = validate(&pending).await {
        // Refuse and keep the file. Deleting it would destroy the only copy of
        // whatever the user was trying to restore.
        bail!("staged restore is not usable: {rejected}");
    }

    // Read BEFORE the swap, written after. Backups carry no credentials, so
    // the incoming file has nothing to say about them — and a restore must not
    // read that silence as "clear them". Failing to read is not fatal: losing a
    // re-pasteable API key is a smaller harm than refusing a restore the user
    // asked for.
    let carried = match read_credentials(&paths.database).await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("[avoir] could not carry credentials across the restore: {e:#}");
            Vec::new()
        }
    };

    std::fs::rename(&pending, &paths.database).with_context(|| {
        format!(
            "moving {} into place at {}",
            pending.display(),
            paths.database.display()
        )
    })?;

    for suffix in ["-journal", "-wal", "-shm"] {
        let mut p = paths.database.clone().into_os_string();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }

    if let Err(e) = write_credentials(&paths.database, &carried).await {
        eprintln!("[avoir] could not restore carried credentials: {e:#}");
    }

    Ok(true)
}

/// Delete a backup file. Missing is success — the end state is the same.
pub fn delete_file(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e).with_context(|| format!("deleting {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use chrono::TimeZone;

    #[test]
    fn a_filename_carries_its_source_and_the_moment() {
        let t = chrono::Local
            .with_ymd_and_hms(2026, 8, 10, 14, 3, 9)
            .unwrap();
        assert_eq!(
            filename_for(Source::Manual, t),
            "avoir_backup_20260810_140309_000.db"
        );
        assert_eq!(
            filename_for(Source::PreRestore, t),
            "pre_restore_20260810_140309_000.db"
        );
    }

    #[test]
    fn two_moments_a_millisecond_apart_do_not_share_a_name() {
        // Second resolution made a name recur, and retention frees names —
        // so a later backup could take a name a still-recorded row points at.
        let a = chrono::Local
            .with_ymd_and_hms(2026, 8, 10, 14, 3, 9)
            .unwrap();
        let b = a + chrono::Duration::milliseconds(1);
        assert_ne!(
            filename_for(Source::Manual, a),
            filename_for(Source::Manual, b)
        );
    }
}

#[cfg(test)]
mod short_file_tests {
    use super::{validate, Rejected};

    /// A file too short to hold the magic bytes.
    ///
    /// `read_exact` fails with UnexpectedEof, which read as "that file could
    /// not be read" — true of the syscall and useless to the person who picked
    /// the wrong file. It is not a database, and that is what to say.
    #[tokio::test]
    async fn a_file_shorter_than_the_magic_is_not_a_database() {
        let p = std::env::temp_dir().join(format!("avoir-short-{}.db", crate::next_id()));
        std::fs::write(&p, b"hello\n").unwrap();
        assert!(matches!(validate(&p).await, Err(Rejected::NotSqlite)));
        let _ = std::fs::remove_file(&p);
    }

    #[tokio::test]
    async fn an_empty_file_is_also_not_a_database() {
        let p = std::env::temp_dir().join(format!("avoir-empty-{}.db", crate::next_id()));
        std::fs::write(&p, b"").unwrap();
        assert!(matches!(validate(&p).await, Err(Rejected::NotSqlite)));
        let _ = std::fs::remove_file(&p);
    }
}
