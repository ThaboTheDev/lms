# Performance

Written against the brief's target: tens of thousands of learners, thousands
concurrent, a 20 000-learner intake generating proof of payment in a fortnight.

## What is in place

**Pagination everywhere.** No collection endpoint or screen loads an unbounded
set. `parsePaging` caps the page size at the call site, and the cap is lower on
heavy screens than on light ones.

**Indexes lead with the tenant.** Every tenant-owned table carries
`institutionId` and a composite index starting with it, so tenant filtering uses
the index rather than filtering after the fact. The proof of payment queue is
indexed on `(institutionId, status, submittedAt)` and on `reference`, which are
exactly the two ways it is read.

**Aggregates, not scans.** Headcount, pass rates, ageing and the finance
dashboard use `groupBy` and `aggregate`. The gradebook loads submissions once
and resolves best-attempt in memory rather than issuing a query per learner.

**Files bypass the web tier.** Uploads and downloads are presigned; the
application never streams bytes. This is the difference between a file server
and a web application at intake volume.

**Work moved off the request.** Email, fan-out, certificate rendering,
transcript generation, scanning and analytics are queued. With
`QUEUE_DRIVER=redis` they run in the worker process (`npm run worker`) with
retries and exponential backoff.

**Shared rate limiting.** `RATE_LIMIT_DRIVER=redis` gives one window across
every instance. A Redis failure allows the request rather than blocking it: a
limiter that takes the site down when its store hiccups is worse than one that
briefly lets traffic through.

## What to watch first under real load

1. **At-risk analytics.** `atRiskLearners` reads several relations for up to 500
   learners. It is already a scheduled job (`npm run atrisk`); if the screen
   feels slow, read the stored flags rather than recomputing.
2. **The audit log.** It grows faster than anything else. The retention rule is
   seven years; partition by month if a single table becomes unwieldy.
3. **Gradebook on a large cohort.** Fine to a few hundred; past that, move the
   best-attempt resolution into SQL.
4. **Notification fan-out.** Currently one email per recipient in a loop. The
   digest batching is written and tested but not wired in; do that before the
   first institution-wide announcement to twenty thousand people.

## Deliberately not done

No caching layer has been added. Adding a cache before there is a measured hot
path is how a system acquires stale-data bugs in exchange for speed it did not
need. The place it will most likely be wanted first is the institution branding
lookup in the layout, which runs on every authenticated request.
