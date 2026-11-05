# EPAM Backend Homework #5 — Owner Group Pre-order

## Local P1 invitation ownership — 2026-11-05

Existing invitation-token endpoint now requires trusted Cognito `sub` and matches
Reservation.CustomerId before eligibility/group/token lookup. Missing identity
returns401; another owner returns403. Missing group returns404 without creation;
inconsistent parent fails closed. Retrieval reuses the stored token and performs
only reads. Service contract requires the authenticated user ID. All P0/Open/
guest/invitation focused regressions pass:153tests. No API route/IAM/schema or
production changes; not deployed. Public invitation-based guest access unchanged.

## Local P0 Submitted Owner read — 2026-11-05

Existing authenticated `GET /reservations/{reservationId}/guest-session-id` adds
explicit `?view=state`: Owner-only read metadata/status/persisted Order quantities,
without ensuring/creating a session. Original no-query behavior is unchanged.
Submitted reads verify parent Owner and SubmittedByCustomer Order; no invitation
token is returned. Unknown views fail closed. Focused group regression91 passed;
no AWS writes/deployment. Backend code must be released before the matching
frontend; no API route/IAM/schema change is introduced. Preserve CORS overlays.

Local implementation of Levels 1–3 in the existing .NET 10 backend.
Requirements: [original homework](../../homework-backend.md).
API reference: [ApiRoutes](docs/ApiRoutes.md). The backend is deployed; authenticated
Owner/Guest group E2E is still pending. See [current submission evidence](../../LEVEL_3_SUBMISSION.md).

## Implemented API

All four endpoints authorize the reservation Owner using authenticated `sub`.
Missing identity returns 401; another user returns 403. Invalid input returns
400; missing reservation/group/session returns 404 where applicable.

| Level | Endpoint | Success (200) |
|---|---|---|
| 1 | `GET /guest/groups/{groupReservationId}/sessions` | `participants` snapshot and `total`; draft and submitted sessions |
| 2 | `GET /reservations/{reservationId}/guest-session-id` | `{"guestSessionId":"owner-session-id"}` |
| 2 | `POST /group-reservations/{groupReservationId}/submit` | Array of consolidated `dishId`/`quantity` |
| 3 | `DELETE /guest/groups/{groupReservationId}/sessions/{guestSessionId}` | Updated snapshot and total, excluding the deleted ID |

POST body: `{"reservationId":"reservation-id"}`. Only submitted sessions are
aggregated by dishId. Existing order becomes `SubmittedByCustomer`; group becomes
`Submitted`. No submitted sessions, no dishes, or missing order returns 400.
Repeated submit returns 400 without adding dishes again. Wrong-group DELETE is
400; missing session is 404. Responses, including nested fields, use camelCase.

## Run local tests

Prerequisite: .NET SDK 10 and restored NuGet packages. From this directory:

```sh
dotnet restore Tests/APIHandler.Tests.csproj
dotnet test Tests/APIHandler.Tests.csproj --no-restore -m:1 -p:UseSharedCompilation=false --filter 'FullyQualifiedName~GroupSessionsLevel1Tests|FullyQualifiedName~GroupPreOrderLevel2Tests|FullyQualifiedName~DeleteGuestSessionLevel3Tests'
dotnet test Tests/APIHandler.Tests.csproj --no-build --no-restore -m:1 --filter 'FullyQualifiedName~GuestSessionServiceTests|FullyQualifiedName~GroupReservationServiceTests|FullyQualifiedName~OrderServiceTests|FullyQualifiedName~GroupSessionsLevel1Tests|FullyQualifiedName~GroupPreOrderLevel2Tests'
```

Restore is needed only on a clean checkout. Tests use mocks; AWS credentials
and deployed resources are not needed. No deployment commands are required.

Recorded local results on 2026-11-02 (not rerun when writing this README):

| Verification | Passed | Failed/skipped |
|---|---:|---:|
| Level 1 targeted | 17 | 0/0 |
| Level 2 targeted | 41 | 0/0 |
| Level 3 HTTP/service targeted | 18 | 0/0 |
| Latest adjacent regression, including Levels 1/2 | 144 | 0/0 |

The combined focused command above is a reproduction command; the targeted
results were collected separately. Regression includes the Level 1/2 tests;
these counts must not be summed as independent coverage. Existing NU1902/NU1903
dependency advisories remain. Full-suite and cloud/browser testing are unverified.

