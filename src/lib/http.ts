import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './errors';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/**
 * Every API route funnels failures through here so that clients get one error
 * shape, and so that an unexpected exception never leaks a stack trace or a
 * database message to the caller.
 */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Check the submitted fields.', details: error.flatten() } },
      { status: 422 },
    );
  }

  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  console.error('[api] unhandled error', error);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong. Try again.' } },
    { status: 500 },
  );
}

export function apiHandler<T>(handler: () => Promise<T>) {
  return async () => {
    try {
      return NextResponse.json(await handler());
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export interface PageParams {
  page: number;
  perPage: number;
  skip: number;
}

/** Pagination is mandatory on every collection endpoint: no unbounded reads. */
export function parsePaging(searchParams: URLSearchParams | Record<string, string | undefined>, max = 100): PageParams {
  const get = (key: string) =>
    searchParams instanceof URLSearchParams ? searchParams.get(key) : searchParams[key];
  const page = Math.max(1, Number(get('page') ?? 1) || 1);
  const perPage = Math.min(max, Math.max(1, Number(get('perPage') ?? 25) || 25));
  return { page, perPage, skip: (page - 1) * perPage };
}
