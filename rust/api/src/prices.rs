//! Live and historical market prices.
//!
//! Port of `apps/api/src/lib/prices.ts` plus the CoinGecko history fetch that
//! `lib/snapshot-generator.ts` performed inline.
//!
//! - **Bitcoin — CoinGecko.** Works with no key at all; a Demo key only raises
//!   the rate limit, so it rides on the same URL as an added header.
//! - **Stocks — Finnhub.** Requires the user's own key. With none configured,
//!   the requests are not attempted at all and those tickers are simply absent
//!   from the map.
//!
//! # `stale` means attempted and failed, never "not attempted"
//!
//! The difference is the whole point of the field. An unattempted stock is
//! already explained by `stocksEnabled: false` and has its own message; a
//! *failed* lookup is a genuine outage the user has no other way to learn
//! about. Bitcoin is on the same terms — before this distinction existed, a
//! CoinGecko rate-limit showed a stale snapshot as though it were live.
//!
//! # This is the only outbound network in the backend
//!
//! Everything else is local SQLite. Both fetches fail soft — the handler turns
//! a failure into a stale entry rather than an error status — because the
//! degradation contract is what keeps the portfolio total meaningful: a holding
//! with no live price falls back to its last snapshot, whereas an error would
//! take the whole page down over a third-party hiccup.
//!
//! **Failing soft is not the same as failing silently**, and until 2026-08-12
//! this module did both: it returned a bare `None` after printing the real
//! reason to stderr. So a doubled API key read on screen as "No live price for
//! TCKB, TCKR.WS, TCKC" while a `401 {"error":"Invalid API key."}` sat in a
//! terminal nobody reads. They now return `Result<_, PriceFailure>`, and the
//! handler groups those into `problems` so the page can say which key was
//! refused and where to fix it.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use avoir_core::money::Cents;

const COINGECKO_PRICE: &str =
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
const COINGECKO_CHART: &str = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart";
const FINNHUB_QUOTE: &str = "https://finnhub.io/api/v1/quote";

/// A bounded client. The default has no timeout at all, which in a desktop app
/// means a hung request holds the command open indefinitely and the page spins
/// with nothing to show for it.
/// Identifies this app to the services it calls.
///
/// **Not optional.** CoinGecko answers a request with no `User-Agent` with a
/// 403 and the message "Please add a descriptive User-Agent to your request",
/// and `reqwest` built with `default-features = false` sends none at all —
/// which is why `curl` worked from the same machine while the app showed "no
/// live price" forever. Nothing in the failure pointed at a header.
const USER_AGENT: &str = concat!("avoir-finance/", env!("CARGO_PKG_VERSION"));

fn client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(10))
        .build()
        .ok()
}

/// Why a price could not be fetched.
///
/// The distinction that earns this type is **`Rejected` versus everything
/// else**: a refused key is the user's to fix and nothing improves until they
/// do, while a rate limit or an outage resolves on its own. These functions
/// used to collapse both into `None` after printing the real reason to stderr —
/// so the app said "No live price for TCKB, TCKR.WS, TCKC" while the backend was
/// holding `401 {"error":"Invalid API key."}` in a terminal nobody reads. That
/// cost an hour of live debugging on 2026-08-12.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriceFailure {
    /// 401 or 403 — the service refused the key. Actionable by the user.
    Rejected,
    /// 429 — too many requests. Transient; nothing to fix.
    RateLimited,
    /// A network error, a timeout, a 5xx, or a body that did not parse.
    Unavailable,
    /// The service answered normally and had no usable quote for this symbol.
    /// Not a fault: a delisted or misspelled ticker looks exactly like this.
    NoQuote,
}

