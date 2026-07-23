import type { Response } from 'express';

/**
 * The one response envelope every endpoint returns:
 *
 *   { statusCode, message, data }
 *
 * Success and failure share it — `errorHandler` emits the same three keys with
 * `data: null` — so a client parses one shape either way.
 *
 * WHY EXPLICIT, AND NOT A res.json WRAPPER
 * This replaced a `responseFormatter` middleware that monkey-patched `res.json`
 * and inferred the envelope from whatever it was handed. Intercepting an
 * arbitrary payload forces guessing — which key is the message? what's left over
 * is data? — and a wrong guess produces no error, just quietly wrong output. It
 * really did: `details` got buried inside `data`, `{ error }` responses were
 * relabelled "Server Error", and `delete body.message` silently stripped any
 * payload field named `message`.
 *
 * Passing `message` and `data` separately removes the guess entirely, and makes
 * the call site state its own contract instead of looking like it returns
 * something it doesn't.
 *
 * `statusCode` is duplicated in the body deliberately: redundant with the HTTP
 * status for a direct caller, but it survives into logs and captured payloads.
 */
export interface ApiEnvelope<T> {
  statusCode: number;
  message: string;
  data: T;
}

/**
 * Send a success response.
 *
 *   sendSuccess(res, vendors);                          // 200 "Success"
 *   sendSuccess(res, vendor, 'Vendor created', 201);    // 201
 *   sendSuccess(res, null, 'Vendor deleted');           // 200, no payload
 *
 * `data` must keep the shape the endpoint already returned — the web client
 * unwraps the envelope in one interceptor (api/client.ts) and hands the inner
 * value to feature code, so changing that shape is a breaking API change.
 *
 * Deletes return 200 with `data: null` rather than 204: a 204 carries no body by
 * definition, so it is the one status that cannot express this envelope.
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Success',
  statusCode = 200,
): void {
  res.status(statusCode).json({ statusCode, message, data } satisfies ApiEnvelope<T>);
}
