import { NextResponse } from 'next/server';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { exportPersonalInformation } from '@/server/services/privacy';
import { rateLimit } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * A person's own information, as a file they can keep. Rate limited because
 * building it reads across most of the database.
 */
export async function GET() {
  try {
    const principal = await requirePrincipal();

    const limit = await rateLimit(`export:${principal.userId}`, 3, 3600);
    if (!limit.allowed) throw new RateLimitError(limit.retryAfterSeconds);

    const data = await exportPersonalInformation(principal, principal.userId);

    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="my-information-${new Date().toISOString().slice(0, 10)}.json"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
