import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth/current-user';
import { toErrorResponse } from '@/lib/http';
import { receiptPdf } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requirePrincipal();
    const { id } = await params;
    const { bytes, filename } = await receiptPdf(principal, id);
    return new NextResponse(Buffer.from(bytes), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${filename}"` },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
