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

/**
 * The digests are Next.js's own markers for forbidden() and notFound(). A page
 * that lets one of these errors escape renders the 403 or 404 page with that
 * status, instead of a 500 "could not be loaded". Server actions and route
 * handlers catch AppError first and are unaffected.
 */
export class AuthorisationError extends AppError {
  readonly digest = 'NEXT_HTTP_ERROR_FALLBACK;403';
  constructor(message = 'You do not have permission to do this.') {
    super(message, 403, 'forbidden');
  }
}

export class NotFoundError extends AppError {
  readonly digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
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
