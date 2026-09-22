import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { assertKeyOwnedBy, storage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

function assertLocalDriver() {
  if (env.STORAGE_DRIVER !== 'local') {
    throw new AppError('This endpoint only exists for local development storage.', 404, 'not_found');
  }
}

/** Stands in for the S3 PUT target when STORAGE_DRIVER=local. */
export async function PUT(request: NextRequest) {
  try {
    assertLocalDriver();
    const principal = await requirePrincipal();
    const key = request.nextUrl.searchParams.get('key');
    if (!key) throw new AppError('A storage key is required.', 400, 'bad_request');
    assertKeyOwnedBy(key, principal.institutionId ?? '');

    const body = Buffer.from(await request.arrayBuffer());
    await storage.put?.(key, body, request.headers.get('content-type') ?? 'application/octet-stream');
    return NextResponse.json({ stored: true, bytes: body.byteLength });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    assertLocalDriver();
    const principal = await requirePrincipal();
    const key = request.nextUrl.searchParams.get('key');
    if (!key) throw new AppError('A storage key is required.', 400, 'bad_request');
    assertKeyOwnedBy(key, principal.institutionId ?? '');

    const body = await storage.get?.(key);
    if (!body) throw new AppError('That file is not in local storage.', 404, 'not_found');

    return new NextResponse(new Uint8Array(body), {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