impl PriceFailure {
    /// The wire form. Kebab-case because it is read by the frontend, not shown.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rejected => "rejected",
            Self::RateLimited => "rate-limited",
            Self::Unavailable => "unavailable",
            Self::NoQuote => "no-quote",
        }
    }

    /// A non-2xx response, classified.
    ///
    /// 403 joins 401 deliberately: CoinGecko answers a bad demo key with 403,
    /// and to the person holding the key those are the same problem.
    fn from_status(status: reqwest::StatusCode) -> Self {
        match status.as_u16() {
            401 | 403 => Self::Rejected,
            429 => Self::RateLimited,
            _ => Self::Unavailable,
        }
    }
}

/// ═══ The price cache ═══
///
/// # Why there is one
///
/// The chart's refresh button and the portfolio view both call out to a
/// free-tier service, and a person who thinks a number looks wrong presses
/// refresh — repeatedly. On 2026-08-13 four requests in fifteen seconds earned
/// a 429 from CoinGecko, which then presented as "the BTC price fetch is
/// busted". The user's instinct was correct and their remedy was the cause.
///
/// So refreshing more often must not make things worse. Two windows do that:
///
/// - Inside `FRESH`, no request is made at all — the last price is returned as
///   though it were live, because at a minute old it is.
/// - Past `FRESH`, a request is made; if it FAILS, the last price is served
///   anyway (up to `USABLE`) and reported as stale. A ten-minute-old bitcoin
///   price is a far better answer than no answer, and much better than the
///   zero this used to collapse to.
///
/// # Why a process-global and not a database table
///
/// It is a cache, not a record: correctness never depends on it, restarting
/// discards it, and it must never be something a backup or an export carries.
/// The app is single-user and single-process, so a `Mutex<HashMap>` is the
/// whole mechanism.
///
/// The lock is only ever held to read or write one small entry — never across
/// an `.await` — so it cannot be held while a network request is in flight.
static CACHE: OnceLock<Mutex<HashMap<String, (f64, Instant)>>> = OnceLock::new();

/// Inside this, do not call the service at all.
const FRESH: Duration = Duration::from_secs(60);
/// Past `FRESH` but inside this, a cached price is still worth serving when the
/// live lookup fails. Beyond it, silence is more honest than a stale figure.
const USABLE: Duration = Duration::from_secs(6 * 60 * 60);

fn cache() -> &'static Mutex<HashMap<String, (f64, Instant)>> {
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached(symbol: &str, within: Duration) -> Option<(f64, Duration)> {
    let map = cache().lock().ok()?;
    let (price, at) = map.get(symbol)?;
    let age = at.elapsed();
    (age <= within).then_some((*price, age))
}

fn remember(symbol: &str, price: f64) {
    if let Ok(mut map) = cache().lock() {
        map.insert(symbol.to_string(), (price, Instant::now()));
    }
}

/// Drops ONE cached symbol. Test-only.
///
/// Deliberately not a `clear()`: the cache is process-global and `cargo test`
/// runs in parallel, so a test that wipes everything wipes the entry another
/// test is midway through asserting on. That is exactly what happened when
/// these were first written — `a_failure_does_not_overwrite_a_good_cached_price`
/// failed because a sibling cleared its key underneath it. Each test owns a
/// distinct symbol and forgets only that.
#[cfg(test)]
fn forget(symbol: &str) {
    if let Ok(mut map) = cache().lock() {
        map.remove(symbol);
    }
}

/// What a lookup produced, including whether it is a live figure.
#[derive(Debug, Clone, PartialEq)]
pub enum Priced {
    /// A live price, or one recent enough to be indistinguishable from live.
    Live(f64),
    /// The lookup failed and this is the last price seen. Reported as stale so
    /// the page says so rather than passing it off as current.
    Stale { price: f64, why: PriceFailure },
    /// The lookup failed and there is nothing cached to fall back on.
    Failed(PriceFailure),
}

