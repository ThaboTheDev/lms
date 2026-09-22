import { can, canViewStudent, type Principal, type ResourceScope } from '@/lib/rbac/authorize';

export interface StudentRecord {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string;
  phone: string | null;
  admissionStatus: string;
  city: string | null;
  province: string | null;
  homeLanguage: string | null;
  // fields below are restricted
  nationalIdRef: string | null;
  passportNumber: string | null;
  dateOfBirth: Date | null;
  nationality: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
  supportNeeds: string | null;
  supportConsentAt: Date | null;
}

export interface StudentView {
  id: string;
  studentNumber: string;
  fullName: string;
  preferredName: string | null;
  email: string;
  phone: string | null;
  admissionStatus: string;
  city: string | null;
  province: string | null;
  homeLanguage: string | null;
  /** Present only when the viewer holds student.read.sensitive or is the student. */
  identity?: {
    nationalIdRef: string | null;
    passportNumber: string | null;
    dateOfBirth: Date | null;
    nationality: string | null;
  };
  contact?: {
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    emergencyRelation: string | null;
  };
  /** Disclosed support needs, released only with the learner's recorded consent. */
  supportNeeds?: string | null;
  restrictedFieldsHidden: boolean;
}

/**
 * Single place where a student record becomes something a given viewer may see.
 * Every screen and endpoint projects through this, so a field cannot leak by
 * being added to one query and forgotten in another.
 *
 * The split is deliberate: `student.read` shows who a learner is and where they
 * are in their studies, which is what a lecturer or support officer needs.
 * Identity numbers, home address and next of kin need `student.read.sensitive`,
 * which only the registrar-type roles hold. Learners always see their own file.
 */
export function projectStudent(
  principal: Principal,
  record: StudentRecord,
  scope: ResourceScope,
): StudentView {
  const isSelf = principal.studentId === record.id;

  if (!isSelf && !canViewStudent(principal, record.id, scope)) {
    throw new Error('projectStudent called without a prior permission check');
  }

  const sensitive = isSelf || can(principal, 'student.read.sensitive', scope);

  const view: StudentView = {
    id: record.id,
    studentNumber: record.studentNumber,
    fullName: `${record.firstName} ${record.lastName}`,
    preferredName: record.preferredName,
    email: record.email,
    phone: record.phone,
    admissionStatus: record.admissionStatus,
    city: record.city,
    province: record.province,
    homeLanguage: record.homeLanguage,
    restrictedFieldsHidden: !sensitive,
  };

  if (sensitive) {
    view.identity = {
      nationalIdRef: record.nationalIdRef,
      passportNumber: record.passportNumber,
      dateOfBirth: record.dateOfBirth,
      nationality: record.nationality,
    };
    view.contact = {
      addressLine1: record.addressLine1,
      addressLine2: record.addressLine2,
      postalCode: record.postalCode,
      emergencyName: record.emergencyName,
      emergencyPhone: record.emergencyPhone,
      emergencyRelation: record.emergencyRelation,
    };
    // Support needs are released only when the learner recorded consent, even
    // to a viewer who otherwise holds the sensitive permission.
    view.supportNeeds = record.supportConsentAt ? record.supportNeeds : null;
  }

  return view;
}

/** Masks all but the last four digits, for the rare screen that must show one. */
export function maskIdentityNumber(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(value.length - 4)}${value.slice(-4)}`;
}
