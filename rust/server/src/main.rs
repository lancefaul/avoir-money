//! The Avoir Money backend, as a local HTTP server.
//!
//! This is the sidecar the Electron shell spawns and owns. It is the same
//! `avoir_api::dispatch` the Tauri shell called over IPC — the backend has no
//! opinion about its transport, which is what made swapping shells a day's work
//! rather than a rewrite.
//!
//! # Why HTTP rather than a native module
//!
//! The frontend's `request()` already speaks HTTP, with error mapping, 204
//! handling and multipart uploads that have been exercised against the Hono
//! server for months. Reusing that path means the desktop and the browser run
//! **identical** client code, so a divergence between them is impossible by
//! construction rather than by discipline. It also keeps the backend runnable on
//! its own, which is what serves the app to a phone on the LAN.
//!
//! The cost is a second process to own, which is the Electron main process's job
//! and the reason this binary is deliberately dull: bind, serve, exit.
//!
//! # It is not reachable from anywhere else
//!
//! Two guards, because a localhost port is not private — any process on the
//! machine can reach it, and so can any web page the user has open, which is
//! what makes CSRF and DNS-rebinding real here rather than theoretical.
//!
//! 1. **Bound to 127.0.0.1 on an ephemeral port.** Nothing off-machine can
//!    route to it, and the port is not guessable across launches.
//! 2. **A bearer token generated per launch by the parent** and required on
//!    every request. A page in a browser can *send* a cross-origin request but
//!    cannot read this token, so it cannot construct an authorised one.
//!
//! The port is printed on stdout as one line of JSON for the parent to read.
//! Not a fixed port: 5273/5274 belong to this project's dev servers and
//! 5173/5174 to a different app on the same machine, and a desktop app that
//! fails to start because something else holds a port is exactly the class of
//! problem this design is meant to avoid.

use anyhow::Context;
use axum::body::Bytes;
use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Router;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;

/// How often the running app re-checks whether a backup is due.
///
/// Carried over from the Tauri shell unchanged, along with its reasoning: this
/// is not the backup frequency (DAILY or WEEKLY, in the config) but how finely
/// the app notices a day boundary passing while it sits open. A check that is
/// not due is two small queries and no file I/O.
const SCHEDULE_TICK: std::time::Duration = std::time::Duration::from_secs(60 * 60);

struct Ctx {
    pool: SqlitePool,
    token: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // The parent decides where data lives, so the two agree on one location by
    // construction. Electron owns the platform convention for an app-data
    // directory; duplicating that guess here is how the app ends up reading a
    // different database than the one it writes.
    let dir: PathBuf = std::env::var("AVOIR_DATA_DIR")
        .map(PathBuf::from)
        .map_err(|_| anyhow::anyhow!("AVOIR_DATA_DIR is required"))?;
    std::fs::create_dir_all(&dir)?;

    let db = dir.join("avoir.db");
    let url = format!("sqlite:{}", db.display());

    // A restore staged by `/backups/:id/restore` is applied HERE, before
    // anything opens the database. SQLite's guidance is to replace the file with
    // no connections open; doing it at startup means there is nothing to close,
    // nothing in flight, and no way to half-apply it. If the staged file no
    // longer validates, the launch fails loudly rather than proceeding on a
    // database the user believes was replaced.
    let paths = avoir_db::backup::Paths {
        database: db.clone(),
        directory: dir.join("backups"),
    };
    if avoir_db::backup::apply_staged_restore(&paths).await? {
        eprintln!("[avoir] applied a staged restore to {}", db.display());
    }

