//! `/sign-conventions` — what a positive or negative number means in a CSV.
//!
//! Ported from `routes/sign-conventions.ts`.
//!
//! # This route was missing entirely, and no harness could see it
//!
//! The frontend has had a `SignConventionForm` all along, reachable from
//! Transactions → Import/Export, and the port never implemented the endpoint it
//! calls. Opening that form against the packaged app got a 404.
//!
//! **Neither differential harness could find it**, and the reason is structural
//! rather than an oversight in the fixtures: both take their route list from the
//! Rust acceptance test's dump, which enumerates the routes the Rust HAS. A
//! route the port is missing entirely never enters the list, so it is never
//! compared against the reference. The harnesses answer "do the routes we have
//! agree?" and cannot answer "are any missing?" — that needs the frontend's own
//! call sites as the source of truth, which is how this was found.
//!
//! # Why the config is a file and not a table
//!
//! ADR-022 settled this: it is import configuration, not user data, and it is
//! read by a tool that may run without the database open. What that ADR is
//! mostly about, though, is testing — the file kept vanishing from the working
//! tree because two API tests pointed at the REAL path and deleted it in
//! `afterEach`. Hence `SIGN_CONVENTION_CONFIG_PATH`: tests point somewhere
//! disposable, and no run can clobber the shared config however it is
//! interrupted.
//!
//! # Where the file lives now
//!
//! It used to sit in `tools/import/`, which was the only thing that read it
//! before the API grew this route. That tool is gone — it read a workbook that
//! was not in the repo, had never been run in this tree, and produced output
//! nothing consumes any more. The config outlived it, so it moved to the data
//! directory beside the database, where a per-user setting belongs.

use crate::{ApiError, Response};
use avoir_core::sign_convention::SignConventionConfig;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::SqlitePool;
use std::path::PathBuf;

/// The `refund` rule, which exists on the WIRE and not in the domain type.
///
/// `SignConventionConfigSchema` requires it and the frontend parses every
/// response with that schema, so omitting it throws in the browser — the same
/// failure as the missing `lineTotal`. But it carries no information: its Zod
/// type is `z.literal('money_in')`, a single possible value that
/// `normalizeRefund` then ignores, which is why `avoir_core` deliberately does
/// not model it.
///
/// So it is reconstructed here rather than stored: one constant, on the boundary
/// that needs it, instead of a one-variant enum threaded through the domain.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefundRule {
    positive_meaning: &'static str,
}

impl Default for RefundRule {
    fn default() -> Self {
        RefundRule {
            positive_meaning: "money_in",
        }
    }
}

/// The config as the wire carries it: the four real rules plus `refund`.
#[derive(Serialize)]
struct ConfigShape {
    #[serde(flatten)]
    config: SignConventionConfig,
    refund: RefundRule,
}

impl From<SignConventionConfig> for ConfigShape {
    fn from(config: SignConventionConfig) -> Self {
        ConfigShape {
            config,
            refund: RefundRule::default(),
        }
    }
}

/// Where the config lives.
///
/// `SIGN_CONVENTION_CONFIG_PATH` wins when set — ADR-022's guardrail, so a test
/// can never write to the shared file no matter how it ends. Otherwise it sits
/// beside the database, which is what makes it travel with a user's data rather
/// than with the installation.
fn config_path(pool: &SqlitePool) -> PathBuf {
    if let Ok(p) = std::env::var("SIGN_CONVENTION_CONFIG_PATH") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    avoir_db::backup::Paths::from_pool(pool)
        .database
        .with_file_name("sign-conventions.json")
}

/// The stored config, or the defaults.
///
/// A missing file is not an error — it means "never configured", and the
/// defaults are what the importer has always assumed. An unreadable or invalid
/// file is also not an error: the reference logs and falls back, because a
/// corrupt preference file should not make the import screen unusable when a
/// perfectly good default exists.
fn load(pool: &SqlitePool) -> SignConventionConfig {
    let path = config_path(pool);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return SignConventionConfig::default();
    };
    match serde_json::from_str::<SignConventionConfig>(&raw) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[sign-conventions] invalid config at {path:?}, using defaults: {e}");
            SignConventionConfig::default()
        }
    }
}

pub async fn get(pool: &SqlitePool) -> Result<Response, ApiError> {
    Ok(Response::ok(ConfigShape::from(load(pool))))
}

pub async fn put(pool: &SqlitePool, body: Option<Value>) -> Result<Response, ApiError> {
    // Parsed into the real type before anything is written, so a malformed body
    // cannot replace a working config with rubbish.
    let config: SignConventionConfig = crate::body_of(body)?;

    let path = config_path(pool);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|_| ApiError::new(500, "Failed to write configuration file"))?;
    }
    let text = serde_json::to_string_pretty(&config)
        .map_err(|_| ApiError::new(500, "Failed to write configuration file"))?;
    std::fs::write(&path, text)
        .map_err(|_| ApiError::new(500, "Failed to write configuration file"))?;

    Ok(Response::ok(ConfigShape::from(config)))
}
