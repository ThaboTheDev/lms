import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { storage } from '@/lib/storage';
import { downloadDecision } from '@/lib/storage/scan-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * An institution's logo, for anyone: it is on the sign-in page before anybody
 * has signed in. Only the file the institution chose as its logo, only as an
 * image, and never one the malware scan withheld.
 */
export async function GET(request: NextRequest) {
  const institutionId = request.nextUrl.searchParams.get('i') ?? '';
  const institution = institutionId
    ? await prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true, logoFileId: true } })
    : null;
  const file = institution?.logoFileId
    ? await prisma.fileObject.findUnique({
        where: { id: institution.logoFileId },
        select: { institutionId: true, storageKey: true, mimeType: true, scanStatus: true },
      })
    : null;
  if (!file || file.institutionId !== institution?.id || !IMAGE_TYPES.has(file.mimeType)) {
    return new NextResponse(null, { status: 404 });
  }
  if (downloadDecision({ scanStatus: file.scanStatus, scannerConfigured: Boolean(env.MALWARE_SCANNER_URL), isUploader: false }) !== 'serve') {
    return new NextResponse(null, { status: 404 });
  }
  const bytes = await storage.get(file.storageKey);
  if (!bytes) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': 'public, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