/// A cached-then-live lookup. `fetch` is only awaited when the cache is cold or
/// past `FRESH`.
async fn with_cache<F, Fut>(symbol: &str, fetch: F) -> Priced
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<f64, PriceFailure>>,
{
    if let Some((price, _)) = cached(symbol, FRESH) {
        return Priced::Live(price);
    }
    match fetch().await {
        Ok(price) => {
            remember(symbol, price);
            Priced::Live(price)
        }
        Err(why) => match cached(symbol, USABLE) {
            Some((price, _)) => Priced::Stale { price, why },
            None => Priced::Failed(why),
        },
    }
}

/// The BTC price, cached. See [`with_cache`].
pub async fn bitcoin_price_cached(api_key: Option<&str>) -> Priced {
    with_cache("BTC", || bitcoin_price(api_key)).await
}

/// One stock quote, cached. See [`with_cache`].
pub async fn stock_price_cached(ticker: &str, api_key: &str) -> Priced {
    with_cache(ticker, || stock_price(ticker, api_key)).await
}

/// The current BTC price in USD.
///
/// A Demo key rides on the SAME base URL as the keyless call, so it is purely
/// an added header. A Pro key uses a different host and header and is not
/// supported; pasting one surfaces as a stale price rather than a silent wrong
/// answer.
pub async fn bitcoin_price(api_key: Option<&str>) -> Result<f64, PriceFailure> {
    let c = client().ok_or(PriceFailure::Unavailable)?;
    let mut req = c.get(COINGECKO_PRICE);
    if let Some(k) = api_key.filter(|k| !k.is_empty()) {
        req = req.header("x-cg-demo-api-key", k);
    }
    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[prices] CoinGecko request failed: {e}");
            return Err(PriceFailure::Unavailable);
        }
    };
    if !res.status().is_success() {
        // The body carries the reason — a rate limit, a bad key, a missing
        // header. Logging the status alone would have said 403 and nothing
        // about what to do, which is how this stayed unexplained.
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        eprintln!("[prices] CoinGecko returned {status}: {}", body.trim());
        return Err(PriceFailure::from_status(status));
    }
    let body: serde_json::Value = res.json().await.map_err(|_| PriceFailure::Unavailable)?;
    body.get("bitcoin")
        .and_then(|b| b.get("usd"))
        .and_then(|u| u.as_f64())
        .ok_or(PriceFailure::NoQuote)
}

/// One quote from Finnhub.
///
/// `c` is the current price. A zero means the symbol returned nothing usable —
/// Finnhub answers an unknown ticker with zeros rather than an error — so it is
/// treated as no price rather than as a stock worth nothing.
pub async fn stock_price(ticker: &str, api_key: &str) -> Result<f64, PriceFailure> {
    let c = client().ok_or(PriceFailure::Unavailable)?;
    let res = c
        .get(FINNHUB_QUOTE)
        .query(&[("symbol", ticker), ("token", api_key)])
        .send()
        .await
        .map_err(|e| {
            eprintln!("[prices] Finnhub request failed for {ticker}: {e}");
            PriceFailure::Unavailable
        })?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        eprintln!(
            "[prices] Finnhub returned {status} for {ticker}: {}",
            body.trim()
        );
        return Err(PriceFailure::from_status(status));
    }
    let body: serde_json::Value = res.json().await.map_err(|_| PriceFailure::Unavailable)?;
    // A zero is Finnhub's answer for an unknown symbol — it does not error — so
    // it is `NoQuote` rather than a stock worth nothing.
    body.get("c")
        .and_then(|c| c.as_f64())
        .filter(|p| *p > 0.0)
        .ok_or(PriceFailure::NoQuote)
}