    // One backend per database, enforced rather than assumed.
    //
    // Two servers on the same file is not a hypothetical: on 2026-08-10 a test
    // server and the running app held this database at once, because both are
    // called `avoir-server` and nothing distinguished them. SQLite's locking
    // held and the integrity check passed, but that was luck — the two disagree
    // about the balance chain the moment they interleave writes, and the
    // failure would surface as drift rather than as an error.
    //
    // An OS-level advisory lock, not a PID file: it is released by the kernel
    // when the process dies however it dies, so a crash cannot leave a stale
    // lock that refuses every future launch.
    let lock_path = dir.join("avoir.lock");
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("opening {}", lock_path.display()))?;
    if let Err(e) = try_lock_exclusive(&lock) {
        anyhow::bail!(
            "another Avoir Money backend is already using {} ({e}). \
             Close the other window, or point AVOIR_DATA_DIR somewhere else.",
            db.display()
        );
    }
    // Held for the process's lifetime. Dropping it here would release it.
    std::mem::forget(lock);

    let pool = avoir_db::connect(&url).await?;

    // Detached deliberately: it must never delay the window appearing, and it
    // has no result the shell can act on. `run_if_due` logs its own outcome and
    // records a FAILED row the Settings screen shows.
    {
        let pool = pool.clone();
        tokio::spawn(async move {
            loop {
                avoir_api::backups::run_if_due(&pool).await;
                tokio::time::sleep(SCHEDULE_TICK).await;
            }
        });
    }

    let ctx = Arc::new(Ctx {
        pool,
        // Absent means unauthenticated, which is only ever right for local
        // development. The packaged app always sets it.
        token: std::env::var("AVOIR_TOKEN").ok().filter(|t| !t.is_empty()),
    });
    if ctx.token.is_none() {
        eprintln!("[avoir] WARNING: AVOIR_TOKEN unset — every local process can reach this server");
    }

    // The API is nested under the prefix the client already uses, and
    // everything else is the built frontend. Serving both from ONE origin is
    // the point: no CORS, no custom protocol, and no `file://` page trying to
    // reach an http:// port. It also means a phone on the LAN can load the
    // whole app from this process, which a native module could never do.
    // Two routes bypass `dispatch`, and both for the same reason: `dispatch`
    // speaks JSON in and JSON out, and these are neither. Framing a multipart
    // body and streaming a file are transport concerns, so they live in the
    // transport — which also keeps the functions behind them callable from a
    // test without constructing an HTTP request.
    let mut app = Router::new()
        .route("/api/v1/backups/upload", axum::routing::post(upload))
        .route(
            "/api/v1/backups/{id}/download",
            axum::routing::post(download),
        )
        .route("/api/v1", axum::routing::any(handle))
        .route("/api/v1/{*rest}", axum::routing::any(handle))
        .with_state(ctx);

    if let Ok(web) = std::env::var("AVOIR_WEB_DIR") {
        let index = PathBuf::from(&web).join("index.html");
        // SPA fallback: the router owns the URL space, so a deep link or a
        // reload on /transactions must return index.html.
        //
        // `fallback`, NOT `not_found_service` — the latter serves the same bytes
        // but stamps 404 on them. A browser renders that anyway, which is
        // exactly why it is worth getting right: the page would work while every
        // deep link reported failure to anything that reads status codes.
        app = app.fallback_service(
            tower_http::services::ServeDir::new(&web)
                .fallback(tower_http::services::ServeFile::new(index)),
        );
    } else {
        eprintln!("[avoir] AVOIR_WEB_DIR unset — serving the API only");
    }

    // Layers LAST, so they wrap the fallback as well as the routes.
    //
    // `Router::layer` only wraps what was added before it. Applied above the
    // `fallback_service`, the CSP reached neither the app page nor the API —
    // the header was configured, compiled, and absent from every response,
    // which is the most convincing kind of security control to have and the
    // least useful.
    let app = app
        // A database is large and the limit is enforced on the decoded bytes in
        // the handler; without raising this, axum's 2MB default refuses every
        // real upload before the handler ever sees it.
        .layer(axum::extract::DefaultBodyLimit::max(
            (avoir_db::upload_staging::MAX_UPLOAD_BYTES + 1024 * 1024) as usize,
        ))
        .layer(axum::middleware::from_fn(security_headers));

    // Port 0: the OS picks a free one. See the module note on why a fixed port
    // is the wrong choice for a desktop app — the shell reads the chosen port
    // off stdout, so nothing has to agree on a number in advance.
    //
    // `AVOIR_PORT` overrides it, and exists for exactly one caller: the UI dev
    // server. Vite proxies `/api` to a target it is configured with at startup,
    // which cannot be a port the backend has not chosen yet. That is a
    // development-only need — the packaged app never sets this, and the
    // reasoning against a fixed default is unchanged.
    let bind = match std::env::var("AVOIR_PORT").ok().filter(|p| !p.is_empty()) {
        Some(p) => format!("127.0.0.1:{p}"),
        None => "127.0.0.1:0".to_string(),
    };
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    let port = listener.local_addr()?.port();

    // One line of JSON, flushed immediately. The parent blocks on this, so a
    // buffered write would hang the splash screen until some later output
    // happened to flush it.
    println!("{}", json!({ "port": port }));
    use std::io::Write;
    std::io::stdout().flush()?;

    watch_parent();

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

