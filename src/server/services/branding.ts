import 'server-only';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { BRAND } from '@/lib/brand';
import { resolvePublicInstitution } from './tenancy';

export interface Brand {
  /** The institution's own logo, or null for the built-in crest. */
  logoUrl: string | null;
  shortName: string;
  name: string;
  /** The institution's language setting, e.g. en-ZA. */
  locale: string;
}

/** Changes whenever the logo does, so browsers never hold on to an old one. */
export function logoUrlFor(institution: { id: string; logoFileId: string | null }): string | null {
  return institution.logoFileId ? `/api/v1/branding/logo?i=${institution.id}&v=${institution.logoFileId.slice(-10)}` : null;
}

/** The host a request came in on, as the reverse proxy passed it. */
export async function requestHost(): Promise<string | null> {
  const list = await headers();
  return list.get('x-forwarded-host') ?? list.get('host');
}

export async function brandFor(institutionId: string | null | undefined): Promise<Brand> {
  if (institutionId) {
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, name: true, shortName: true, logoFileId: true, locale: true },
    });
    if (institution) {
      return {
        logoUrl: logoUrlFor(institution),
        shortName: institution.shortName || BRAND.shortName,
        name: institution.name,
        locale: institution.locale,
      };
    }
  }
  return { logoUrl: null, shortName: BRAND.shortName, name: BRAND.name, locale: 'en-ZA' };
}

/** The brand for a public page: the institution this host (or deployment) belongs to, else the built-in one. */
export async function publicBrand(): Promise<Brand> {
  try {
    const institution = await resolvePublicInstitution(undefined, await requestHost());
    return await brandFor(institution.id);
  } catch {
    return brandFor(null);
  }
}
