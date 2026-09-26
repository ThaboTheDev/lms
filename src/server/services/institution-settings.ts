import 'server-only';
import { normaliseHost } from '@/lib/hosts';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';

/**
 * Institution profile, branding and contact details.
 *
 * These fields are not decoration: the colours carry into every signed-in
 * screen, the certificate prefix goes onto a document a graduate hands to an
 * employer, and the reply-to address is what every automated email the platform
 * sends will carry. Changing them is therefore an audited act rather than a
 * preference.
 */

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export interface InstitutionSettingsInput {
  name: string;
  shortName?: string | null;
  registrationNo?: string | null;
  accreditationNo?: string | null;
  primaryColour: string;
  secondaryColour: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  emailFromName?: string | null;
  emailFromAddress?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country: string;
  timezone: string;
  locale: string;
  currency: string;
  certificatePrefix: string;
  footerText?: string | null;
  /** The host name public pages answer on for this institution; blank for none. */
  domain?: string | null;
}

export async function getInstitutionSettings(principal: Principal) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'settings.manage', { institutionId });

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw new NotFoundError('Institution');
  return institution;
}

export async function updateInstitutionSettings(
  principal: Principal,
  input: InstitutionSettingsInput,
) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'settings.manage', { institutionId });

  const name = input.name.trim();
  if (name.length < 2) throw new AppError('The institution needs a name.', 422, 'validation_failed');

  const primaryColour = input.primaryColour.trim();
  const secondaryColour = input.secondaryColour.trim();
  if (!HEX_COLOUR.test(primaryColour) || !HEX_COLOUR.test(secondaryColour)) {
    throw new AppError('Colours must be six digit hex values, such as #0B113B.', 422, 'validation_failed');
  }

  const certificatePrefix = input.certificatePrefix.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(certificatePrefix)) {
    throw new AppError(
      'The certificate prefix is two to eight letters or numbers, because it is printed on every certificate.',
      422,
      'validation_failed',
    );
  }

  const emailFromAddress = normaliseOptional(input.emailFromAddress);
  if (emailFromAddress && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailFromAddress)) {
    throw new AppError('Enter a valid address for automated email.', 422, 'validation_failed');
  }

  const rawDomain = normaliseOptional(input.domain ?? null);
  const domain = rawDomain ? normaliseHost(rawDomain) : null;
  if (rawDomain && !domain) {
    throw new AppError('Enter the host name only, such as learn.example.ac.za.', 422, 'validation_failed');
  }
  if (domain) {
    const taken = await prisma.institution.findFirst({ where: { domain, id: { not: institutionId } }, select: { id: true } });
    if (taken) throw new AppError('Another institution on this system already uses that host name.', 409, 'domain_taken');
  }

  const before = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!before) throw new NotFoundError('Institution');

  const updated = await prisma.institution.update({
    where: { id: institutionId },
    data: {
      name,
      shortName: normaliseOptional(input.shortName),
      registrationNo: normaliseOptional(input.registrationNo),
      accreditationNo: normaliseOptional(input.accreditationNo),
      primaryColour,
      secondaryColour,
      contactEmail: normaliseOptional(input.contactEmail),
      contactPhone: normaliseOptional(input.contactPhone),
      emailFromName: normaliseOptional(input.emailFromName),
      emailFromAddress,
      addressLine1: normaliseOptional(input.addressLine1),
      addressLine2: normaliseOptional(input.addressLine2),
      city: normaliseOptional(input.city),
      province: normaliseOptional(input.province),
      postalCode: normaliseOptional(input.postalCode),
      country: input.country.trim().toUpperCase().slice(0, 2) || before.country,
      timezone: input.timezone.trim() || before.timezone,
      locale: input.locale.trim() || before.locale,
      currency: input.currency.trim().toUpperCase().slice(0, 3) || before.currency,
      certificatePrefix,
      footerText: normaliseOptional(input.footerText),
      ...(input.domain !== undefined ? { domain } : {}),
    },
    select: { id: true, name: true, primaryColour: true, secondaryColour: true },
  });

  await recordAudit(principal, {
    action: 'institution.settings_updated',
    entityType: 'Institution',
    entityId: institutionId,
    institutionId,
    before: {
      name: before.name,
      primaryColour: before.primaryColour,
      contactEmail: before.contactEmail,
      certificatePrefix: before.certificatePrefix,
    },
    after: {
      name: updated.name,
      primaryColour: updated.primaryColour,
      contactEmail: emailFromAddress,
      certificatePrefix,
    },
  });

  return updated;
}

/** Empty strings are how a cleared input arrives; they mean "no value". */
function normaliseOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Sets (or, with null, removes) the logo shown on every screen, email and certificate. */
export async function setInstitutionLogo(principal: Principal, fileId: string | null) {
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');
  requirePermission(principal, 'settings.manage', { institutionId });

  if (fileId) {
    const file = await prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { institutionId: true, uploadedById: true, mimeType: true, sizeBytes: true },
    });
    if (!file || file.institutionId !== institutionId || file.uploadedById !== principal.userId) {
      throw new AppError('Upload the logo first.', 422, 'no_file');
    }
    if (!LOGO_TYPES.has(file.mimeType)) throw new AppError('The logo must be a PNG, JPEG, WebP or GIF image.', 422, 'validation_failed');
    if (Number(file.sizeBytes) > 2 * 1024 * 1024) throw new AppError('Keep the logo under 2 MB.', 422, 'validation_failed');
  }

  const before = await prisma.institution.findUnique({ where: { id: institutionId }, select: { logoFileId: true } });
  await prisma.institution.update({ where: { id: institutionId }, data: { logoFileId: fileId } });
  await recordAudit(principal, {
    action: fileId ? 'institution.logo_set' : 'institution.logo_removed',
    entityType: 'Institution',
    entityId: institutionId,
    institutionId,
    before: { logoFileId: before?.logoFileId ?? null },
    after: { logoFileId: fileId },
  });
}
