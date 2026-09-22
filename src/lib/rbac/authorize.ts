import { AuthorisationError } from '@/lib/errors';
import { ALL_PERMISSIONS, type PermissionKey } from './permissions';

export type ScopeType = 'INSTITUTION' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAMME' | 'COURSE';

export interface RoleGrant {
  roleKey: string;
  scopeType: ScopeType;
  /** null for an institution-wide grant. */
  scopeId: string | null;
  institutionId: string | null;
  permissions: PermissionKey[] | typeof ALL_PERMISSIONS;
  expiresAt?: Date | null;
}

export interface Principal {
  userId: string;
  institutionId: string | null;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  grants: RoleGrant[];
  /** Present when the signed-in user is also a learner. */
  studentId?: string | null;
}

/**
 * Where a resource sits in the academic hierarchy. A grant made higher up the
 * chain covers everything below it: a faculty administrator can act on the
 * programmes and courses inside that faculty without a separate grant for each.
 */
export interface ResourceScope {
  institutionId: string;
  facultyId?: string | null;
  departmentId?: string | null;
  programmeId?: string | null;
  courseOfferingId?: string | null;
}

function grantIsLive(grant: RoleGrant, now: Date): boolean {
  return !grant.expiresAt || grant.expiresAt > now;
}

function grantCoversScope(grant: RoleGrant, scope: ResourceScope): boolean {
  if (grant.institutionId && grant.institutionId !== scope.institutionId) return false;

  switch (grant.scopeType) {
    case 'INSTITUTION':
      return true;
    case 'FACULTY':
      return !!scope.facultyId && grant.scopeId === scope.facultyId;
    case 'DEPARTMENT':
      return !!scope.departmentId && grant.scopeId === scope.departmentId;
    case 'PROGRAMME':
      return !!scope.programmeId && grant.scopeId === scope.programmeId;
    case 'COURSE':
      return !!scope.courseOfferingId && grant.scopeId === scope.courseOfferingId;
    default:
      return false;
  }
}

function grantHasPermission(grant: RoleGrant, permission: PermissionKey): boolean {
  return grant.permissions === ALL_PERMISSIONS || grant.permissions.includes(permission);
}

/**
 * Returns true when the principal holds `permission` for the given resource.
 * Omitting the scope asks the weaker question "does this person hold the
 * permission anywhere?", which is what navigation and menu visibility need.
 */
export function can(
  principal: Principal,
  permission: PermissionKey,
  scope?: ResourceScope,
  now: Date = new Date(),
): boolean {
  if (principal.isSuperAdmin) return true;

  return principal.grants.some((grant) => {
    if (!grantIsLive(grant, now)) return false;
    if (!grantHasPermission(grant, permission)) return false;
    if (!scope) return true;
    return grantCoversScope(grant, scope);
  });
}

/** True when the principal holds every listed permission. */
export function canAll(principal: Principal, permissions: PermissionKey[], scope?: ResourceScope) {
  return permissions.every((p) => can(principal, p, scope));
}

/** True when the principal holds at least one of the listed permissions. */
export function canAny(principal: Principal, permissions: PermissionKey[], scope?: ResourceScope) {
  return permissions.some((p) => can(principal, p, scope));
}

/** Throws AuthorisationError, which the API and page layers render as 403. */
export function requirePermission(
  principal: Principal,
  permission: PermissionKey,
  scope?: ResourceScope,
): void {
  if (!can(principal, permission, scope)) {
    throw new AuthorisationError();
  }
}

/**
 * Tenant guard. Every query that loads a record by id must also prove the
 * record belongs to the caller's institution, otherwise an id from one tenant
 * could be replayed against another.
 */
export function requireSameInstitution(principal: Principal, institutionId: string): void {
  if (principal.isSuperAdmin) return;
  if (principal.institutionId !== institutionId) {
    throw new AuthorisationError('This record belongs to another institution.');
  }
}

/**
 * Students may always read their own record. Anyone else needs student.read in
 * the relevant scope. This is the check that stops one learner reading another
 * learner's results.
 */
export function canViewStudent(
  principal: Principal,
  studentId: string,
  scope: ResourceScope,
): boolean {
  if (principal.studentId && principal.studentId === studentId) return true;
  return can(principal, 'student.read', scope);
}

export function listPermissions(principal: Principal): PermissionKey[] | typeof ALL_PERMISSIONS {
  if (principal.isSuperAdmin) return ALL_PERMISSIONS;
  const set = new Set<PermissionKey>();
  for (const grant of principal.grants) {
    if (grant.permissions === ALL_PERMISSIONS) return ALL_PERMISSIONS;
    grant.permissions.forEach((p) => set.add(p));
  }
  return [...set];
}
