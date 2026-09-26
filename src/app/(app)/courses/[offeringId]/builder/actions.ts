'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { parseEmbedOrigins, toEmbed } from '@/lib/embed';
import { linkLesson } from '@/server/services/lesson-links';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import {
  addBlock,
  createLesson,
  createSection,
  deleteBlock,
  deleteLesson,
  deleteSection,
  moveLesson,
  moveSection,
  updateLesson,
  updateSection,
} from '@/server/services/course-builder';

function refresh(offeringId: string) {
  revalidatePath(`/courses/${offeringId}/builder`);
  revalidatePath(`/courses/${offeringId}`);
}

async function guarded<T>(work: () => Promise<T>, success: string): Promise<FormState> {
  try {
    await work();
    return { status: 'success', message: success };
  } catch (error) {
    if (error instanceof AppError) return { status: 'error', message: error.message };
    throw error;
  }
}

const sectionSchema = z.object({
  offeringId: z.string().min(1),
  title: z.string().trim().min(2, 'Give the section a title.').max(160),
  summary: z.string().trim().max(500).optional().or(z.literal('')),
});

export async function addSection(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = sectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const result = await guarded(
    () => createSection(principal, parsed.data.offeringId, parsed.data),
    'Section added.',
  );
  refresh(parsed.data.offeringId);
  return result;
}

const lessonSchema = z.object({
  offeringId: z.string().min(1),
  sectionId: z.string().min(1),
  title: z.string().trim().min(2, 'Give the lesson a title.').max(160),
  type: z.enum([
    'PAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'SCORM', 'H5P',
    'EXTERNAL_LINK', 'LIVE_SESSION', 'ASSESSMENT', 'DISCUSSION', 'SURVEY',
  ]),
  estimatedMinutes: z.coerce.number().int().min(0).max(600).optional(),
  isMandatory: z.coerce.boolean().default(true),
});

export async function addLesson(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = lessonSchema.safeParse({
    ...Object.fromEntries(formData),
    isMandatory: formData.get('isMandatory') === 'on',
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const result = await guarded(
    () => createLesson(principal, parsed.data.sectionId, parsed.data),
    'Lesson added.',
  );
  refresh(parsed.data.offeringId);
  return result;
}

const blockSchema = z.object({
  offeringId: z.string().min(1),
  lessonId: z.string().min(1),
  kind: z.enum(['RICH_TEXT', 'CALLOUT', 'FILE', 'IMAGE', 'VIDEO', 'AUDIO', 'LINK', 'EMBED']),
  text: z.string().trim().max(20_000).optional().or(z.literal('')),
  url: z.string().trim().url('Enter a full web address.').optional().or(z.literal('')),
  fileId: z.string().optional().or(z.literal('')),
});

export async function addLessonBlock(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const parsed = blockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: 'error', message: 'Check the form.', fieldErrors: toFieldErrors(parsed.error) };
  }

  const { kind, text, url, fileId, lessonId, offeringId } = parsed.data;

  if ((kind === 'RICH_TEXT' || kind === 'CALLOUT') && !text) {
    return { status: 'error', message: 'Write something first.', fieldErrors: { text: 'This cannot be empty.' } };
  }
  if ((kind === 'LINK' || kind === 'EMBED') && !url) {
    return { status: 'error', message: 'Add the web address.', fieldErrors: { url: 'This cannot be empty.' } };
  }
  if (['FILE', 'IMAGE', 'VIDEO', 'AUDIO'].includes(kind) && !fileId) {
    return { status: 'error', message: 'Upload a file first.', fieldErrors: { fileId: 'Choose a file.' } };
  }

  // Rich text is stored as a document of paragraphs, never as raw HTML, so
  // authored content cannot inject markup into a learner's page.
  const richText =
    kind === 'RICH_TEXT'
      ? { blocks: (text ?? '').split(/\n{2,}/).map((paragraph) => ({ text: paragraph.trim() })).filter((p) => p.text) }
      : kind === 'CALLOUT'
        ? { text }
        : undefined;

  const result = await guarded(
    // Only the field the kind uses: before the scripts run the form shows
    // every field, and a stray value in another one must not ride along.
    () =>
      addBlock(principal, lessonId, {
        kind,
        richText,
        fileId: ['FILE', 'IMAGE', 'VIDEO', 'AUDIO'].includes(kind) ? fileId || undefined : undefined,
        url: kind === 'LINK' || kind === 'EMBED' ? url || undefined : undefined,
      }),
    kind === 'EMBED' && !toEmbed(url, parseEmbedOrigins(env.EMBED_ALLOWED_ORIGINS))
      ? 'Added. That site cannot play inside the lesson, so learners get a link to it instead. An administrator can allow it with EMBED_ALLOWED_ORIGINS.'
      : 'Added to the lesson.',
  );
  refresh(offeringId);
  return result;
}

export async function removeBlock(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await deleteBlock(principal, String(formData.get('blockId') ?? ''));
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function toggleSectionPublished(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await updateSection(principal, String(formData.get('sectionId') ?? ''), {
    isPublished: formData.get('isPublished') === 'true',
  });
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function toggleLessonPublished(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await updateLesson(principal, String(formData.get('lessonId') ?? ''), {
    isPublished: formData.get('isPublished') === 'true',
  });
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function moveSectionAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await moveSection(
    principal,
    String(formData.get('sectionId') ?? ''),
    formData.get('direction') === 'up' ? 'up' : 'down',
  );
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function moveLessonAction(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await moveLesson(
    principal,
    String(formData.get('lessonId') ?? ''),
    formData.get('direction') === 'up' ? 'up' : 'down',
  );
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function removeSection(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await deleteSection(principal, String(formData.get('sectionId') ?? ''));
  refresh(String(formData.get('offeringId') ?? ''));
}

export async function removeLesson(formData: FormData): Promise<void> {
  const principal = await requirePrincipal();
  await deleteLesson(principal, String(formData.get('lessonId') ?? ''));
  refresh(String(formData.get('offeringId') ?? ''));
}

/** Points a live class, assessment, discussion, survey or package lesson at the thing it opens. */
export async function saveLessonLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const ref = String(formData.get('ref') ?? '');
  const result = await guarded(
    () => linkLesson(principal, String(formData.get('lessonId') ?? ''), ref || null),
    ref ? 'Linked.' : 'Link removed.',
  );
  refresh(offeringId);
  return result;
}
