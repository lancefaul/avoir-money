//! The IPC surface — what used to be 181 Hono route handlers.
//!
//! # Why one dispatcher instead of 181 `#[tauri::command]`s
//!
//! The React frontend funnels every call through one function:
//!
//! ```ignore
//! request(path, schema, { method, body })   // apps/web/src/lib/api/request.ts
//! ```
//!
//! Those three arguments are exactly a dispatcher's arguments, so routing on
//! `(method, path)` here lets all ~30 frontend domain modules and all 50 Zod
//! schemas stay byte-identical. That is not just less typing — it is the
//! port's main safety property. `request()` parses every response with the
//! same Zod schema it used against Hono, so **any shape divergence between
//! the TypeScript backend and this one throws `ApiValidationError` in the
//! browser**. The existing schemas become a conformance test the port
//! inherits for free, and it only works while the response shapes match
//! exactly. Named per-operation commands would have thrown that away and
//! required rebuilding an equivalent check deliberately.
//!
//! The cost, accepted knowingly: no typed Tauri commands and no `specta`
//! type generation, and path parsing lives in Rust. Splitting this into
//! named commands later is mechanical — a routing table is already a list of
//! operations — so the ergonomic choice stays open while the risky part
//! (behaviour) is the only thing in flight.
//!
//! # Why this is a plain library and not part of the Tauri crate
//!
//! Nothing here mentions Tauri. The desktop shell is a five-line wire from
//! `#[tauri::command] api_request` into [`dispatch`], which means the entire
//! backend is testable with `cargo test` and no webview, no window, and no
//! display server — including in CI.
//!
//! # What the middleware stack becomes
//!
//! `app.ts` wraps every route in `secureHeaders`, `cors`, `rateLimitMiddleware`
//! and `authMiddleware`. All four exist to defend a listening TCP socket from
//! other origins. IPC has no socket and no origin: the only caller is the
//! bundled webview in the same process. The static bearer token in particular
//! protected nothing once it shipped inside the client bundle it authenticated.
//! They are deliberately not ported. What *is* ported is `defaultHook` and
//! `onError` — the error *shape* is part of the contract the frontend parses.

pub mod accounts;
pub mod anticipations;
pub mod backups;
pub mod budgets;
pub mod category_budget_status;
pub mod category_budgets;
pub mod connected_services;
pub mod dashboard;
pub mod dashboard_period;
pub mod dashboard_predict;
pub mod data_management;
pub mod debts;
pub mod descriptions;
pub mod healthcare;
pub mod id;
pub mod investments;
pub mod investments_history;
pub mod pay;
pub mod preferences;
pub mod prices;
pub mod purchases;
pub mod reconciliations;
pub mod reconciliations_close;
pub mod reconciliations_merge;
pub mod recurring;
pub mod scheduled;
pub mod sign_conventions;
pub mod transactions;
pub mod transactions_children;
pub mod utilities;
pub mod year_plans;

use recurring::Kind::{Expense, Income};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;

/// A successful response, carrying the status the frontend still keys on.
///
/// The status is not decoration: `request()` returns `undefined` on 204 and
/// distinguishes it from a `null` body, and callers of `create` rely on 201.
#[derive(Debug, Clone)]
pub struct Response {
    pub status: u16,
    pub body: Value,
}

/// Serialize a response body.
///
/// `Serialize` rather than `Value` so a handler can hand over a typed struct —
/// see the `Shape` types in each route module. `Value` itself implements
/// `Serialize`, so the `json!` call sites that remain are unaffected.
///
/// The failure branch is unreachable for the types used here. `to_value` can
/// only fail when a `Serialize` impl returns an error, which derived impls over
/// strings, integers, bools, `Option` and `Vec` never do — and a non-finite
/// float, the one case that looks dangerous, serializes to `null` rather than
/// erroring, which is exactly what `json!` already did with the same value.
pub(crate) fn to_body(body: impl Serialize) -> Value {
    serde_json::to_value(body).expect("a plain data struct cannot fail to serialize")
}

impl Response {
    pub fn ok(body: impl Serialize) -> Self {
        Response {
            status: 200,
            body: to_body(body),
        }
    }
    pub fn created(body: impl Serialize) -> Self {
        Response {
            status: 201,
            body: to_body(body),
        }
    }
    /// 204 with no body — `request()` maps this to `undefined`.
    pub fn no_content() -> Self {
        Response {
            status: 204,
            body: Value::Null,
        }
    }
}

