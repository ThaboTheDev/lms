/**
 * src/server/services/open-badges.ts
 *
 * Open Badges 2.0 hosted verification for issued credentials, so a learner can
 * put a credential in a badge wallet or on a professional profile and anyone
 * can check it against the institution. The recipient is identified by a
 * salted hash of their email, never the address itself, and a revoked
 * credential says so in its assertion.
 */
import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { NotFoundError } from '@/lib/errors';

const CONTEXT = 'https://w3id.org/openbadges/v2';

function base(code: string) {
  return `${env.APP_URL.replace(/\/$/, '')}/api/v1/badges/${encodeURIComponent(code)}`;
}

async function load(code: string) {
  const certificate = await prisma.certificate.findUnique({
    where: { verificationCode: code },
    select: {
      id: true, title: true, kind: true, status: true, revokedReason: true, issuedOn: true, completionDate: true, verificationCode: true,
      student: { select: { user: { select: { email: true } } } },
      institution: { select: { name: true, contactEmail: true, primaryColour: true } },
      qualification: { select: { title: true, nqfLevel: true } },
    },
  });
  if (!certificate || certificate.status === 'DRAFT') throw new NotFoundError('Credential');
  return certificate;
}

export async function badgeAssertion(code: string) {
  const certificate = await load(code);
  // Stable per credential and unguessable without the server secret.
  const salt = createHmac('sha256', env.AUTH_SECRET).update(`badge-salt:${certificate.id}`).digest('hex').slice(0, 16);
  const identity = `sha256$${createHash('sha256').update(certificate.student.user.email.toLowerCase() + salt).digest('hex')}`;
  return {
    '@context': CONTEXT,
    type: 'Assertion',
    id: base(code),
    recipient: { type: 'email', hashed: true, salt, identity },
    badge: `${base(code)}/class`,
    verification: { type: 'hosted' },
    issuedOn: certificate.issuedOn.toISOString(),
    evidence: `${env.APP_URL.replace(/\/$/, '')}/verify/${encodeURIComponent(certificate.verificationCode)}`,
    ...(certificate.status === 'REVOKED' ? { revoked: true, revocationReason: certificate.revokedReason ?? 'Revoked by the institution' } : {}),
  };
}

export async function badgeClass(code: string) {
  const certificate = await load(code);
  const colour = /^#[0-9a-f]{6}$/i.test(certificate.institution.primaryColour) ? certificate.institution.primaryColour : '#0B113B';
  const initials = certificate.title.split(/\s+/).filter(Boolean).slice(0, 3).map((word) => word[0]!.toUpperCase()).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="120" fill="${colour}"/><circle cx="128" cy="128" r="104" fill="none" stroke="#CBA65E" stroke-width="6"/><text x="128" y="148" font-family="Georgia, serif" font-size="64" fill="#ffffff" text-anchor="middle">${initials.replace(/[<>&"]/g, '')}</text></svg>`;
  return {
    '@context': CONTEXT,
    type: 'BadgeClass',
    id: `${base(code)}/class`,
    name: certificate.title,
    description: certificate.qualification
      ? `${certificate.qualification.title}${certificate.qualification.nqfLevel ? `, NQF level ${certificate.qualification.nqfLevel}` : ''}, awarded by ${certificate.institution.name}.`
      : `${certificate.kind.toLowerCase().replace(/_/g, ' ')} awarded by ${certificate.institution.name}.`,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    criteria: { narrative: `Awarded on completing the requirements for ${certificate.title}, confirmed on ${certificate.completionDate.toISOString().slice(0, 10)}.` },
    issuer: `${base(code)}/issuer`,
  };
}

export async function badgeIssuer(code: string) {
  const certificate = await load(code);
  return {
    '@context': CONTEXT,
    type: 'Issuer',
    id: `${base(code)}/issuer`,
    name: certificate.institution.name,
    url: env.APP_URL,
    ...(certificate.institution.contactEmail ? { email: certificate.institution.contactEmail } : {}),
  };
}
