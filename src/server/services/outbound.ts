/**
 * src/server/services/outbound.ts
 *
 * Email to people the notification system cannot reach: an applicant has no
 * account, and a newly registered learner has an account they cannot sign in
 * to until they have chosen a password. Messages go through the queue, so a
 * slow mail server never holds a request open, and they carry the
 * institution's own sender identity when it has one.
 */
import 'server-only';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { issueToken } from '@/lib/auth/tokens';
import { escapeHtml, wrapEmail, type OutboundEmail } from '@/lib/mail';
import { queue } from '@/lib/queue';

const APPLICATION_STATUS_WORDS: Record<string, string> = {
  SUBMITTED: 'received',
  UNDER_REVIEW: 'under review',
  DOCUMENTS_OUTSTANDING: 'waiting for documents from you',
  INTERVIEW: 'at the interview stage',
  CONDITIONAL_OFFER: 'successful, with conditions',
  OFFER: 'successful: we are offering you a place',
  ACCEPTED: 'accepted',
  DECLINED: 'closed, because you declined the offer',
  REJECTED: 'unsuccessful',
  WITHDRAWN: 'withdrawn',
  ENROLLED: 'complete: you are now registered',
};

function paragraph(text: string) {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(text)}</p>`;
}

function senderFor(institution: { emailFromName: string | null; emailFromAddress: string | null } | null) {
  return institution?.emailFromAddress && institution.emailFromName
    ? `${institution.emailFromName} <${institution.emailFromAddress}>`
    : undefined;
}

function appUrl(path: string) {
  return `${env.APP_URL.replace(/\/$/, '')}${path}`;
}

/** Hands an email to the queue; the worker (or the in-process driver) sends it. */
export async function queueMail(message: OutboundEmail) {
  await queue.enqueue('mail.send', message as unknown as Record<string, unknown>);
}

/**
 * Issues a single-use invitation link and emails it. The account stays INVITED
 * until the link is used to choose a password, which also activates it.
 */
export async function sendInvitation(userId: string, invitedBy: string | null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      status: true,
      institution: { select: { name: true, emailFromName: true, emailFromAddress: true, footerText: true } },
    },
  });
  if (!user || user.status !== 'INVITED') return { sent: false };

  const { token } = await issueToken(user.id, 'INVITATION');
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  const institutionName = user.institution?.name ?? env.APP_NAME;
  const who = invitedBy ? `${invitedBy} has created an account for you.` : `An account has been created for you at ${institutionName}.`;

  await queueMail({
    to: user.email,
    subject: `Your ${institutionName} account`,
    html: wrapEmail(
      institutionName,
      'Set up your account',
      `${paragraph(`Hello ${user.firstName},`)}
       ${paragraph(`${who} Choose a password and it is ready to use.`)}
       <p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="color:#0e5c4a">Choose your password</a></p>
       <p style="margin:0;font-size:13px;color:#5b6b70">The link expires in seven days and works once. If it has expired, use "Forgot your password?" on the sign-in page.</p>`,
      user.institution?.footerText ?? undefined,
    ),
    text: `Hello ${user.firstName},\n\n${who} Choose a password here: ${link}\n\nThe link expires in seven days and works once.`,
    from: senderFor(user.institution),
  });
  return { sent: true };
}

/** Tells an applicant where their application stands. They have no account, so this is email only. */
export async function emailApplicant(applicationId: string, note?: string | null) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      referenceNumber: true,
      firstName: true,
      email: true,
      status: true,
      conditions: true,
      programme: { select: { title: true } },
      institution: { select: { name: true, emailFromName: true, emailFromAddress: true, footerText: true, contactEmail: true } },
    },
  });
  if (!application) return { sent: false };

  const institutionName = application.institution.name;
  const words = APPLICATION_STATUS_WORDS[application.status] ?? application.status.toLowerCase().replace(/_/g, ' ');
  const received = application.status === 'SUBMITTED';
  const heading = received ? 'We have your application' : 'An update on your application';
  const lines = [
    `Hello ${application.firstName},`,
    received
      ? `Thank you for applying for ${application.programme.title}. Your reference number is ${application.referenceNumber}; quote it whenever you contact us.`
      : `Your application ${application.referenceNumber} for ${application.programme.title} is now ${words}.`,
    ...(application.status === 'CONDITIONAL_OFFER' && application.conditions ? [`Conditions: ${application.conditions}`] : []),
    ...(note && !received ? [note] : []),
    received ? 'We will email you as it moves along.' : '',
    application.institution.contactEmail ? `Questions? Write to ${application.institution.contactEmail}.` : '',
  ].filter(Boolean);

  await queueMail({
    to: application.email,
    subject: received
      ? `Application received: ${application.referenceNumber}`
      : `Your application ${application.referenceNumber}: ${words}`,
    html: wrapEmail(institutionName, heading, lines.map(paragraph).join('\n'), application.institution.footerText ?? undefined),
    text: lines.join('\n\n'),
    from: senderFor(application.institution),
  });
  return { sent: true };
}
