import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listAnnouncements } from '@/server/services/announcements';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { AnnouncementForm } from './announcement-form';

export const metadata: Metadata = { title: 'Announcements' };

export default async function AnnouncementsPage() {
  const principal = await requirePrincipal();
  const announcements = await listAnnouncements(principal);

  const canPublish = can(principal, 'announcement.publish');

  const [offerings, programmes] = canPublish
    ? await Promise.all([
        prisma.courseOffering.findMany({
          where: { institutionId: principal.institutionId ?? undefined, status: { in: ['OPEN', 'ACTIVE'] } },
          select: { id: true, course: { select: { code: true, title: true } } },
          orderBy: { course: { code: 'asc' } },
        }),
        prisma.programme.findMany({
          where: { institutionId: principal.institutionId ?? undefined, isActive: true },
          select: { id: true, code: true, title: true },
          orderBy: { code: 'asc' },
        }),
      ])
    : [[], []];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Announcements</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Notices from the institution and from the courses you belong to.
        </p>
      </div>

      <Panel>
        {announcements.length === 0 ? (
          <EmptyState title="Nothing announced" hint="Announcements from your institution appear here." />
        ) : (
          <ol className="divide-y divide-line">
            {announcements.map((announcement) => (
              <li key={announcement.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-serif text-base font-semibold">{announcement.title}</h2>
                  <div className="flex items-center gap-2">
                    {announcement.isPinned && <Tag tone="active">pinned</Tag>}
                    <span className="text-xs tabular-nums text-muted">
                      {announcement.publishedAt?.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {announcement.offering?.course.code ??
                    announcement.programme?.code ??
                    'Everyone at the institution'}
                </p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{announcement.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {canPublish && (
        <AnnouncementForm
          offerings={offerings.map((offering) => ({
            id: offering.id,
            label: `${offering.course.code} · ${offering.course.title}`,
          }))}
          programmes={programmes.map((programme) => ({
            id: programme.id,
            label: `${programme.code} · ${programme.title}`,
          }))}
        />
      )}
    </div>
  );
}
