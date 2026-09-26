# Roadmap

## MVP

The smallest system an institution could actually run a semester on:

1. Institution, users, roles and permissions (Phase 1)
2. Students, programmes, qualifications, courses, curriculum, enrolment (Phase 2)
3. Course builder, lessons, content library, the learner course view (Phase 3)
4. Assignments and quizzes, question bank, rubrics, marking, grade release (Phase 4)
5. Results, transcripts, certificates with public verification (Phase 5)

Phases 6 to 10 turn that into an institutional platform.

## Phase status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Setup, database, authentication, RBAC, institution, users, admin dashboard | **Implemented** |
| 2 | Student management, programmes, qualifications, courses, curriculum | **Implemented** |
| 3 | Course builder, lessons, content management, learner interface | **Implemented** |
| 4 | Assessments, question banks, assignments, rubrics, grading | **Implemented** |
| 5 | Academic records, progression, transcripts, certificates | **Implemented** |
| 6 | Attendance, calendar, messaging, notifications, discussions | **Implemented** |
| 7 | Finance, invoices, payments, proof of payment, receipts | **Implemented** |
| 8 | Quality assurance, moderation, audit systems, institutional reporting | **Implemented** |
| 9 | Analytics, performance, security hardening, accessibility | **Implemented** |
| 10 | Deployment, backup, monitoring, documentation | **Implemented** |

## What Phase 10 delivered

- The second factor completed at sign in: a session for an account with MFA
  exists but may do nothing except present its code, and the code step is rate
  limited because it is the last door between a stolen password and somebody's
  records
- Production Dockerfile with a separate worker target built from the same image,
  so the worker cannot drift from the handlers the web process registers
- An entrypoint that applies migrations and syncs permissions before accepting
  traffic, with the worker explicitly not migrating: one process owns the schema
- A production compose stack with the database unpublished, resource limits, and
  health gates between services
- Backup, restore and verification scripts. The restore refuses to write over
  the live database unless told twice, and the verification checks the records
  an institution would notice losing
- Liveness that checks nothing external, readiness that fails on the database
  and only degrades on Redis, and an operational metrics endpoint behind a
  permission
- Structured JSON logging with forbidden fields redacted before anything is
  written
- CI that generates the Prisma client and applies migrations before type
  checking, so the check sees real model types rather than `any`
- Ten documents: architecture, database, security, accessibility, performance,
  deployment, backup, monitoring, API, developer guide, first run, and separate
  guides for administrators, lecturers and learners

## What Phase 9 delivered

- Learning analytics where every indicator is something the institution
  measured, and every flagged learner carries the reasons they were flagged. The
  score exists only to order a list; the statements are what anyone acts on
- Nothing infers anything about a person's circumstances, character or ability,
  and the screen says so in the words a support officer would use
- Aggregates suppressed below five learners, because a pass rate for a group of
  three is a statement about three identifiable people
- Redis-backed rate limiting shared across instances, failing open rather than
  taking the site down when the store hiccups
- BullMQ queue driver with retries and backoff, a worker process that imports
  the same handlers, and a scheduled task for the at-risk refresh
- A real malware scanner contract that stays honest: no scanner configured means
  SKIPPED, never CLEAN, and an unreachable scanner leaves the file PENDING for
  the next pass rather than recording a verdict nobody reached
- TOTP second factor with single-use recovery codes stored only as hashes, a
  session list, and sign out everywhere
- Content security policy locked to the origin, plus HSTS, frame denial and
  no-store on every API response
- POPIA operations: a personal information export a person can read, a retention
  policy where every rule carries the reason it exists, and an erasure path that
  anonymises rather than refusing where an academic record exists
- Accessibility: forced-colors support, 44px touch targets on coarse pointers,
  focus and reduced-motion handling, and a public statement that names the gaps
  rather than claiming there are none

## What Phase 8 delivered

