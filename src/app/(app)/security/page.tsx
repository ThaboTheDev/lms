import type { Metadata } from 'next';
import { ActionForm } from '@/components/ui/action-form';
import { changePassword, saveProfile } from './actions';
import QRCode from 'qrcode';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { generateMfaSecret, mfaUri } from '@/lib/auth/mfa';
import { Button, Panel, Tag } from '@/components/ui/primitives';
import { DescriptionList } from '@/components/ui/navigation';
import { LOCALES } from '@/lib/i18n/messages';
import { MfaSetup } from './mfa-setup';
import { signOutEverywhere, turnOffMfa } from './actions';

export const metadata: Metadata = { title: 'Account and security' };

export default async function SecurityPage() {
  const principal = await requirePrincipal();
  const profile = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { preferredName: true, phone: true, locale: true, digestFrequency: true },
  });

  const [user, sessions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        email: true, mfaEnabled: true, lastLoginAt: true, emailVerifiedAt: true,
        mfaRecoveryHashes: true,
        institution: { select: { name: true } },
      },
    }),
    prisma.session.findMany({
      where: { userId: principal.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
  ]);

  // The secret is generated per visit and only persisted once a code proves the
  // phone actually has it.
  const secret = user?.mfaEnabled ? null : generateMfaSecret();
  const uri = secret ? mfaUri(principal.email, secret, user?.institution?.name ?? 'Institution') : null;
  const qr = uri ? await QRCode.toDataURL(uri, { margin: 1, width: 200 }) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Account and security</h1>
        <p className="mt-1 text-sm text-muted">{principal.email}</p>
      </div>

      <Panel title="Your account">
        <DescriptionList
          items={[
            { term: 'Email address', value: user?.email ?? principal.email },
            {
              term: 'Email confirmed',
              value: user?.emailVerifiedAt
                ? user.emailVerifiedAt.toLocaleDateString('en-ZA', { dateStyle: 'long' })
                : 'Not yet',
            },
            {
              term: 'Last signed in',
              value: user?.lastLoginAt
                ? user.lastLoginAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
                : 'This is your first visit',
            },
            {
              term: 'Two step sign in',
              value: user?.mfaEnabled ? (
                <Tag tone="active">on</Tag>
              ) : (
                <Tag tone="caution">off</Tag>
              ),
            },
          ]}
        />
      </Panel>

      <MfaSetup secret={secret} qr={qr ?? null} uri={uri ?? null} enabled={Boolean(user?.mfaEnabled)} />

      {user?.mfaEnabled && (
        <Panel title="Two step sign in" description="A code from your phone is asked for at sign in.">
          <div className="space-y-3 px-4 py-4 text-sm">
            <p className="text-muted">
              {user.mfaRecoveryHashes.length} recovery codes are unused. Each one works once, and
              they are stored only as hashes, so nobody at the institution can read them back to
              you.
            </p>
            <form action={turnOffMfa}>
              <Button type="submit" variant="secondary" size="sm">
                Turn two step sign in off
              </Button>
            </form>
          </div>
        </Panel>
      )}

      <Panel title="Where you are signed in" description={`${sessions.length} active sessions`}>
        <ul className="divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.id} className="px-4 py-3 text-sm">
              <p>{session.userAgent?.slice(0, 80) ?? 'Unknown device'}</p>
              <p className="text-xs text-muted">
                started {session.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                {' · last used '}
                {session.lastSeenAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </li>
          ))}
        </ul>

        <form action={signOutEverywhere} className="border-t border-line px-4 py-4">
          <p className="mb-3 text-sm text-muted">
            Signing out everywhere ends every session including this one. Use it if you think
            somebody else has your password.
          </p>
          <Button type="submit" variant="danger" size="sm">
            Sign out everywhere
          </Button>
        </form>
      </Panel>

      <ActionForm
        title="Change your password"
        description="Every other session is signed out when it changes."
        action={changePassword}
        submitLabel="Change password"
        columns={3}
        fields={[
          { name: 'currentPassword', label: 'Current password', type: 'password', required: true },
          { name: 'newPassword', label: 'New password', type: 'password', required: true, hint: 'At least 12 characters; a phrase of a few words works well' },
          { name: 'confirmPassword', label: 'New password again', type: 'password', required: true },
        ]}
      />

      <ActionForm
        title="Your details"
        action={saveProfile}
        submitLabel="Save"
        fields={[
          { name: 'preferredName', label: 'Preferred name', defaultValue: profile?.preferredName ?? '', hint: 'What people here call you' },
          { name: 'phone', label: 'Phone', type: 'text', defaultValue: profile?.phone ?? '', hint: 'Used for text messages, if your institution sends them' },
          {
            name: 'locale',
            label: 'Language',
            type: 'select',
            defaultValue: profile?.locale ?? '',
            options: [{ value: '', label: 'The institution’s language' }, ...Object.entries(LOCALES).map(([value, label]) => ({ value, label }))],
          },
          {
            name: 'digestFrequency',
            label: 'Email about notices',
            type: 'select',
            defaultValue: profile?.digestFrequency ?? 'OFF',
            options: [
              { value: 'OFF', label: 'As they happen' },
              { value: 'DAILY', label: 'One summary a day' },
              { value: 'WEEKLY', label: 'One summary a week' },
            ],
            hint: 'Security notices always come straight away',
          },
        ]}
      />

      <Panel title="Your information">
        <div className="space-y-3 px-4 py-4 text-sm">
          <p className="text-muted">
            You can ask for a copy of everything the institution holds about you. The registry
            prepares it and sends it to the address on your account.
          </p>
          <a href="/api/v1/me/export" download className="inline-block">
            <Button variant="secondary" size="sm" type="button">
              Download my information
            </Button>
          </a>
        </div>
      </Panel>
    </div>
  );
}
