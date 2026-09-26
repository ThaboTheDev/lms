import 'server-only';
import { randomUUID } from 'node:crypto';
import { unzipSync } from 'fflate';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { queue } from '@/lib/queue';
import { storage } from '@/lib/storage';
import type { Principal } from '@/lib/rbac/authorize';
import { parseH5pManifest, parseScormManifest } from '@/lib/packages/manifest';
import { PACKAGE_LIMITS, commonRoot, contentTypeFor, safeEntryPath } from '@/lib/packages/zip';
import {
  signPackageToken,
  storableValues,
  summariseCmi,
  totalSessionSeconds,
  verifyPackageToken,
  type CmiValues,
  type ScormVersion,
} from '@/lib/packages/scorm-runtime';
import { assertCanEditOffering } from './course-builder';

/** A launch link lasts a long sitting; a new page view issues a new one. */
const TOKEN_TTL_SEC = 6 * 60 * 60;

/** Where the player page for H5P lives inside every package's URL space. */
export const H5P_LAUNCH_PATH = '__lms/h5p.html';

/** The URL a learner's frame loads: the package id, a signed token for this learner, and the page to open. */
export function packageLaunchUrl(packageId: string, userId: string, launchPath: string, now = Date.now()): string {
  const token = signPackageToken(env.AUTH_SECRET, packageId, userId, Math.floor(now / 1000) + TOKEN_TTL_SEC);
  return `/api/v1/packages/${packageId}/${token}/${launchPath}`;
}

/** Registers an uploaded archive as a package of this delivery and queues it for unpacking. */
export async function createPackage(
  principal: Principal,
  offeringId: string,
  input: { fileId: string; title?: string },
) {
  const offering = await assertCanEditOffering(principal, offeringId);
  const file = await prisma.fileObject.findUnique({
    where: { id: input.fileId },
    select: { id: true, institutionId: true, uploadedById: true, originalName: true },
  });
  if (!file || file.uploadedById !== principal.userId || file.institutionId !== offering.institutionId) {
    throw new AppError('Upload the package first.', 422, 'no_file');
  }

  const kind = /\.h5p$/i.test(file.originalName) ? 'H5P' : 'SCORM';
  const pkg = await prisma.learningPackage.create({
    data: {
      institutionId: offering.institutionId,
      offeringId,
      kind,
      title: input.title?.trim() || file.originalName.replace(/\.(zip|h5p)$/i, ''),
      fileId: file.id,
      storagePrefix: `${offering.institutionId}/packages/${randomUUID()}`,
      createdById: principal.userId,
    },
    select: { id: true, title: true },
  });

  await recordAudit(principal, {
    action: 'content.package_uploaded',
    entityType: 'LearningPackage',
    entityId: pkg.id,
    institutionId: offering.institutionId,
    after: { title: pkg.title, kind },
  });
  await queue.enqueue('package.process', { packageId: pkg.id });
  return pkg;
}

/**
 * Unpacks a package into storage and reads its manifest. Runs as a job: a
 * large package is thousands of files, which is not something to do inside
 * the request that uploaded it.
 */
