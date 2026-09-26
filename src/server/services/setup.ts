import { createHash, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { AppError, ValidationError } from '@/lib/errors';
import { toFieldErrors } from '@/lib/validation/common';
import {
  decideSetup,
  setupFormSchema,
  type SetupAdmin,
  type SetupField,
  type SetupInput,
} from '@/lib/validation/setup';

/**
 * First-run setup: the first institution and its first administrator, created
 * on an empty database and then never again.
 *
 * Two things here differ from the other services, on purpose:
 *
 * - No `server-only` import. scripts/bootstrap.ts runs this same code under
 *   tsx, where that guard throws. Nothing below may import a module that
 *   carries it (audit, session, tenancy, ...), which is why auditing and the
 *   session are left to the callers.
 * - The Prisma client is passed in rather than imported from @/lib/db. That
 *   module validates the web app's whole environment as it loads, and the
 *   headless script runs from the migrate container, which has DATABASE_URL
 *   and nothing else.
 */

export const SETUP_LOCK_KEY = 'lms:setup';
export const SETUP_ADMIN_ROLE_KEY = 'INSTITUTION_ADMIN';

type Db = Pick<PrismaClient, 'user' | 'institution' | 'role'>;

export interface SetupInstitution {
  id: string;
  name: string;
  slug: string;
}

export type SetupState =
  | { mode: 'closed' }
  | { mode: 'ambiguous' }
  | { mode: 'create'; rolesReady: boolean }
  | { mode: 'attach'; rolesReady: boolean; institution: SetupInstitution };

export type SetupRefusal = 'closed' | 'ambiguous' | 'changed' | 'roles_missing';

const REFUSALS: Record<SetupRefusal, string> = {
  closed: 'Setup has already been completed on this server. Sign in with the administrator account instead.',
  ambiguous:
    'This database holds more than one institution and nobody who runs them, and setup will not guess which one a new administrator belongs to.',
  changed: 'The database changed while this form was open. Reload the page to see what it says now.',
  roles_missing:
    'The system roles have not been created yet. Run `npm run rbac:sync` (the migrate service does this on every deploy), then submit again.',
};

/** A reason setup will not run right now, as opposed to a problem with the input. */
export class SetupRefusedError extends AppError {
  constructor(readonly reason: SetupRefusal) {
    super(REFUSALS[reason], 409, `setup_${reason}`);
  }
}

export interface SetupResult {
  userId: string;
  email: string;
  institution: SetupInstitution;
  institutionCreated: boolean;
}

// ------------------------------------------------------------------ state --

/**
 * `take: 1` keeps this constant-time however large the user table grows: the
 * setup page and the sign-in screen both ask it on public, unauthenticated
 * requests, long after setup has closed.
 */
function countUsers(db: Pick<Db, 'user'>): Promise<number> {
  return db.user.count({ take: 1 });
}

/** Two rows are enough to tell none, one and several apart. */
function firstInstitutions(db: Pick<Db, 'institution'>): Promise<SetupInstitution[]> {
  return db.institution.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
}

/**
 * The system role, which belongs to no institution. findFirst rather than a
 * compound-unique lookup: Prisma refuses null inside a compound unique.
 */
function findAdminRole(db: Pick<Db, 'role'>) {
  return db.role.findFirst({
    where: { key: SETUP_ADMIN_ROLE_KEY, institutionId: null },
    select: { id: true },
  });
}

/** True while nobody has an account, which is the only time setup is open. */
export async function setupPending(db: Pick<Db, 'user'>): Promise<boolean> {
  return (await countUsers(db)) === 0;
}

/** What the setup page should show. Stale the moment it returns: `completeSetup` asks again under its lock. */
export async function readSetupState(db: Db): Promise<SetupState> {
  const users = await countUsers(db);
  if (users > 0) return { mode: 'closed' };

  const [institutions, role] = await Promise.all([firstInstitutions(db), findAdminRole(db)]);
  const mode = decideSetup({ users, institutions: institutions.length });
  const rolesReady = role !== null;

  switch (mode) {
    case 'create':
      return { mode, rolesReady };
    case 'attach': {
      const institution = institutions[0];
      return institution ? { mode, rolesReady, institution } : { mode: 'ambiguous' };
    }
    default:
      return { mode };
  }
}

// ------------------------------------------------------------------ input --

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The password policy, judged against the details of the person it will protect. */
export function passwordProblems(admin: SetupAdmin): string[] {
  // An empty password already has its own message from the schema.
  if (!admin.password) return [];
  return checkPasswordPolicy(admin.password, [
    admin.firstName.trim(),
    admin.lastName.trim(),
    admin.email.trim(),
  ]).problems;
}

export type SetupSubmission =
  | { success: true; data: SetupInput }
  | { success: false; fieldErrors: Partial<Record<SetupField, string>> };

/**
 * The form's schema and the password policy in a single pass. Somebody allowed
 * five attempts an hour should see every problem at once, not one per submit.
 */
export function parseSetupSubmission(raw: Record<string, unknown>): SetupSubmission {
  const parsed = setupFormSchema.safeParse(raw);
  const fieldErrors: Partial<Record<SetupField, string>> = parsed.success
    ? {}
    : toFieldErrors(parsed.error);

  const problems = passwordProblems({
    firstName: text(raw.firstName),
    lastName: text(raw.lastName),
    email: text(raw.email),
    password: text(raw.password),
  });
  if (problems.length > 0 && !fieldErrors.password) fieldErrors.password = problems.join(' ');

  if (!parsed.success || problems.length > 0) return { success: false, fieldErrors };
  return { success: true, data: parsed.data };
}

// ------------------------------------------------------------------ token --

/**
 * Whether a submitted setup token is good enough. With no token configured
 * there is nothing to check. Both sides are hashed before the comparison, so
 * timingSafeEqual always sees two buffers of one length and a wrong guess
 * learns nothing, not even how long the real token is.
 */
export function setupTokenAccepted(configured: string | undefined, submitted: unknown): boolean {
  const expected = configured?.trim();
  if (!expected) return true;

  const offered = typeof submitted === 'string' ? submitted.trim() : '';
  if (!offered) return false;

  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(expected), digest(offered));
}

