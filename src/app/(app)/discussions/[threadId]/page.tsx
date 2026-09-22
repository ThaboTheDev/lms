import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadThread } from '@/server/services/forums';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ReplyForm, ReportButton } from '../discussion-forms';
import { moderate, togglePostVisibility } from '../actions';

export const metadata: Metadata = { title: 'Discussion' };

function ModerationButton({
  action,
  fields,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
}) {
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button type="submit" className="rounded px-2 py-1 text-xs text-muted hover:bg-ink/5">
        {label}
      </button>
    </form>
  );
}

export default async function DiscussionThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const principal = await requirePrincipal();
  const { threadId } = await params;
  const { thread, forum, canModerate } = await loadThread(principal, threadId);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Discussions', href: '/discussions' },
          { label: forum.title, href: `/discussions?forum=${forum.id}` },
          { label: thread.title },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{thread.title}</h1>
          <p className="mt-1 text-sm text-muted">
            Started by {thread.author.firstName} {thread.author.lastName} on{' '}
            {thread.createdAt.toLocaleDateString('en-ZA', { dateStyle: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {thread.isPinned && <Tag tone="active">pinned</Tag>}
          {thread.isLocked && <Tag tone="caution">closed</Tag>}
          {canModerate && (
            <>
              <ModerationButton
                action={moderate}
                fields={{ threadId, action: thread.isPinned ? 'unpin' : 'pin' }}
                label={thread.isPinned ? 'Unpin' : 'Pin'}
              />
              <ModerationButton
                action={moderate}
                fields={{ threadId, action: thread.isLocked ? 'unlock' : 'lock' }}
                label={thread.isLocked ? 'Reopen' : 'Close'}
              />
            </>
          )}
        </div>
      </div>

      <Panel>
        <ol className="divide-y divide-line">
          {thread.posts.map((post) => (
            <li key={post.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted">
                  <span className="font-medium text-ink">
                    {post.author.firstName} {post.author.lastName}
                  </span>
                  {' · '}
                  {post.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  {post.editedAt ? ' · edited' : ''}
                </p>
                {canModerate && (
                  <ModerationButton
                    action={togglePostVisibility}
                    fields={{ postId: post.id, threadId, hidden: String(!post.isHidden) }}
                    label={post.isHidden ? 'Restore' : 'Hide'}
                  />
                )}
              </div>

              <p className={`mt-1 whitespace-pre-line text-sm leading-relaxed ${post.isHidden ? 'text-muted' : ''}`}>
                {post.body}
              </p>

              {post.author.id !== principal.userId && !post.isHidden && (
                <div className="mt-2">
                  <ReportButton postId={post.id} />
                </div>
              )}
            </li>
          ))}
        </ol>

        {!thread.isLocked || canModerate ? (
          <ReplyForm threadId={threadId} />
        ) : (
          <p className="border-t border-line px-4 py-4 text-sm text-muted">
            This thread is closed to new replies.
          </p>
        )}
      </Panel>
    </div>
  );
}
