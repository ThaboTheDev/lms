import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { NotFoundError } from '@/lib/errors';

/**
 * Public pages have no signed-in principal to take an institution from, so the
 * tenant is resolved explicitly: the configured slug first, then the single
 * active institution on a one-institution deployment. Anything ambiguous is an
 * error rather than a guess, because guessing would mean showing one
 * institution's programmes under another's name.
 *
 * TODO(phase-9): resolve from the request host as well, for white-label
 * deployments where each institution has its own domain.
 */
export async function resolvePublicInstitution(slug?: string) {
  const wanted = slug ?? env.PUBLIC_INSTITUTION_SLUG;

  if (wanted) {
    const institution = await prisma.institution.findFirst({
      where: { slug: wanted, isActive: true },
      select: { id: true, slug: true, name: true, primaryColour: true, contactEmail: true },
    });
    if (!institution) throw new NotFoundError('Institution');
    return institution;
  }

  const active = await prisma.institution.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, primaryColour: true, contactEmail: true },
    take: 2,
  });

  if (active.length === 1) return active[0]!;
  throw new NotFoundError('Institution');
}