// --------------------------------------------------------------- conflicts --

/**
 * Maps a unique-constraint failure (P2002) to the field that caused it. The
 * lock and the guards make one all but impossible, so this is the backstop for
 * a write that bypassed them, such as a seed run at the same moment. The whole
 * error is searched because the native engine names the fields in
 * `meta.target` while a driver adapter reports the constraint instead.
 */
export function setupConflictFields(error: unknown): Partial<Record<SetupField, string>> | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, meta, message } = error as { code?: unknown; meta?: unknown; message?: unknown };
  if (code !== 'P2002') return null;

  const detail = `${JSON.stringify(meta ?? {})} ${typeof message === 'string' ? message : ''}`;
  if (/slug/i.test(detail)) {
    return { institutionSlug: 'Another institution already uses that short name. Choose a different one.' };
  }
  if (/email/i.test(detail)) {
    return { email: 'An account with that email address already exists.' };
  }
  return {};
}

// ----------------------------------------------------------------- setup --

/**
 * Creates the administrator, and the institution in create mode, in one
 * transaction serialised by an advisory lock. The guards are asked again
 * inside it: whatever the page saw is stale by the time the form comes back.
 *
 * Nothing here audits or signs anybody in. The audit writer uses its own
 * connection, which cannot see these rows until the transaction commits, so
 * callers record the entry (`setupAuditEntry`) once this has returned.
 */
export async function completeSetup(db: PrismaClient, input: SetupInput): Promise<SetupResult> {
  const { admin } = input;

  // Checked here as well as in the form, so no caller can skip it.
  const problems = passwordProblems(admin);
  if (problems.length > 0) {
    throw new ValidationError({ password: problems.join(' ') }, problems[0]);
  }

  // Refuse cheaply before the expensive part. argon2 is slow and memory-hungry
  // by design, and this endpoint is public.
  if (!(await setupPending(db))) throw new SetupRefusedError('closed');

  const passwordHash = await hashPassword(admin.password);

  try {
    return await db.$transaction(async (tx) => {
      // Held until commit. A second submission waits here, then finds the
      // user this one created and stops.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK_KEY}))`;

      const users = await countUsers(tx);
      const institutions = await firstInstitutions(tx);
      const mode = decideSetup({ users, institutions: institutions.length });

      if (mode === 'closed') throw new SetupRefusedError('closed');
      if (mode === 'ambiguous') throw new SetupRefusedError('ambiguous');
      if (mode !== input.mode) throw new SetupRefusedError('changed');

      const role = await findAdminRole(tx);
      if (!role) throw new SetupRefusedError('roles_missing');

      let institution: SetupInstitution;
      if (input.mode === 'create') {
        institution = await tx.institution.create({
          data: { name: input.institution.name, slug: input.institution.slug },
          select: { id: true, name: true, slug: true },
        });
      } else {
        const existing = institutions[0];
        if (!existing) throw new SetupRefusedError('changed');
        institution = existing;
      }

      const user = await tx.user.create({
        data: {
          institutionId: institution.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          passwordHash,
          status: 'ACTIVE',
          // Typed by the person standing the platform up, on the platform
          // itself. There is nobody else to confirm it to.
          emailVerifiedAt: new Date(),
        },
        select: { id: true, email: true },
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          institutionId: institution.id,
          scopeType: 'INSTITUTION',
        },
      });

      return {
        userId: user.id,
        email: user.email,
        institution,
        institutionCreated: input.mode === 'create',
      };
    });
  } catch (error) {
    const conflict = setupConflictFields(error);
    if (conflict) {
      throw new ValidationError(
        conflict,
        'That clashes with a record created a moment ago. Check the highlighted fields, or reload the page.',
      );
    }
    throw error;
  }
}

/** One audit entry for the whole setup, in the shape `recordAudit` takes. */
export function setupAuditEntry(result: SetupResult, via: 'setup_page' | 'bootstrap_script') {
  return {
    action: 'setup.completed',
    entityType: 'User',
    entityId: result.userId,
    institutionId: result.institution.id,
    after: {
      email: result.email,
      role: SETUP_ADMIN_ROLE_KEY,
      institution: result.institution.slug,
      institutionCreated: result.institutionCreated,
      via,
    },
  };
}
