//! Where an uploaded database waits between being validated and being restored.
//!
//! Port of `apps/api/src/lib/upload-staging.ts`, and its central property is
//! carried over exactly: **no string from the client ever becomes part of a
//! path.** The upload writes into a directory this process creates, under a
//! fixed filename this process chooses, and the caller receives an opaque id.
//! [`resolve`] is the single place that id turns back into a path.
//!
//! That matters more here than it looks. The path this produces is handed to
//! the restore endpoint, which replaces the live database with it — so a
//! traversal bug is not an information leak, it is "restore the app from a file
//! of the attacker's choosing".
//!
//! Two independent guards, because either alone has failed somewhere before:
//! the pattern rejects separators and traversal outright, and the containment
//! check catches whatever the pattern let through by confirming the resolved
//! path is genuinely *inside* the staging root rather than merely starting with
//! its name (`/tmp/avoir-uploads-evil` starts with `/tmp/avoir-uploads`).

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

/// The largest upload accepted, checked before any bytes are read into memory.
pub const MAX_UPLOAD_BYTES: u64 = 100 * 1024 * 1024;

/// Fixed — the uploaded file's own name is never used.
const STAGED_FILENAME: &str = "upload.db";

/// Staging directories older than this are swept.
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// An id is a plain token and nothing else: no separators, no dots, no
/// traversal. This is the first of the two guards.
fn is_valid_id(id: &str) -> bool {
    (6..=64).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn staging_root() -> PathBuf {
    std::env::temp_dir().join("avoir-uploads")
}

pub struct Staged {
    pub upload_id: String,
    pub filepath: PathBuf,
}

/// Write an uploaded database to a fresh staging directory.
///
/// Returns an opaque id, never a path.
pub fn stage(bytes: &[u8]) -> Result<Staged> {
    let root = staging_root();
    std::fs::create_dir_all(&root).context("creating the staging root")?;

    // A directory name this process picks. `mkdtemp` has no std equivalent, so
    // the id is generated the same way every other id in this app is — the
    // collision risk is the same one the whole schema already depends on.
    let upload_id = format!("up-{}", crate::next_id());
    let dir = root.join(&upload_id);
    std::fs::create_dir(&dir).context("creating the staging directory")?;

    let filepath = dir.join(STAGED_FILENAME);
    std::fs::write(&filepath, bytes).context("writing the staged upload")?;
    Ok(Staged {
        upload_id,
        filepath,
    })
}

/// Turn an id from the client back into a path, or `None` if it is not one.
pub fn resolve(upload_id: &str) -> Option<PathBuf> {
    if !is_valid_id(upload_id) {
        return None;
    }
    let root = staging_root();
    let candidate = root.join(upload_id).join(STAGED_FILENAME);

    // Guard two: the resolved path must sit inside the root. `canonicalize`
    // resolves symlinks as well as `..`, so a staged directory replaced by a
    // link to somewhere else is caught here rather than followed.
    let root = root.canonicalize().ok()?;
    let real = candidate.canonicalize().ok()?;
    if !real.starts_with(&root) {
        return None;
    }
    real.is_file().then_some(real)
}

/// Remove one staging directory. Never fails — cleanup is not the operation.
pub fn discard(upload_id: &str) {
    if !is_valid_id(upload_id) {
        return;
    }
    let dir = staging_root().join(upload_id);
    if let Ok(root) = staging_root().canonicalize() {
        if let Ok(real) = dir.canonicalize() {
            if real.starts_with(&root) {
                let _ = std::fs::remove_dir_all(real);
            }
        }
    }
}

/// Delete staging directories left by uploads that were never restored.
///
/// An upload that is validated and then abandoned would otherwise sit in the
/// temp directory holding a full copy of someone's finances indefinitely.
pub fn sweep_stale() -> usize {
    let Ok(entries) = std::fs::read_dir(staging_root()) else {
        return 0;
    };
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !is_valid_id(name) {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .is_some_and(|age| age > STALE_AFTER);
        if stale && std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// The staged file's size, for re-validation.
pub fn size_of(path: &Path) -> Result<u64> {
    Ok(std::fs::metadata(path)?.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_staged_upload_round_trips_through_its_id() {
        let s = stage(b"SQLite format 3\0and then some").unwrap();
        let back = resolve(&s.upload_id).expect("resolves");
        assert_eq!(std::fs::read(&back).unwrap().len(), 29);
        discard(&s.upload_id);
        assert!(resolve(&s.upload_id).is_none(), "gone after discard");
    }

    /// The guard that matters. Every one of these is a path the restore
    /// endpoint would otherwise be pointed at, and restore REPLACES the live
    /// database — so this is not an information leak, it is arbitrary
    /// file adoption.
    #[test]
    fn no_client_string_can_escape_the_staging_root() {
        for hostile in [
            "../../../etc/passwd",
            "..",
            "../up-something",
            "/etc/passwd",
            "up-abc/../../..",
            "a", // too short to be an id
            "",
            "has space",
            "semi;colon",
            "null\0byte",
        ] {
            assert!(
                resolve(hostile).is_none(),
                "{hostile:?} must not resolve to a path"
            );
        }
    }

    #[test]
    fn discard_refuses_the_same_strings() {
        // Should be a no-op rather than deleting anything outside the root.
        discard("../../../tmp");
        discard("/etc");
        assert!(std::path::Path::new("/etc").exists(), "still there");
    }

    #[test]
    fn an_unknown_id_is_simply_absent() {
        assert!(resolve("up-doesnotexist000").is_none());
    }
}
