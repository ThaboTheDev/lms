import 'server-only';
import { prisma } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Principal } from '@/lib/rbac/authorize';

/**
 * Checks files somebody wants to attach to a message or a ticket: they
 * uploaded them, they belong to this institution, and the scanner has not
 * withheld them. Returns the ids to attach.
 */
export async function claimUploads(principal: Principal, fileIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = [...new Set(fileIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];
  const files = await prisma.fileObject.findMany({
    where: { id: { in: ids } },
    select: { id: true, uploadedById: true, institutionId: true, scanStatus: true },
  });
  for (const id of ids) {
    const file = files.find((candidate) => candidate.id === id);
    if (!file || file.uploadedById !== principal.userId || (file.institutionId && file.institutionId !== principal.institutionId)) {
      throw new AppError('That attachment is not one of your uploads.', 403, 'forbidden');
    }
    if (file.scanStatus === 'INFECTED') throw new AppError('That file was withheld by the malware scan.', 422, 'file_withheld');
  }
  return ids;
}
