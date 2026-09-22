import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { Panel, Tag } from '@/components/ui/primitives';
import { listAnnouncements } from '@/server/services/announcements';
import { upcomingForPrincipal } from '@/server/services/calendar';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * One dashboard route, three audiences. The counts a person sees are the ones
 * their permissions allow, which keeps a learner from inferring institutional
 * figures from a shared page.
 */
export default async function DashboardPage() {
  const principal = await requirePrincipal();
  const institutionId = principal.institutionId ?? undefined;

  const showInstitutional = can(principal, 'report.read');

  const [students, activeOfferings, pendingPops, openTickets] = await Promise.all([
    showInstitutional && institutionId
      ? prisma.studentProfile.count({ where: { institutionId, admissionStatus: 'REGISTERED' } })
      : Promise.resolve(null),
    showInstitutional && institutionId
      ? prisma.courseOffering.count({ where: { institutionId, status: 'ACTIVE' } })
      : Promise.resolve(null),
    can(principal, 'pop.review') && institutionId
      ? prisma.proofOfPayment.count({ where: { institutionId, status: { in: ['PENDING', 'UNDER_REVIEW'] } } })
      : Promise.resolve(null),
    can(principal, 'ticket.read') && institutionId
      ? prisma.supportTicket.count({ where: { institutionId, status: { in: ['OPEN', 'IN_PROGRESS'] } } })
      : Promise.resolve(null),
  ]);

  const [announcements, upcomingEvents] = await Promise.all([
    listAnnouncements(principal, 4),
    upcomingForPrincipal(principal),
  ]);

  const metrics = [
    { label: 'Registered students', value: students },
    { label: 'Courses running', value: activeOfferings },
    { label: 'Payments awaiting review', value: pendingPops },
    { label: 'Open support tickets', value: openTickets },
  ].filter((metric) => metric.value !== null);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg bg-navy px-6 py-7 text-white shadow-card">
        <p className="eyebrow eyebrow-on-navy">
          {BRAND.shortName} · Est. {BRAND.established}
        </p>
        <h1 className="band-title font-sans text-2xl font-bold text-white">
          Good day, {principal.displayName}
        </h1>
        <p className="mt-1 text-sm text-slate-300">
          {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </section>

      {metrics.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="relative overflow-hidden rounded-md border border-line bg-surface px-4 py-5 shadow-card">
              <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gold" />
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{metric.label}</p>
              <p className="mt-1 font-sans text-3xl font-bold tabular-nums text-gold-ink">{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Coming up"
          description="The next two weeks, from the courses and programmes you belong to."
          action={
            <Link href="/calendar" className="text-sm text-accent underline underline-offset-2">
              Calendar
            </Link>
          }
        >
          {upcomingEvents.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Nothing is scheduled.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcomingEvents.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    {event.title}
                    {event.location && <span className="block text-xs text-muted">{event.location}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {event.startsAt.toLocaleString('en-ZA', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Announcements"
          description="From your institution and your courses."
          action={
            <Link href="/announcements" className="text-sm text-accent underline underline-offset-2">
              All
            </Link>
          }
        >
          {announcements.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No announcements have been published yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{announcement.title}</p>
                    {announcement.isPinned && <Tag tone="active">pinned</Tag>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-muted">{announcement.body}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {announcement.publishedAt?.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