export async function processPackage(packageId: string): Promise<void> {
  const pkg = await prisma.learningPackage.findUnique({
    where: { id: packageId },
    select: { id: true, title: true, storagePrefix: true, status: true, file: { select: { storageKey: true, originalName: true } } },
  });
  if (!pkg || pkg.status === 'READY') return;

  const fail = async (error: string) => {
    await prisma.learningPackage.update({ where: { id: packageId }, data: { status: 'FAILED', error } });
  };

  try {
    const bytes = await storage.get(pkg.file.storageKey);
    if (!bytes) return fail('The uploaded archive is not in storage.');

    let entries = 0;
    let total = 0;
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipSync(bytes, {
        filter: (entry) => {
          if (!safeEntryPath(entry.name)) return false;
          entries += 1;
          total += entry.originalSize;
          if (entries > PACKAGE_LIMITS.maxEntries) throw new Error(`The archive has more than ${PACKAGE_LIMITS.maxEntries} files.`);
          if (entry.originalSize > PACKAGE_LIMITS.maxEntryBytes || total > PACKAGE_LIMITS.maxTotalBytes) {
            throw new Error('The archive unpacks to more than this system accepts.');
          }
          return true;
        },
      });
    } catch (error) {
      return fail(error instanceof Error && error.message.startsWith('The archive') ? error.message : 'That file is not a ZIP archive this system can open.');
    }

    const files = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(archive)) {
      const path = safeEntryPath(name);
      if (path) files.set(path, data);
    }
    const paths = [...files.keys()];
    const decode = (path: string) => new TextDecoder().decode(files.get(path));

    let kind: 'SCORM' | 'H5P';
    let root: string;
    let version: string | null = null;
    let launchPath: string;
    let title: string;
    let summary: Record<string, unknown>;

    const scormRoot = commonRoot(paths, 'imsmanifest.xml');
    const h5pRoot = commonRoot(paths, 'h5p.json');
    if (paths.includes(`${scormRoot}imsmanifest.xml`)) {
      kind = 'SCORM';
      root = scormRoot;
      const manifest = parseScormManifest(decode(`${root}imsmanifest.xml`));
      const page = manifest.launchPath.split('?')[0]!;
      if (!files.has(`${root}${page}`)) return fail(`The manifest opens ${page}, which is not in the archive.`);
      version = manifest.version;
      launchPath = manifest.launchPath;
      title = manifest.title;
      summary = { version, launchPath };
    } else if (paths.includes(`${h5pRoot}h5p.json`)) {
      kind = 'H5P';
      root = h5pRoot;
      const manifest = parseH5pManifest(decode(`${root}h5p.json`));
      if (!files.has(`${root}content/content.json`)) return fail('The H5P file has no content/content.json.');
      launchPath = H5P_LAUNCH_PATH;
      title = manifest.title;
      summary = { mainLibrary: manifest.mainLibrary };
    } else {
      return fail('Neither imsmanifest.xml (SCORM) nor h5p.json (H5P) is at the top of the archive.');
    }

    // Upload a few at a time: fast enough, and gentle on the storage service.
    const stored: string[] = [];
    const queueOf = paths.filter((path) => path.startsWith(root));
    const workers = Array.from({ length: 8 }, async () => {
      while (queueOf.length) {
        const path = queueOf.shift()!;
        const relative = path.slice(root.length);
        await storage.put(`${pkg.storagePrefix}/${relative}`, files.get(path)!, contentTypeFor(relative));
        stored.push(relative);
      }
    });
    await Promise.all(workers);

    await prisma.learningPackage.update({
      where: { id: packageId },
      data: {
        status: 'READY',
        error: null,
        kind,
        version,
        launchPath,
        title: pkg.title || title,
        manifest: { ...summary, title, fileCount: stored.length, files: stored } as never,
      },
    });
  } catch (error) {
    console.error('[packages] could not process', packageId, error);
    await fail(error instanceof Error ? error.message : 'The package could not be unpacked.');
  }
}

