import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';

export const CREDENTIAL_KINDS = ['QUALIFICATION', 'SHORT_COURSE', 'MICRO_CREDENTIAL', 'BADGE', 'COMPLETION', 'ATTENDANCE'] as const;
export type CredentialKindValue = (typeof CREDENTIAL_KINDS)[number];

export interface TemplateInput {
  name: string;
  kind: CredentialKindValue;
  bodyHtml: string;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  signatureFileId?: string | null;
  backgroundFileId?: string | null;
  isDefault: boolean;
}

function institutionOf(principal: Principal): string {
  if (!principal.institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'certificate.issue', { institutionId: principal.institutionId });
  return principal.institutionId;
}

/** A signature or background: an image this person uploaded to this institution. */
async function checkImage(principal: Principal, institutionId: string, fileId: string | null | undefined): Promise<string | null | undefined> {
  if (fileId === undefined) return undefined;
  if (!fileId) return null;
  const file = await prisma.fileObject.findUnique({ where: { id: fileId }, select: { institutionId: true, uploadedById: true, mimeType: true } });
  if (!file || file.institutionId !== institutionId || file.uploadedById !== principal.userId) throw new AppError('Upload the image first.', 422, 'no_file');
  if (file.mimeType !== 'image/png' && file.mimeType !== 'image/jpeg') {
    throw new AppError('Signatures and backgrounds must be PNG or JPEG: those are what a PDF can carry.', 422, 'validation_failed');
  }
  return fileId;
}

export async function listCertificateTemplates(principal: Principal) {
  const institutionId = institutionOf(principal);
  return prisma.certificateTemplate.findMany({
    where: { institutionId },
    orderBy: [{ kind: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, kind: true, bodyHtml: true, signatoryName: true, signatoryTitle: true,
      signatureFileId: true, backgroundFileId: true, isDefault: true, _count: { select: { certificates: true } },
    },
  });
}

export async function saveCertificateTemplate(principal: Principal, templateId: string | null, input: TemplateInput) {
  const institutionId = institutionOf(principal);
  const name = input.name.trim();
  if (name.length < 2) throw new AppError('Give the template a name.', 422, 'validation_failed');
  if (!CREDENTIAL_KINDS.includes(input.kind)) throw new AppError('Choose what kind of credential it is for.', 422, 'validation_failed');
  if (input.bodyHtml.length > 2000) throw new AppError('Keep the wording under 2,000 characters.', 422, 'validation_failed');

  if (templateId) {
    const existing = await prisma.certificateTemplate.findUnique({ where: { id: templateId }, select: { institutionId: true } });
    if (!existing) throw new NotFoundError('Template');
    requireSameInstitution(principal, existing.institutionId);
  }
  const clash = await prisma.certificateTemplate.findFirst({
    where: { institutionId, name, ...(templateId ? { id: { not: templateId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new AppError('Another template already has that name.', 409, 'duplicate');

  const signatureFileId = await checkImage(principal, institutionId, input.signatureFileId);
  const backgroundFileId = await checkImage(principal, institutionId, input.backgroundFileId);
  const data = {
    name,
    kind: input.kind,
    bodyHtml: input.bodyHtml,
    signatoryName: input.signatoryName?.trim() || null,
    signatoryTitle: input.signatoryTitle?.trim() || null,
    isDefault: input.isDefault,
    ...(signatureFileId !== undefined ? { signatureFileId } : {}),
    ...(backgroundFileId !== undefined ? { backgroundFileId } : {}),
  };

  // One default per kind of credential.
  const saved = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.certificateTemplate.updateMany({
        where: { institutionId, kind: input.kind, isDefault: true, ...(templateId ? { id: { not: templateId } } : {}) },
        data: { isDefault: false },
      });
    }
    return templateId
      ? tx.certificateTemplate.update({ where: { id: templateId }, data, select: { id: true } })
      : tx.certificateTemplate.create({ data: { ...data, institutionId }, select: { id: true } });
  });

  await recordAudit(principal, {
    action: templateId ? 'certificate.template_updated' : 'certificate.template_created',
    entityType: 'CertificateTemplate',
    entityId: saved.id,
    institutionId,
    after: { name, kind: input.kind, isDefault: input.isDefault },
  });
  return saved;
}

export async function deleteCertificateTemplate(principal: Principal, templateId: string) {
  const institutionId = institutionOf(principal);
  const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId }, select: { institutionId: true, name: true } });
  if (!template) throw new NotFoundError('Template');
  requireSameInstitution(principal, template.institutionId);
  // Certificates issued with it keep their wording from the default template of their kind.
  await prisma.certificateTemplate.delete({ where: { id: templateId } });
  await recordAudit(principal, {
    action: 'certificate.template_deleted',
    entityType: 'CertificateTemplate',
    entityId: templateId,
    institutionId,
    before: { name: template.name },
  });
}
