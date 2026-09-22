import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadRegister } from '@/server/services/attendance';
import { checkInWindow } from '@/server/services/attendance-rules';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList } from '@/components/ui/navigation';
import { CheckInForm, RegisterForm } from '../attendance-forms';

export const metadata: Metadata = { title: 'Register' };

export default async function SessionPage({
  params,
}: {
  params: Promise<{ offeringId: string; sessionId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, sessionId } = await params;
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
            <Panel title="Check-in code" description="Read this out at the start of the session.">
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
