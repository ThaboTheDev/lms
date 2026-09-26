import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { toErrorResponse } from '@/lib/http';
import { RateLimitError } from '@/lib/errors';
import { rateLimit } from '@/lib/rate-limit';
import { hashIp } from '@/lib/crypto';
import { badgeIssuer } from '@/server/services/open-badges';

export const dynamic = 'force-dynamic';

/** Public by design: badge wallets and verifiers fetch this without signing in. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
    const limited = await rateLimit(`badges:${hashIp(ip) ?? 'unknown'}`, 60, 60);
    if (!limited.allowed) throw new RateLimitError(limited.retryAfterSeconds);
    const { code } = await params;
    return NextResponse.json(await badgeIssuer(code.toUpperCase()), {
      headers: { 'content-type': 'application/ld+json; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
