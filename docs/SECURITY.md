# Security

What this system does to protect the records it holds, and what it deliberately
does not claim.

## Identity

- Argon2id password hashing, 19 MiB and t=2, re-hashed transparently on the next
  successful sign in when the parameters are raised.
- Password policy rewards length over symbol soup, and refuses a password that
  contains the person's own name, email or student number.
- Opaque 256-bit session tokens. Only a keyed SHA-256 hash is stored, so a
  database leak yields no usable session.
- Absolute expiry and an idle timeout, both configurable. Changing a password
  revokes every session.
- Optional TOTP second factor with single-use recovery codes, stored only as
  hashes. Nobody at the institution can read a recovery code back to a learner.
- Per-IP rate limiting on sign in, plus per-account lockout, with the same
  generic failure message whatever the cause, so the form cannot be used to
  discover which email addresses exist.

## Authorisation

Every permission is checked on the server, in the page or route handler. The
navigation is built from the same function, so a menu never shows a page the
person cannot open, but the menu is not the control. Records loaded by id are
re-checked against the caller's institution, so an id from one tenant cannot be
replayed against another.

## Files

Uploads are presigned and go straight to object storage; the application server
never handles file bytes. Keys are tenant-prefixed and filenames sanitised, so
nothing can climb out of its prefix. A file is served only when it is not
INFECTED, and read access is decided from how the file is attached rather than
from where the request came.

**The scanner is honest about itself.** With `MALWARE_SCANNER_URL` unset, files
are recorded as `SKIPPED`, not `CLEAN`. An institution asked at an audit what it
checked should be able to answer truthfully, and "we did not check" is a
different answer from "we checked and it was clean". A scanner that is
unreachable leaves the file `PENDING` rather than recording a verdict nobody
reached.

## Transport and headers

A content security policy locked to the origin, HSTS with preload, frame
denial, nosniff, a restrictive permissions policy, and `no-store` on every API
response. `'unsafe-inline'` is allowed for styles, because per-institution
branding sets custom properties inline; scripts carry no such exception.

## Audit

Every mutation writes through `recordAudit`. Password hashes, MFA secrets,
session tokens and identity-document numbers are redacted before anything is
written, and IP addresses are stored as keyed hashes rather than addresses.

## What is not done yet

- SMS and push delivery are declared in the channel model but not implemented.
- The malware scanner integration is a contract against an HTTP endpoint; no
  scanner is bundled.
- Penetration testing has not been carried out. Do it before the first real
  intake, not after.
- Secrets live in environment variables. A managed secret store is a deployment
  decision and is documented in `docs/DEPLOYMENT.md` rather than assumed here.
