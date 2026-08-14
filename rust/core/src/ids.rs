//! Primary-key generation.
//!
//! Prisma made every id in this database with `@default(cuid())`, and the
//! 6,254 imported production rows all carry that shape: `c` followed by 24
//! base36 characters. Nothing in the app parses an id — they are opaque
//! everywhere — so the format is not load-bearing on its own. It is kept
//! anyway for one reason: after the cutover the table holds both old and new
//! ids, and a row whose key looks nothing like its neighbours' invites the
//! question "was this one imported differently?" every time someone reads the
//! table by hand. Uniformity costs 30 lines here and saves that question.
//!
//! Collision resistance comes from three independent parts, which is cuid's
//! actual design: a millisecond timestamp (distinct across time), a process
//! counter (distinct within a millisecond), and 8 random base36 characters
//! (~41 bits, covering the case where two processes start in the same
//! millisecond).
//!
//! # Why this lives in `core` rather than `api`
//!
//! It was in `avoir-api` until the ledger gate needed it. `ledger_create` has
//! to mint a `TransactionDescription` row when a transaction names something
//! new, and that gate lives in `avoir-db`, which cannot depend on `avoir-api`.
//! The alternative was to have every route resolve the description and pass an
//! id in — which is precisely what the gate exists to make impossible to
//! forget. `api::id` re-exports this, so every existing call site is unchanged.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const BLOCK: u32 = 4;
const BASE: u64 = 36;

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn to_base36(mut n: u64, pad: usize) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".repeat(pad);
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % BASE) as usize]);
        n /= BASE;
    }
    out.reverse();
    let s = String::from_utf8(out).expect("base36 digits are ascii");
    if s.len() >= pad {
        s
    } else {
        format!("{}{}", "0".repeat(pad - s.len()), s)
    }
}

/// The last `pad` base36 characters, so an oversized component cannot push
/// the id past its expected width.
fn tail(n: u64, pad: usize) -> String {
    let s = to_base36(n, pad);
    if s.len() > pad {
        s[s.len() - pad..].to_string()
    } else {
        s
    }
}

/// A fingerprint for this process, mixing pid with a per-run random value.
///
/// Pid alone is not enough: the OS reuses pids, and two runs of a desktop app
/// on the same machine are exactly the case where that reuse shows up.
fn fingerprint() -> &'static str {
    use std::sync::OnceLock;
    static FP: OnceLock<String> = OnceLock::new();
    FP.get_or_init(|| {
        let pid = std::process::id() as u64;
        let noise: u64 = rand::random::<u32>() as u64;
        format!("{}{}", tail(pid, 2), tail(noise, 2))
    })
}

/// A new cuid-shaped primary key.
pub fn cuid() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed) % BASE.pow(BLOCK);
    let random = rand::random::<u64>() % BASE.pow(BLOCK * 2);
    format!(
        "c{}{}{}{}",
        to_base36(ms, 8),
        tail(count, BLOCK as usize),
        fingerprint(),
        tail(random, (BLOCK * 2) as usize),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ids_look_like_the_imported_ones() {
        let id = cuid();
        assert_eq!(id.len(), 25, "c + 24 base36 characters");
        assert!(id.starts_with('c'));
        assert!(
            id[1..]
                .chars()
                .all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()),
            "base36 only: {id}"
        );
    }

    #[test]
    fn timestamps_sort_lexicographically() {
        // Fixed-width base36 is what makes string ordering agree with time
        // ordering. Without the zero padding, "9" would sort after "10".
        let a = to_base36(9, 8);
        let b = to_base36(10, 8);
        assert!(a < b, "{a} should sort before {b}");
    }

    #[test]
    fn does_not_repeat_itself_within_a_millisecond() {
        // The timestamp component is identical across a tight loop, so this is
        // really a test of the counter and the random block. If both were
        // dropped the whole batch would collapse to one value.
        let ids: HashSet<String> = (0..10_000).map(|_| cuid()).collect();
        assert_eq!(ids.len(), 10_000, "generated a duplicate id");
    }
}
