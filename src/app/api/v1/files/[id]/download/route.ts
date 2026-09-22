import { NextResponse } from 'next/server';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { getDownloadUrl } from '@/server/services/files';

export const dynamic = 'force-dynamic';

/**
 * Redirects to a short-lived storage URL rather than streaming the bytes, so
 * the application server stays out of the data path. The permission check
 * happens here, before the redirect is issued.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await params;
    const { url } = await getDownloadUrl(principal, id);
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
