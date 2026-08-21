//! Money as integer cents (ADR-033).
//!
//! The whole point of this type is that the arithmetic QUALITY.md currently
//! polices by hand becomes impossible to get wrong: `Cents + Cents` is exact
//! integer addition, so there is nothing to round and no discipline to forget.
//! The 769 unrounded values sitting in production exist because that discipline
//! had 72 call sites and no enforcement.
//!
//! Division is the one operation that can still lose a cent, so it is the only
//! one that takes an explicit rounding decision — see `split_evenly`.

use std::fmt;
use std::iter::Sum;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

/// A monetary amount in integer cents. Signed: a ledger has negatives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Hash)]
pub struct Cents(pub i64);

impl Cents {
    pub const ZERO: Cents = Cents(0);

    pub const fn from_cents(c: i64) -> Self {
        Cents(c)
    }

    /// Exact only for values that are whole cents. Intended for parsing a
    /// decimal string that has already been validated, and for tests.
    pub fn from_dollars_f64(d: f64) -> Self {
        Cents(js_round(d * 100.0) as i64)
    }

    pub fn as_dollars_f64(self) -> f64 {
        self.0 as f64 / 100.0
    }

    pub fn is_negative(self) -> bool {
        self.0 < 0
    }

    pub fn abs(self) -> Cents {
        Cents(self.0.abs())
    }

    /// Split into `n` parts that sum EXACTLY back to the original.
    ///
    /// The remainder is distributed one cent at a time across the leading
    /// parts rather than dropped, so `sum(split_evenly(x, n)) == x` always.
    /// This is the shape ADR-030's payment legs need: legs must sum to their
    /// parent, so one leg absorbs the residual.
    pub fn split_evenly(self, n: u32) -> Vec<Cents> {
        assert!(n > 0, "cannot split into zero parts");
        let n = n as i64;
        let base = self.0 / n;
        let mut rem = self.0 % n;
        let step = if self.0 < 0 { -1 } else { 1 };
        (0..n)
            .map(|_| {
                let extra = if rem != 0 {
                    rem -= step;
                    step
                } else {
                    0
                };
                Cents(base + extra)
            })
            .collect()
    }
}

impl Add for Cents {
    type Output = Cents;
    fn add(self, o: Cents) -> Cents {
        Cents(self.0 + o.0)
    }
}
impl Sub for Cents {
    type Output = Cents;
    fn sub(self, o: Cents) -> Cents {
        Cents(self.0 - o.0)
    }
}
impl Neg for Cents {
    type Output = Cents;
    fn neg(self) -> Cents {
        Cents(-self.0)
    }
}
impl AddAssign for Cents {
    fn add_assign(&mut self, o: Cents) {
        self.0 += o.0;
    }
}
impl SubAssign for Cents {
    fn sub_assign(&mut self, o: Cents) {
        self.0 -= o.0;
    }
}
impl Sum for Cents {
    fn sum<I: Iterator<Item = Cents>>(it: I) -> Cents {
        Cents(it.map(|c| c.0).sum())
    }
}

impl fmt::Display for Cents {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let neg = self.0 < 0;
        let a = self.0.abs();
        write!(
            f,
            "{}{}.{:02}",
            if neg { "-" } else { "" },
            a / 100,
            a % 100
        )
    }
}

/// A rate in percent, stored as hundredths of a percent (scale 2).
///
/// `5.25%` is `Percent(525)`. Same scale-2 integer convention as money, chosen
/// so ordering and comparison work in SQL — a percentage stored as TEXT sorts
/// lexicographically, which would silently mis-order any "sort by APR".
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
pub struct Percent(pub i64);

impl Percent {
    pub const ZERO: Percent = Percent(0);

    /// The percent value itself, e.g. `Percent(525)` → `5.25`.
    pub fn as_percent_f64(self) -> f64 {
        self.0 as f64 / 100.0
    }

    /// As a plain fraction, e.g. `Percent(525)` → `0.0525`.
    pub fn as_fraction_f64(self) -> f64 {
        self.0 as f64 / 10_000.0
    }

    pub fn from_percent_f64(p: f64) -> Self {
        Percent(js_round(p * 100.0) as i64)
    }
}

/// Rounds exactly as JavaScript's `Math.round` does: halves go toward +∞.
///
/// Rust's `f64::round` breaks halves away from zero instead, so the two
/// disagree on negative midpoints (`-0.5` → `0` in JS, `-1` in Rust). This
/// matters only because the port must be provably equivalent to the TypeScript
/// it replaces — the differential tests compare both implementations on the
/// same inputs, and a rounding difference would show up there as a real defect
/// rather than the deliberate convention it is.
///
/// **Measured, so the claim is not overstated:** swapping this for Rust's
/// `round()` does NOT fail the differential fixture. Every vector in it is
/// positive, and the two conventions agree everywhere except negative
/// midpoints. So this is defensive rather than currently load-bearing — the
/// fixture does not prove it either way, and a negative-balance case (a credit
/// balance, a refund larger than the charge) would be needed to exercise it.
///
/// Once the TypeScript is gone this can become plain `round()` if a symmetric
/// rule is preferred, but that is a behaviour change and needs saying out loud.
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}