/// The bearer check every route runs.
///
/// Extracted rather than repeated: the upload and download routes bypass
/// `dispatch`, and a second copy of an auth check is how one of them ends up
/// missing it. Returns the refusal to send, so a caller cannot forget to.
fn authorize(ctx: &Ctx, headers: &HeaderMap) -> Result<(), Box<Response>> {
    // Checked BEFORE the token, and deliberately outside the `token.is_some()`
    // branch: a development run with no token should still not be reachable
    // from a web page.
    //
    // A localhost port is reachable by any page the user has open. A browser
    // will send a cross-origin POST here quite happily — it cannot READ the
    // reply without CORS, but a write does not need to be read. The token is
    // the primary defence, since a page cannot learn it; this is the second
    // lock on the same door.
    //
    // Requests with NO `Origin` are allowed: that is curl, the LAN case and
    // the shell's own fetches, none of which a browser page can forge — a
    // browser always sets `Origin` on a cross-origin request.
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let ours =
            origin.starts_with("http://127.0.0.1:") || origin.starts_with("http://localhost:");
        if !ours {
            return Err(Box::new(err(
                StatusCode::FORBIDDEN,
                "Cross-origin requests are not accepted.",
            )));
        }
    }

    let Some(expected) = &ctx.token else {
        return Ok(());
    };
    let ok = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        // Length-independent comparison is not warranted here: the token is 256
        // bits of OS randomness and an attacker who can time this already has
        // local code execution.
        .is_some_and(|t| t == expected);
    if ok {
        Ok(())
    } else {
        Err(Box::new(err(StatusCode::UNAUTHORIZED, "Unauthorized")))
    }
}

/// Every request, routed by the same dispatcher the Tauri shell used.
///
/// A single fallback rather than a route table: `dispatch` already owns the
/// routing, and declaring the 178 paths a second time here would be a second
/// list to keep in step with the first.
async fn handle(
    State(ctx): State<Arc<Ctx>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(r) = authorize(&ctx, &headers) {
        return *r;
    }

    // The client's base URL carries the `/api/v1` prefix that `dispatch` does
    // not expect, matching how the Hono server mounted its router.
    let path = uri.path().strip_prefix("/api/v1").unwrap_or(uri.path());
    let full = match uri.query() {
        Some(q) if !q.is_empty() => format!("{path}?{q}"),
        _ => path.to_string(),
    };

    // An empty body is None, not `null`: handlers distinguish "no body" from a
    // body that happens to be null, and a GET has neither.
    let parsed: Option<Value> = if body.is_empty() {
        None
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => Some(v),
            Err(e) => return err(StatusCode::BAD_REQUEST, &format!("Invalid JSON body: {e}")),
        }
    };

    match avoir_api::dispatch(&ctx.pool, method.as_str(), &full, parsed).await {
        Ok(r) => {
            let code = StatusCode::from_u16(r.status).unwrap_or(StatusCode::OK);
            // 204 must carry no body — `request()` maps it to `undefined`, and a
            // body here makes that ambiguous.
            if code == StatusCode::NO_CONTENT {
                return code.into_response();
            }
            (code, axum::Json(r.body)).into_response()
        }
        Err(e) => {
            let code = StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            (code, axum::Json(e.to_json())).into_response()
        }
    }
}

fn err(code: StatusCode, message: &str) -> Response {
    (code, axum::Json(json!({ "error": message }))).into_response()
}

