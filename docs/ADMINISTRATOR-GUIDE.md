# Administrator guide

For the registrar, the academic administrator and whoever holds the
institutional administrator role.

## Standing the institution up

Work in this order. Each step needs the one before it.

1. **Institution** under Settings: name, contact details, logo, colours and the
   certificate prefix. The prefix appears on every certificate number, so choose
   it once and leave it alone.
2. **People and access.** Invite your registrar, academic administrators and
   finance officer. Give each person the narrowest role that lets them work; you
   can always add another.
3. **Academic year and terms.** Mark the current year and term. Several screens
   default to whatever is current, so this is worth getting right.
4. **Faculty, department, qualification, programme.** A programme leads to a
   qualification and lives in a department. The qualification carries the NQF
   level and the minimum credits that graduation is later checked against.
5. **Courses and curriculum.** Add courses, then place them in the programme's
   curriculum by year and term. The credit total is checked against the
   qualification as you go.
6. **Fees**, if you are billing through the platform.
7. **Grading scheme.** One is seeded; edit the bands to match your policy before
   any results are released.

## Roles, and who should hold them

| Role | Give it to | The thing to watch |
| --- | --- | --- |
| Super administrator | One or two people | Unrestricted across every institution |
| Institutional administrator | The principal or registrar | Can change settings and grant roles |
| Registrar | The registrar's office | The only role that sees identity numbers and addresses |
| Academic administrator | Whoever owns the curriculum | Cannot see learner personal details |
| Finance officer | The finance office | Cannot see academic records |
| Quality assurance officer | The QA function | Reads results, cannot change them |
| External examiner | A person outside the institution | Give it an expiry date |

Roles are scoped. A faculty administrator granted at a faculty reaches
everything inside it and nothing outside. Grant at the narrowest scope that
works.

`/admin/roles` is where the list above lives. System roles are shipped with the
platform and kept in step by `npm run rbac:sync`, so they are read there;
institution roles can be composed for a job this institution actually has. A new
role grants nothing until permissions are added to it, which is the safe
default. A role cannot be deleted while somebody still holds it.

## People and access

Invite people from `/admin/users/invite` rather than creating a password for
them: the account is created with a password nobody knows, and they set their
own from a single-use link that expires in seven days. If a link is lost, the
person asks for a new password at `/forgot-password` and the same thing happens.

Opening a person shows the roles they hold. Granting and revoking takes effect
at their next request, so somebody who is signed in keeps their access until
then - suspend the account from the same screen if that matters. Suspending
keeps every record they have made; it only stops them signing in.

## Institution settings

`/admin/settings` carries the profile, branding, contact details and the
certificate prefix. Two of these are worth a second thought: the prefix is
printed on every certificate number, so changing it changes how certificates
issued years ago read, and the outgoing email address is what every automated
message will be sent from.

## Support

`/support` holds the tickets people raise, each with a number they can quote.
Holders of `ticket.read` see the whole queue and can assign tickets, change
their status and leave internal notes that the person who raised the ticket
never sees; everybody else sees only what they raised themselves. The due date
on a ticket is the response target for its priority, not a promise.

## Admissions

Applications arrive at `/apply` and land in the queue. Move each one along with
a reason recorded; the applicant sees what you wrote. Accepting an offer and
then enrolling creates the account, allocates the student number and records the
programme enrolment in one step. Running it twice is safe.

## Results and progression

Lecturers mark. Releasing results is a separate, deliberate act, so a class
cannot compare partial marks as they appear. Finalising a course writes each
learner's result onto their enrolment, which is what the transcript and the
progression board read afterwards.

The progression board recommends; you record. Where you record something
different from the recommendation, write why. That note is what an appeal turns
on, and in two years nobody will remember the conversation.

## Certificates

Issue from a learner's academic record. A qualification certificate is refused
unless the learner has met the qualification; you can override, and the reason
is printed on the record and written to the audit log. Revoking withdraws
without deleting, because a document already in circulation has to stay
answerable.

## Things worth knowing

- **Nothing important is ever really deleted.** Revocation, withdrawal and
  erasure all leave a trail. This is deliberate.
- **The audit log answers "who changed this".** Filter to results, money and
  credentials, or open the history of a single record.
- **Retention sweeps are manual.** Deleting learner records on a timer with
  nobody looking is how an institution destroys something it needed.
- **An erasure request is not all or nothing.** Where an academic record exists
  the platform anonymises rather than refusing: the qualification stays
  verifiable and everything else about the person goes.