/// A failed response, in the shape `request()` already knows how to read:
/// `{ error, details? }` plus the status.
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub error: String,
    pub details: Option<Value>,
}

impl ApiError {
    pub fn new(status: u16, error: impl Into<String>) -> Self {
        ApiError {
            status,
            error: error.into(),
            details: None,
        }
    }
    pub fn not_found(what: &str) -> Self {
        ApiError::new(404, format!("{what} not found"))
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        ApiError::new(400, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        ApiError::new(409, msg)
    }

    /// A rule about ONE field, reported the way the frontend can act on it.
    ///
    /// `bad_request` puts the whole explanation in `error` and leaves `details`
    /// absent, which reads fine in a terminal and is useless in a form: the web
    /// client renders `details[].field` to mark the offending input, so a
    /// top-level string means the user is told something is wrong and not
    /// where. Every such rule in the reference answers `Validation failed` plus
    /// one detail, which is also the shape `body_of` already produces for a
    /// deserialization failure — so this is the existing contract, not a new
    /// one, and the divergence was simply nobody having a helper for it.
    ///
    /// Found on 2026-08-12 by the differential harness, which had never probed
    /// a business-rule rejection on this endpoint.
    pub fn invalid_field(field: &str, message: impl Into<String>) -> Self {
        ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{ "field": field, "message": message.into() }])),
        }
    }

    /// The error body, which is `{ error, details? }` and nothing else.
    ///
    /// It used to carry `status` as well. That was correct under Tauri — the
    /// doc comment here read "the body the frontend parses out of a rejected
    /// `invoke`", and an IPC rejection has no status line to carry it. Since
    /// ADR-036 the transport is HTTP, the status IS the status line, and
    /// `request.ts` reads `res.status`; nothing has ever read it from the body.
    /// So it was a field the reference does not return, invented by a transport
    /// that no longer exists — found by the write harness, which sees error
    /// shapes the read harness never exercises.
    pub fn to_json(&self) -> Value {
        match &self.details {
            Some(d) => json!({ "error": self.error, "details": d }),
            None => json!({ "error": self.error }),
        }
    }
}

/// Deserialize a request body, naming the FIELD that failed.
///
/// This replaced twenty-two identical `body_of` helpers, one per route module,
/// every one of which reported `field: "body"` for any deserialization error.
/// The reference's errors are Zod's, so each names the field it belongs to and
/// the frontend renders the message against that input — `{"balance": "100"}`
/// puts "Expected number" under the balance box. Reporting `body` for all of
/// them pointed every validation failure at the form as a whole.
///
/// `serde_json::Error` cannot supply the name: it carries a line and column,
/// which describe a text buffer the caller assembled in memory and never saw.
/// `serde_path_to_error` threads the path through the deserializer instead.
///
/// The MESSAGE stays serde's. It reads differently from Zod's — "invalid type:
/// string, expected f64" against "Expected number, received string" — and
/// matching the wording would mean maintaining a translation table for every
/// type in the API, which would then be the thing that drifts. The field name is
/// what the interface positions by, and it is now right.
///
/// **Known and accepted divergence:** serde stops at the first bad field where
/// Zod reports every one, so a body with two faults yields one detail here and
/// two there. Collecting them all would mean deserializing field-by-field
/// against a schema the struct definition already expresses. The first fault is
/// reported accurately, which is what the form needs to highlight something
/// real; the harness's `EXPECTED` list records this so it cannot be mistaken
/// for an unexamined difference later.
/// Refuse a body that OMITS a field, before serde turns the omission into zero.
///
/// Most request structs carry `#[serde(default)]`, which is right for the
/// optional fields and silently wrong for the required ones: a missing `amount`
/// deserializes to `0.0` and gets stored. A survey on 2026-08-12 found 21 such
/// fields across 12 files, after two had been caught individually — a utility
/// reading with no cost, and a reconciliation with no statement balance, in
/// different domains days apart.
///
/// Checked on the raw JSON rather than by making each field an `Option`,
/// because the alternative means renaming every use site in a handler and the
/// same field name usually appears in that domain's UPDATE struct too, where an
/// omission legitimately means "leave it alone". Presence is the question, and
/// the raw body is where presence still exists.
///
/// Which fields are required is not a judgement made here: each one below was
/// probed against the reference in `rejections.mjs`, and only the ones it
/// refuses are listed. `originalBalance`, `minimumPayment` and `apr` were
/// probed the same way and accepted by both, so their zeros are real defaults.
pub fn require_present(body: &Option<Value>, fields: &[&str]) -> Result<(), ApiError> {
    let obj = body.as_ref().and_then(|v| v.as_object());
    for f in fields {
        let missing = match obj {
            Some(map) => !map.contains_key(*f) || map.get(*f).is_some_and(Value::is_null),
            None => true,
        };
        if missing {
            return Err(ApiError::invalid_field(f, "Required"));
        }
    }
    Ok(())
}

