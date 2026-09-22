# Architecture

## Shape of the system

```
browser
  │  HTTPS
  ▼
Next.js (App Router)
  ├── middleware.ts          edge gate: is a session cookie present
  ├── app/(auth)/*           public: sign in, password reset, apply
  ├── app/(app)/*            authenticated pages, server components
  ├── app/verify/*           public certificate verification
  └── app/api/v1/*           JSON API for integrations and the mobile client
        │
        ▼
  src/lib (domain services)
    auth · rbac · audit · mail · storage · queue · http · i18n
        │
        ▼
  Prisma ──► PostgreSQL          S3-compatible storage      Redis (queue, rate limit)
```

Pages are server components. Student data is fetched on the server and only the
rendered result reaches the browser, so a permission failure cannot be bypassed
by reading a client bundle or an over-broad API response.

## Request lifecycle for a protected page

1. `middleware.ts` checks that a session cookie exists and redirects to `/login`
   if it does not. It does no database work: the edge runtime has no connection.
2. `app/(app)/layout.tsx` calls `getCurrentPrincipal()`, which validates the
   session against the database, enforces the absolute and idle timeouts and
   loads the user's role grants.
3. The page calls `requirePermission(principal, '<permission>', scope)`.
4. Queries are scoped to `principal.institutionId`. A record loaded by id is
   re-checked with `requireSameInstitution`.
5. Mutations call `recordAudit(...)` with the before and after values.

## Modules

Each module owns its models, its permissions and its services. Nothing reaches
across a module boundary except through an exported service function.

| Module | Owns |
| --- | --- |
| Identity | User, Session, AuthToken, LoginAttempt, password policy, MFA |
| Access | Role, Permission, UserRole, the authorisation engine |
| Institution | Institution, branding, SystemSetting, EmailTemplate |
| Academic structure | Faculty, Department, Qualification, Programme, Course, Curriculum, AcademicYear, AcademicTerm, CourseOffering |
| People | StudentProfile, StaffProfile, Cohort |
| Admissions | Application, ApplicationDocument, ApplicationEvent |
| Enrolment | ProgrammeEnrolment, CourseEnrolment |
| Content | FileObject, ContentFolder, ContentAsset, CourseSection, Lesson, LessonBlock |
| Progress | LessonProgress, CourseProgress |
| Assessment | Assessment, Question, QuestionBank, QuestionPool, Submission, QuestionResponse |
| Grading | Rubric, RubricCriterion, RubricLevel, RubricScore, GradingScheme, GradeBand |
| Quality | ModerationRecord, QaDocument, ProgrammeReview |
| Records | ProgressionDecision, TranscriptSnapshot, Certificate, CertificateVerification |
| Delivery | AttendanceSession, AttendanceRecord, LiveSession, CalendarEvent |
| Communication | Forum, MessageThread, Message, Announcement, Notification |
| Finance | FeeStructure, Invoice, Payment, ProofOfPayment, Receipt, PaymentPlan, Discount, Refund |
| Support | SupportTicket, TicketMessage |
| Oversight | AuditLog, AtRiskFlag, reporting queries |

## Access control

Three concepts, kept deliberately separate:

- **Permission** - a capability such as `submission.grade`. Declared once in
  `src/lib/rbac/permissions.ts`.
- **Role** - a named bundle of permissions. Fifteen system roles ship with the
  platform; administrators can compose their own.
- **Grant** - a role given to a user *at a scope*: institution, faculty,
  department, programme or course offering.

A grant made higher in the hierarchy covers everything below it, so a faculty
administrator does not need a separate grant for each programme. Grants may
carry an expiry, which is how an external examiner gets time-bound access.

`can(principal, permission, scope)` answers the question. Called without a scope
it asks the weaker "anywhere?" question, which is what menu visibility needs.
Navigation is built from the same function, so the rail never shows a page the
person cannot open, and the page still enforces the check itself.

## Multi-tenancy

One database, one schema, an `institutionId` on every tenant-owned table, and a
composite index that leads with it. Every query filters on the caller's
institution; every record loaded by id is re-checked. Storage keys are prefixed
with the institution id so object storage is partitioned the same way.

