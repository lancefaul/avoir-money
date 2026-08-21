/**
 * Shared request infrastructure for the API client layer.
 * All domain-specific API modules import from this file.
 */

import { z } from 'zod';

/**
 * Relative by default, which is what the browser needs: Vite proxies `/api`
 * to the API server in dev, and a same-origin deployment serves both.
 *
 * The desktop shell needs no exception: it serves this page from the backend
 * itself, so a relative path is already same-origin with the API. That is why
 * there is one transport here rather than two.
 */
const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

/**
 * The bearer token, resolved at call time rather than at module load.
 *
 * The desktop shell serves this page from the backend itself, so `BASE` stays
 * relative and the browser and desktop run the *same* request path — the one
 * with the error mapping, 204 handling and multipart upload that have been
 * exercised for months. Only the credential differs: the shell mints a fresh
 * token per launch and hands it over on `window.__AVOIR__`, because a localhost
 * port is reachable by any process on the machine.
 *
 * Read per call, not captured once, so it cannot be sampled before the preload
 * bridge has been installed.
 */
function apiKey(): string {
  const shell = (globalThis as { __AVOIR__?: { token?: string } }).__AVOIR__;
  if (shell?.token) return shell.token;
  if (import.meta.env.VITE_API_KEY) return import.meta.env.VITE_API_KEY;
  /*
   * The dev convenience default, and it must not reach a build.
   *
   * `import.meta.env.DEV` is replaced with a literal `false` by Vite in
   * production, so this branch and the string in it are removed by dead-code
   * elimination — the same technique `useUpdates` uses for its mock, verified
   * the same way, by grepping the built bundle rather than trusting it.
   *
   * It was previously a third `??` and therefore compiled in. Not exploitable:
   * the packaged app mints a fresh 256-bit token per launch and hands it over
   * on `window.__AVOIR__`, and a server started with no `AVOIR_TOKEN` skips the
   * check entirely — so the string authenticated nothing in either path. It was
   * a credential-shaped literal sitting in a shipped artifact, which is worth
   * removing on its own, and worth more once v1.0 publishes this source
   * (ADR-040): a string named `dev-key` in a public repo is an invitation to
   * try it against something.
   */
  if (import.meta.env.DEV) return 'budget-tracker-dev-key';
  // A production build with no shell and no configured key has no credential,
  // and says so by sending an empty one rather than a guessable default.
  return '';
}

/**
 * Custom error class for API failures. Carries a human-readable message
 * (shown as the toast title) and an optional technical description
 * (shown in the toast body).
 */
export class ApiError extends Error {
  public readonly description?: string;
  /** HTTP status code, when the failure came from a server response. */
  public readonly status?: number;

  constructor(message: string, description?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.description = description;
    this.status = status;
  }
}

export class ApiValidationError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly zodError: z.ZodError,
  ) {
    super(`API response validation failed for ${endpoint}: ${zodError.message}`);
    this.name = 'ApiValidationError';
  }
}

/** Detect network-level failures (server unreachable, DNS, CORS, etc.) */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('fetch') || msg.includes('network') || msg.includes('aborted');
}

/**
 * REMOVED 2026-08-10: the Tauri IPC transport.
 *
 * The desktop shell now serves this page from the backend itself, so there is
 * exactly ONE transport again — browser and desktop run the same `fetch` path,
 * with the same error mapping, the same 204 handling and the same multipart
 * upload. While two transports existed only one was exercised by the suite, and
 * a divergence between them was possible; now it is not expressible.
 */

/** Parse a response body, converting a Zod failure into `ApiValidationError`. */
function parseResponse<T extends z.ZodTypeAny>(schema: T, path: string, json: unknown): z.infer<T> {
  try {
    return schema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new ApiValidationError(path, err);
    }
    throw err;
  }
}

