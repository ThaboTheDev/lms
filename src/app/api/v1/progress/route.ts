import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { recordProgress } from '@/server/services/learning';

const schema = z.object({
  lessonId: z.string().min(1),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  secondsSpent: z.number().int().min(0).max(86_400).optional(),
  lastPositionSec: z.number().int().min(0).max(86_400).optional(),
});

/** Called on lesson open, periodically during playback, and on mark as done. */
export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal();
    const body = schema.parse(await request.json());
    return NextResponse.json(await recordProgress(principal, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
