# Owner Group Pre-order — submission evidence

## Accepted scope

Owner sees participants and their carts, Submitted/Still choosing statuses,
per-person totals and submitted-only group totals. A silent 15-second refresh
and manual Refresh keep the open group current. Manual Submit consolidates by
dish ID and changes the Group and existing Order statuses atomically.

This is the narrowed EPAM homework feature, not all original BA US1/US2.
Hospitality/payment allocation, automatic deadline finalization, Owner cart
editing and frontend Remove Guest are excluded. Backend DELETE is implemented.
Original PNG design is adapted to a standalone page; no pixel-perfect claim.

## User path

Sign in as the Customer who owns a multi-person Reserved reservation. On
My Reservations choose **Group Pre-Order**. The navigation change is now
published. Existing production also supports
the direct route `/reservations/<reservationId>/group-order`.

The page obtains the invitation, binds/reuses the Owner session, then loads
participant snapshots and group status. Owner-ID GET may create a session;
it is not a read-only probe. Guest invite tokens and passwords stay private.

## Important data behavior

Ordinary reservation pre-orders and Owner participant carts are different data.
The existing reservation Order is a required editable target, not an extra basket
merged into the group. Submit **replaces its dishes** with submitted participant
carts. An empty Owner session does not include the Owner's ordinary draft.
The confirmation now explicitly discloses this replacement. Do not Submit before
the owner accepts the exact proposed quantities and effect on their draft.

## Evidence collected on 2026-11-04

| Check | Result |
|---|---|
| Frontend Node logic/HTTP/navigation | 62 passed, 0 failed |
| App and spec TypeScript | Both passed |
| Production build + placeholder/demo scan | Passed |
| Backend group Levels 1–3 focused tests | 76 passed, 0 failed/skipped |
| CloudFront routing tests | 56 passed, 0 failed |
| Local IAM/private-S3/Gateway CORS regression | 24 passed |
| Existing production reservation/group/Owner link | Read-only verified |
| Existing draft | Created, one Bowl; unchanged |
| Target sessions | 0 at read-only preflight |
| Authenticated Owner/Guest browser E2E | PENDING |
| Current navigation/confirmation deployed | 97 files verified; invalidation Completed; 18 HTTP checks passed |
| Actual submission/reviewer repository access | PENDING |

Node tests exercise component logic and HTTP contracts, not rendered DOM.
Browser automation failed to start because the OS sandbox refused the process;
no sandbox bypass was used. Group UI/mobile screenshots are not yet evidence.
Build warning budget/CommonJS and existing NuGet security advisories remain.
The application retains known eventual-index/concurrent-writer limitations.
Known reopening limitation: the page bootstraps through invitation APIs that
reject Submitted groups. Immediate Sent state is implemented, but reloading or
reopening a submitted group's page is not currently supported by that flow.
Do not claim reload acceptance; final Group/Order statuses can be verified through
authorized read-only checks. A durable submitted-view API is separate follow-up
work, not silently replaced by cached/fabricated participant data.

## Bounded production demonstration, approved but browser-blocked

The user approved this exact E2E including draft replacement, but the agent cannot
start browser automation because of OS sandbox failure. Private browser interaction
was requested; no Owner/Guest session or Group Submit has been executed by the
agent. Read-only session count remains0 at the last check. This is not E2E PASS.

Reuse the existing reservation and Created order; never create duplicate booking
or order. The recovered group is already present and must not be recovered again.

1. Customer privately signs in; open Group Pre-Order. Verify correct booking and
   one reusable empty My Pre-Order session. Snapshot and status must load.
2. Copy Invite Link and use two genuinely isolated browser profiles/storage.
   Guest A adds Bowl x2 and Salad x1; guest B adds Bowl x1 but leaves it draft.
3. Guest A submits: Owner shows submitted total **26**, while B remains pending.
   Owner snapshot may total **36** including drafts; restaurant consolidation
   deliberately excludes B until submitted. Observe automatic refresh and Refresh.
4. Guest B submits: consolidated quantities Bowl x3/Salad x1, total **36**.
5. Before Group Submit verify the Owner's initial Bowl x1 is being replaced,
   not added as a fourth Bowl. Do not silently remove or duplicate its meaning.
6. Approve one Group Submit: expect Group Submitted, Order SubmittedByCustomer,
   exact quantities 3+1 and total36; the current screen shows Sent/read-only.
   Verify persisted Group/Order statuses independently; do not claim page reload.
7. Capture sanitized screenshots before/after and read-only status/quantity
   evidence. Do not export passwords, JWTs, invitation URLs or personal emails.

No acceptance is claimed until these live steps pass. On unexpected errors stop
mutating operations; inspect state, do not create retries/duplicates/cleanup.
If reservation status/time makes the scenario unavailable, stop; a new or edited
booking is outside this demonstration permission.

## Submission checklist

- [ ] Latest reviewed source commit is publicly accessible to the reviewer.
- [ ] Published build matches the approved release manifest.
- [ ] Group before/after screenshots and live quantities/status evidence exist.
- [ ] Readme states scope limits, test results, AI use and known risks honestly.
- [ ] App/repository links are entered in the actual EPAM submission form.
- [ ] User confirms submission receipt and separately completes the final exam.

This repository does not contain the private audit knowledge, course PDFs, AWS
credentials/state/plans, build outputs or deployment ZIPs. Local commits are not
evidence of remote publication or successful EPAM submission.