export async function request<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
        ...init?.headers,
      },
      ...init,
    });
  } catch (err) {
    if (isNetworkError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        'Unable to reach the server. Check your connection and try again.',
        detail,
      );
    }
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const rawError = (body as { error?: unknown }).error;
    const serverMsg =
      typeof rawError === 'string'
        ? rawError
        : rawError
          ? JSON.stringify(rawError)
          : res.statusText;
    const details = (body as { details?: Array<{ field: string; message: string }> }).details;
    const detailStr = details?.map((d) => `${d.field}: ${d.message}`).join(', ');
    const description = detailStr
      ? `${detailStr} (${init?.method ?? 'GET'} ${path} → ${res.status})`
      : `${init?.method ?? 'GET'} ${path} → ${res.status}`;
    throw new ApiError(serverMsg, description, res.status);
  }
  if (res.status === 204) return undefined as z.infer<T>;
  return parseResponse(schema, path, await res.json());
}

/**
 * Send a file as multipart/form-data.
 *
 * Separate from `request` for one reason that matters: the browser must set
 * `Content-Type` itself, because only it knows the multipart boundary. Reusing
 * `request` would stamp `application/json` over the body and the server would
 * parse nothing. Error handling is deliberately identical, so an upload failure
 * surfaces the same way as every other API failure.
 */
export async function uploadRequest<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  file: File,
  field = 'file',
): Promise<z.infer<T>> {
  // This used to refuse outright in the desktop app, because IPC cannot carry a
  // multipart body and there was no HTTP server to send one to. The Electron
  // shell serves the app from the backend, so uploads now work exactly as they
  // do in the browser — and that is what unblocks the last two backup handlers.
  const form = new FormData();
  form.append(field, file);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      // Authorization only — no Content-Type, on purpose.
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });
  } catch (err) {
    if (isNetworkError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        'Unable to reach the server. Check your connection and try again.',
        detail,
      );
    }
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const rawError = (body as { error?: unknown }).error;
    const serverMsg = typeof rawError === 'string' ? rawError : res.statusText;
    throw new ApiError(serverMsg, `POST ${path} → ${res.status}`, res.status);
  }

  return parseResponse(schema, path, await res.json());
}

/**
 * Fetch a file the server sends as bytes, with the filename it chose.
 *
 * Separate from `request` for the same reason `uploadRequest` is: the response
 * is not JSON, so `parseResponse` has nothing to validate and would throw on a
 * perfectly good download.
 *
 * **POST rather than GET, deliberately.** The old download was an anchor the
 * browser navigated to, and an anchor cannot set an Authorization header — so
 * the API key travelled in the query string, into browser history and any proxy
 * log on the way. A `fetch` puts it in a header, and the same body carries the
 * passphrase, which could never have gone in a URL at all.
 */
export async function downloadRequest(
  path: string,
  body?: unknown,
): Promise<{ filename: string; blob: Blob }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    if (isNetworkError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        'Unable to reach the server. Check your connection and try again.',
        detail,
      );
    }
    throw err;
  }

  if (!res.ok) {
    const b = await res.json().catch(() => ({ error: res.statusText }));
    const raw = (b as { error?: unknown }).error;
    const msg = typeof raw === 'string' ? raw : res.statusText;
    throw new ApiError(msg, `POST ${path} → ${res.status}`, res.status);
  }

  // The server names the file, and appends `.age` when it encrypted it — so the
  // name is how the user can tell which they got.
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { filename: match?.[1] ?? 'backup.db', blob: await res.blob() };
}

export const _passthrough = z.any();

export interface TransactionListParams {
  cursor?: string;
  limit?: number;
  search?: string;
  accountId?: string;
  budgetIds?: string;
  purchaseGroupId?: string;
  type?: string;
  linkedToRecurring?: boolean;
  sortOrder?: 'newest' | 'oldest';
  dateFrom?: string;
  dateTo?: string;
  payPeriodId?: string;
  expenseId?: string;
  incomeId?: string;
  skipGenerate?: boolean;
  /** Include upcoming scheduled rows. Server defaults to true. */
  showAnticipations?: boolean;
  /** Also include snoozed anticipations. Server defaults to false. */
  showSnoozed?: boolean;
}
