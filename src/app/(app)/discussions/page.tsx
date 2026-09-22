import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listThreads } from '@/server/services/forums';
import { viewerContext } from '@/server/services/calendar';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { Button } from '@/components/ui/primitives';
import { NewThreadForm } from './discussion-forms';

export const metadata: Metadata = { title: 'Discussions' };

export default async function DiscussionsPage({
  searchParams,
}: {
  searchParams: Promise<{ forum?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const viewer = await viewerContext(principal);

  const forums = await prisma.forum.findMany({
    where: {
      institutionId: principal.institutionId ?? undefined,
      ...(viewer.seesEverything ? {} : { offeringId: { in: viewer.offeringIds } }),
    },
    orderBy: { title: 'asc' },
    select: {
      id: true,
      title: true,
      isLocked: true,
      offering: { select: { course: { select: { code: true } } } },
      _count: { select: { threads: true } },
    },
  });

  const forumId = params.forum ?? forums[0]?.id;

  if (!forumId) {
    return (
      <Panel title="Discussions">
        <EmptyState
          title="No discussions yet"
          hint="A discussion is created for each course you teach or take."
        />
      </Panel>
    );
  }

  const { forum, threads, canModerate } = await listThreads(principal, forumId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Discussions</h1>
          <p className="mt-1 text-sm text-muted">{forum.title}</p>
        </div>
        {forums.length > 1 && (
          <form className="flex items-end gap-2">
            <div>
              <label htmlFor="forum" className="block text-sm font-medium">Course</label>
              <Select id="forum" name="forum" defaultValue={forumId} className="mt-1 h-9 w-56">
                {forums.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.offering?.course.code ?? entry.title}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary" size="sm">Open</Button>
          </form>
        )}
      </div>

      <Panel title="Threads" description={`${threads.length} in this discussion`}>
        {threads.length === 0 ? (
          <EmptyState title="Nothing asked yet" hint="Start the first thread below." />
        ) : (
          <ul className="divide-y divide-line">
            {threads.map((thread) => (
              <li key={thread.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/discussions/${thread.id}`}
                    className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {thread.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {thread.author.firstName} {thread.author.lastName} ·{' '}
                    {thread._count.posts} {thread._count.posts === 1 ? 'post' : 'posts'} · last activity{' '}
                    {thread.lastPostAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {thread.isPinned && <Tag tone="active">pinned</Tag>}
                  {thread.isLocked && <Tag tone="caution">closed</Tag>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {!forum.isLocked && (
        <NewThreadForm forumId={forumId} announcementOnly={forum.isAnnouncementOnly && !canModerate} />
      )}
    </div>
  );
}
