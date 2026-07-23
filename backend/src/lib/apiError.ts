/**
 * An error the client is allowed to see. Anything else that reaches the error
 * handler is a bug, and is reported as a generic 500 — never with its message,
 * which may contain a connection string or a stack path.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  static unauthorized(message = 'Incorrect email or password.'): ApiError {
    return new ApiError(401, message);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }
}

/** A Prisma unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Run a write, turning a unique-constraint violation into a 409 with a message
 * the user can act on.
 *
 * This belongs in the SERVICE, not the controller: the service is what knows
 * which constraint it is writing against, so it can say "Currency code already
 * exists in this organization" instead of a generic "value already in use". The
 * controller then needs no try/catch at all — `errorHandler` formats the ApiError.
 *
 *   return withUniqueViolation('Currency code already exists in this organization.', () =>
 *     tx.currency.create({ ... }));
 */
export async function withUniqueViolation<T>(
  conflictMessage: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict(conflictMessage);
    throw error;
  }
}