- Moderation sampling that draws what a moderator would draw by hand: the top,
  the bottom, everything near the pass mark, every failure, then a spread.
  Seeded by the assessment, so reloading gives the same scripts rather than a
  fresh set
- A comparison between the assessor's marks and the moderator's that separates
  scatter from drift: a consistent shift in one direction is a marking standard
  problem, which has a different remedy from a few odd scripts
- The recommended verdict is stored alongside whatever outcome the moderator
  chose, so a disagreement between the two stays visible
- Cohort-wide adjustments that cap at 0 and the maximum, require an external
  moderation record when they are large, and write every changed mark to the
  audit log with its before and after
- Programme review with an evidence checklist that says what is missing and why
  an accreditation panel asks for it, rather than just showing a red cross
- Compliance signals counted from the records, not entered by hand, including
  the one that matters most: results released with no moderation on file
- The audit log as a usable screen: plain-language descriptions, a diff of the
  fields that actually moved, filters by record type, person and date, a
  sensitive-only filter for results, money and credentials, and a one-click
  history of everything that happened to a single record
- Institutional reporting across academics, delivery and finance, with a mark
  distribution and a pass rate computed from resolved results only

## What Phase 7 delivered

- Money handled as integer cents throughout, converted to the database Decimal
  only at the edge, because floating point arithmetic on currency loses cents
  and an institution reconciling twenty thousand payments notices
- Fee structure by programme, course and academic year, so invoices are raised
  from the fee book rather than from whatever somebody remembers
- Invoices whose totals are computed by the pure rules from the lines, so a
  figure typed into a form cannot disagree with what it is supposed to add up to
- Percentage discounts applied before fixed ones, always in that order, so two
  invoices for the same learner cannot come out differently. A discount never
  turns an invoice into a credit
- Status derived rather than stored, so an invoice cannot sit at paid while
  money is owed, and an overpayment reads as paid with a credit balance
- Payments that issue their receipt in the same transaction, because a payment
  without a receipt is the thing a learner cannot prove
- Debtors ageing in the buckets a finance office works from, where the total
  across buckets always equals the total outstanding
- Payment plans that split a balance without losing or inventing a cent, step by
  month, and do not skip February for a plan starting on the 31st
- Proof of payment as a claim, not a receipt: nothing is credited until a person
  approves it, and approval runs through the ordinary payment service so it
  produces the same receipt and audit trail as a payment taken at the counter
- Duplicate detection that says how confident it is and why, as a prompt for the
  reviewer rather than an automatic rejection
- A review queue built for volume: worked oldest first, claimable so two
  officers do not review the same document, filtered by status, programme, date
  and a search over the three things a reviewer actually has in front of them

## What Phase 6 delivered

- Attendance: sessions, a register that opens with every enrolled learner on it
  unmarked, self check-in behind a code and a time window, and a report that
  lists learners who have stopped coming before learners with a low percentage
- Excused absences leave the denominator rather than counting against the
  learner, and an unmarked register reads as unmarked rather than as a room of
  absentees
- Calendar with membership-based visibility, day grouping that keeps empty days,
  clash detection, and assessment due dates that arrive automatically when an
  assessment is published
- Messaging with rules about who may write to whom: staff reach anyone, learners
  reach the staff who teach them and the administration, and learner-to-learner
  traffic goes to the course discussion instead of private inboxes
- Notifications with per-type channel defaults and per-person preferences.
  Notices that carry consequences cannot be switched off entirely, and the
  in-app row is always written before any other channel is attempted
- A real SMTP driver, per-institution sender identity, and editable email
  templates with escaped variables
- Announcements scoped to an institution, programme or course, notifying the
  audience once on publish and nobody at all on save as draft
- Discussion forums with pinning, closing, hiding and reporting. A hidden post
  leaves a visible gap rather than vanishing, and a report queues for a
  moderator rather than removing the post automatically

## What Phase 5 delivered

- One source for course records, read by the transcript, the progression engine
  and the graduation check, so the three cannot disagree about what a learner
  achieved