pub fn body_of<T: serde::de::DeserializeOwned>(body: Option<Value>) -> Result<T, ApiError> {
    let raw = body.unwrap_or(Value::Null);
    let text = raw.to_string();
    let de = &mut serde_json::Deserializer::from_str(&text);
    serde_path_to_error::deserialize(de).map_err(|e| {
        let path = e.path().to_string();
        let message = e.into_inner().to_string();
        ApiError {
            status: 400,
            error: "Validation failed".into(),
            details: Some(json!([{
                "field": field_name(&path, &message),
                "message": trim_position(&message),
            }])),
        }
    })
}

/// The field a deserialization error belongs to.
///
/// `serde_path_to_error` gives an empty path for a **missing** field, because
/// the error belongs to the struct rather than to any value inside it — nothing
/// was visited, so there is no path to record. That is most of the required-field
/// failures in the API, and it was landing every one of them on "body".
///
/// The name is in the message (`missing field \`name\``), so it is taken from
/// there. Parsing an error string is ordinarily a bad idea; it is acceptable
/// here because the format is serde's own `Display` for one specific variant,
/// and because the fallback when it does not match is the honest "body" rather
/// than a guess.
fn field_name(path: &str, message: &str) -> String {
    if !path.is_empty() && path != "." {
        return path.to_string();
    }
    message
        .strip_prefix("missing field `")
        .and_then(|rest| rest.split('`').next())
        .map(str::to_string)
        .unwrap_or_else(|| "body".to_string())
}

/// Drop serde's ` at line N column M` suffix.
///
/// The position is real and refers to a buffer this function created by
/// re-serializing a `Value` that arrived already parsed. It describes text the
/// caller never sent and could not act on, so showing it in a form field is
/// worse than saying nothing — it invites someone to go looking for line 1
/// column 31 of a request they wrote as an object.
fn trim_position(message: &str) -> String {
    match message.find(" at line ") {
        Some(i) => message[..i].to_string(),
        None => message.to_string(),
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status, self.error)
    }
}

impl std::error::Error for ApiError {}

/// Anything unexpected becomes a generic 500.
///
/// This mirrors `app.onError`, which returns a flat "Internal server error"
/// rather than the thrown message. The reason survives the move to IPC only
/// partly — there is no remote attacker to leak a stack trace to — but the
/// frontend's error toast is user-facing, and a raw sqlx error in it is noise
/// to the person reading it. The detail goes to the log instead.
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        eprintln!("[api] unhandled: {e:#}");
        ApiError::new(500, "Internal server error")
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("[api] sqlx: {e:#}");
        ApiError::new(500, "Internal server error")
    }
}

/// Undo `URLSearchParams.toString()`, which is what builds every query the
/// frontend sends.
///
/// It percent-encodes and writes a space as `+`, so a value is decoded before
/// any handler sees it — otherwise a search for "coffee shop" arrives as
/// `coffee+shop` and matches nothing, and a base64 cursor arrives with its
/// `+` and `=` mangled.
///
/// Bytes are collected and converted at the end rather than pushed as `char`s,
/// because a percent sequence encodes a UTF-8 *byte*: `%C3%A9` is one `é`, and
/// casting each byte to `char` would produce two wrong ones.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 3 <= b.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(c) => {
                    out.push(c);
                    i += 3;
                }
                // Not a valid escape — a literal '%' in an unencoded value.
                Err(_) => {
                    out.push(b'%');
                    i += 1;
                }
            },
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A parsed request path: `/accounts/abc/archive?x=1` → segments + query.
pub struct Path<'a> {
    pub segments: Vec<&'a str>,
    query: Vec<(&'a str, String)>,
}

impl<'a> Path<'a> {
    pub fn parse(path: &'a str) -> Self {
        let (raw, qs) = match path.split_once('?') {
            Some((p, q)) => (p, q),
            None => (path, ""),
        };
        let segments = raw.split('/').filter(|s| !s.is_empty()).collect();
        let query = qs
            .split('&')
            .filter(|s| !s.is_empty())
            .filter_map(|kv| kv.split_once('=').or(Some((kv, ""))))
            .map(|(k, v)| (k, percent_decode(v)))
            .collect();
        Path { segments, query }
    }

