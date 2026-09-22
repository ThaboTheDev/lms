import { describe, expect, it } from 'vitest';
import { maskIdentityNumber, projectStudent, type StudentRecord } from '@/server/services/student-view';
import type { Principal, ResourceScope } from '@/lib/rbac/authorize';

const scope: ResourceScope = { institutionId: 'inst_1' };

const record: StudentRecord = {
  id: 'stu_1',
  studentNumber: '202600001',
  firstName: 'Lerato',
  lastName: 'Mokoena',
  preferredName: null,
  email: 'lerato@example.ac.za',
  phone: '0821234567',
  admissionStatus: 'REGISTERED',
  city: 'Vereeniging',
  province: 'Gauteng',
  homeLanguage: 'Sesotho',
  nationalIdRef: '9001015800087',
  passportNumber: null,
  dateOfBirth: new Date('1990-01-01'),
  nationality: 'South African',
  addressLine1: '12 Example Street',
  addressLine2: null,
  postalCode: '1930',
  emergencyName: 'M Mokoena',
  emergencyPhone: '0829876543',
  emergencyRelation: 'Mother',
  supportNeeds: 'Extra time in written assessments',
  supportConsentAt: new Date('2026-01-20'),
};

function principal(permissions: string[], overrides: Partial<Principal> = {}): Principal {
  return {
    userId: 'usr_1',
    institutionId: 'inst_1',
    email: 'staff@example.ac.za',
    displayName: 'Staff Member',
    isSuperAdmin: false,
    studentId: null,
    grants: [
      {
        roleKey: 'TEST',
        scopeType: 'INSTITUTION',
        scopeId: null,
        institutionId: 'inst_1',
        permissions: permissions as never,
      },
    ],
    ...overrides,
  };
}

describe('student field projection', () => {
  it('hides identity and next of kin from a viewer with only student.read', () => {
    const view = projectStudent(principal(['student.read']), record, scope);
    expect(view.fullName).toBe('Lerato Mokoena');
    expect(view.identity).toBeUndefined();
    expect(view.contact).toBeUndefined();
    expect(view.supportNeeds).toBeUndefined();
    expect(view.restrictedFieldsHidden).toBe(true);
  });

  it('shows them to a registrar holding the sensitive permission', () => {
    const view = projectStudent(principal(['student.read', 'student.read.sensitive']), record, scope);
    expect(view.identity?.nationalIdRef).toBe('9001015800087');
    expect(view.contact?.emergencyName).toBe('M Mokoena');
    expect(view.restrictedFieldsHidden).toBe(false);
  });

  it('lets a learner see their own full record', () => {
    const learner = principal(['student.self'], { studentId: 'stu_1' });
    const view = projectStudent(learner, record, scope);
    expect(view.identity?.dateOfBirth).toEqual(new Date('1990-01-01'));
  });

  it('refuses to project a record the viewer may not read', () => {
    const outsider = principal(['finance.read'], { studentId: 'stu_2' });
    expect(() => projectStudent(outsider, record, scope)).toThrow();
  });

  it('withholds disclosed support needs until consent is recorded', () => {
    const registrar = principal(['student.read', 'student.read.sensitive']);
    const withConsent = projectStudent(registrar, record, scope);
    expect(withConsent.supportNeeds).toBe('Extra time in written assessments');

    const withoutConsent = projectStudent(registrar, { ...record, supportConsentAt: null }, scope);
    expect(withoutConsent.supportNeeds).toBeNull();
  });

  it('masks all but the last four digits of an identity number', () => {
    expect(maskIdentityNumber('9001015800087')).toBe('•••••••••0087');
    expect(maskIdentityNumber(null)).toBeNull();
  });
});