- Transcripts grouped as a printed transcript reads, with credits, grade point
  average and a provisional marker while any result is outstanding
- Issued transcripts are snapshots. A copy given to an employer still reads the
  same years later, after a mark is corrected or a grading scheme changes
- Progression rules driven by a stored policy rather than hard-coded thresholds,
  so an institution can change a threshold without changing audited code. A
  changed threshold applies to future evaluations only
- Recommendations with their reasoning attached: credits, pass rate, modules to
  carry, attempts exhausted. A registrar records the decision and may record a
  different one, and the reason is stored, because that note is what an appeal
  turns on
- Exclusion is never reached in one step from good standing: a learner must
  already have been flagged, which is what makes the decision defensible
- Graduation needs both the credits and every compulsory course, so a learner
  over the total on electives is still held back for a missing required module
- Certificates with an institution-prefixed number allocated under an advisory
  lock, and a twelve character verification code with a check digit
- A qualification certificate is refused unless the learner has met the
  qualification. A registrar may override, and the exception is printed on the
  record and written to the audit log
- Revocation withdraws without deleting, because a document already in
  circulation has to stay answerable
- Public verification showing what was awarded, to whom, by whom and when, and
  nothing else. A mistyped code is reported as malformed rather than as not
  found, so an honest error does not look like a forgery

## What Phase 4 delivered

- Assessment configuration: ten types, formative or summative, marks, pass mark,
  weighting, open and due and close dates, time limits, attempt limits and a
  late rule. Publishing validates the setup and puts the due date on the course
  calendar
- Automatic marking for the eight machine-markable question types, with partial
  credit on multiple response and matching, tolerance on numerical answers, and
  accepted-answer lists on short answers. Essays, long answers and uploads are
  returned as unmarked rather than guessed at
- Question banks with per-type validation at authoring time, so a question that
  cannot be answered correctly is refused before a learner meets it
- Question pools: each learner draws their own questions, seeded by the attempt,
  so reloading cannot reroll the paper and two learners do not sit the same one
- Attempt handling: the paper is fixed server side at the start, answers
  autosave every fifteen seconds, the clock is a real deadline that submits the
  attempt when it expires, and a short grace absorbs clock drift rather than
  losing a learner's work
- Assignment submission with file attachment, replaceable until submitted
- Rubrics with weighted criteria and performance levels. Where a rubric is
  attached it decides the mark, and the assessor sees the total the rubric will
  produce before saving
- Late penalties applied from the submission time rather than the marking time,
  a part day counting as a full day, never below zero
- Mark release as a deliberate act: nothing reaches a learner until the whole
  assessment is marked and released, so a class cannot compare partial results
  as they trickle in
- Gradebook with the weighted course mark, counting only marked work and saying
  how much weight is still outstanding, plus a finalisation step that writes the
  course result onto the enrolment for Phase 5 to read

## What Phase 3 delivered

- Course builder: sections and lessons with publish control, ordering that
  renumbers the whole sequence in one transaction rather than swapping two rows,
  and a block editor for text, callouts, files, images, video, audio and links
- Direct-to-storage uploads: the browser asks for a short-lived URL, PUTs the
  bytes straight to S3 (or the local driver in development) and confirms, so
  file bytes never pass through the web tier
- A real S3 driver behind the same interface as the development one, so MinIO,
  AWS and R2 all work from the same code path
- One place decides who may read a file, based on how the file is attached:
  uploader, enrolled learner or assigned staff on the offering it belongs to,
  the learner who submitted it, or a staff permission. Downloads redirect to a
  presigned URL and are written to the audit log
- Upload policy as an allowlist with size limits, tenant-prefixed keys, and
  filenames sanitised so nothing can climb out of its prefix
- Learner course view with an outline that hides drafts and unreleased lessons,
  resumes where the learner left off, and shows progress over required lessons
- Lesson view that renders each block by kind, stores rich text as a document of
  paragraphs rather than raw HTML, and withholds any file the scan flagged
