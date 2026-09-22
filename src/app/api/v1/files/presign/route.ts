import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { requestUpload } from '@/server/services/files';
import { rateLimit } from '@/lib/rate-limit';
import { RateLimitError } from '@/lib/errors';

const schema = z.object({
  folder: z.string().min(1).max(60),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal();

    // An upload URL is cheap to ask for and expensive to abuse.
    const limit = await rateLimit(`presign:${principal.userId}`, 60, 300);
    if (!limit.allowed) throw new RateLimitError(limit.retryAfterSeconds);

    const body = schema.parse(await request.json());
    return NextResponse.json(await requestUpload(principal, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