/// Accept an uploaded database and report what it is.
///
/// The multipart framing stops here; `avoir_api::backups::upload` takes bytes.
async fn upload(State(ctx): State<Arc<Ctx>>, headers: HeaderMap, mut form: Multipart) -> Response {
    if let Err(r) = authorize(&ctx, &headers) {
        return *r;
    }

    let mut bytes: Option<Bytes> = None;
    loop {
        match form.next_field().await {
            Ok(Some(field)) => {
                // The field NAME is trusted (it is our own form); the file name
                // is not, and is never read — the staging module picks the
                // destination.
                if field.name() == Some("file") {
                    match field.bytes().await {
                        Ok(b) => bytes = Some(b),
                        Err(e) => {
                            return err(
                                StatusCode::BAD_REQUEST,
                                &format!("Could not read the uploaded file: {e}"),
                            )
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                return err(
                    StatusCode::BAD_REQUEST,
                    &format!("Could not read the uploaded file: {e}"),
                )
            }
        }
    }

    let Some(bytes) = bytes else {
        return err(StatusCode::BAD_REQUEST, "No file was uploaded.");
    };

    match avoir_api::backups::upload(&ctx.pool, &bytes).await {
        Ok(r) => (
            StatusCode::from_u16(r.status).unwrap_or(StatusCode::CREATED),
            axum::Json(r.body),
        )
            .into_response(),
        Err(e) => (
            StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            axum::Json(e.to_json()),
        )
            .into_response(),
    }
}

/// Send a completed backup's bytes as a download, encrypted when asked.
///
/// **POST, not GET, and that is the point.** The old route was a `GET` a
/// browser navigated to, which cannot set an Authorization header — so the API
/// key rode in the query string, into history and any proxy log along the way.
/// A passphrase could not go there at all. A `fetch` carries both in places
/// that are not the URL.
#[derive(serde::Deserialize, Default)]
#[serde(default)]
struct DownloadBody {
    passphrase: Option<String>,
}

async fn download(
    State(ctx): State<Arc<Ctx>>,
    axum::extract::Path(id): axum::extract::Path<String>,
    headers: HeaderMap,
    body: Option<axum::Json<DownloadBody>>,
) -> Response {
    if let Err(r) = authorize(&ctx, &headers) {
        return *r;
    }
    let passphrase = body.and_then(|b| b.0.passphrase);
    match avoir_api::backups::download(&ctx.pool, &id, passphrase.as_deref()).await {
        Ok((filename, bytes)) => {
            let mut res = (StatusCode::OK, bytes).into_response();
            let h = res.headers_mut();
            h.insert("content-type", "application/octet-stream".parse().unwrap());
            // The filename comes from our own row, not from the client, so it
            // cannot carry a quote or a newline into this header.
            if let Ok(v) = format!("attachment; filename=\"{filename}\"").parse() {
                h.insert("content-disposition", v);
            }
            res
        }
        Err(e) => (
            StatusCode::from_u16(e.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            axum::Json(e.to_json()),
        )
            .into_response(),
    }
}

/// Take an exclusive advisory lock without blocking.
///
/// `flock(LOCK_EX | LOCK_NB)`: a second process gets `EWOULDBLOCK` immediately
/// rather than hanging, and the kernel drops the lock when this process exits
/// by any route — including SIGKILL, which is exactly the case a PID file
/// cannot survive.
#[cfg(unix)]
fn try_lock_exclusive(file: &std::fs::File) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    // SAFETY: `fd` is owned by `file` and valid for this call; flock has no
    // memory effects and reports failure through errno.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn try_lock_exclusive(file: &std::fs::File) -> std::io::Result<()> {
    // Windows opens the file without FILE_SHARE_WRITE, so the open itself is
    // the lock. Nothing further to do.
    let _ = file;
    Ok(())
}

/// Exit when the process that started us does.
///
/// The shell kills this process on every ordinary exit path, and that is
/// verified. It cannot on the paths that matter here — a SIGKILLed or crashed
/// parent runs no cleanup — and an orphan holding the database is worse than no
/// backend at all: it keeps the lock, so the next launch is refused, and the
/// app becomes unopenable until someone finds the process by hand.
///
/// Two mechanisms, because the first has a real gap:
///
/// 1. `PR_SET_PDEATHSIG` asks the kernel to signal us when the parent dies.
///    Cheap and immediate — but it fires when the parent THREAD that forked us
///    exits, not the process, and a runtime that forks from a pool thread can
///    trigger it early or not at all.
/// 2. A slow poll of `getppid()`. Reparenting to init is unambiguous and
///    survives every case the first misses. Ten seconds is far below the cost
///    of an orphan and far above the cost of a syscall.
fn watch_parent() {
    #[cfg(target_os = "linux")]
    // SAFETY: prctl with PR_SET_PDEATHSIG takes an integer and touches no
    // memory; the call reports failure through errno, which is not fatal here.
    unsafe {
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
    }

    #[cfg(unix)]
    {
        // If the parent died between the spawn and this line, PDEATHSIG has
        // already been missed — check once before settling into the poll.
        let start = unsafe { libc::getppid() };
        tokio::spawn(async move {
            loop {
                let ppid = unsafe { libc::getppid() };
                // Reparented, or the parent we were started by has gone.
                if ppid == 1 || (start != 1 && ppid != start) {
                    eprintln!("[avoir] parent process exited; shutting down");
                    std::process::exit(0);
                }
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        });
    }

    // 3. The supervision pipe, and it is the only one of the three that works
    //    on Windows.
    //
    //    The shell spawns us with stdin as a pipe it holds open and never
    //    writes to. It does not have to do anything when it dies: the OS closes
    //    every handle a process owned, by every exit route including SIGKILL,
    //    TerminateProcess and a hard crash. So the read below returns EOF
    //    exactly when the parent is gone, and never before.
    //
    //    Chosen over the two alternatives for one reason each. Polling a parent
    //    PID passed in the environment needs `OpenProcess` on Windows — a new
    //    dependency to answer a question a pipe already answers. And a job
    //    object would tie the child's lifetime to the parent's correctly, but
    //    it is Windows-only, so the unix path would still need something else
    //    and the two would drift.
    //
    //    It is also strictly better than the poll above: immediate rather than
    //    up to ten seconds late, and it cannot misread a reparent.
    //
    //    Gated on an explicit flag rather than on "is stdin a pipe", because
    //    that test gets the CI and terminal cases exactly backwards: a run with
    //    stdin redirected from /dev/null is not a terminal AND reads EOF
    //    instantly, so the server would exit the moment it started. Only the
    //    shell sets AVOIR_SUPERVISED, and only the shell holds the pipe.
    if std::env::var_os("AVOIR_SUPERVISED").is_some() {
        std::thread::spawn(|| {
            use std::io::Read;
            let mut stdin = std::io::stdin();
            let mut buf = [0u8; 64];
            loop {
                match stdin.read(&mut buf) {
                    // EOF: every write end is closed, so the shell is gone.
                    Ok(0) => break,
                    // The shell does not write, but a stray byte is not a
                    // reason to quit — only the close is.
                    Ok(_) => continue,
                    // A broken pipe means the same thing as EOF here.
                    Err(_) => break,
                }
            }
            eprintln!("[avoir] shell closed the supervision pipe; shutting down");
            std::process::exit(0);
        });
    }
}

/// The headers every response carries.
///
/// The renderer runs with `contextIsolation` on, `nodeIntegration` off and a
/// sandbox, so a script injected into the page cannot reach Node. A CSP is the
/// layer below that: it stops the injection being *useful* — no remote script,
/// no exfiltration to an outside host, no framing of the app by anything else.
///
/// `'unsafe-inline'` is present for styles and not for scripts, and that split
/// is the whole point. Vanilla Extract compiles to static CSS but the app still
/// sets inline styles, so removing it would break the UI; scripts have no such
/// need, and script injection is the one that matters.
///
/// `connect-src 'self'` is what makes the CSP worth having here — a page that
/// somehow ran hostile code still could not send this database anywhere,
/// because the only origin it may talk to is the one serving it.
async fn security_headers(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.insert(
        "content-security-policy",
        "default-src 'self'; \
         script-src 'self'; \
         style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; \
         font-src 'self' data:; \
         connect-src 'self'; \
         object-src 'none'; \
         frame-ancestors 'none'; \
         base-uri 'none'; \
         form-action 'none'"
            .parse()
            .expect("a static header value"),
    );
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert("referrer-policy", "no-referrer".parse().unwrap());
    res
}
