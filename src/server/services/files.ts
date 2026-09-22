import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { queue } from '@/lib/queue';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import {
  assertKeyOwnedBy,
  assertUploadAllowed,
  buildStorageKey,
  storage,
  storageBucket,
} from '@/lib/storage';

export interface UploadRequest {
  folder: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Two-step upload. We record the intended object and hand back a short-lived
 * URL the browser PUTs to directly, then the client calls confirmUpload. File
 * bytes never pass through the application server, which is what keeps a
 * twenty thousand learner intake from turning the web tier into a file proxy.
 */
export async function requestUpload(principal: Principal, request: UploadRequest) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  assertUploadAllowed(request.mimeType, request.sizeBytes);

  const storageKey = buildStorageKey(institutionId, request.folder, request.filename);

  const file = await prisma.fileObject.create({
    data: {
      institutionId,
      storageKey,
      bucket: storageBucket,
      originalName: request.filename,
      mimeType: request.mimeType,
      sizeBytes: BigInt(request.sizeBytes),
      scanStatus: 'PENDING',
      uploadedById: principal.userId,
    },
    select: { id: true, storageKey: true },
  });

  const uploadUrl = await storage.presignUpload(storageKey, request.mimeType);
  return { fileId: file.id, storageKey: file.storageKey, uploadUrl };
}

/**
 * Called once the browser has finished the PUT. The object stays PENDING until
 * the scanner clears it, and nothing downstream serves a file that is not CLEAN.
 */
export async function confirmUpload(principal: Principal, fileId: string, checksum?: string) {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { id: true, institutionId: true, storageKey: true, uploadedById: true },
  });
  if (!file) throw new NotFoundError('File');
  if (file.institutionId) requireSameInstitution(principal, file.institutionId);
  if (file.uploadedById !== principal.userId) {
    throw new AppError('Only the uploader can confirm this upload.', 403, 'forbidden');
  }

  await prisma.fileObject.update({
    where: { id: fileId },
    data: { checksum: checksum ?? null },
  });

  await queue.enqueue('file.scan', { fileId });
  return { fileId, scanStatus: 'PENDING' as const };
}

/**
 * Whether this principal may read this file. Files are reachable by many paths,
 * so rather than duplicating rules at each call site the question is answered
 * once, here, from how the file is actually attached.
 */
export async function assertCanReadFile(principal: Principal, fileId: string) {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      institutionId: true,
      storageKey: true,
      originalName: true,
      mimeType: true,
      scanStatus: true,
      uploadedById: true,
      contentAssets: { select: { id: true, isRestricted: true } },
      lessonBlocks: {
        select: { lesson: { select: { section: { select: { offeringId: true } } } } },
      },
      submissionFiles: { select: { submission: { select: { studentId: true } } } },
      proofsOfPayment: { select: { studentId: true } },
    },
  });

  if (!file) throw new NotFoundError('File');
  if (file.institutionId) requireSameInstitution(principal, file.institutionId);

  if (file.scanStatus === 'INFECTED') {
    throw new AppError('This file was withheld by the malware scan.', 403, 'file_withheld');
  }

  if (file.uploadedById === principal.userId) return file;

  // Learning content: anyone enrolled in or teaching the offering may read it.
  const offeringIds = file.lessonBlocks
    .map((block) => block.lesson.section.offeringId)
    .filter(Boolean);

  if (offeringIds.length > 0) {
    const reachable = await prisma.courseOffering.count({
      where: {
        id: { in: offeringIds },
        OR: [
          { staff: { some: { userId: principal.userId } } },
          ...(principal.studentId
            ? [{ enrolments: { some: { studentId: principal.studentId, status: 'ACTIVE' as const } } }]
            : []),
        ],
      },
    });
    if (reachable > 0) return file;
  }

  // A learner's own submission or proof of payment.
  if (principal.studentId) {
    const ownsSubmission = file.submissionFiles.some((f) => f.submission.studentId === principal.studentId);
    const ownsProof = file.proofsOfPayment.some((p) => p.studentId === principal.studentId);
    if (ownsSubmission || ownsProof) return file;
  }

  // Library assets and staff oversight fall back to the ordinary permissions.
  const scope = { institutionId: file.institutionId ?? '' };
  const staffPermissions = [
    'content.read',
    'submission.read',
    'pop.review',
    'application.read',
  ] as const;

  for (const permission of staffPermissions) {
    try {
      requirePermission(principal, permission, scope);
      return file;
    } catch {
      // try the next one
    }
  }

  throw new AppError('You do not have access to this file.', 403, 'forbidden');
}

/** Short-lived download URL, recorded so file access is auditable. */
export async function getDownloadUrl(principal: Principal, fileId: string) {
  const file = await assertCanReadFile(principal, fileId);
  if (file.institutionId) assertKeyOwnedBy(file.storageKey, file.institutionId);

  const url = await storage.presignDownload(file.storageKey, file.originalName);

  await recordAudit(principal, {
    action: 'file.downloaded',
    entityType: 'FileObject',
    entityId: fileId,
    institutionId: file.institutionId,
    after: { originalName: file.originalName },
  });

  return { url, filename: file.originalName, mimeType: file.mimeType };
}

export async function deleteFile(principal: Principal, fileId: string) {
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { id: true, institutionId: true, storageKey: true, originalName: true },
  });
  if (!file) throw new NotFoundError('File');
  if (file.institutionId) {
    requireSameInstitution(principal, file.institutionId);
    requirePermission(principal, 'content.manage', { institutionId: file.institutionId });
  }

  await storage.delete(file.storageKey);
  await prisma.fileObject.delete({ where: { id: fileId } });

  await recordAudit(principal, {
    action: 'file.deleted',
    entityType: 'FileObject',
    entityId: fileId,
    institutionId: file.institutionId,
    before: { originalName: file.originalName },
  });
}
