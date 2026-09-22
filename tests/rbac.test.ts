import { describe, expect, it } from 'vitest';
import {
  can,
  canViewStudent,
  requirePermission,
  requireSameInstitution,
  type Principal,
  type ResourceScope,
} from '@/lib/rbac/authorize';
import { AuthorisationError } from '@/lib/errors';
import { ALL_PERMISSIONS } from '@/lib/rbac/permissions';

const INSTITUTION = 'inst_kopano';
const OTHER_INSTITUTION = 'inst_other';

const courseScope: ResourceScope = {
  institutionId: INSTITUTION,
  facultyId: 'fac_business',
  departmentId: 'dep_admin',
  programmeId: 'prog_hcbm',
  courseOfferingId: 'off_bus101',
};

const otherCourseScope: ResourceScope = {
  institutionId: INSTITUTION,
  facultyId: 'fac_science',
  departmentId: 'dep_maths',
  programmeId: 'prog_dipsci',
  courseOfferingId: 'off_mat101',
};

function principal(overrides: Partial<Principal>): Principal {
  return {
    userId: 'usr_1',
    institutionId: INSTITUTION,
    email: 'person@kopano.example.ac.za',
    displayName: 'Test Person',
    isSuperAdmin: false,
    grants: [],
    studentId: null,
    ...overrides,
  };
}

describe('scope cascade', () => {
  it('lets a faculty grant reach a course inside that faculty', () => {
    const facultyAdmin = principal({
      grants: [
        {
          roleKey: 'FACULTY_ADMIN',
          scopeType: 'FACULTY',
          scopeId: 'fac_business',
          institutionId: INSTITUTION,
          permissions: ['course.manage'],
        },
      ],
    });

    expect(can(facultyAdmin, 'course.manage', courseScope)).toBe(true);
    expect(can(facultyAdmin, 'course.manage', otherCourseScope)).toBe(false);
  });

  it('keeps a course grant inside its own course', () => {
    const lecturer = principal({
      grants: [
        {
          roleKey: 'LECTURER',
          scopeType: 'COURSE',
          scopeId: 'off_bus101',
          institutionId: INSTITUTION,
          permissions: ['submission.grade'],
        },
      ],
    });

    expect(can(lecturer, 'submission.grade', courseScope)).toBe(true);
    expect(can(lecturer, 'submission.grade', otherCourseScope)).toBe(false);
  });
});

describe('permission boundaries between roles', () => {
  const financeOfficer = principal({
    grants: [
      {
        roleKey: 'FINANCE_OFFICER',
        scopeType: 'INSTITUTION',
        scopeId: null,
        institutionId: INSTITUTION,
        permissions: ['finance.read', 'finance.manage', 'pop.review', 'student.read'],
      },
    ],
  });

  it('denies a finance officer access to academic records', () => {
    expect(can(financeOfficer, 'academic_record.read', courseScope)).toBe(false);
    expect(() => requirePermission(financeOfficer, 'academic_record.read', courseScope)).toThrow(
      AuthorisationError,
    );
  });

  it('denies an ordinary learner the administrative permissions', () => {
    const student = principal({
      studentId: 'stu_1',
      grants: [
        {
          roleKey: 'STUDENT',
          scopeType: 'INSTITUTION',
          scopeId: null,
          institutionId: INSTITUTION,
          permissions: ['student.self', 'course.read', 'assessment.read'],
        },
      ],
    });

    expect(can(student, 'user.manage')).toBe(false);
    expect(can(student, 'grade.publish', courseScope)).toBe(false);
    expect(can(student, 'audit.read')).toBe(false);
  });

  it('gives the super administrator everything', () => {
    const superAdmin = principal({
      isSuperAdmin: true,
      institutionId: null,
      grants: [
        {
          roleKey: 'SUPER_ADMIN',
          scopeType: 'INSTITUTION',
          scopeId: null,
          institutionId: null,
          permissions: ALL_PERMISSIONS,
        },
      ],
    });

    expect(can(superAdmin, 'audit.read', otherCourseScope)).toBe(true);
    expect(() => requireSameInstitution(superAdmin, OTHER_INSTITUTION)).not.toThrow();
  });
});

describe('student record privacy', () => {
  const student = principal({
    userId: 'usr_student',
    studentId: 'stu_1',
    grants: [
      {
        roleKey: 'STUDENT',
        scopeType: 'INSTITUTION',
        scopeId: null,
        institutionId: INSTITUTION,
        permissions: ['student.self', 'course.read'],
      },
    ],
  });

  it('lets a learner read their own record', () => {
    expect(canViewStudent(student, 'stu_1', courseScope)).toBe(true);
  });

  it('stops a learner reading another learner record', () => {
    expect(canViewStudent(student, 'stu_2', courseScope)).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('rejects a record from another institution', () => {
    const admin = principal({
      grants: [
        {
          roleKey: 'INSTITUTION_ADMIN',
          scopeType: 'INSTITUTION',
          scopeId: null,
          institutionId: INSTITUTION,
          permissions: ['student.read'],
        },
      ],
    });

    expect(() => requireSameInstitution(admin, INSTITUTION)).not.toThrow();
    expect(() => requireSameInstitution(admin, OTHER_INSTITUTION)).toThrow(AuthorisationError);
    expect(can(admin, 'student.read', { ...courseScope, institutionId: OTHER_INSTITUTION })).toBe(false);
  });
});

describe('time limited grants', () => {
  it('ignores a grant that has expired', () => {
    const examiner = principal({
      grants: [
        {
          roleKey: 'EXTERNAL_EXAMINER',
          scopeType: 'COURSE',
          scopeId: 'off_bus101',
          institutionId: INSTITUTION,
          permissions: ['moderation.perform'],
          expiresAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });

    expect(can(examiner, 'moderation.perform', courseScope, new Date('2025-12-01'))).toBe(true);
    expect(can(examiner, 'moderation.perform', courseScope, new Date('2026-02-01'))).toBe(false);
  });
});