This gives one migration path, one connection pool and cheap cross-institution
reporting for the platform owner. Postgres row level security can be layered on
later for defence in depth without changing the application code: the policy
would read a session variable set per connection.

## Security model

- Argon2id password hashing (19 MiB, t=2), with transparent re-hashing when the
  parameters are raised.
- Opaque 256-bit session tokens. Only a keyed SHA-256 hash is stored, so a
  database leak yields no usable session.
- Absolute expiry (`SESSION_TTL_HOURS`) and idle timeout
  (`SESSION_IDLE_TIMEOUT_MINUTES`). Password change revokes every session.
- Per-IP login rate limiting plus per-account lockout, with the same generic
  failure message for every cause so the form cannot enumerate accounts.
- Security headers set in `next.config.mjs`; server actions carry Next's own
  CSRF protection.
- Uploads are validated by MIME type and size, stored under tenant-prefixed
  keys, and marked `scanStatus: PENDING` until the scanning job clears them.
- The audit log redacts password hashes, MFA secrets, session tokens and
  identity-document numbers, and stores a hash of the IP address rather than the
  address itself.

## Files

Uploads are a three step handshake: the client asks `/api/v1/files/presign` for
a short-lived URL, PUTs the bytes straight to object storage, then calls
`/api/v1/files/confirm`. The application server never handles file bytes, which
is what keeps a twenty thousand learner intake from turning the web tier into a
file proxy. The local driver serves the same interface through an application
route so the whole flow can be exercised without running MinIO.

Read access is decided in one place, `assertCanReadFile`, from how the file is
attached rather than from where the request came: the uploader, a learner
enrolled in or staff assigned to the offering whose lesson references it, the
learner who submitted it, or a holder of the relevant staff permission.
Downloads redirect to a presigned URL and are written to the audit log. A file
whose scan came back infected is never served, and a file with no scanner
configured is marked SKIPPED rather than CLEAN.

## Assessment and marking

Marking rules are pure functions in `quiz-engine.ts`, `grading-rules.ts` and
`assessment-window.ts`, with no database access. The same code scores a live
attempt, re-scores after a question is corrected, and runs in the tests, so a
rule cannot differ between those paths. Anything needing a person is returned as
unmarked rather than scored as zero.

Three decisions worth knowing:

- The paper is fixed server side when an attempt starts, seeded by the attempt
  id. Reloading cannot reroll a pool, and two learners get different papers.
- Whether a learner may start or submit is decided by the same function the page
  and the action both call, so a stale page cannot smuggle a late attempt past
  the rule. Late penalties are applied from the submission time, on the server
  clock, not from whenever marking happens.
- Results are released deliberately, per assessment, once marking is complete.
  Until then a learner sees that their work was received and nothing more.

The course mark counts only marked assessments in both numerator and
denominator, and reports the outstanding weight, so a mid-semester figure is
honest about what it covers. Finalisation writes the result onto the enrolment
rather than leaving it computed, because a question corrected next year must not
silently change a result somebody has already graduated on.

## Records, progression and credentials

`loadCourseRecords` is the one place course results are read from. The
transcript, the progression engine and the graduation check all call it, so they
cannot disagree.

Three decisions worth knowing:

- Issued transcripts are snapshots, not queries. A document handed to an
  employer must still read the same after a mark is corrected or a grading
  scheme is edited.
- Progression thresholds live in `SystemSetting` as a policy object. The rules
  that consume them are pure functions with the policy passed in, so an
  institution changing a threshold does not touch audited code, and a decision
  already recorded keeps the numbers it was made on.
- A decision is a recommendation plus its reasoning. The registrar records the
  outcome, may record a different one, and the override is stored with the
  reason, because that note is what an appeal turns on. Exclusion is never
  reached in one step from good standing.

Public verification is deliberately narrow: what was awarded, to whom, by which
institution, when, and whether it still stands. No student number, no marks, no
transcript, no contact details. Every check is logged with a hashed address, the
page is rate limited, and a code that fails its check digit is reported as
malformed rather than as not found, so a typing mistake does not read as a
forgery.

## Communication

Notifications resolve their channels from a per-type default and the person's
own preferences, and the in-app row is written before any other channel is
attempted, so an email outage costs the delivery rather than the notice. A small
set of types cannot be switched off entirely: an admission decision or a change
on someone's account carries consequences whether or not it was read.