export async function listPackages(principal: Principal, offeringId: string) {
  await assertCanEditOffering(principal, offeringId);
  const packages = await prisma.learningPackage.findMany({
    where: { offeringId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      kind: true,
      version: true,
      status: true,
      error: true,
      createdAt: true,
      _count: { select: { attempts: true } },
      attempts: {
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: {
          completion: true,
          success: true,
          scoreRaw: true,
          scoreMax: true,
          scoreScaled: true,
          totalTimeSec: true,
          completedAt: true,
          updatedAt: true,
          user: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  return packages;
}

export async function deletePackage(principal: Principal, packageId: string) {
  const pkg = await prisma.learningPackage.findUnique({
    where: { id: packageId },
    select: { id: true, offeringId: true, storagePrefix: true, manifest: true, title: true },
  });
  if (!pkg?.offeringId) throw new NotFoundError('Package');
  const offering = await assertCanEditOffering(principal, pkg.offeringId);
  const files = ((pkg.manifest ?? {}) as { files?: string[] }).files ?? [];
  await prisma.learningPackage.delete({ where: { id: packageId } });
  for (const file of files) await storage.delete(`${pkg.storagePrefix}/${file}`).catch(() => undefined);
  await recordAudit(principal, {
    action: 'content.package_deleted',
    entityType: 'LearningPackage',
    entityId: packageId,
    institutionId: offering.institutionId,
    before: { title: pkg.title },
  });
}

/* ---------------------------------------------------------- runtime --- */

export interface PlayablePackage {
  id: string;
  kind: 'SCORM' | 'H5P';
  version: ScormVersion;
  storagePrefix: string;
  launchPath: string;
  title: string;
}

/** The package a token was issued for, and whose it is. Null for anything that does not check out. */
export async function packageForToken(
  packageId: string,
  token: string,
): Promise<{ pkg: PlayablePackage; userId: string } | null> {
  const verified = verifyPackageToken(env.AUTH_SECRET, packageId, token);
  if (!verified) return null;
  const pkg = await prisma.learningPackage.findFirst({
    where: { id: packageId, status: 'READY' },
    select: { id: true, kind: true, version: true, storagePrefix: true, launchPath: true, title: true },
  });
  if (!pkg) return null;
  return {
    pkg: { ...pkg, kind: pkg.kind as 'SCORM' | 'H5P', version: pkg.version === '1.2' ? '1.2' : '2004' },
    userId: verified.userId,
  };
}

export async function readPackageFile(pkg: PlayablePackage, path: string): Promise<Uint8Array | null> {
  return storage.get(`${pkg.storagePrefix}/${path}`);
}

export async function learnerRuntimeState(pkg: PlayablePackage, userId: string) {
  const [attempt, user] = await Promise.all([
    prisma.packageAttempt.findUnique({
      where: { packageId_userId: { packageId: pkg.id, userId } },
      select: { data: true, totalTimeSec: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
  ]);
  return {
    stored: (((attempt?.data ?? {}) as { values?: CmiValues }).values ?? {}) as CmiValues,
    totalTimeSec: attempt?.totalTimeSec ?? 0,
    learnerName: user ? `${user.lastName}, ${user.firstName}` : 'Learner',
  };
}

/** Which SCORM a set of values was written in, whatever the manifest claimed. */
function detectVersion(values: Record<string, unknown>, fallback: ScormVersion): ScormVersion {
  const keys = Object.keys(values);
  if (keys.some((key) => key.startsWith('cmi.core.'))) return '1.2';
  if (keys.some((key) => key === 'cmi.completion_status' || key === 'cmi.success_status' || key === 'cmi.location')) return '2004';
  return fallback;
}

/** A commit from the runtime shim. */
export async function recordScormCommit(pkg: PlayablePackage, userId: string, body: unknown) {
  const payload = (body ?? {}) as { session?: unknown; values?: unknown };
  const raw = payload.values && typeof payload.values === 'object' ? (payload.values as Record<string, unknown>) : {};
  const version = detectVersion(raw, pkg.version);
  const values = storableValues(version, raw);
  const summary = summariseCmi(version, Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value ?? '')])));
  const session = typeof payload.session === 'string' ? payload.session.slice(0, 64) : 'unknown';

  const existing = await prisma.packageAttempt.findUnique({
    where: { packageId_userId: { packageId: pkg.id, userId } },
    select: { data: true, completedAt: true },
  });
  const previous = (existing?.data ?? {}) as { sessions?: Record<string, number> };
  const sessions = Object.fromEntries(
    Object.entries({ ...(previous.sessions ?? {}), [session]: summary.sessionTimeSec }).slice(-100),
  );

  const data = {
    completion: summary.completion,
    success: summary.success,
    scoreRaw: summary.scoreRaw,
    scoreMax: summary.scoreMax,
    scoreScaled: summary.scoreScaled,
    location: summary.location,
    suspendData: summary.suspendData,
    totalTimeSec: Math.round(totalSessionSeconds(sessions)),
    data: { values, sessions, version } as never,
    completedAt: existing?.completedAt ?? (summary.completed ? new Date() : null),
  };

  await prisma.packageAttempt.upsert({
    where: { packageId_userId: { packageId: pkg.id, userId } },
    create: { packageId: pkg.id, userId, ...data },
    update: data,
  });
}

/** An xAPI statement from the H5P player. Only the activity itself counts, not its parts. */
export async function recordXapi(pkg: PlayablePackage, userId: string, statement: unknown) {
  const s = (statement ?? {}) as {
    verb?: { id?: string };
    object?: { id?: string };
    result?: { score?: { raw?: number; max?: number; scaled?: number }; completion?: boolean; success?: boolean; duration?: string };
  };
  if (typeof s.object?.id === 'string' && s.object.id.includes('subContentId')) return;
  const verb = s.verb?.id?.split('/').pop() ?? '';
  const result = s.result;
  if (!result && !['completed', 'passed', 'failed'].includes(verb)) return;

  const completed = result?.completion === true || verb === 'completed' || verb === 'passed';
  const success = result?.success === true ? 'passed' : result?.success === false ? 'failed' : null;
  const existing = await prisma.packageAttempt.findUnique({
    where: { packageId_userId: { packageId: pkg.id, userId } },
    select: { completedAt: true, completion: true },
  });
  const data = {
    completion: completed ? 'completed' : (existing?.completion ?? 'incomplete'),
    ...(success ? { success } : {}),
    ...(typeof result?.score?.raw === 'number' ? { scoreRaw: result.score.raw } : {}),
    ...(typeof result?.score?.max === 'number' ? { scoreMax: result.score.max } : {}),
    ...(typeof result?.score?.scaled === 'number' ? { scoreScaled: Math.max(-1, Math.min(1, result.score.scaled)) } : {}),
    completedAt: existing?.completedAt ?? (completed ? new Date() : null),
  };
  await prisma.packageAttempt.upsert({
    where: { packageId_userId: { packageId: pkg.id, userId } },
    create: { packageId: pkg.id, userId, ...data },
    update: data,
  });
}
