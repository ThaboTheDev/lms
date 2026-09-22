import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { saveAnswers } from '@/server/services/submissions';

const schema = z.object({ responses: z.record(z.unknown()) });

/**
 * Autosave for an attempt in progress. Separate from the submit action so a
 * flaky connection costs a learner their last few seconds of typing rather than
 * the whole paper.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await params;
    const body = schema.parse(await request.json());
    return NextResponse.json(await saveAnswers(principal, id, body.responses as never));
  } catch (error) {
    return toErrorResponse(error);
  }
}