Messaging is a channel between a learner and the staff responsible for them, not
an open directory. Staff reach anyone; learners reach the staff who teach them
and the administration; learner-to-learner traffic goes to the course discussion
instead. The rule is one pure function, so the page that lists recipients and
the action that creates the thread cannot disagree.

Moderation is deliberately non-destructive. Hiding a post leaves a visible gap,
and reporting queues the post for a person rather than removing it, because
automatic removal on report is a tool for silencing people rather than for
moderating them.

Attendance percentages take excused absences out of the denominator rather than
counting them against the learner, and an unmarked register reads as unmarked.
Consecutive absences are surfaced ahead of low percentages, because the learner
at 80% who has missed the last four sessions is the one to phone.

## Money

Amounts are integer cents everywhere inside the application and are converted to
the database Decimal only at the edge. Floating point arithmetic on currency
loses cents, and it loses them silently.

Three decisions worth knowing:

- Invoice totals are computed by pure functions from the lines, and the status
  is derived rather than stored, so an invoice cannot sit at paid while money is
  owed, and a typed-in total cannot disagree with the lines beneath it.
- Discounts apply percentage first, then fixed, always. Applying them in the
  order they happen to arrive would quietly change what a percentage means, and
  two invoices for the same learner would not match.
- A proof of payment is a claim, not a receipt. Nothing is credited until a
  person approves it, and approval runs through the same payment service the
  counter uses, so it produces the same receipt and the same audit entry.

The review queue is built for an intake that generates twenty thousand documents
in a fortnight: bounded pages, indexed filters, oldest first, and a claim step so
two officers do not review the same proof. Duplicate detection narrows candidates
by reference or amount before comparing, states its confidence and its reason,
and never rejects anything on its own.

## Quality assurance and the audit trail

Moderation sampling is deliberately not random. A random sample is defensible
statistically and useless in practice, because the marks that matter sit near a
decision boundary. The sample takes the top, the bottom, everything within five
points of the pass mark, every failure, then a seeded spread across the rest, so
reloading the page gives the same scripts.

The comparison between assessor and moderator separates two different problems.
A few scripts out by more than the tolerance is a marking problem on those
scripts. A consistent shift in one direction across the sample is a marking
standard problem across the cohort, and the wording says so.

A cohort-wide adjustment caps at zero and the maximum, needs an external
moderation record once it is large, and writes every changed mark to the audit
log with its before and after, because that is the single thing an external
examiner will want to trace.

The audit log is written by every mutation in the system through `recordAudit`,
with credential and identity fields redacted and the IP address hashed. The
screen over it diffs the fields that actually moved rather than printing two
JSON blobs, because a log nobody can read is a log that gets exported once,
during an investigation, and misunderstood.

## Analytics, and what it refuses to do

Every indicator behind the at-risk list is something the institution recorded: a
missed deadline, a mark, a register, a lesson opened. Nothing infers anything
about a person's circumstances, character or ability, and every flagged learner
carries the statements that flagged them. The score exists only to order the
list; nobody acts on a number.

Aggregates are suppressed below five learners. Publishing the pass rate of a
group of three names those three people to anyone who knows the group.

## Data privacy (POPIA)

A person can export everything held about them from their own security screen,
shaped the way they would describe their life at the institution rather than as
a database dump. Retention rules carry the reason each exists, so the policy can
be argued with. An erasure request where an academic record exists is answered by
anonymising rather than refusing: the qualification stays verifiable, which
protects the learner as much as the institution, and everything identifying them
beyond that record goes.

Personal information is minimised in the log stream and in the audit trail.
Sensitive student fields sit behind a separate permission
(`student.read.sensitive`) rather than being implied by `student.read`, so an
administrator who needs to see enrolment status does not automatically see
identity-document details. Support needs a learner discloses are stored with an
explicit consent timestamp. Retention periods and export of a data subject's
personal information are configured per institution in Phase 9.

## Performance

Collections are paginated at the query, never in memory. Indexes lead with
`institutionId` so tenant filtering uses the index. Large files live in object
storage. Certificate rendering, transcript generation, notification fan-out and
analytics recalculation run as background jobs. The reporting dashboards read
aggregates rather than scanning submission tables.
