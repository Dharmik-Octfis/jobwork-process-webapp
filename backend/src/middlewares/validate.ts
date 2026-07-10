import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../lib/apiError.ts';

/**
 * Validate `req.body` against a Zod schema before the controller runs
 * (architecture §5). On success the parsed — and therefore *normalized*, e.g.
 * trimmed — value replaces `req.body`, so downstream code can never
 * accidentally read the raw input.
 */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        fieldErrors[path] ??= issue.message;
      }
      next(ApiError.badRequest('Please check the highlighted fields.', fieldErrors));
      return;
    }

    req.body = result.data;
    next();
  };
}
