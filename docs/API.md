# API

Versioned under `/api/v1`. Every endpoint authenticates with the session cookie
and authorises with the same permission checks the screens use, so nothing is
reachable through the API that is not reachable through the interface.

## Conventions

Errors share one shape:

```json
{ "error": { "code": "forbidden", "message": "You do not have permission to do this." } }
```

| Code | Status | Meaning |
| --- | --- | --- |
| `unauthenticated` | 401 | No session, or one awaiting its second factor |
| `forbidden` | 403 | Signed in, not permitted |
| `not_found` | 404 | No such record, or not in your institution |
| `validation_failed` | 422 | Field errors in `details` |
| `rate_limited` | 429 | `details.retryAfterSeconds` |
| `internal_error` | 500 | Logged; no detail is returned |

Collections are always paginated: `?page=1&perPage=25`, with `meta` carrying
`total` and `totalPages`. There is no unbounded read anywhere.

## Endpoints

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/v1/health` | public, readiness |
| GET | `/api/v1/health/live` | public, liveness |
| GET | `/api/v1/metrics` | `report.read` |
| GET | `/api/v1/users` | `user.read` |
| POST | `/api/v1/files/presign` | any signed-in user |
| POST | `/api/v1/files/confirm` | the uploader |
| GET | `/api/v1/files/{id}/download` | decided from how the file is attached |
| POST | `/api/v1/progress` | the learner |
| POST | `/api/v1/attempts/{id}/autosave` | the learner sitting the attempt |
| GET | `/api/v1/me/export` | yourself |
| POST | `/api/v1/auth/sign-out` | any signed-in user |

## Uploading

Three steps, so file bytes never pass through the application server.

```
POST /api/v1/files/presign   { folder, filename, mimeType, sizeBytes }
  -> { fileId, uploadUrl }
PUT  <uploadUrl>             the bytes, with the right content-type
POST /api/v1/files/confirm   { fileId }
```

The file is `PENDING` until the scanner clears it. Nothing serves a file that
came back `INFECTED`.

## Integrating

Most integration work belongs in the service layer under `src/server/services`
rather than in a new endpoint. The services are where the permission checks, the
audit writes and the tenant scoping already live; an endpoint that goes straight
to Prisma will skip all three.

To add an endpoint:

1. Put the logic in a service, taking a `Principal`.
2. Call `requirePermission` with the scope.
3. Write an audit entry for anything that changes a record.
4. Wrap the route in `toErrorResponse` so failures share the shape above.