## Guarantees and limitations

- New Owner sessions use a deterministic key and conditional creation; a visible
  existing Owner session is reused. Owner counting reserves exactly one seat.
- One conditional DynamoDB transaction writes the consolidated Order and Group.
  Mock tests inspect the request and simulate failures; they do not verify AWS.
- GuestSessions are read through an eventually consistent GSI. Submitted sessions
  or legacy Owners can be missing temporarily. Global snapshot isolation and
  coordinated writers are deliberately not implemented.
- Concurrent legacy writers can overwrite data after the transaction. A timeout
  can mean both records committed; it does not prove rollback.
- DELETE filters its deleted ID from a stale GSI response. Other rows may lag;
  subsequent catalog/profile/read failure does not undo the deletion.
- Owner-ID GET does not issue a guest token or extend Owner cart authorization.
  No automatic deadline, database schema, index or IAM changes were introduced.
- Existing public API/S3 deployment security findings remain separate blockers
  for deployment. This package is source/test evidence, not a deployment guide.

## Historical Backend #5 snapshot scope (superseded for current full submission)

The following describes the earlier backend-only snapshot, not today's full
frontend/backend/security source preparation. Current local commit/publication
status belongs in the root submission evidence; no deployment is authorized here.

```text
README_BACKEND_05.md
Tests/Services/GroupSessionsLevel1Tests.cs
Tests/Services/GroupPreOrderLevel2Tests.cs
Tests/Services/DeleteGuestSessionLevel3Tests.cs
dnapp/lambdas/api-handler/Handlers/GuestSessions/GetGroupSessionsHandler.cs
dnapp/lambdas/api-handler/Handlers/GuestSessions/GroupPreOrderHandlers.cs
dnapp/lambdas/api-handler/Handlers/GuestSessions/DeleteGuestSessionHandler.cs
dnapp/lambdas/api-handler/Repositories/GuestSessions/GroupPreOrderWriter.cs
dnapp/lambdas/api-handler/Repositories/GuestSessions/IGroupPreOrderWriter.cs
dnapp/lambdas/api-handler/Repositories/GuestSessions/GuestSessionRepository.cs
dnapp/lambdas/api-handler/Services/GuestSessions/GroupPreOrderService.cs
dnapp/lambdas/api-handler/Services/GuestSessions/GuestSessionService.cs
dnapp/lambdas/api-handler/Services/GuestSessions/IGuestSessionService.cs
dnapp/lambdas/api-handler/Routing/RouteRegistry.cs
deployment_resources.json
```

For `deployment_resources.json`, include only the three added Cognito routes:
GET group sessions, GET Owner session ID, POST group submit. Exclude the earlier
unrelated Swagger S3 resource removal hunk; preserve it locally and unstaged.
Also exclude the unrelated reports-handler `lambda_config.json` fix.

Do not include project-knowledge, AGENTS, EPAM-Materials, `.tools`, credential
files, Terraform state/plan, build outputs or ZIP bundles. Do not force-add
ignored artifacts. The shared repository already contains deployment templates;
do not use this submission as approval to execute them.

## Publication checks still open

API docs contain four email occurrences, now all on reserved `example.com`.
The two John Doe addresses were sanitized with user approval; repository search
found their previous address only in documentation, not executable test data.
The documentation-only email change is separate from the 15-path Backend #5
commit scope above and needs its own explicitly reviewed publication scope.
No real credentials were identified in the changed
files by the limited pattern scan; this is not a full Git-history secret audit.

Anonymous repository/README availability must be confirmed before submission.
This new README exists locally until a separately approved commit and push.

## Publication sequence (not executed)

1. Review the 15-path allowlist above; do not stage the whole working tree.
2. Stage the 14 full paths other than deployment_resources.json explicitly.
3. Stage only its three added route blocks. Keep the old Swagger removal
   and reports-handler fix unstaged. Do not include API docs in this 15-path
   commit; review the approved email sanitation as a separate documentation diff.
4. Check staged paths and diff, credentials patterns, private-artifact exclusions
   and test evidence. Confirm that unrelated unstaged diffs remain intact.
5. Only with separate approval, commit to a named feature branch and push that
   branch. Confirm the reviewer can access the exact revision and README.
6. Do not change repository visibility until a complete history/security review
   is accepted. A clean current diff does not certify the existing history.
