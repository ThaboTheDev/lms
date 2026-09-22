/** Errors that carry an HTTP status and a stable code for API clients. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(message, 401, 'unauthenticated');
  }
}

export class AuthorisationError extends AppError {
  constructor(message = 'You do not have permission to do this.') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Record') {
    super(`${resource} not found.`, 404, 'not_found');
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Check the highlighted fields.') {
    super(message, 422, 'validation_failed', details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('Too many attempts. Try again shortly.', 429, 'rate_limited', { retryAfterSeconds });
  }
}