- Progress tracking that only counts time while the tab is visible, accumulates
  rather than overwrites, and never un-completes a lesson on a replayed update
- Content library with folders, tags, search and versioning: publishing a
  replacement keeps the previous version linked, so a lesson pointing at it
  still resolves and the record shows what learners were actually given

## What Phase 2 delivered

- Student register: paged, filtered list; record screen with overview, enrolment
  and results tabs; registration form that creates the account, allocates a
  student number and records the programme enrolment in one transaction
- Field-level privacy: one projection function decides what each viewer sees, so
  identity numbers, home address and next of kin need `student.read.sensitive`
  while a lecturer still sees who the learner is. Learners always see their own
  file, and disclosed support needs are released only with recorded consent
- Admissions as an explicit state machine: twelve statuses, permissioned
  transitions, mandatory reasons on every decision, full event history, and a
  public application form with per-IP rate limiting and POPIA consent
- Offer to learner in one idempotent step: account, student number, profile and
  programme enrolment, with the application closed out as enrolled
- Programme and curriculum builder: curriculum placed by year and term, credit
  totals checked against the qualification, and prerequisite rules refused if
  they would create a loop
- Registration screen driven by the curriculum, with prerequisite, corequisite,
  capacity and duplicate checks re-run at the moment of saving
- Registrar reports: headcount by programme and by cohort, from grouped
  aggregates rather than row scans
- Reference allocation under concurrency, using a Postgres advisory lock per
  institution and year, with the unique constraint as the backstop

## What Phase 1 delivered

- Validated environment configuration that fails fast on a bad value
- 95-model PostgreSQL schema covering every module in the brief
- Argon2id passwords, database-backed sessions, idle and absolute timeouts,
  per-IP rate limiting, per-account lockout, account enumeration resistance
- Permission catalogue (57 permissions), 15 system roles, scoped grants with
  hierarchy cascade and expiry, tested
- Institution branding tokens wired through the design system
- Application shell with permission-filtered navigation, accessible components,
  responsive down to a phone
- Role-aware dashboard, people and access screen with search and pagination
- Versioned JSON API with a single error shape, health probe
- Audit logging with redaction, seed data, Docker build, compose stack

## Carried from Phase 2 into later phases

- Document upload on an application needs the storage driver, which lands with
  the content library in Phase 3. The model, the review UI and the verification
  flag are already in place
- Applicant and learner emails are queued rather than sent until the mail driver
  lands in Phase 6. Every send point is marked
- Bulk registration for a whole cohort reuses `buildRegistrationPlan` per
  learner; the batch screen follows the background job runner in Phase 9

## Carried from Phase 3 into later phases

- The malware scan is a real job with a real gate: nothing serves a file that
  came back infected. With no scanner configured the file is marked SKIPPED
  rather than CLEAN, because the distinction matters at an audit. Wiring ClamAV
  or a hosted scanner is Phase 9
- SCORM and H5P lesson types are reserved and authorable; the players need the
  package extractor, which follows the assessment engine
- Reordering posts the whole new order, which the drag handle will use directly;
  the buttons are the accessible fallback and stay

## Carried from Phase 4 into later phases

- Auto-submit currently happens in the browser when the clock expires, which
  covers a learner who walks away with the tab open. A learner who closes the
  laptop entirely is swept up by a scheduled job once the runner lands in
  Phase 9; the submit path already accepts a server-initiated submission
- Peer assessment is an assessment type and can be set and marked, but the
  allocation of who reviews whom follows the notification work in Phase 6
- Moderation records marks against a submission; the moderation workflow and
  sampling are Phase 8, which is where the external examiner picks it up
- Annotating a submitted PDF in the browser needs a viewer component and is
  deliberately deferred; feedback and the rubric carry the marking today

## Carried from Phase 5 into later phases

- Transcripts and certificates render in the browser and print correctly; the
  PDF is queued and generated once the job runner lands in Phase 9. The snapshot
  it renders from is already stored
