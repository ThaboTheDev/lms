# Monitoring

The aim is to notice a problem before a learner reports it, without waking
anybody for something that is not a problem.

## Endpoints

| Path | Purpose | Auth |
| --- | --- | --- |
| `/api/v1/health/live` | Liveness. Checks nothing external | Public |
| `/api/v1/health` | Readiness. Checks the database, reports Redis | Public |
| `/api/v1/metrics` | Operational counts | `report.read` |

Liveness deliberately checks nothing external. If the database is down, the
right answer is to stop sending traffic, not to restart a process that is
working perfectly well.

Readiness fails on the database and only degrades on Redis, because the queue
and rate limiter fall back in process: worse, not broken.

## Alert on these

| Alert | Condition | Why it matters |
| --- | --- | --- |
| Readiness failing | 2 minutes | Nobody can sign in |
| Error rate | 5xx above 1% over 5 minutes | Something is broken for real users |
| Database connections | Above 80% of the pool | The next symptom is timeouts |
| Job queue depth | Above 1 000 and rising 15 minutes | Email and certificates have stopped |
| Failed sign ins | Ten times the weekly baseline | Credential stuffing |
| Files awaiting scan | Above 100 for an hour | The scanner is down and uploads are unusable |
| Disk on the database | Above 80% | The audit log grows faster than anything else |
| Backup age | No dump in 26 hours | The thing you find out too late |

## Watch, do not alert

Proof of payment queue depth, submissions awaiting marking, overdue invoices.
These are workload, not faults. A queue of eight hundred proofs during
registration week is the system working. Put them on a dashboard the registrar
and the finance office look at, and let them decide.

## Logs

`src/lib/logger.ts` emits one line of JSON per event, with forbidden fields
redacted before anything is written. Ship to whatever the institution already
runs. Useful queries:

```
event="auth.sign_in_failed"          # by email, over time
event="queue.job_failed"             # which handler
durationMs > 2000                    # slow requests, by route
```

## When something is wrong

1. `/api/v1/health` first. It says which dependency.
2. `/api/v1/metrics` next. Queue depth and scan backlog distinguish "slow" from
   "stopped".
3. The audit log at `/admin/audit`, filtered to results, money and credentials.
   If an incident touched records, that is where it shows.
4. Worker logs. A job failing repeatedly has already retried five times with
   backoff before it reaches the dead letter.
