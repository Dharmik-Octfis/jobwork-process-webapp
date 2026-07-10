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
}
