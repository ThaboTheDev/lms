import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import type { Principal } from '@/lib/rbac/authorize';
import { LINK_KINDS_FOR_TYPE, parseLessonRef, refFitsType, type LinkKind } from '@/lib/lesson-links';
import { assertCanEditOffering, updateLesson } from './course-builder';

export interface LinkTarget {
  ref: string;
  label: string;
}

/** What a lesson of each linkable type can point at in this delivery, for the builder. */
export async function linkTargets(principal: Principal, offeringId: string): Promise<Record<LinkKind, LinkTarget[]>> {
  await assertCanEditOffering(principal, offeringId);

  const [sessions, assessments, forums, threads, surveys, packages] = await Promise.all([
    prisma.liveSession.findMany({
      where: { offeringId },
      orderBy: { startsAt: 'desc' },
      take: 100,
      select: { id: true, title: true, startsAt: true },
    }),
    prisma.assessment.findMany({
      where: { offeringId },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, status: true },
    }),
    prisma.forum.findMany({ where: { offeringId }, select: { id: true, title: true } }),
    prisma.forumThread.findMany({
      where: { forum: { offeringId } },
      orderBy: { lastPostAt: 'desc' },
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.survey.findMany({ where: { offeringId }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true } }),
    prisma.learningPackage.findMany({
      where: { offeringId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, kind: true },
    }),
  ]);

  return {
    live: sessions.map((session) => ({
      ref: `live:${session.id}`,
      label: `${session.title} · ${session.startsAt.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}`,
    })),
    assessment: assessments.map((assessment) => ({
      ref: `assessment:${assessment.id}`,
      label: assessment.status === 'PUBLISHED' ? assessment.title : `${assessment.title} (${assessment.status.toLowerCase()})`,
    })),
    forum: forums.map((forum) => ({ ref: `forum:${forum.id}`, label: `The whole forum: ${forum.title}` })),
    thread: threads.map((thread) => ({ ref: `thread:${thread.id}`, label: `Thread: ${thread.title}` })),
    survey: surveys.map((survey) => ({ ref: `survey:${survey.id}`, label: survey.title })),
    package: packages.map((pkg) => ({ ref: `package:${pkg.id}`, label: `${pkg.title} (${pkg.kind === 'SCORM' ? 'SCORM' : 'H5P'})` })),
  };
}

/** Whether the thing a reference names belongs to this delivery. */
async function belongsToOffering(kind: LinkKind, id: string, offeringId: string): Promise<boolean> {
  switch (kind) {
    case 'live':
      return Boolean(await prisma.liveSession.findFirst({ where: { id, offeringId }, select: { id: true } }));
    case 'assessment':
      return Boolean(await prisma.assessment.findFirst({ where: { id, offeringId }, select: { id: true } }));
    case 'forum':
      return Boolean(await prisma.forum.findFirst({ where: { id, offeringId }, select: { id: true } }));
    case 'thread':
      return Boolean(await prisma.forumThread.findFirst({ where: { id, forum: { offeringId } }, select: { id: true } }));
    case 'survey':
      return Boolean(await prisma.survey.findFirst({ where: { id, offeringId }, select: { id: true } }));
    case 'package':
      return Boolean(await prisma.learningPackage.findFirst({ where: { id, offeringId }, select: { id: true } }));
    default:
      return false;
  }
}

/** Points a lesson at a live class, assessment, discussion, survey or package in the same delivery. */
export async function linkLesson(principal: Principal, lessonId: string, ref: string | null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, type: true, section: { select: { offeringId: true } } },
  });
  if (!lesson) throw new NotFoundError('Lesson');
  await assertCanEditOffering(principal, lesson.section.offeringId);

  if (!ref) return updateLesson(principal, lessonId, { externalRef: null });

  if (!LINK_KINDS_FOR_TYPE[lesson.type]) {
    throw new AppError('This kind of lesson does not link to anything.', 422, 'not_linkable');
  }
  if (!refFitsType(lesson.type, ref)) {
    throw new AppError('That is not something this kind of lesson can link to.', 422, 'wrong_link');
  }
  const parsed = parseLessonRef(ref)!;
  if (!(await belongsToOffering(parsed.kind, parsed.id, lesson.section.offeringId))) {
    throw new AppError('That belongs to another course.', 422, 'wrong_offering');
  }
  return updateLesson(principal, lessonId, { externalRef: ref });
}

export type ResolvedLink =
  | {
      kind: 'live';
      title: string;
      startsAt: Date;
      endsAt: Date;
      joinUrl: string | null;
      recordingUrl: string | null;
      passcode: string | null;
      provider: string;
    }
  | { kind: 'assessment'; title: string; dueAt: Date | null; href: string; open: boolean }
  | { kind: 'forum' | 'thread'; title: string; href: string }
  | { kind: 'survey'; title: string; href: string }
  | { kind: 'package'; packageId: string; title: string; packageKind: string; launchPath: string }
  | { kind: 'missing' };

/**
 * What a lesson's link points at, for the lesson page. Only called after the
 * page has checked the viewer can see the course; everything returned is
 * scoped to that same course.
 */
export async function resolveLessonLink(offeringId: string, ref: string | null): Promise<ResolvedLink | null> {
  const parsed = parseLessonRef(ref);
  if (!parsed) return null;
  const { kind, id } = parsed;

  switch (kind) {
    case 'live': {
      const live = await prisma.liveSession.findFirst({
        where: { id, offeringId },
        select: { title: true, startsAt: true, endsAt: true, joinUrl: true, recordingUrl: true, passcode: true, provider: true },
      });
      return live ? { kind, ...live, provider: String(live.provider) } : { kind: 'missing' };
    }
    case 'assessment': {
      const assessment = await prisma.assessment.findFirst({
        where: { id, offeringId },
        select: { id: true, title: true, dueAt: true, status: true },
      });
      if (!assessment) return { kind: 'missing' };
      return {
        kind,
        title: assessment.title,
        dueAt: assessment.dueAt,
        href: `/courses/${offeringId}/assessments/${assessment.id}`,
        open: assessment.status === 'PUBLISHED',
      };
    }
    case 'forum': {
      const forum = await prisma.forum.findFirst({ where: { id, offeringId }, select: { id: true, title: true } });
      return forum ? { kind, title: forum.title, href: `/discussions?forum=${forum.id}` } : { kind: 'missing' };
    }
    case 'thread': {
      const thread = await prisma.forumThread.findFirst({ where: { id, forum: { offeringId } }, select: { id: true, title: true } });
      return thread ? { kind, title: thread.title, href: `/discussions/${thread.id}` } : { kind: 'missing' };
    }
    case 'survey': {
      const survey = await prisma.survey.findFirst({ where: { id, offeringId }, select: { id: true, title: true } });
      return survey ? { kind, title: survey.title, href: `/courses/${offeringId}/surveys/${survey.id}` } : { kind: 'missing' };
    }
    case 'package': {
      const pkg = await prisma.learningPackage.findFirst({
        where: { id, offeringId, status: 'READY' },
        select: { id: true, title: true, kind: true, launchPath: true },
      });
      return pkg
        ? { kind, packageId: pkg.id, title: pkg.title, packageKind: String(pkg.kind), launchPath: pkg.launchPath }
        : { kind: 'missing' };
    }
    default:
      return null;
  }
}
