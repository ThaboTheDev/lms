import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadLesson } from '@/server/services/learning';
import { humanFileSize, isPreviewable } from '@/lib/storage/keys';
import { env } from '@/lib/env';
import { parseEmbedOrigins, toEmbed } from '@/lib/embed';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { LessonTracker } from './lesson-tracker';
import { resolveLessonLink, type ResolvedLink } from '@/server/services/lesson-links';
import { isLinkableType } from '@/lib/lesson-links';
import { PackagePlayer } from './package-player';
import { packageLaunchUrl } from '@/server/services/packages';

export const metadata: Metadata = { title: 'Lesson' };

interface Block {
  id: string;
  kind: string;
  richText: unknown;
  url: string | null;
  settings: unknown;
  file: { id: string; originalName: string; mimeType: string; sizeBytes: bigint; scanStatus: string } | null;
}

/**
 * Blocks are rendered by kind. Rich text is stored as a document rather than
 * raw HTML, and only its paragraphs are rendered here, so authored content
 * cannot inject markup into another learner's page.
 */
function BlockView({ block }: { block: Block }) {
  if (block.kind === 'RICH_TEXT') {
    const doc = block.richText as { blocks?: { text: string }[] } | null;
    return (
      <div className="max-w-prose space-y-3 px-4 py-4 text-sm leading-relaxed">
        {(doc?.blocks ?? []).map((paragraph, index) => (
          <p key={index}>{paragraph.text}</p>
        ))}
      </div>
    );
  }

  if (block.kind === 'CALLOUT') {
    const doc = block.richText as { text?: string } | null;
    return (
      <p className="mx-4 my-4 border-l-2 border-accent bg-accent/5 px-4 py-3 text-sm">{doc?.text}</p>
    );
  }

  if (block.kind === 'EMBED') {
    const embed = toEmbed(block.url, parseEmbedOrigins(env.EMBED_ALLOWED_ORIGINS));
    if (embed) {
      return (
        <div className="px-4 py-4">
          <div className="relative aspect-video w-full max-w-3xl border border-line bg-paper">
            {/* Sandboxed: the player keeps its own origin and can run, but
                cannot navigate this page or reach its cookies. */}
            <iframe
              src={embed.src}
              title={`${embed.provider} content`}
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {embed.provider} ·{' '}
            <a href={block.url ?? '#'} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              open it in a new tab
            </a>{' '}
            if it does not load.
          </p>
        </div>
      );
    }
  }

  if (block.kind === 'LINK' || block.kind === 'EMBED') {
    return (
      <p className="px-4 py-4 text-sm">
        <a
          href={block.url ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2"
        >
          {block.url}
        </a>
        <span className="block text-xs text-muted">
          {block.kind === 'EMBED' ? 'This site cannot be shown inside the lesson, so it opens in a new tab.' : 'Opens in a new tab.'}
        </span>
      </p>
    );
  }

  if (!block.file) return null;

  if (block.file.scanStatus === 'INFECTED') {
    return (
      <p className="px-4 py-4 text-sm text-danger">
        This file was withheld by the malware scan. Your lecturer has been notified.
      </p>
    );
  }

  const href = `/api/v1/files/${block.file.id}/download`;

  if (block.file.mimeType.startsWith('video/')) {
    return (
      <div className="px-4 py-4">
        {/* Captions are the uploader's responsibility, a known gap recorded in
            docs/ACCESSIBILITY.md rather than something the player can fix. */}
        <video controls preload="metadata" className="w-full max-w-3xl bg-ink" src={href} />
        <p className="mt-2 text-xs text-muted">
          {block.file.originalName} · {humanFileSize(block.file.sizeBytes)}
        </p>
      </div>
    );
  }

  if (block.file.mimeType.startsWith('audio/')) {
    return (
      <div className="px-4 py-4">
        <audio controls preload="metadata" className="w-full max-w-xl" src={href} />
        <p className="mt-2 text-xs text-muted">{block.file.originalName}</p>
      </div>
    );
  }

  if (block.file.mimeType.startsWith('image/')) {
    return (
      <figure className="px-4 py-4">
        {/* Not next/image: these bytes live in object storage and are served by
            a signed URL, so routing them through the image optimiser would put
            the application back in the data path. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={block.file.originalName} className="max-w-full border border-line" />
      </figure>
    );
  }

  return (
    <p className="px-4 py-4 text-sm">
      <a href={href} className="text-accent underline underline-offset-2">
        {block.file.originalName}
      </a>
      <span className="block text-xs text-muted">
        {humanFileSize(block.file.sizeBytes)}
        {isPreviewable(block.file.mimeType) ? ' · opens in your browser' : ' · downloads'}
        {block.file.scanStatus === 'PENDING' ? ' · awaiting virus scan' : ''}
      </span>
    </p>
  );
}

const LIVE_PROVIDER: Record<string, string> = {
  ZOOM: 'Zoom',
  MICROSOFT_TEAMS: 'Microsoft Teams',
  GOOGLE_MEET: 'Google Meet',
  JITSI: 'Jitsi Meet',
  OTHER: 'online',
};

/** Where a live class stands now: joinable from 15 minutes before, over once it ends. */
function liveWindow(startsAt: Date, endsAt: Date, at = new Date()) {
  return {
    joinable: at.getTime() >= startsAt.getTime() - 15 * 60_000 && at <= endsAt,
    over: at > endsAt,
  };
}

const LINK_NOUN: Record<string, string> = {
  LIVE_SESSION: 'live class',
  ASSESSMENT: 'assessment',
  DISCUSSION: 'discussion',
  SURVEY: 'survey',
  SCORM: 'interactive package',
  H5P: 'activity',
};

/** The thing a live class, assessment, discussion, survey or package lesson opens. */
function LinkedActivity({
  linked,
  lessonType,
  viewerIsStaff,
  launchUrl,
}: {
  linked: ResolvedLink | null;
  lessonType: string;
  viewerIsStaff: boolean;
  launchUrl: string | null;
}) {
  const noun = LINK_NOUN[lessonType] ?? 'activity';
  const box = 'border border-line bg-surface px-4 py-4';
  const button =
    'inline-flex h-9 items-center rounded bg-[rgb(var(--brand))] px-4 text-sm font-medium text-white hover:opacity-90';

  if (!linked || linked.kind === 'missing') {
    return (
      <p className={`${box} text-sm text-muted`}>
        {linked?.kind === 'missing'
          ? `The ${noun} this lesson pointed to has been removed.`
          : `This lesson has not been linked to its ${noun} yet.`}
        {viewerIsStaff ? ' Choose it in the course builder.' : ''}
      </p>
    );
  }

  if (linked.kind === 'live') {
    const { joinable, over } = liveWindow(linked.startsAt, linked.endsAt);
    return (
      <div className={box}>
        <p className="text-xs uppercase tracking-wide text-muted">Live class · {LIVE_PROVIDER[linked.provider] ?? linked.provider}</p>
        <p className="mt-1 font-medium">{linked.title}</p>
        <p className="text-sm text-muted">
          {linked.startsAt.toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' })} to{' '}
          {linked.endsAt.toLocaleTimeString('en-ZA', { timeStyle: 'short' })}
          {linked.passcode ? ` · passcode ${linked.passcode}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          {linked.joinUrl && !over && (
            <a href={linked.joinUrl} target="_blank" rel="noopener noreferrer" className={button}>
              {joinable ? 'Join now' : 'Join link'}
            </a>
          )}
          {!joinable && !over && <span className="text-muted">The link works from 15 minutes before the start.</span>}
          {over && linked.recordingUrl && (
            <a href={linked.recordingUrl} target="_blank" rel="noopener noreferrer" className={button}>
              Watch the recording
            </a>
          )}
          {over && !linked.recordingUrl && <span className="text-muted">This class has ended. A recording appears here if one is added.</span>}
        </div>
      </div>
    );
  }

  if (linked.kind === 'assessment') {
    return (
      <div className={box}>
        <p className="text-xs uppercase tracking-wide text-muted">Assessment</p>
        <p className="mt-1 font-medium">{linked.title}</p>
        {linked.dueAt && (
          <p className="text-sm text-muted">Due {linked.dueAt.toLocaleString('en-ZA', { dateStyle: 'full', timeStyle: 'short' })}</p>
        )}
        <div className="mt-3">
          {linked.open || viewerIsStaff ? (
            <Link href={linked.href as never} className={button}>
              Open the assessment
            </Link>
          ) : (
            <span className="text-sm text-muted">It opens once your lecturer publishes it.</span>
          )}
        </div>
      </div>
    );
  }

  if (linked.kind === 'package') {
    return (
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted">
          {linked.packageKind === 'SCORM' ? 'Interactive package' : 'Activity'} · {linked.title}
        </p>
        {launchUrl ? <PackagePlayer src={launchUrl} title={linked.title} /> : null}
      </div>
    );
  }

  return (
    <div className={box}>
      <p className="text-xs uppercase tracking-wide text-muted">{linked.kind === 'survey' ? 'Survey' : 'Discussion'}</p>
      <p className="mt-1 font-medium">{linked.title}</p>
      <div className="mt-3">
        <Link href={linked.href as never} className={button}>
          {linked.kind === 'survey' ? 'Answer the survey' : 'Join the discussion'}
        </Link>
      </div>
    </div>
  );
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ offeringId: string; lessonId: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId, lessonId } = await params;
  const { offering, viewer, lesson, progress, next, previous } = await loadLesson(
    principal,
    offeringId,
    lessonId,
  );

  const linked = isLinkableType(lesson.type) ? await resolveLessonLink(offeringId, lesson.externalRef) : null;
  const launchUrl =
    linked?.kind === 'package' ? packageLaunchUrl(linked.packageId, principal.userId, linked.launchPath) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: offering.course.code, href: `/courses/${offeringId}` },
          { label: lesson.section.title, href: `/courses/${offeringId}` },
          { label: lesson.title },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{lesson.title}</h1>
          {lesson.summary && <p className="mt-1 max-w-prose text-sm text-muted">{lesson.summary}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!lesson.isPublished && <Tag tone="caution">draft</Tag>}
          {!lesson.isMandatory && <Tag tone="neutral">optional</Tag>}
          {progress?.status === 'COMPLETED' && <Tag tone="active">done</Tag>}
        </div>
      </div>

      {isLinkableType(lesson.type) && (
        <LinkedActivity
          linked={linked}
          lessonType={lesson.type}
          viewerIsStaff={viewer !== 'learner'}
          launchUrl={launchUrl}
        />
      )}

      <Panel>
        {lesson.blocks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {isLinkableType(lesson.type) ? 'Nothing else to read for this lesson.' : 'This lesson has no content yet.'}
          </p>
        ) : (
          <div className="divide-y divide-line">
            {lesson.blocks.map((block) => (
              <BlockView key={block.id} block={block as Block} />
            ))}
          </div>
        )}
      </Panel>

      {viewer === 'learner' && (
        <LessonTracker
          lessonId={lesson.id}
          alreadyComplete={progress?.status === 'COMPLETED'}
          nextHref={next ? `/courses/${offeringId}/lessons/${next.id}` : `/courses/${offeringId}`}
          nextLabel={next ? `Next: ${next.title}` : 'Back to the course'}
        />
      )}

      <nav aria-label="Lesson" className="flex justify-between border-t border-line pt-4 text-sm">
        {previous ? (
          <Link href={`/courses/${offeringId}/lessons/${previous.id}`} className="text-accent underline underline-offset-2">
            Previous: {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/courses/${offeringId}/lessons/${next.id}`} className="text-accent underline underline-offset-2">
            Next: {next.title}
          </Link>
        )}
      </nav>
    </div>
  );
}
