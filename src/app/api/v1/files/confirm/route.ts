import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { confirmUpload } from '@/server/services/files';

const schema = z.object({ fileId: z.string().min(1), checksum: z.string().max(128).optional() });

export async function POST(request: NextRequest) {
  try {
    const principal = await requirePrincipal();
    const body = schema.parse(await request.json());
    return NextResponse.json(await confirmUpload(principal, body.fileId, body.checksum));
  } catch (error) {
    return toErrorResponse(error);
  }
}
