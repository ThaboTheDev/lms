import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { can, requirePermission, type Principal, requireSameInstitution } from '@/lib/rbac/authorize';
import { assertCanViewOffering } from './course-builder';
import { notify } from './notifications';

/** Anyone on the course may read; only staff or a moderator may moderate. */
async function assertForumAccess(principal: Principal, forumId: string) {
  const forum = await prisma.forum.findUnique({
    where: { id: forumId },
    select: {
      id: true, institutionId: true, offeringId: true, title: true,
      isLocked: true, isAnnouncementOnly: true,
    },
  });
  if (!forum) throw new NotFoundError('Discussion');

  const viewer = forum.offeringId
    ? (await assertCanViewOffering(principal, forum.offeringId)).viewer
    : 'staff';

  const canModerate =
    viewer === 'staff' &&
    can(principal, 'forum.moderate', {
      institutionId: forum.institutionId,
      ...(forum.offeringId ? { courseOfferingId: forum.offeringId } : {}),
    });

  return { forum, viewer, canModerate };
}

export async function ensureCourseForum(principal: Principal, offeringId: string) {
  const existing = await prisma.forum.findFirst({
    where: { offeringId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const { offering } = await assertCanViewOffering(principal, offeringId);
  const forum = await prisma.forum.create({
    data: {
      institutionId: offering.institutionId,
      offeringId,
      title: `${offering.course.code} discussion`,
      description: 'Questions and discussion for everyone taking this course.',
    },
    select: { id: true },
  });
  return forum.id;
}

export async function listThreads(principal: Principal, forumId: string) {
  const { forum, canModerate } = await assertForumAccess(principal, forumId);

  const threads = await prisma.forumThread.findMany({
    where: { forumId },
    orderBy: [{ isPinned: 'desc' }, { lastPostAt: 'desc' }],
    take: 50,
    select: {
      id: true, title: true, isPinned: true, isLocked: true, viewCount: true,
      lastPostAt: true, createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { posts: true } },
    },
  });

  return { forum, threads, canModerate };
}

export async function loadThread(principal: Principal, threadId: string) {
  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    select: {
      id: true, forumId: true, title: true, isPinned: true, isLocked: true,
      createdAt: true,
      author: { select: { id: true, firstName: true, lastName: true } },
      posts: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, body: true, createdAt: true, editedAt: true, isHidden: true, parentId: true,
          author: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
  if (!thread) throw new NotFoundError('Discussion');

  const { forum, canModerate } = await assertForumAccess(principal, thread.forumId);

  await prisma.forumThread.update({
    where: { id: threadId },
    data: { viewCount: { increment: 1 } },
  });

  // A hidden post leaves a visible gap rather than disappearing: silently
  // removing what someone wrote is how a discussion loses its participants.
  const posts = thread.posts.map((post) =>
    post.isHidden && !canModerate
      ? { ...post, body: 'This post was hidden by a moderator.', author: post.author }
      : post,
  );

  return { thread: { ...thread, posts }, forum, canModerate };
}

export async function startThread(
  principal: Principal,
  forumId: string,
  input: { title: string; body: string },
) {
  const { forum, canModerate } = await assertForumAccess(principal, forumId);

  if (forum.isLocked && !canModerate) {
    throw new AppError('This discussion is closed.', 409, 'forum_locked');
  }
  if (forum.isAnnouncementOnly && !canModerate) {
    throw new AppError('Only staff post in this discussion.', 403, 'announcement_only');
  }

  return prisma.forumThread.create({
    data: {
      forumId,
      authorId: principal.userId,
      title: input.title.trim(),
      posts: { create: { authorId: principal.userId, body: input.body.trim() } },
    },
    select: { id: true },
  });
}

export async function reply(
  principal: Principal,
  threadId: string,
  input: { body: string; parentId?: string },
) {
  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    select: {
      id: true, forumId: true, title: true, isLocked: true, authorId: true,
      forum: { select: { institutionId: true } },
    },
  });
  if (!thread) throw new NotFoundError('Discussion');

  const { canModerate } = await assertForumAccess(principal, thread.forumId);
  if (thread.isLocked && !canModerate) {
    throw new AppError('This discussion is closed to new replies.', 409, 'thread_locked');
  }

  const post = await prisma.forumPost.create({
    data: {
      threadId,
      authorId: principal.userId,
      parentId: input.parentId || null,
      body: input.body.trim(),
    },
    select: { id: true },
  });

  await prisma.forumThread.update({
    where: { id: threadId },
    data: { lastPostAt: new Date() },
  });

  if (thread.authorId !== principal.userId) {
    await notify({
      userId: thread.authorId,
      institutionId: thread.forum.institutionId,
      type: 'forum.reply',
      title: `New reply: ${thread.title}`,
      body: input.body.slice(0, 160),
      linkUrl: `/discussions/${threadId}`,
    });
  }

  return post;
}

export async function moderateThread(
  principal: Principal,
  threadId: string,
  action: 'pin' | 'unpin' | 'lock' | 'unlock',
) {
  const thread = await prisma.forumThread.findUnique({
    where: { id: threadId },
    select: { id: true, forumId: true, title: true },
  });
  if (!thread) throw new NotFoundError('Discussion');

  const { forum, canModerate } = await assertForumAccess(principal, thread.forumId);
  if (!canModerate) throw new AppError('You cannot moderate this discussion.', 403, 'forbidden');

  const data =
    action === 'pin' ? { isPinned: true }
      : action === 'unpin' ? { isPinned: false }
        : action === 'lock' ? { isLocked: true }
          : { isLocked: false };

  await prisma.forumThread.update({ where: { id: threadId }, data });

  await recordAudit(principal, {
    action: `forum.${action}`,
    entityType: 'ForumThread',
    entityId: threadId,
    institutionId: forum.institutionId,
    after: { title: thread.title },
  });
}

export async function hidePost(principal: Principal, postId: string, hidden: boolean) {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { id: true, body: true, thread: { select: { forumId: true } } },
  });
  if (!post) throw new NotFoundError('Post');

  const { forum, canModerate } = await assertForumAccess(principal, post.thread.forumId);
  if (!canModerate) throw new AppError('You cannot moderate this discussion.', 403, 'forbidden');

  await prisma.forumPost.update({
    where: { id: postId },
    data: { isHidden: hidden, hiddenById: hidden ? principal.userId : null },
  });

  await recordAudit(principal, {
    action: hidden ? 'forum.post_hidden' : 'forum.post_restored',
    entityType: 'ForumPost',
    entityId: postId,
    institutionId: forum.institutionId,
    before: { excerpt: post.body.slice(0, 120) },
  });
}

