/**
 * The permission catalogue is the single source of truth for what the system
 * can authorise. Roles are just named bundles of these keys, and administrators
 * may compose their own bundles, so new capabilities are added here first and
 * synced to the database with `npm run rbac:sync`.
 *
 * Key format: <resource>.<action>
 */
export const PERMISSIONS = {
  // institution and configuration
  'institution.read': { group: 'Institution', description: 'View institution profile and branding' },
  'institution.manage': { group: 'Institution', description: 'Edit institution profile, branding and settings' },
  'settings.manage': { group: 'Institution', description: 'Change system configuration' },
  'integration.manage': { group: 'Institution', description: 'Configure external integrations' },

  // people and access
  'user.read': { group: 'People', description: 'View staff and user accounts' },
  'user.manage': { group: 'People', description: 'Create, edit, suspend and invite users' },
  'role.read': { group: 'People', description: 'View roles and permissions' },
  'role.manage': { group: 'People', description: 'Create roles and assign permissions' },
  'role.assign': { group: 'People', description: 'Grant or revoke roles for users' },

  // students and records
  'student.read': { group: 'Students', description: 'View student profiles in scope' },
  'student.read.sensitive': { group: 'Students', description: 'View restricted student fields' },
  'student.manage': { group: 'Students', description: 'Create and edit student records' },
  'student.self': { group: 'Students', description: 'View and edit own student profile' },
  'enrolment.read': { group: 'Students', description: 'View enrolments' },
  'enrolment.manage': { group: 'Students', description: 'Enrol, transfer and withdraw students' },
  'application.read': { group: 'Admissions', description: 'View applications' },
  'application.manage': { group: 'Admissions', description: 'Process and decide applications' },
  'academic_record.read': { group: 'Records', description: 'View transcripts and academic records' },
  'academic_record.manage': { group: 'Records', description: 'Amend academic records and progression' },

  // academic structure
  'programme.read': { group: 'Academic', description: 'View programmes and curriculum' },
  'programme.manage': { group: 'Academic', description: 'Create and edit programmes and curriculum' },
  'course.read': { group: 'Academic', description: 'View courses and offerings' },
  'course.manage': { group: 'Academic', description: 'Create and edit courses and offerings' },
  'course.teach': { group: 'Academic', description: 'Author content and run an assigned course' },
  'content.read': { group: 'Content', description: 'View the content library' },
  'content.manage': { group: 'Content', description: 'Upload and organise learning content' },

  // assessment
  'assessment.read': { group: 'Assessment', description: 'View assessments' },
  'assessment.manage': { group: 'Assessment', description: 'Create and configure assessments' },
  'question_bank.read': { group: 'Assessment', description: 'View question banks' },
  'question_bank.manage': { group: 'Assessment', description: 'Create and edit questions' },
  'submission.read': { group: 'Assessment', description: 'View learner submissions' },
  'submission.grade': { group: 'Assessment', description: 'Mark submissions and give feedback' },
  'grade.publish': { group: 'Assessment', description: 'Release results to learners' },
  'moderation.perform': { group: 'Quality', description: 'Moderate assessments and marks' },
  'qa.manage': { group: 'Quality', description: 'Manage quality assurance records and reviews' },

  // delivery
  'attendance.read': { group: 'Delivery', description: 'View attendance' },
  'attendance.manage': { group: 'Delivery', description: 'Mark and amend attendance' },
  'calendar.manage': { group: 'Delivery', description: 'Manage institutional calendar entries' },
  'announcement.publish': { group: 'Communication', description: 'Publish announcements' },
  'message.send': { group: 'Communication', description: 'Send internal messages' },
  'forum.moderate': { group: 'Communication', description: 'Moderate discussion forums' },

  // finance
  'finance.read': { group: 'Finance', description: 'View invoices, payments and balances' },
  'finance.manage': { group: 'Finance', description: 'Issue invoices and capture payments' },
  'pop.review': { group: 'Finance', description: 'Review proof of payment submissions' },
  'pop.submit': { group: 'Finance', description: 'Upload proof of payment' },

  // credentials
  'certificate.read': { group: 'Credentials', description: 'View issued certificates' },
  'certificate.issue': { group: 'Credentials', description: 'Issue and revoke certificates' },

  // support and oversight
  'ticket.read': { group: 'Support', description: 'View support tickets' },
  'ticket.manage': { group: 'Support', description: 'Assign and resolve support tickets' },
  'ticket.submit': { group: 'Support', description: 'Raise a support ticket' },
  'report.read': { group: 'Reporting', description: 'View institutional reports' },
  'analytics.read': { group: 'Reporting', description: 'View learning analytics' },
  'audit.read': { group: 'Reporting', description: 'Read the audit log' },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return value in PERMISSIONS;
}

/** Wildcard used only by the platform super administrator. */
export const ALL_PERMISSIONS = '*' as const;
