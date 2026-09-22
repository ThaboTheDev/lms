import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadThread } from '@/server/services/messaging';
import { Panel } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ReplyForm } from '../message-forms';

export const metadata: Metadata = { title: 'Conversation' };

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const principal = await requirePrincipal();
  const { threadId } = await params;
  const thread = await loadThread(principal, threadId);

  return (
    <div className="max-w-3xl space-y-6">
      <Breadcrumbs trail={[{ label: 'Messages', href: '/messages' }, { label: thread.subject }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">{thread.subject}</h1>
        <p className="mt-1 text-sm text-muted">
          {thread.participants.map((entry) => `${entry.user.firstName} ${entry.user.lastName}`).join(', ')}
          {thread.offering ? ` · ${thread.offering.course.code}` : ''}
        </p>
      </div>

      <Panel>
        <ol className="divide-y divide-line">
          {thread.messages.map((message) => {
            const mine = message.sender.id === principal.userId;
            return (
              <li key={message.id} className="px-4 py-3">
                <p className="text-xs text-muted">
                  <span className={mine ? 'font-medium text-ink' : 'font-medium'}>
                    {mine ? 'You' : `${message.sender.firstName} ${message.sender.lastName}`}
                  </span>
                  {' · '}
                  {message.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  {message.editedAt ? ' · edited' : ''}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{message.body}</p>
                {message.attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.fileId}>
                        <a
                          href={`/api/v1/files/${attachment.fileId}/download`}
                          className="text-sm text-accent underline underline-offset-2"
                        >
                          {attachment.file.originalName}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>

        <ReplyForm threadId={threadId} />
      </Panel>
    </div>
  );
}
