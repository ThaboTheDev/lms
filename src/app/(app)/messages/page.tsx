import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listThreads, messageableUsers } from '@/server/services/messaging';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { NewMessageForm } from './message-forms';

export const metadata: Metadata = { title: 'Messages' };

export default async function MessagesPage() {
  const principal = await requirePrincipal();
  const [threads, recipients] = await Promise.all([
    listThreads(principal),
    messageableUsers(principal),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Messages</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Private conversations with the staff responsible for you. Questions the whole class would
          benefit from belong in the course discussion instead.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Conversations">
          {threads.length === 0 ? (
            <EmptyState title="No conversations yet" hint="Start one on the right." />
          ) : (
            <ul className="divide-y divide-line">
              {threads.map((thread) => (
                <li key={thread.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/messages/${thread.id}`}
                        className={`text-sm underline-offset-2 hover:underline ${thread.unread ? 'font-semibold text-ink' : 'text-accent'}`}
                      >
                        {thread.subject}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {thread.others.map((other) => `${other.user.firstName} ${other.user.lastName}`).join(', ')}
                        {thread.offering ? ` · ${thread.offering.course.code}` : ''}
                      </p>
                      <p className="mt-1 truncate text-sm text-muted">{thread.preview}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-xs tabular-nums text-muted">
                        {thread.lastMessageAt.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}
                      </span>
                      {thread.unread && <Tag tone="active">new</Tag>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="New message">
          <div className="px-4 py-4">
            <NewMessageForm recipients={recipients} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
