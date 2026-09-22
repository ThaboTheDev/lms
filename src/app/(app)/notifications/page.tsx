import type { Metadata } from 'next';
import Link from 'next/link';
import type { Route } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listNotifications, loadPreferences } from '@/server/services/notifications';
import {
  CHANNEL_DEFAULTS,
  MANDATORY_TYPES,
  type NotificationType,
} from '@/server/services/notification-rules';
import { Button, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { PreferenceRow } from './preference-form';
import { markAllRead } from './actions';

export const metadata: Metadata = { title: 'Notifications' };

const LABELS: Record<NotificationType, string> = {
  'course.published': 'A course opens',
  'assessment.published': 'An assessment is set',
  'assessment.due_soon': 'An assessment is due soon',
  'grade.released': 'A result is released',
  'announcement.published': 'An announcement is published',
  'message.received': 'Someone messages you',
  'forum.reply': 'Someone replies in a discussion',
  'attendance.flagged': 'Your attendance is flagged',
  'admission.decision': 'An admission decision is made',
  'payment.status': 'Something changes on your account',
  'certificate.issued': 'A certificate is issued',
  'system.notice': 'The institution sends a system notice',
};

export default async function NotificationsPage() {
  const principal = await requirePrincipal();
  const [notifications, preferences] = await Promise.all([
    listNotifications(principal),
    loadPreferences(principal),
  ]);

  const byType = new Map<string, { inApp: boolean; email: boolean; sms: boolean; push: boolean }>(
    (preferences as { type: string; inApp: boolean; email: boolean; sms: boolean; push: boolean }[]).map(
      (entry) => [entry.type, entry],
    ),
  );
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Notifications</h1>
          <p className="mt-1 text-sm text-muted">
            {unread > 0 ? `${unread} unread` : 'Nothing unread'}
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllRead}>
            <Button type="submit" variant="secondary" size="sm">Mark everything read</Button>
          </form>
        )}
      </div>

      <Panel title="Recent">
        {notifications.length === 0 ? (
          <EmptyState title="Nothing yet" hint="Notices about your courses and account appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={`text-sm ${notification.readAt ? '' : 'font-semibold'}`}>
                    {notification.linkUrl ? (
                      <Link href={notification.linkUrl as Route} className="text-accent underline-offset-2 hover:underline">
                        {notification.title}
                      </Link>
                    ) : (
                      notification.title
                    )}
                  </p>
                  {notification.body && <p className="mt-0.5 text-sm text-muted">{notification.body}</p>}
                  <p className="mt-0.5 text-xs text-muted">
                    {notification.createdAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                {!notification.readAt && <Tag tone="active">new</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="What you are told about"
        description="In-app notices are always kept. Email is what these settings mostly change."
      >
        <ul className="divide-y divide-line">
          {(Object.keys(CHANNEL_DEFAULTS) as NotificationType[]).map((type) => (
            <li key={type} className="px-4 py-3">
              <PreferenceRow
                type={type}
                label={LABELS[type]}
                mandatory={MANDATORY_TYPES.includes(type)}
                current={
                  byType.get(type) ?? {
                    inApp: CHANNEL_DEFAULTS[type].includes('IN_APP'),
                    email: CHANNEL_DEFAULTS[type].includes('EMAIL'),
                    sms: false,
                    push: false,
                  }
                }
              />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