    /// The decoded value of a query parameter.
    pub fn query(&self, key: &str) -> Option<&str> {
        self.query
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.as_str())
    }

    /// A query parameter parsed as a bool, accepting only the two spellings
    /// the frontend actually sends (`z.enum(['true','false'])` on the Hono
    /// side). Anything else is treated as absent, exactly as the enum
    /// validation did by rejecting it into the `undefined` branch.
    pub fn query_bool(&self, key: &str) -> Option<bool> {
        match self.query(key) {
            Some("true") => Some(true),
            Some("false") => Some(false),
            _ => None,
        }
    }
}

/// Route a request to its handler.
///
/// The `match` is the routing table `app.route(...)` used to build. An
/// unmatched pair is a 404, which is what Hono did with no route registered.
pub async fn dispatch(
    pool: &SqlitePool,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    let p = Path::parse(path);
    let seg: Vec<&str> = p.segments.clone();

    match (method, seg.as_slice()) {
        ("GET", ["accounts"]) => accounts::list(pool, &p).await,
        ("POST", ["accounts"]) => accounts::create(pool, body).await,
        ("GET", ["accounts", id]) => accounts::get(pool, id).await,
        ("PUT", ["accounts", id]) => accounts::update(pool, id, body).await,
        ("DELETE", ["accounts", id]) => accounts::delete(pool, id).await,
        ("GET", ["accounts", id, "transaction-count"]) => {
            accounts::transaction_count(pool, id).await
        }
        ("POST", ["accounts", id, "archive"]) => accounts::set_archived(pool, id, true).await,
        ("POST", ["accounts", id, "unarchive"]) => accounts::set_archived(pool, id, false).await,
        ("POST", ["accounts", id, "recalculate-balance"]) => {
            accounts::recalculate_balance(pool, id).await
        }
        ("POST", ["accounts", id, "rebuild-balance-chain"]) => {
            accounts::rebuild_balance_chain(pool, id).await
        }
        ("POST", ["accounts", id, "rewards-account"]) => {
            accounts::create_rewards_account(pool, id, body).await
        }

        // Expenses and income are one shape with one lifecycle, so they share
        // handlers and differ only by which table `Kind` names.
        ("GET", ["expenses"]) => recurring::list(pool, Expense, &p).await,
        ("POST", ["expenses"]) => recurring::create(pool, Expense, body).await,
        ("GET", ["expenses", id]) => recurring::get(pool, Expense, id).await,
        ("PUT", ["expenses", id]) => recurring::update(pool, Expense, id, body).await,
        ("DELETE", ["expenses", id]) => recurring::delete(pool, Expense, id).await,
        ("POST", ["expenses", id, "pause"]) => recurring::pause(pool, Expense, id, body).await,
        ("POST", ["expenses", id, "resume"]) => recurring::resume(pool, Expense, id, body).await,
        ("POST", ["expenses", id, "archive"]) => recurring::archive(pool, Expense, id).await,
        ("POST", ["expenses", id, "restore"]) => recurring::restore(pool, Expense, id).await,

        ("GET", ["income"]) => recurring::list(pool, Income, &p).await,
        ("POST", ["income"]) => recurring::create(pool, Income, body).await,
        ("GET", ["income", id]) => recurring::get(pool, Income, id).await,
        ("PUT", ["income", id]) => recurring::update(pool, Income, id, body).await,
        ("DELETE", ["income", id]) => recurring::delete(pool, Income, id).await,
        ("POST", ["income", id, "pause"]) => recurring::pause(pool, Income, id, body).await,
        ("POST", ["income", id, "resume"]) => recurring::resume(pool, Income, id, body).await,
        ("POST", ["income", id, "archive"]) => recurring::archive(pool, Income, id).await,
        ("POST", ["income", id, "restore"]) => recurring::restore(pool, Income, id).await,

        ("GET", ["scheduled-transactions"]) => scheduled::list(pool, &p).await,
        ("POST", ["scheduled-transactions", id, "pay"]) => scheduled::pay(pool, id, body).await,
        ("POST", ["scheduled-transactions", id, "snooze"]) => {
            scheduled::snooze(pool, id, body).await
        }
        ("POST", ["scheduled-transactions", id, "skip"]) => scheduled::skip(pool, id).await,

        ("GET", ["utilities", "providers"]) => utilities::list_providers(pool).await,
        ("POST", ["utilities", "providers"]) => utilities::create_provider(pool, body).await,
        ("PUT", ["utilities", "providers", id]) => utilities::update_provider(pool, id, body).await,
        ("DELETE", ["utilities", "providers", id]) => utilities::delete_provider(pool, id).await,
        ("GET", ["utilities", "providers", pid, "services"]) => {
            utilities::list_services(pool, pid).await
        }
        ("POST", ["utilities", "providers", pid, "services"]) => {
            utilities::create_service(pool, pid, body).await
        }
        ("PUT", ["utilities", "services", id]) => utilities::update_service(pool, id, body).await,
        ("DELETE", ["utilities", "services", id]) => utilities::delete_service(pool, id).await,
        ("PUT", ["utilities", "services", id, "link"]) => {
            utilities::link_service(pool, id, body).await
        }
        ("DELETE", ["utilities", "services", id, "link"]) => {
            utilities::unlink_service(pool, id).await
        }
        ("GET", ["utilities", "readings"]) => utilities::list_readings(pool, &p).await,
        ("POST", ["utilities", "readings"]) => utilities::create_reading(pool, body).await,
        ("PUT", ["utilities", "readings", id]) => utilities::update_reading(pool, id, body).await,
        ("DELETE", ["utilities", "readings", id]) => utilities::delete_reading(pool, id).await,

        ("GET", ["budgets", "groups"]) => budgets::list_groups(pool).await,
        ("POST", ["budgets", "groups"]) => budgets::create_group(pool, body).await,
        ("PUT", ["budgets", "groups", id]) => budgets::update_group(pool, id, body).await,
        ("DELETE", ["budgets", "groups", id]) => budgets::delete_group(pool, id).await,
        ("GET", ["budgets"]) => budgets::list_budgets(pool, &p).await,
        ("POST", ["budgets"]) => budgets::create_budget(pool, body).await,
        ("PUT", ["budgets", id]) => budgets::update_budget(pool, id, body).await,
        ("DELETE", ["budgets", id]) => budgets::delete_budget(pool, id, &p).await,
        ("POST", ["budgets", id, "reassign"]) => budgets::reassign_budget(pool, id, body).await,

        ("GET", ["category-budgets"]) => category_budgets::list(pool, &p).await,
        ("POST", ["category-budgets"]) => category_budgets::create(pool, body).await,
        ("GET", ["category-budgets", id]) => category_budgets::get(pool, id, &p).await,
        ("PUT", ["category-budgets", id]) => category_budgets::update(pool, id, body).await,
        ("DELETE", ["category-budgets", id]) => category_budgets::remove(pool, id).await,
        ("POST", ["category-budgets", id, "restore"]) => category_budgets::restore(pool, id).await,
        ("GET", ["category-budgets", id, "history"]) => category_budgets::history(pool, id).await,
        ("GET", ["category-budgets", id, "links"]) => category_budgets::list_links(pool, id).await,
        ("POST", ["category-budgets", id, "links"]) => {
            category_budgets::create_link(pool, id, body).await
        }
        ("POST", ["category-budgets", id, "links", "bulk"]) => {
            category_budgets::create_links_bulk(pool, id, body).await
        }
        ("DELETE", ["category-budgets", id, "links", link_id]) => {
            category_budgets::delete_link(pool, id, link_id).await
        }

        ("GET", ["debts", "summary"]) => debts::summary(pool).await,
        ("GET", ["debts"]) => debts::list(pool, &p).await,
        ("POST", ["debts"]) => debts::create(pool, body).await,
        ("GET", ["debts", id]) => debts::get(pool, id).await,
        ("PUT", ["debts", id]) => debts::update(pool, id, body).await,
        ("DELETE", ["debts", id]) => debts::delete(pool, id).await,
        ("GET", ["debts", id, "amortization"]) => debts::amortization(pool, id, &p).await,
        ("POST", ["debts", id, "extra-payment"]) => debts::extra_payment(pool, id, body).await,
        ("GET", ["debts", id, "escrow"]) => debts::list_escrow(pool, id).await,
        ("POST", ["debts", id, "escrow"]) => debts::create_escrow(pool, id, body).await,
        ("PUT", ["debts", id, "escrow", eid]) => debts::update_escrow(pool, id, eid, body).await,
        ("DELETE", ["debts", id, "escrow", eid]) => debts::delete_escrow(pool, id, eid).await,

        // Static segments before `{id}`: `/investments/prices` and
        // `/investments/custodians` are not holdings, and a match arm is
        // ordered, so the specific ones have to come first. Hono resolved this
        // by registration order for the same reason.
        ("GET", ["investments", "custodians"]) => investments::list_custodians(pool).await,
        ("POST", ["investments", "custodians"]) => investments::create_custodian(pool, body).await,
        ("PUT", ["investments", "custodians", id]) => {
            investments::update_custodian(pool, id, body).await
        }
        ("DELETE", ["investments", "custodians", id]) => {
            investments::delete_custodian(pool, id).await
        }
        ("GET", ["investments", "wallets"]) => investments::list_wallets(pool).await,
        ("POST", ["investments", "wallets"]) => investments::create_wallet(pool, body).await,
        ("PUT", ["investments", "wallets", id]) => investments::update_wallet(pool, id, body).await,
        ("DELETE", ["investments", "wallets", id]) => investments::delete_wallet(pool, id).await,
        ("GET", ["investments", "prices"]) => investments_history::prices(pool).await,
        ("POST", ["investments", "snapshots", "regenerate"]) => {
            investments_history::regenerate_snapshots(pool).await
        }
        ("GET", ["investments", "history"]) => investments_history::history(pool, &p).await,
        ("GET", ["investments", "portfolio-history"]) => {
            investments_history::portfolio_history(pool, &p).await
        }
        ("POST", ["investments", "transfers", "bitcoin"]) => {
            investments_history::bitcoin_transfer(pool, body).await
        }
        ("POST", ["investments", "transfers", "stock"]) => {
            investments_history::stock_transfer(pool, body).await
        }
        ("DELETE", ["investments", "transfers", id]) => {
            investments_history::delete_transfer(pool, id).await
        }
        ("GET", ["investments"]) => investments::list(pool).await,
        ("POST", ["investments"]) => investments::create(pool, body).await,
        ("PUT", ["investments", id]) => investments::update(pool, id, body).await,
        ("DELETE", ["investments", id]) => investments::delete(pool, id).await,
        ("POST", ["investments", id, "snapshot"]) => {
            investments::create_snapshot(pool, id, body).await
        }

        ("GET", ["healthcare", "years"]) => healthcare::list_years(pool).await,
        ("GET", ["healthcare", "policies"]) => healthcare::list_policies(pool, &p).await,
        ("POST", ["healthcare", "policies"]) => healthcare::create_policy(pool, body).await,
        ("GET", ["healthcare", "policies", id]) => healthcare::get_policy(pool, id).await,
        ("PUT", ["healthcare", "policies", id]) => healthcare::update_policy(pool, id, body).await,
        ("PATCH", ["healthcare", "policies", id, "overrides"]) => {
            healthcare::update_overrides(pool, id, body).await
        }
        ("GET", ["healthcare", "policies", id, "transactions"]) => {
            healthcare::list_transactions(pool, id).await
        }
        ("POST", ["healthcare", "policies", id, "end-coverage"]) => {
            healthcare::advance_status(pool, id, "ENDED").await
        }
        ("POST", ["healthcare", "policies", id, "close"]) => {
            healthcare::advance_status(pool, id, "CLOSED").await
        }
        ("GET", ["healthcare", "summary"]) => healthcare::summary(pool, &p).await,

        ("GET", ["pay-schedules"]) => pay::list_schedules(pool).await,
        ("POST", ["pay-schedules"]) => pay::create_schedule(pool, body).await,
        ("GET", ["pay-schedules", id]) => pay::get_schedule(pool, id).await,
        ("PUT", ["pay-schedules", id]) => pay::update_schedule(pool, id, body).await,
        ("DELETE", ["pay-schedules", id]) => pay::delete_schedule(pool, id).await,
        ("POST", ["pay-schedules", id, "generate"]) => pay::generate_periods(pool, id, body).await,

        ("GET", ["pay-periods", "current"]) => pay::current_period(pool, &p).await,
        ("GET", ["pay-periods"]) => pay::list_periods(pool, &p).await,
        ("GET", ["pay-periods", id]) => pay::get_period(pool, id).await,

        ("GET", ["goals"]) => pay::list_goals(pool).await,
        ("POST", ["goals"]) => pay::create_goal(pool, body).await,
        ("PUT", ["goals", id]) => pay::update_goal(pool, id, body).await,
        ("DELETE", ["goals", id]) => pay::delete_goal(pool, id).await,
        ("GET", ["dashboard", "current-period"]) => {
            dashboard_period::current_period(pool, &p).await
        }
        ("GET", ["dashboard", "ytd"]) => dashboard::ytd(pool, &p).await,
        ("GET", ["dashboard", "trends"]) => dashboard::trends(pool, &p).await,
        ("GET", ["dashboard", "category-breakdown"]) => {
            dashboard::category_breakdown(pool, &p).await
        }
        ("GET", ["dashboard", "goal-progress"]) => pay::goal_progress(pool).await,
        ("GET", ["dashboard", "income-trend"]) => dashboard_predict::income_trend(pool, &p).await,
        ("GET", ["dashboard", "spend-prediction"]) => {
            dashboard_predict::spend_prediction(pool, &p).await
        }

        ("GET", ["preferences"]) => preferences::get_all(pool).await,
        ("PUT", ["preferences"]) => preferences::put(pool, body).await,
        ("DELETE", ["preferences", key]) => preferences::delete(pool, key).await,
        ("GET", ["sign-conventions"]) => sign_conventions::get(pool).await,
        ("PUT", ["sign-conventions"]) => sign_conventions::put(pool, body).await,
        ("GET", ["backups", "config"]) => backups::get_config(pool).await,
        ("PUT", ["backups", "config"]) => backups::update_config(pool, body).await,
        ("POST", ["backups", "run"]) => backups::run(pool).await,
        ("GET", ["backups"]) => backups::list(pool).await,
        // Before the `{id}/restore` arm: "upload" is a literal segment, and a
        // pattern that binds `id` first would swallow it.
        ("POST", ["backups", "upload", upload_id, "restore"]) => {
            backups::restore_upload(pool, upload_id, body).await
        }
        ("POST", ["backups", id, "restore"]) => backups::restore(pool, id, body).await,
        ("DELETE", ["backups", id]) => backups::delete(pool, id).await,

        ("GET", ["descriptions"]) => descriptions::list(pool, &p).await,
        ("POST", ["descriptions"]) => descriptions::create(pool, body).await,
        ("POST", ["descriptions", "merge"]) => descriptions::merge(pool, body).await,
        ("PUT", ["descriptions", id]) => descriptions::rename(pool, id, body).await,
        ("POST", ["descriptions", id, "merge"]) => descriptions::merge_into(pool, id, body).await,
        ("DELETE", ["descriptions", id]) => descriptions::delete(pool, id).await,

        ("GET", ["year-plans"]) => year_plans::list(pool).await,
        ("POST", ["year-plans"]) => year_plans::create(pool, body).await,
        ("GET", ["year-plans", id]) => year_plans::get(pool, id).await,
        ("POST", ["year-plans", id, "confirm"]) => year_plans::confirm(pool, id).await,
        ("POST", ["year-plans", id, "carry-forward"]) => {
            year_plans::carry_forward(pool, id, body).await
        }

        ("POST", ["purchases"]) => purchases::create(pool, body).await,
        ("DELETE", ["purchases", gid]) => purchases::delete(pool, gid).await,
        ("PUT", ["purchases", gid, "payments"]) => {
            purchases::update_payments(pool, gid, body).await
        }

        // Reconciliation. `/{id}/matches` and `/{id}/match` are distinct routes
        // that differ by one character, so the more specific patterns are listed
        // first and the compiler's exhaustiveness check keeps them apart.
        ("POST", ["reconciliations"]) => reconciliations::create(pool, body).await,
        ("GET", ["reconciliations"]) => reconciliations::list(pool, &p).await,
        ("PATCH", ["reconciliations", id]) => reconciliations::update(pool, id, body).await,
        ("GET", ["reconciliations", id]) => reconciliations::detail(pool, id).await,
        ("POST", ["reconciliations", id, "import"]) => {
            reconciliations::import(pool, id, body).await
        }
        ("POST", ["reconciliations", id, "match"]) => reconciliations::run_match(pool, id).await,
        ("POST", ["reconciliations", id, "matches"]) => {
            reconciliations::create_match(pool, id, body).await
        }
        ("DELETE", ["reconciliations", id, "matches", match_id]) => {
            reconciliations::delete_match(pool, id, match_id).await
        }
        ("POST", ["reconciliations", id, "abandon"]) => reconciliations::abandon(pool, id).await,
        ("POST", ["reconciliations", id, "adjustment"]) => {
            reconciliations_close::adjustment(pool, id, body).await
        }
        ("POST", ["reconciliations", id, "close"]) => reconciliations_close::close(pool, id).await,
        ("POST", ["reconciliations", id, "merge"]) => {
            reconciliations_merge::merge(pool, id, body).await
        }

        ("GET", ["data-management", "counts"]) => data_management::counts(pool).await,
        ("DELETE", ["data-management", "bulk"]) => data_management::bulk_delete(pool, body).await,

        ("GET", ["connected-services"]) => connected_services::list(pool).await,
        ("PUT", ["connected-services", provider]) => {
            connected_services::set(pool, provider, body).await
        }
        ("DELETE", ["connected-services", provider]) => {
            connected_services::clear(pool, provider).await
        }

        ("GET", ["transactions", id, "children"]) => transactions_children::list(pool, id).await,
        ("POST", ["transactions", id, "children"]) => {
            transactions_children::create(pool, id, body).await
        }
        ("PUT", ["transactions", id, "children", cid]) => {
            transactions_children::update(pool, id, cid, body).await
        }
        ("DELETE", ["transactions", id, "children", cid]) => {
            transactions_children::delete(pool, id, cid).await
        }
        ("POST", ["transactions", id, "link"]) => transactions_children::link(pool, id, body).await,
        ("DELETE", ["transactions", id, "link"]) => transactions_children::unlink(pool, id).await,
        ("GET", ["transactions", "suggest-budget"]) => transactions::suggest_budget(pool, &p).await,
        ("DELETE", ["transactions", "imported"]) => transactions::delete_imported(pool, &p).await,
        ("GET", ["transactions"]) => transactions::list(pool, &p).await,
        ("POST", ["transactions"]) => transactions::create(pool, body).await,
        ("PUT", ["transactions", id]) => transactions::update(pool, id, body).await,
        ("DELETE", ["transactions", id]) => transactions::delete(pool, id).await,

        _ => Err(ApiError::new(404, format!("No route for {method} {path}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_segments_and_query() {
        let p = Path::parse("/accounts/abc123/archive?earnsInterest=true&x=");
        assert_eq!(p.segments, vec!["accounts", "abc123", "archive"]);
        assert_eq!(p.query_bool("earnsInterest"), Some(true));
        assert_eq!(p.query("x"), Some(""));
        assert_eq!(p.query("absent"), None);
    }

    #[test]
    fn a_bare_flag_is_not_true() {
        // `?earnsInterest` with no value is not `true`. The Hono side validated
        // this with z.enum(['true','false']), so only those two spellings ever
        // meant anything, and a bare key fell through to "no filter".
        let p = Path::parse("/accounts?earnsInterest");
        assert_eq!(p.query_bool("earnsInterest"), None);
    }

    #[test]
    fn query_values_arrive_decoded() {
        // `URLSearchParams.toString()` builds every query the frontend sends:
        // spaces become '+', everything else becomes %XX. A base64 cursor
        // carries '+', '/' and '=', so without this the pagination cursor is
        // unreadable and a text search matches nothing.
        let p = Path::parse("/x?search=coffee+shop&cursor=YWJj%2Bd%2F%3D%3D&plain=abc");
        assert_eq!(p.query("search"), Some("coffee shop"));
        assert_eq!(p.query("cursor"), Some("YWJj+d/=="));
        assert_eq!(p.query("plain"), Some("abc"));
    }

    #[test]
    fn a_percent_that_is_not_an_escape_stays_a_percent() {
        // A literal '%' in an unencoded value must not eat the two characters
        // after it, and a truncated escape at the end must not panic on a
        // slice past the string.
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("50%zz"), "50%zz");
        assert_eq!(percent_decode("a%4"), "a%4");
    }

    #[test]
    fn a_multi_byte_character_survives_its_escape() {
        // %C3%A9 is one 'é' in UTF-8. Pushing each byte as a `char` would
        // produce two wrong ones.
        assert_eq!(percent_decode("caf%C3%A9"), "café");
    }

    #[test]
    fn a_trailing_slash_does_not_invent_a_segment() {
        // request() builds paths like `/accounts` but the list endpoint was
        // registered at '/', so both spellings have to land on the same arm.
        assert_eq!(Path::parse("/accounts/").segments, vec!["accounts"]);
        assert_eq!(Path::parse("/accounts").segments, vec!["accounts"]);
    }
}
