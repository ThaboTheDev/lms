import 'server-only';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError } from '@/lib/errors';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';

export interface LibraryFilters {
  query?: string;
  folderId?: string;
  tag?: string;
}

export async function listAssets(
  principal: Principal,
  filters: LibraryFilters,
  paging: { skip: number; perPage: number },
) {
  requirePermission(principal, 'content.read');

  const where = {
    institutionId: principal.institutionId ?? undefined,
    // Superseded versions stay in the database for the audit trail but are kept
    // out of the library listing: staff want the current version of a thing.
    replacedBy: { is: null },
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    ...(filters.query
      ? {
          OR: [
            { title: { contains: filters.query, mode: 'insensitive' as const } },
            { description: { contains: filters.query, mode: 'insensitive' as const } },
            { tags: { has: filters.query.toLowerCase() } },
          ],
        }
      : {}),
  };

  const [total, assets] = await Promise.all([
    prisma.contentAsset.count({ where: where as never }),
    prisma.contentAsset.findMany({
      where: where as never,
      skip: paging.skip,
      take: paging.perPage,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        tags: true,
        version: true,
        isRestricted: true,
        downloadCount: true,
        updatedAt: true,
        folder: { select: { id: true, name: true, path: true } },
        file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } },
      },
    }),
  ]);

  return { total, assets };
}

export async function listFolders(principal: Principal) {
  requirePermission(principal, 'content.read');
  return prisma.contentFolder.findMany({
    where: { institutionId: principal.institutionId ?? undefined },
    select: { id: true, name: true, path: true, parentId: true, _count: { select: { assets: true } } },
    orderBy: { path: 'asc' },
  });
}

export async function createFolder(principal: Principal, input: { name: string; parentId?: string }) {
  requirePermission(principal, 'content.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const parent = input.parentId
    ? await prisma.contentFolder.findFirst({
        where: { id: input.parentId, institutionId },
        select: { id: true, path: true },
      })
    : null;

  if (input.parentId && !parent) throw new NotFoundError('Parent folder');

  const slug = input.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
  const path = parent ? `${parent.path}/${slug}` : `/${slug}`;

  const existing = await prisma.contentFolder.findFirst({
    where: { institutionId, path },
    select: { id: true },
  });
  if (existing) throw new AppError('A folder with that name is already here.', 409, 'duplicate_folder');

  return prisma.contentFolder.create({
    data: { institutionId, name: input.name.trim(), path, parentId: parent?.id ?? null, createdById: principal.userId },
  });
}

/** Registers an uploaded file in the library. */
export async function createAsset(
  principal: Principal,
  input: { fileId: string; title: string; description?: string; tags?: string[]; folderId?: string; isRestricted?: boolean },
) {
  requirePermission(principal, 'content.manage');
  const institutionId = principal.institutionId;
  if (!institutionId) throw new NotFoundError('Institution');

  const file = await prisma.fileObject.findFirst({
    where: { id: input.fileId, institutionId },
    select: { id: true, originalName: true },
  });
  if (!file) throw new AppError('That file is not available to this institution.', 403, 'forbidden');

  const asset = await prisma.contentAsset.create({
    data: {
      institutionId,
      fileId: input.fileId,
      folderId: input.folderId || null,
      title: input.title.trim() || file.originalName,
      description: input.description || null,
      tags: (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
      isRestricted: input.isRestricted ?? false,
      uploadedById: principal.userId,
    },
  });

  await recordAudit(principal, {
    action: 'content.asset_created',
    entityType: 'ContentAsset',
    entityId: asset.id,
    after: { title: asset.title, file: file.originalName },
  });

  return asset;
}

/**
 * Publishes a new version of an asset. The previous version is kept and linked,
 * so a lesson that referenced it still resolves and the audit trail shows what
 * learners were actually given at the time.
 */
export async function replaceAsset(
  principal: Principal,
  assetId: string,
  input: { fileId: string; note?: string },
) {
  requirePermission(principal, 'content.manage');
  const institutionId = principal.institutionId;

  const existing = await prisma.contentAsset.findFirst({
    where: { id: assetId, institutionId: institutionId ?? undefined },
    select: {
      id: true, title: true, description: true, tags: true, folderId: true,
      version: true, isRestricted: true, replacedBy: { select: { id: true } },
    },
  });
  if (!existing) throw new NotFoundError('Asset');
  if (existing.replacedBy) {
    throw new AppError('This version has already been superseded.', 409, 'already_replaced');
  }

  const asset = await prisma.contentAsset.create({
    data: {
      institutionId: institutionId!,
      fileId: input.fileId,
      folderId: existing.folderId,
      title: existing.title,
      description: input.note ?? existing.description,
      tags: existing.tags,
      isRestricted: existing.isRestricted,
      version: existing.version + 1,
      replacesId: existing.id,
      uploadedById: principal.userId,
    },
  });

  await recordAudit(principal, {
    action: 'content.asset_replaced',
    entityType: 'ContentAsset',
    entityId: asset.id,
    before: { version: existing.version },
    after: { version: asset.version, replaces: existing.id },
  });

  return asset;
}

export async function assetVersionHistory(principal: Principal, assetId: string) {
  requirePermission(principal, 'content.read');

  const versions: { id: string; version: number; updatedAt: Date; title: string }[] = [];
  let cursor: string | null = assetId;

  // Walk back down the replaces chain. Bounded so a corrupt link cannot loop.
  for (let steps = 0; cursor && steps < 50; steps += 1) {
    const asset: { id: string; version: number; updatedAt: Date; title: string; replacesId: string | null } | null =
      await prisma.contentAsset.findFirst({
        where: { id: cursor, institutionId: principal.institutionId ?? undefined },
        select: { id: true, version: true, updatedAt: true, title: true, replacesId: true },
      });
    if (!asset) break;
    versions.push({ id: asset.id, version: asset.version, updatedAt: asset.updatedAt, title: asset.title });
    cursor = asset.replacesId;
  }

  return versions;
}
