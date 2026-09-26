import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { queue } from '@/lib/queue';
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import type { PermissionKey } from '@/lib/rbac/permissions';
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
      submissionFiles: { select: { submission: { select: { studentId: true, assessment: { select: { offeringId: true } } } } } },
      proofsOfPayment: { select: { studentId: true } },
      applicationDocs: { select: { id: true } },
      qaDocuments: { select: { id: true } },
      messageAttachments: { select: { message: { select: { thread: { select: { participants: { select: { userId: true } } } } } } } },
      ticketAttachments: { select: { ticket: { select: { requesterId: true, assigneeId: true } } } },
    },
  });

  if (!file) throw new NotFoundError('File');
  if (file.institutionId) requireSameInstitution(principal, file.institutionId);

  if (file.scanStatus === 'INFECTED') {
    throw new AppError('This file was withheld by the malware scan.', 403, 'file_withheld');
  }

  if (file.uploadedById === principal.userId) return file;

  const institutionId = file.institutionId ?? '';
  const allowed = (permission: PermissionKey, courseOfferingId?: string) =>
    can(principal, permission, { institutionId, ...(courseOfferingId ? { courseOfferingId } : {}) });

  // Each way a file can be attached decides who may read it. A permission that
  // covers one kind of file never opens another: content.read, which every
  // learner holds for library material, used to open everyone's submissions
  // and bank slips as well.

  // Learning content: anyone enrolled in or teaching the offering, or who manages courses.
  const offeringIds = file.lessonBlocks.map((block) => block.lesson.section.offeringId).filter(Boolean);
  if (offeringIds.length > 0) {
    const reachable = await prisma.courseOffering.count({
      where: {
        id: { in: offeringIds },
        OR: [
          { staff: { some: { userId: principal.userId } } },
          ...(principal.studentId
            ? [{ enrolments: { some: { studentId: principal.studentId, status: { in: ['ACTIVE' as const, 'COMPLETED' as const] } } } }]
            : []),
        ],
      },
    });
    if (reachable > 0 || offeringIds.some((id) => allowed('course.manage', id))) return file;
  }

  // Library material: content.read, or content.manage for restricted items.
  if (file.contentAssets.some((asset) => (asset.isRestricted ? allowed('content.manage') : allowed('content.read')))) return file;

  // Submitted work: the learner who submitted it, and staff who read submissions on that course.
  for (const { submission } of file.submissionFiles) {
    if (principal.studentId && submission.studentId === principal.studentId) return file;
    if (allowed('submission.read', submission.assessment.offeringId)) return file;
  }

  // Proof of payment: the learner who sent it, and finance.
  for (const proof of file.proofsOfPayment) {
    if (principal.studentId && proof.studentId === principal.studentId) return file;
    if (allowed('pop.review') || allowed('finance.read')) return file;
  }

  // Application documents: admissions.
  if (file.applicationDocs.length > 0 && allowed('application.read')) return file;

  // Quality assurance evidence: QA and moderators.
  if (file.qaDocuments.length > 0 && (allowed('qa.manage') || allowed('moderation.perform'))) return file;

  // A message attachment: everyone in the conversation.
  if (file.messageAttachments.some((row) => row.message.thread.participants.some((entry) => entry.userId === principal.userId))) {
    return file;
  }

  // A ticket attachment: the requester, the assignee and the support desk.
  if (file.ticketAttachments.some((row) => row.ticket.requesterId === principal.userId || row.ticket.assigneeId === principal.userId)) {
    return file;
  }
  if (file.ticketAttachments.length > 0 && allowed('ticket.read')) return file;

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