/// Daily BTC closes for the last `days` days, keyed `YYYY-MM-DD`.
///
/// Capped at 365 by the caller because that is CoinGecko's free-tier limit.
///
/// # Why this returns a `Result` and not just an empty map
///
/// It used to return the map alone, documented as "a failure returns an empty
/// map, and the rebuild then writes no snapshots — a gap in the chart rather
/// than a fabricated line". The reasoning is right and the caller made it
/// false: `regenerate_all` DELETES every snapshot before it writes, so an empty
/// map is not a gap in a chart, it is the erasure of the entire history.
///
/// That is how the production database reached **zero** `InvestmentSnapshot`
/// rows on 2026-08-13. Pressing refresh on the chart rate-limited CoinGecko,
/// the history came back empty, the delete ran anyway, and the app reported
/// "Snapshots regenerated" — after which `liveValue` had no recorded figure to
/// fall back to and valued the bitcoin at nothing.
///
/// An empty map and a failed fetch look identical and mean opposite things.
/// The caller has to be able to tell them apart, so it is told.
pub async fn bitcoin_history(
    days: u32,
    api_key: Option<&str>,
) -> Result<HashMap<String, Cents>, PriceFailure> {
    let mut out = HashMap::new();
    let Some(c) = client() else {
        return Err(PriceFailure::Unavailable);
    };

    let mut req = c.get(COINGECKO_CHART).query(&[
        ("vs_currency", "usd"),
        ("days", &days.to_string()),
        ("interval", "daily"),
    ]);
    if let Some(k) = api_key.filter(|k| !k.is_empty()) {
        req = req.header("x-cg-demo-api-key", k);
    }

    let res = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[prices] CoinGecko history request failed: {e}");
            return Err(PriceFailure::Unavailable);
        }
    };
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        eprintln!(
            "[prices] CoinGecko history returned {status}: {}",
            body.trim()
        );
        return Err(PriceFailure::from_status(status));
    }
    let body: serde_json::Value = match res.json().await {
        Ok(b) => b,
        Err(_) => return Err(PriceFailure::Unavailable),
    };
    let Some(rows) = body.get("prices").and_then(|v| v.as_array()) else {
        return Err(PriceFailure::NoQuote);
    };

    for row in rows {
        let (Some(ts), Some(price)) = (
            row.get(0).and_then(serde_json::Value::as_f64),
            row.get(1).and_then(serde_json::Value::as_f64),
        ) else {
            continue;
        };
        // CoinGecko returns milliseconds since the epoch, and the day is read
        // in UTC — the only calendar the stored dates are in.
        let Some(dt) = chrono::DateTime::from_timestamp_millis(ts as i64) else {
            continue;
        };
        out.insert(
            dt.date_naive().format("%Y-%m-%d").to_string(),
            Cents::from_dollars_f64(price),
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cache is process-global, so these must not race each other over the
    /// same key. Each uses its own symbol and clears first.
    #[tokio::test]
    async fn a_fresh_price_is_served_without_calling_out() {
        forget("T_FRESH");
        let calls = std::cell::Cell::new(0);
        let fetch = || {
            calls.set(calls.get() + 1);
            async { Ok(42.0) }
        };

        assert_eq!(with_cache("T_FRESH", fetch).await, Priced::Live(42.0));
        assert_eq!(calls.get(), 1);

        // The whole point: pressing refresh again does NOT reach the service.
        // Doing so is what earned the 429 that started this.
        assert_eq!(with_cache("T_FRESH", fetch).await, Priced::Live(42.0));
        assert_eq!(with_cache("T_FRESH", fetch).await, Priced::Live(42.0));
        assert_eq!(calls.get(), 1, "a cached price must not cost a request");
    }

    #[tokio::test]
    async fn a_failure_falls_back_to_the_last_price_rather_than_to_nothing() {
        forget("T_FALL");
        assert_eq!(
            with_cache("T_FALL", || async { Ok(60_000.0) }).await,
            Priced::Live(60_000.0)
        );

        // Age it past FRESH so the next call really attempts a fetch.
        cache()
            .lock()
            .unwrap()
            .insert("T_FALL".into(), (60_000.0, Instant::now() - FRESH * 2));

        let out = with_cache("T_FALL", || async { Err(PriceFailure::RateLimited) }).await;
        assert_eq!(
            out,
            Priced::Stale {
                price: 60_000.0,
                why: PriceFailure::RateLimited
            },
            "a rate limit must not erase a price we already had"
        );
    }

    #[tokio::test]
    async fn a_failure_with_nothing_cached_reports_failure_not_zero() {
        forget("T_COLD");
        // The 2026-08-13 shape. `Failed` is deliberately not `Live(0.0)`:
        // valuing a holding at zero because a server was busy is the app
        // asserting the coins are worthless.
        assert_eq!(
            with_cache("T_COLD", || async { Err(PriceFailure::RateLimited) }).await,
            Priced::Failed(PriceFailure::RateLimited)
        );
    }

    #[tokio::test]
    async fn a_price_past_the_usable_window_is_not_served() {
        forget("T_OLD");
        cache()
            .lock()
            .unwrap()
            .insert("T_OLD".into(), (1.0, Instant::now() - USABLE * 2));

        // Silence beats a figure old enough to mislead.
        assert_eq!(
            with_cache("T_OLD", || async { Err(PriceFailure::Unavailable) }).await,
            Priced::Failed(PriceFailure::Unavailable)
        );
    }

    #[tokio::test]
    async fn a_failure_does_not_overwrite_a_good_cached_price() {
        forget("T_KEEP");
        with_cache("T_KEEP", || async { Ok(100.0) }).await;
        cache()
            .lock()
            .unwrap()
            .insert("T_KEEP".into(), (100.0, Instant::now() - FRESH * 2));
        with_cache("T_KEEP", || async { Err(PriceFailure::Unavailable) }).await;

        // Still there for the next attempt. Caching the failure would turn one
        // bad minute into an outage lasting as long as the entry.
        let (price, _) = cached("T_KEEP", USABLE).expect("entry survives a failure");
        assert_eq!(price, 100.0);
    }

    #[test]
    fn the_windows_are_ordered() {
        // FRESH > USABLE would make the fallback unreachable, and every test
        // above would still pass.
        assert!(FRESH < USABLE);
    }

    #[test]
    fn a_client_is_bounded() {
        // The assertion that matters is that one is built at all — an
        // unbounded default would hang the IPC command with no way out.
        assert!(client().is_some());
    }

    /// A refused key must be distinguishable from every other failure.
    ///
    /// This is the whole point of `PriceFailure`. When both collapsed into
    /// `None`, a doubled API key surfaced two pages away as "No live price for
    /// TCKB" and cost an hour on 2026-08-12 — the backend had the 401 the entire
    /// time and threw it away.
    #[test]
    fn a_refused_key_is_not_an_outage() {
        use reqwest::StatusCode;
        assert_eq!(
            PriceFailure::from_status(StatusCode::UNAUTHORIZED),
            PriceFailure::Rejected
        );
        // 403 joins 401 deliberately: CoinGecko answers a bad demo key that
        // way, and to the person holding the key they are the same problem.
        assert_eq!(
            PriceFailure::from_status(StatusCode::FORBIDDEN),
            PriceFailure::Rejected
        );
        assert_eq!(
            PriceFailure::from_status(StatusCode::TOO_MANY_REQUESTS),
            PriceFailure::RateLimited
        );
        for transient in [
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::BAD_GATEWAY,
            StatusCode::SERVICE_UNAVAILABLE,
        ] {
            assert_eq!(
                PriceFailure::from_status(transient),
                PriceFailure::Unavailable
            );
        }
    }

    /// The wire strings are a contract with the frontend's Zod enum.
    ///
    /// Pinned as literals rather than derived, because a rename here parses as
    /// a schema error in the browser rather than as anything readable — and the
    /// whole feature exists to stop a failure being reported as the wrong thing.
    #[test]
    fn the_wire_names_match_the_frontend_schema() {
        assert_eq!(PriceFailure::Rejected.as_str(), "rejected");
        assert_eq!(PriceFailure::RateLimited.as_str(), "rate-limited");
        assert_eq!(PriceFailure::Unavailable.as_str(), "unavailable");
        assert_eq!(PriceFailure::NoQuote.as_str(), "no-quote");
    }
}
