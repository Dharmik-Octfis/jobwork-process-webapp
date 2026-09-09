/**
 * The one place that decides whether a successful response is a real API
 * envelope, and what to do when it is not.
 *
 * 🔴 WHY THIS IS STRICT, AND WHAT IT PREVENTS
 * Every endpoint returns `{ statusCode, message, data }` (CLAUDE.md). The
 * interceptor used to unwrap only when the body *looked* like that and otherwise
 * hand the raw body straight to feature code — silently. So a 2xx carrying
 * anything else became the query's data, and the first `.map` over it threw
 * `X.map is not a function` from deep inside a component, with no clue what the
 * body actually was.
 *
 * That is not hypothetical: the platform in front of this app returns bodies of
 * its own, e.g.
 *   {"error_description":"You have made too many requests continuously…",
 *    "error":"Access Denied","status":"failure"}
 * Passed through, that object reaches `useUoms()` and `uoms.map(…)` explodes.
 *
 * Failing loudly here turns a white screen into a normal query error, and names
 * the URL and the shape that arrived.
 *
 * Deliberately kept free of Vite-only imports (`import.meta.env`) so it can be
 * executed and checked outside a browser build.
 */

export interface ApiEnvelope<T = unknown> {
  statusCode: number;
  message?: string;
  data: T;
}

/** Bodies that are legitimately not JSON and must pass through untouched. */
function isBinaryBody(body: unknown): boolean {
  return (
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    ArrayBuffer.isView(body as ArrayBufferView)
  );
}

export function isApiEnvelope(body: unknown): body is ApiEnvelope {
  return typeof body === 'object' && body !== null && 'statusCode' in body && 'data' in body;
}

/** A short, safe description of what arrived, for the error message. */
export function describeBody(body: unknown): string {
  if (body === null) return 'null';
  if (body === undefined) return 'undefined';
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed === '') return 'an empty string';
    const opening = trimmed.slice(0, 40).replace(/\s+/g, ' ');
    return `a string starting "${opening}${trimmed.length > 40 ? '…' : ''}"`;
  }
  if (Array.isArray(body)) return `a bare array (${body.length} items)`;
  if (typeof body === 'object') {
    const keys = Object.keys(body as object).slice(0, 6);
    return `an object with keys [${keys.join(', ')}]`;
  }
  return `a ${typeof body}`;
}

export class ApiEnvelopeError extends Error {
  readonly body: unknown;

  constructor(url: string, body: unknown) {
    super(
      `The server returned an unexpected response for ${url}. ` +
        `Expected the standard { statusCode, message, data } envelope but received ${describeBody(body)}.`,
    );
    this.name = 'ApiEnvelopeError';
    this.body = body;
  }
}

/**
 * Returns the envelope's `data`, or throws.
 *
 * `binary` bodies are returned as-is: nothing calls `apiClient` for a file today
 * (`/api/storage/stream` is fetched directly, never through this client), but a
 * future one should not have to come back here to work.
 */
export function unwrapEnvelope(body: unknown, url: string): unknown {
  if (isBinaryBody(body)) return body;
  if (isApiEnvelope(body)) return body.data;
  throw new ApiEnvelopeError(url, body);
}
