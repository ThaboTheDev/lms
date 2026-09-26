import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { env } from '@/lib/env';

/** The check-in link as an SVG QR code. Generated on the server: nothing external is fetched. */
async function checkInQr(offeringId: string, sessionId: string, code: string): Promise<string> {
  const url = `${env.APP_URL.replace(/\/$/, '')}/courses/${offeringId}/attendance/${sessionId}?code=${encodeURIComponent(code)}`;
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadRegister } from '@/server/services/attendance';
import { checkInWindow } from '@/server/services/attendance-rules';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { CheckInForm, RegisterForm } from '../attendance-forms';

export const metadata: Metadata = { title: 'Register' };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string; sessionId: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, sessionId } = await params;
  const { code: scannedCode } = await searchParams;
  const { session, viewer } = await loadRegister(principal, sessionId);

  const window = checkInWindow(session);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: session.offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Attendance', href: `/courses/${offeringId}/attendance` },
          { label: session.title },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{session.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {session.scheduledStart.toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' })}
            {session.venue ? ` · ${session.venue}` : ''}
          </p>
        </div>
        <Tag tone={window.state === 'open' ? 'active' : 'neutral'}>
          {window.state === 'open' ? 'check-in open' : session.mode.toLowerCase().replace(/_/g, ' ')}
        </Tag>
      </div>

      {viewer === 'staff' ? (
        <>
          {session.selfCheckInEnabled && (
            <Panel title="Check-in code" description="Read this out at the start of the session, or put the QR code on the screen.">
              {session.checkInCode && (
                <div className="flex flex-wrap items-center gap-6 border-b border-line px-4 py-4">
                  {/* Scanning opens this session with the code filled in; the learner still has to be signed in and enrolled. */}
                  <div className="h-44 w-44 bg-white p-2" dangerouslySetInnerHTML={{ __html: await checkInQr(offeringId, sessionId, session.checkInCode) }} />
                  <p className="max-w-xs text-sm text-muted">Learners scan this with their phone camera, sign in if they need to, and press Check in.</p>
                </div>
              )}
              <DescriptionList
                items={[
                  { term: 'Code', value: <span className="font-serif text-2xl tracking-widest">{session.checkInCode}</span> },
                  {
                    term: 'Open until',
                    value:
                      window.state === 'open'
                        ? window.closesAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
                        : 'Closed',
                  },
                ]}
              />
            </Panel>
          )}

          <RegisterForm sessionId={sessionId} offeringId={offeringId} records={session.records as never} />
        </>
      ) : (
        <>
          {session.selfCheckInEnabled ? (
            <CheckInForm
              code={scannedCode}
              sessionId={sessionId}
              offeringId={offeringId}
              status={session.records[0]?.status ?? 'NOT_MARKED'}
            />
          ) : (
            <p className="border-l-2 border-line bg-paper px-4 py-3 text-sm text-muted">
              Your lecturer takes the register for this session.
            </p>
          )}

          <Panel title="Your attendance">
            <DescriptionList
              items={[
                {
                  term: 'Status',
                  value: (session.records[0]?.status ?? 'NOT_MARKED').toLowerCase().replace(/_/g, ' '),
                },
                {
                  term: 'Marked at',
                  value:
                    session.records[0]?.markedAt?.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) ??
                    'Not yet',
                },
              ]}
            />
          </Panel>
        </>
      )}
    </div>
  );
}
