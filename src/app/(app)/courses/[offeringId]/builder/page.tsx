import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { assertCanEditOffering } from '@/server/services/course-builder';
import { humanFileSize } from '@/lib/storage/keys';
import { Button, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { AddSectionForm, AddLessonForm, AddBlockForm, LessonLinkForm } from './builder-forms';
import { LINK_KINDS_FOR_TYPE } from '@/lib/lesson-links';
import { linkTargets } from '@/server/services/lesson-links';
import {
  moveLessonAction,
  moveSectionAction,
  removeBlock,
  removeLesson,
  removeSection,
  toggleLessonPublished,
  toggleSectionPublished,
} from './actions';

export const metadata: Metadata = { title: 'Course builder' };

/** Small submit control for the single-purpose forms that sit inside the list. */
function IconForm({
  action,
  fields,
  label,
  destructive,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  destructive?: boolean;
}) {
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <button
        type="submit"
        className={`rounded px-2 py-1 text-xs ${destructive ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-ink/5'}`}
      >
        {label}
      </button>
    </form>
  );
}

export default async function BuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ offeringId: string }>;
  searchParams: Promise<{ lesson?: string }>;
}) {
  const principal = await requirePrincipal();
  const { offeringId } = await params;
  const { lesson: selectedLessonId } = await searchParams;

  const offering = await assertCanEditOffering(principal, offeringId);

  const sections = await prisma.courseSection.findMany({
    where: { offeringId },
    orderBy: { orderIndex: 'asc' },
    select: {
      id: true,
      title: true,
      summary: true,
      isPublished: true,
      orderIndex: true,
      lessons: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true,
          title: true,
          type: true,
          isPublished: true,
          isMandatory: true,
          estimatedMinutes: true,
          _count: { select: { blocks: true } },
        },
      },
    },
  });

  const selectedLesson = selectedLessonId
    ? await prisma.lesson.findFirst({
        where: { id: selectedLessonId, section: { offeringId } },
        select: {
          id: true,
          title: true,
          type: true,
          externalRef: true,
          blocks: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              kind: true,
              url: true,
              richText: true,
              file: { select: { originalName: true, sizeBytes: true } },
            },
          },
        },
      })
    : null;

  const linkKinds = selectedLesson ? LINK_KINDS_FOR_TYPE[selectedLesson.type] : undefined;
  const targets = linkKinds ? await linkTargets(principal, offeringId) : null;
  const LINK_EMPTY_HINT: Record<string, string> = {
    LIVE_SESSION: 'Schedule a live class on the course page first, then link it here.',
    ASSESSMENT: 'Create the assessment under Assessments first, then link it here.',
    DISCUSSION: 'The course forum appears here once the delivery has one.',
    SURVEY: 'Create a survey under Surveys first, then link it here.',
    SCORM: 'Upload the package under Interactive packages first, then link it here.',
    H5P: 'Upload the activity under Interactive packages first, then link it here.',
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          { label: 'Courses', href: '/courses' },
          { label: offering.course.code, href: `/courses/${offeringId}` },
          { label: 'Builder' },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Course builder</h1>
          <p className="mt-1 text-sm text-muted">
            {offering.course.code} · {offering.course.title}. Learners see a section only once it is
            published, and only its published lessons.
          </p>
        </div>
        <Link href={`/courses/${offeringId}`}>
          <Button variant="secondary">View as learners see it</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {sections.length === 0 && (
            <Panel>
              <p className="px-4 py-8 text-center text-sm text-muted">
                Start with a section: a week, a unit, or a theme.
              </p>
            </Panel>
          )}

          {sections.map((section, index) => (
            <Panel
              key={section.id}
              title={`${index + 1}. ${section.title}`}
              description={section.summary ?? undefined}
              action={
                <div className="flex items-center gap-1">
                  <Tag tone={section.isPublished ? 'active' : 'caution'}>
                    {section.isPublished ? 'published' : 'draft'}
                  </Tag>
                  <IconForm
                    action={toggleSectionPublished}
                    fields={{
                      offeringId,
                      sectionId: section.id,
                      isPublished: String(!section.isPublished),
                    }}
                    label={section.isPublished ? 'Unpublish' : 'Publish'}
                  />
                  <IconForm
                    action={moveSectionAction}
                    fields={{ offeringId, sectionId: section.id, direction: 'up' }}
                    label="Move up"
                  />
                  <IconForm
                    action={moveSectionAction}
                    fields={{ offeringId, sectionId: section.id, direction: 'down' }}
                    label="Move down"
                  />
                  {section.lessons.length === 0 && (
                    <IconForm
                      action={removeSection}
                      fields={{ offeringId, sectionId: section.id }}
                      label="Delete"
                      destructive
                    />
                  )}
                </div>
              }
            >
              {section.lessons.length > 0 && (
                <ul className="divide-y divide-line">
                  {section.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/courses/${offeringId}/builder?lesson=${lesson.id}`}
                          className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                        >
                          {lesson.title}
                        </Link>
                        <span className="block text-xs text-muted">
                          {lesson.type.toLowerCase().replace(/_/g, ' ')} · {lesson._count.blocks} blocks
                          {lesson.estimatedMinutes ? ` · ${lesson.estimatedMinutes} min` : ''}
                          {lesson.isMandatory ? '' : ' · optional'}
                        </span>
                      </div>
                      <Tag tone={lesson.isPublished ? 'active' : 'caution'}>
                        {lesson.isPublished ? 'published' : 'draft'}
                      </Tag>
                      <IconForm
                        action={toggleLessonPublished}
                        fields={{ offeringId, lessonId: lesson.id, isPublished: String(!lesson.isPublished) }}
                        label={lesson.isPublished ? 'Unpublish' : 'Publish'}
                      />
                      <IconForm
                        action={moveLessonAction}
                        fields={{ offeringId, lessonId: lesson.id, direction: 'up' }}
                        label="Up"
                      />
                      <IconForm
                        action={moveLessonAction}
                        fields={{ offeringId, lessonId: lesson.id, direction: 'down' }}
                        label="Down"
                      />
                      <IconForm
                        action={removeLesson}
                        fields={{ offeringId, lessonId: lesson.id }}
                        label="Delete"
                        destructive
                      />
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-line bg-paper px-4 py-3">
                <AddLessonForm offeringId={offeringId} sectionId={section.id} />
              </div>
            </Panel>
          ))}

          <Panel title="Add a section">
            <div className="px-4 py-4">
              <AddSectionForm offeringId={offeringId} />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {selectedLesson ? (
            <>
              <Panel
                title={selectedLesson.title}
                description={`${selectedLesson.blocks.length} blocks in this lesson`}
              >
                {selectedLesson.blocks.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted">
                    Nothing in this lesson yet. Add text, a file or a link below.
                  </p>
                ) : (
                  <ol className="divide-y divide-line">
                    {selectedLesson.blocks.map((block, index) => {
                      const doc = block.richText as { blocks?: { text: string }[]; text?: string } | null;
                      const preview =
                        doc?.blocks?.[0]?.text ??
                        doc?.text ??
                        block.url ??
                        (block.file
                          ? `${block.file.originalName} · ${humanFileSize(block.file.sizeBytes)}`
                          : '');
                      return (
                        <li key={block.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="text-xs text-muted">{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs uppercase tracking-wide text-muted">
                              {block.kind.toLowerCase().replace(/_/g, ' ')}
                            </p>
                            <p className="truncate text-sm">{preview}</p>
                          </div>
                          <IconForm
                            action={removeBlock}
                            fields={{ offeringId, blockId: block.id }}
                            label="Remove"
                            destructive
                          />
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Panel>

              {linkKinds && targets && (
                <Panel
                  title="What this lesson opens"
                  description="Learners see it at the top of the lesson, with anything you add below as context."
                >
                  <div className="px-4 py-4">
                    <LessonLinkForm
                      offeringId={offeringId}
                      lessonId={selectedLesson.id}
                      current={selectedLesson.externalRef}
                      groups={linkKinds.map((kind) => ({ kind, targets: targets[kind] }))}
                      emptyHint={LINK_EMPTY_HINT[selectedLesson.type] ?? 'Nothing to link to yet.'}
                    />
                  </div>
                </Panel>
              )}

              <Panel title="Add to this lesson">
                <div className="px-4 py-4">
                  <AddBlockForm offeringId={offeringId} lessonId={selectedLesson.id} />
                </div>
              </Panel>
            </>
          ) : (
            <Panel title="Lesson content">
              <p className="px-4 py-8 text-sm text-muted">
                Choose a lesson on the left to add text, files, video or links to it.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