/**
 * Anyone may report a post. Reports go to a queue rather than hiding the post
 * automatically, because automatic removal on report is a tool for silencing
 * people rather than for moderating them.
 */
export async function reportPost(principal: Principal, postId: string, reason: string) {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
    select: { id: true, thread: { select: { forumId: true } } },
  });
  if (!post) throw new NotFoundError('Post');
  await assertForumAccess(principal, post.thread.forumId);

  if (!reason.trim()) {
    throw new AppError('Say what is wrong with the post.', 422, 'reason_required');
  }

  return prisma.forumReport.create({
    data: { postId, reporterId: principal.userId, reason: reason.trim() },
    select: { id: true },
  });
}

export async function openReports(principal: Principal) {
  requirePermission(principal, 'forum.moderate');

  return prisma.forumReport.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: {
      id: true, reason: true, createdAt: true,
      post: {
        select: {
          id: true, body: true, isHidden: true,
          author: { select: { firstName: true, lastName: true } },
          thread: { select: { id: true, title: true } },
        },
      },
    },
  });
}

/**
 * Closes a report. "Hide" hides the post as well, which leaves a visible gap in
 * the thread; "dismiss" keeps it. Either way the report leaves the queue and
 * the audit log records who decided.
 */
export async function resolveReport(principal: Principal, reportId: string, outcome: 'hide' | 'dismiss') {
  requirePermission(principal, 'forum.moderate');
  const report = await prisma.forumReport.findUnique({
    where: { id: reportId },
    select: { id: true, status: true, post: { select: { id: true, thread: { select: { forum: { select: { institutionId: true } } } } } } },
  });
  if (!report) throw new NotFoundError('Report');
  requireSameInstitution(principal, report.post.thread.forum.institutionId);
  if (report.status !== 'OPEN') throw new AppError('Somebody has already dealt with that report.', 409, 'already_resolved');

  await prisma.$transaction([
    prisma.forumReport.update({ where: { id: reportId }, data: { status: outcome === 'hide' ? 'ACTIONED' : 'DISMISSED', reviewedById: principal.userId, reviewedAt: new Date() } }),
    ...(outcome === 'hide' ? [prisma.forumPost.update({ where: { id: report.post.id }, data: { isHidden: true } })] : []),
  ]);
  await recordAudit(principal, { action: `forum.report_${outcome === 'hide' ? 'actioned' : 'dismissed'}`, entityType: 'ForumReport', entityId: reportId, after: { postId: report.post.id } });
}

