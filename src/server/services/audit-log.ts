import 'server-only';
import { prisma } from '@/lib/db';
import { requirePermission, type Principal } from '@/lib/rbac/authorize';
import { SENSITIVE_ACTIONS, summariseActions, type AuditRow } from './audit-view';

export interface AuditFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string;
  query?: string;
  from?: Date;
  to?: Date;
  sensitiveOnly?: boolean;
}

/**
 * The audit log as something a person can work with. Bounded pages and indexed
 * filters, because this table grows faster than any other and is queried when
 * somebody is already under pressure.
 */
export async function queryAuditLog(
  principal: Principal,
  filters: AuditFilters,
  paging: { skip: number; perPage: number },
) {
  requirePermission(principal, 'audit.read');

  const where = {
    institutionId: principal.institutionId ?? undefined,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.sensitiveOnly ? { action: { in: SENSITIVE_ACTIONS } } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.query ? { actorEmail: { contains: filters.query, mode: 'insensitive' as const } } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where: where as never }),
    prisma.auditLog.findMany({
      where: where as never,
      skip: paging.skip,
      take: paging.perPage,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, action: true, entityType: true, entityId: true,
        actorEmail: true, before: true, after: true, createdAt: true,
      },
    }),
  ]);

  return { total, entries: entries as unknown as AuditRow[] };
}

/** Everything that has happened to one record, oldest first. */
export async function entityHistory(principal: Principal, entityType: string, entityId: string) {
  requirePermission(principal, 'audit.read');

  const entries = await prisma.auditLog.findMany({
    where: { entityType, entityId, institutionId: principal.institutionId ?? undefined },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: {
      id: true, action: true, entityType: true, entityId: true,
      actorEmail: true, before: true, after: true, createdAt: true,
    },
  });

  return entries as unknown as AuditRow[];
}

/** What has been happening lately, for the top of the audit screen. */
export async function auditActivity(principal: Principal, days = 30) {
  requirePermission(principal, 'audit.read');

  const since = new Date(Date.now() - days * 86_400_000);

  const [rows, actorCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { institutionId: principal.institutionId ?? undefined, createdAt: { gte: since } },
      select: { action: true },
      take: 5000,
    }),
    prisma.auditLog.groupBy({
      by: ['actorId'],
      where: { institutionId: principal.institutionId ?? undefined, createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  return {
    days,
    total: rows.length,
    actors: actorCount.length,
    actions: summariseActions(rows as { action: string }[]).slice(0, 10),
  };
}
