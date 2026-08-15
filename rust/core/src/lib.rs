//! Pure business logic ported from `packages/core`.
//!
//! No I/O, no database, no framework — which is why this is the first thing
//! ported: it establishes the pattern (and `proptest` replacing `fast-check`)
//! on code where a mistake cannot corrupt data.

pub mod aggregation;
pub mod backup_schedule;
pub mod budget;
pub mod cash_flow;
pub mod dates;
pub mod debt;
pub mod healthcare;
pub mod ids;
pub mod leftovers;
pub mod matcher;
pub mod money;
pub mod name_similarity;
pub mod occurrences;
pub mod pause;
pub mod prediction;
pub mod reconcile;
pub mod schedule_amount;
pub mod sign_convention;
pub mod statement;
pub mod tax;
pub mod transaction_rules;
pub mod trend;
pub mod utility;