- Year of study on a course record is taken from the enrolment rather than the
  curriculum placement, which is right for a single-year programme and needs the
  curriculum lookup for multi-year ones. Flagged in the loader
- Badges and micro-credentials issue and verify like any other credential; the
  Open Badges export follows the integrations work in Phase 9

## Carried from Phase 6 into later phases

- Email fan-out walks the audience one message at a time. The digest batching is
  written and tested but is not wired in until the job runner and provider rate
  limiting land in Phase 9, which is also where SMS and push attach
- QR attendance reuses the check-in code; the scanner is a thin client on top of
  the same endpoint and waits for the mobile work
- Live session integrations (Zoom, Teams, Meet) have their model and their place
  in attendance; the provider APIs follow the integration work in Phase 9

## Carried from Phase 7 into later phases

- Payment gateway integration has its model fields (`gatewayRef`) and its place
  in the payment service; the provider itself is Phase 9 integration work. Most
  South African institutions reconcile by EFT and proof of payment first, which
  is why that path was built first
- Refunds and scholarships have their models and their permissions; the approval
  workflow follows the same shape as proof of payment review and lands with the
  finance reporting in Phase 8
- Instalment status is set when a plan is created and updated when a payment is
  captured against the invoice; automatic arrears marking needs the scheduler in
  Phase 9
- Invoice and receipt PDFs render in the browser and print; the stored PDF waits
  for the same renderer as transcripts and certificates

## Carried from Phase 8 into later phases

- Compliance and report exports render on screen; the CSV and PDF downloads
  share the renderer that transcripts and certificates are waiting on, in
  Phase 9
- External examiners have their role, their scoped grant and their expiry, and
  they can moderate what they are assigned. The invitation flow that issues that
  grant follows the user management work in Phase 9
- Moderation of individual submissions writes to the same record as assessment
  moderation; the per-script moderation screen is a variant of the marking
  screen and was deliberately not duplicated

## Carried from Phase 9 into Phase 10

- The MFA challenge at sign in is written and tested as a service; the second
  step in the login flow itself is the last piece, and lands with deployment
- No caching layer has been added. Adding one before there is a measured hot
  path trades stale-data bugs for speed nobody asked for; `docs/PERFORMANCE.md`
  names where it will most likely be wanted first
- Notification digests are written and tested but not wired into fan-out. Do it
  before the first institution-wide announcement to twenty thousand people
- Penetration testing has not been done, and no amount of care here substitutes
  for it

## What has not been done, and should be

Tested end to end against a production build (`next build` + `next start`,
Redis worker, real Postgres, real Chrome with the content security policy
enforced), on a fresh database set up only through the screens and on the
seeded one. Still to do, roughly in order of value:

1. **A penetration test** before the first real intake, and an accessibility
   walkthrough with somebody who uses assistive technology.
2. **Integrations that need an account with a provider**: payment gateway,
   SMS and push, creating meetings through the Zoom/Teams/Meet APIs (live
   classes take a pasted link today), proctoring, and a ClamAV (or hosted)
   scanner adapter behind `MALWARE_SCANNER_URL`.
3. **SCORM and H5P players**; surveys; peer-review allocation (needs a
   schema change).
4. **Smaller gaps**: document upload on applications, learning-outcome
   mapping screens, staff profiles, certificate templates, white-label
   tenancy by host name (needs a domain column), notification digest
   batching wired into fan-out.
5. **Integration tests in CI** against a real database. The pure rules are
   unit tested; the services and screens have been exercised by hand-run
   production tests, not by an automated suite in the repository.

## Deferred by design

- Proctoring: the examination model carries the hooks; the integration itself
  waits until an institution has chosen a vendor
- SCORM and H5P playback: `LessonType` reserves both; the player is Phase 3
- Payment gateway: the finance module records payments and proof of payment
  first, since that is how most South African institutions actually reconcile
- Mobile applications: the API is versioned from the start so a client can be
  added without reshaping the server
