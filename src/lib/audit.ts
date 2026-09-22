import 'server-only';
import { prisma } from './db';
import { hashIp } from './crypto';
import { readClientContext } from './auth/session';
import type { Principal } from './rbac/authorize';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  institutionId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Fields that must never be written to the audit trail. */
const REDACTED = new Set([
  'passwordHash', 'password', 'mfaSecret', 'mfaRecoveryHashes',
  'tokenHash', 'nationalIdRef', 'passportNumber',
]);

function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      REDACTED.has(k) ? [k, '[redacted]'] : [k, redact(v)],
    ),
  );
}

/**
 * Records an administrative action. Auditing must never break the operation it
 * describes, so a logging failure is swallowed and reported to the server log.
 */
export async function recordAudit(principal: Principal | null, entry: AuditEntry): Promise<void> {
  try {
    const context = await readClientContext();
    await prisma.auditLog.create({
      data: {
        institutionId: entry.institutionId ?? principal?.institutionId ?? null,
        actorId: principal?.userId ?? null,
        actorEmail: principal?.email ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: redact(entry.before) as never,
        after: redact(entry.after) as never,
        ipHash: hashIp(context.ipAddress),
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record entry', entry.action, error);
  }
}
