import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { loadLesson } from '@/server/services/learning';
import { humanFileSize, isPreviewable } from '@/lib/storage/keys';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { LessonTracker } from './lesson-tracker';

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
        <span className="block text-xs text-muted">Opens in a new tab.</span>
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
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
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
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <figure className="px-4 py-4">
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

      <Panel>
        {lesson.blocks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            This lesson has no content yet.
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
