import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { NotFoundError } from '@/lib/errors';
import { normaliseHost } from '@/lib/hosts';

/**
 * Public pages have no signed-in principal to take an institution from, so the
 * tenant is resolved explicitly: a slug the page was given, then the host the
 * request came in on (an institution with its own domain), then the
 * configured slug, then the single active institution on a one-institution
 * deployment. Anything ambiguous is an error rather than a guess, because
 * guessing would mean showing one institution's programmes under another's
 * name.
 */
export async function resolvePublicInstitution(slug?: string, host?: string | null) {
  const select = { id: true, slug: true, name: true, primaryColour: true, contactEmail: true } as const;

  if (slug) {
    const institution = await prisma.institution.findFirst({ where: { slug, isActive: true }, select });
    if (!institution) throw new NotFoundError('Institution');
    return institution;
  }

  const domain = normaliseHost(host);
  if (domain) {
    const institution = await prisma.institution.findFirst({ where: { domain, isActive: true }, select });
    if (institution) return institution;
  }

  if (env.PUBLIC_INSTITUTION_SLUG) {
    const institution = await prisma.institution.findFirst({
      where: { slug: env.PUBLIC_INSTITUTION_SLUG, isActive: true },
      select,
    });
    if (!institution) throw new NotFoundError('Institution');
    return institution;
  }

  const active = await prisma.institution.findMany({ where: { isActive: true }, select, take: 2 });

  if (active.length === 1) return active[0]!;
  throw new NotFoundError('Institution');
}

