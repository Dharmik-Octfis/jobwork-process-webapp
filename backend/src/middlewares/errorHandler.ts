import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/apiError.ts';
import { env } from '../config/env.ts';

/**
 * The single place an error becomes an HTTP response.
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so controllers need no try/catch and no `express-async-errors`.
 *
 * Only `ApiError` messages reach the client. Everything else is a bug, and its
 * message could leak a connection string or a file path — so it's logged
 * server-side and reported as a flat 500.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  // Errors use the SAME envelope as successes ({ statusCode, message, data }) —
  // see lib/apiResponse.ts — so a client parses one shape either way. `data` is
  // null on failure. `details` stays a TOP-LEVEL key, beside message rather than
  // inside data: it is error metadata, not payload, and the web client reads
  // `response.data.details` to highlight the offending fields.
  if (error instanceof ApiError) {
    res.status(error.status).json({
      statusCode: error.status,
      message: error.message,
      data: null,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  console.error('[unhandled]', error);

  res.status(500).json({
    statusCode: 500,
    message: 'Something went wrong. Please try again.',
    data: null,
    ...(env.isProduction ? {} : { debug: error instanceof Error ? error.message : String(error) }),
  });
}

/** 404 for any route the router didn't match. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    statusCode: 404,
    message: `Cannot ${req.method} ${req.path}`,
    data: null,
  });
}
