# Database design

PostgreSQL 16, modelled with Prisma. 95 models, 52 enums. The full definition is
`prisma/schema.prisma`; this document explains the decisions behind it.

## Core hierarchy

```
Institution
 └── Faculty
      └── Department
           ├── Programme ──── Qualification (NQF level, credits, SAQA id)
           │    ├── ProgrammeOutcome        exit level outcomes
           │    ├── CurriculumItem ──────── Course     year + term placement
           │    └── Cohort
           └── Course
                └── CourseOffering          one delivery of a course in a term
                     ├── OfferingStaff      lecturer, facilitator, assessor, moderator
                     ├── CourseSection ──── Lesson ──── LessonBlock
                     ├── Assessment ─────── AssessmentQuestion / QuestionPool
                     ├── AttendanceSession
                     └── CourseEnrolment ── StudentProfile
```

`AcademicYear → AcademicTerm` runs alongside and is what a `CourseOffering` is
scheduled into.

### Why Course and CourseOffering are separate

A course is the approved academic definition: code, title, credits, NQF level,
outcomes. An offering is one delivery of it, in one term, with its own staff,
content, assessments and class list. Separating them means the curriculum and
its accreditation record stay stable while each intake gets its own content and
marks, and a repeat student can be enrolled in a later offering without
disturbing the earlier result.

## Conventions

- **Primary keys** are `cuid()` strings. They are unguessable, safe in URLs and
  do not leak record counts the way sequential integers do.
- **Money** is `Decimal(12,2)`, never a float. Marks are `Decimal(6,2)`,
  percentages `Decimal(5,2)`.
- **Dates** without a time component use `@db.Date` (term dates, dates of birth,
  instalment due dates).
- **Deletes** are `Restrict` where a record is part of the academic record,
  `Cascade` for owned children, `SetNull` for optional references such as a
  reviewer who has since left. Students and users are soft-deleted
  (`deletedAt`), because an academic record must survive the account.
- **Tenant scoping**: every tenant-owned table carries `institutionId` and an
  index that leads with it. Child tables inherit tenancy through their parent.
- **Authorship metadata** (`createdById`, `decidedById`, `issuedById`) is stored
  as a plain id where a reverse lookup is never needed; that keeps the `User`
  model from accumulating dozens of unused back-relations. Where the reverse
  question is real, such as "submissions I marked" or "tickets assigned to me",
  it is a proper foreign key.

## Indexing

| Pattern | Index |
| --- | --- |
| Tenant listing | `@@index([institutionId, status])` on the large tables |
| Learner lookups | `@@unique([institutionId, studentNumber])` |
| Marking queue | `@@index([assessmentId, status])` on `Submission` |
| Proof of payment dashboard | `@@index([institutionId, status, submittedAt])` and `@@index([reference])` |
| Audit search | `@@index([entityType, entityId])` and `@@index([actorId, createdAt])` |
| Certificate verification | unique `verificationCode` and unique `number` |

The proof of payment indexes matter at the volumes this system is meant for: a
20 000 learner intake generates that many documents in a single enrolment
window, and the review dashboard filters by status and searches by reference.

## Integrity rules worth knowing

- `CourseEnrolment` is unique on `(studentId, offeringId)`: no double enrolment.
- `Submission` is unique on `(assessmentId, studentId, attemptNumber)`, so a
  retry creates a new attempt rather than overwriting the first one.
- `ProgressionDecision` is unique on `(studentId, programmeId, academicYearId)`:
  one progression outcome per student per year.
- `ProofOfPayment.paymentId` is unique, so one document can only ever clear one
  payment. Duplicates are recorded with status `DUPLICATE` rather than deleted.
- `Certificate.number` and `Certificate.verificationCode` are both unique. The
  verification code is what the public page accepts; the certificate number is
  what appears on the document.

## Retention and privacy

`AuditLog` holds a hashed IP address, never the address. `User.mfaSecret`,
`passwordHash`, `Session.tokenHash` and `StudentProfile.nationalIdRef` are never
written to the audit trail. Retention windows per record type are configured
per institution in `SystemSetting` and enforced by a scheduled job in Phase 9.

## Migrations

```bash
npm run db:migrate -- --name add_examination_windows   # development
npm run db:deploy                                      # CI and production
```

Migrations are reviewed like code. Destructive changes to academic record tables
require a data migration that preserves history: results, certificates and
progression decisions are the institution's statutory record.

## Backups

- Postgres: nightly base backup plus continuous WAL archiving to object storage,
  giving point-in-time recovery. Retain 35 days.
- Object storage: versioning enabled, lifecycle rule to cold storage after 90
  days, cross-region replication for the certificate and submission buckets.
- Verification: a weekly job restores the latest backup into a scratch database
  and runs a row-count and checksum comparison. A backup that has not been
  restored is not a backup.
- Recovery targets: RPO 15 minutes, RTO 4 hours.
