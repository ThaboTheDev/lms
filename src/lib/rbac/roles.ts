import { ALL_PERMISSIONS, type PermissionKey } from './permissions';

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[] | typeof ALL_PERMISSIONS;
}

/**
 * Seeded on first boot and re-synced by `npm run rbac:sync`. Institutions may
 * clone any of these into a custom role; the system roles themselves are not
 * editable, which keeps an accidental permission removal from locking everyone
 * out of the platform.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super administrator',
    description: 'Platform owner with unrestricted access across all institutions.',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'INSTITUTION_ADMIN',
    name: 'Institutional administrator',
    description: 'Runs one institution: people, settings, branding and oversight.',
    permissions: [
      'institution.read', 'institution.manage', 'settings.manage', 'integration.manage',
      'user.read', 'user.manage', 'role.read', 'role.manage', 'role.assign',
      'student.read', 'student.manage', 'enrolment.read', 'enrolment.manage',
      'application.read', 'application.manage', 'academic_record.read',
      'programme.read', 'programme.manage', 'course.read', 'course.manage',
      'content.read', 'content.manage', 'assessment.read', 'attendance.read',
      'calendar.manage', 'announcement.publish', 'message.send',
      'finance.read', 'certificate.read', 'report.read', 'analytics.read', 'audit.read',
      'ticket.read', 'ticket.manage',
    ],
  },
  {
    key: 'ACADEMIC_ADMIN',
    name: 'Academic administrator',
    description: 'Owns programmes, curriculum and the academic structure.',
    permissions: [
      'institution.read', 'user.read', 'student.read', 'enrolment.read',
      'programme.read', 'programme.manage', 'course.read', 'course.manage',
      'content.read', 'content.manage', 'assessment.read', 'assessment.manage',
      'question_bank.read', 'academic_record.read', 'calendar.manage',
      'announcement.publish', 'message.send', 'report.read', 'qa.manage',
      // The academic office releases results in most institutions; without
      // this only a programme coordinator could, and many have none.
      'submission.read', 'grade.publish',
    ],
  },
  {
    key: 'REGISTRAR',
    name: 'Registrar',
    description: 'Custodian of student records, enrolment, progression and certificates.',
    permissions: [
      'institution.read', 'user.read', 'student.read', 'student.read.sensitive', 'student.manage',
      'enrolment.read', 'enrolment.manage', 'application.read', 'application.manage',
      'academic_record.read', 'academic_record.manage', 'programme.read', 'course.read',
      'certificate.read', 'certificate.issue', 'report.read', 'audit.read',
      'announcement.publish', 'message.send',
    ],
  },
  {
    key: 'FACULTY_ADMIN',
    name: 'Faculty administrator',
    description: 'Manages departments and programmes within one faculty.',
    permissions: [
      'institution.read', 'user.read', 'student.read', 'enrolment.read',
      'programme.read', 'programme.manage', 'course.read', 'course.manage',
      'assessment.read', 'attendance.read', 'report.read', 'announcement.publish',
      'message.send', 'calendar.manage',
    ],
  },
  {
    key: 'PROGRAMME_COORDINATOR',
    name: 'Programme coordinator',
    description: 'Runs a programme: modules, lecturers, learners and delivery.',
    permissions: [
      'institution.read', 'user.read', 'student.read', 'enrolment.read', 'enrolment.manage',
      'programme.read', 'course.read', 'course.manage', 'course.teach',
      'content.read', 'content.manage', 'assessment.read', 'assessment.manage',
      'question_bank.read', 'submission.read', 'grade.publish',
      'attendance.read', 'attendance.manage', 'calendar.manage',
      'announcement.publish', 'message.send', 'forum.moderate', 'report.read', 'analytics.read',
    ],
  },
  {
    key: 'LECTURER',
    name: 'Lecturer',
    description: 'Teaches assigned courses, authors content and marks work.',
    permissions: [
      'institution.read', 'course.read', 'course.teach', 'content.read', 'content.manage',
      'assessment.read', 'assessment.manage', 'question_bank.read', 'question_bank.manage',
      'submission.read', 'submission.grade', 'attendance.read', 'attendance.manage',
      'student.read', 'announcement.publish', 'message.send', 'forum.moderate',
      'calendar.manage', 'analytics.read',
    ],
  },
  {
    key: 'FACILITATOR',
    name: 'Facilitator',
    description: 'Delivers learning activities and monitors learner participation.',
    permissions: [
      'institution.read', 'course.read', 'course.teach', 'content.read',
      'assessment.read', 'submission.read', 'attendance.read', 'attendance.manage',
      'student.read', 'message.send', 'forum.moderate', 'analytics.read',
    ],
  },
  {
    key: 'ASSESSOR',
    name: 'Assessor',
    description: 'Assesses learner submissions and records outcomes.',
    permissions: [
      'institution.read', 'course.read', 'content.read', 'assessment.read',
      'submission.read', 'submission.grade', 'student.read', 'message.send',
    ],
  },
  {
    key: 'MODERATOR',
    name: 'Moderator',
    description: 'Moderates assessment instruments and marking.',
    permissions: [
      'institution.read', 'course.read', 'assessment.read', 'submission.read',
      'moderation.perform', 'question_bank.read', 'report.read', 'message.send',
    ],
  },
  {
    key: 'EXTERNAL_EXAMINER',
    name: 'External examiner',
    description: 'Limited, time-bound access to assigned moderation activities.',
    permissions: ['assessment.read', 'submission.read', 'moderation.perform'],
  },
  {
    key: 'STUDENT',
    name: 'Student',
    description: 'Learner access to own courses, assessments, records and account.',
    permissions: [
      'student.self', 'course.read', 'content.read', 'assessment.read',
      'message.send', 'pop.submit', 'ticket.submit',
    ],
  },
  {
    key: 'FINANCE_OFFICER',
    name: 'Finance officer',
    description: 'Manages fees, invoices, payments and proof of payment review.',
    permissions: [
      'institution.read', 'student.read', 'enrolment.read',
      'finance.read', 'finance.manage', 'pop.review',
      'report.read', 'message.send', 'ticket.read', 'ticket.manage',
    ],
  },
  {
    key: 'QA_OFFICER',
    name: 'Quality assurance officer',
    description: 'Owns moderation workflows, compliance records and academic quality.',
    permissions: [
      'institution.read', 'programme.read', 'course.read', 'assessment.read',
      'submission.read', 'moderation.perform', 'qa.manage', 'academic_record.read',
      'report.read', 'analytics.read', 'audit.read', 'message.send',
    ],
  },
  {
    key: 'SUPPORT_STAFF',
    name: 'Support staff',
    description: 'Handles learner support tickets and general assistance.',
    permissions: [
      'institution.read', 'student.read', 'course.read', 'enrolment.read',
      'ticket.read', 'ticket.manage', 'message.send',
    ],
  },
];

export const SYSTEM_ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);
