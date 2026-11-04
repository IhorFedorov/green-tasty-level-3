# Frontend homework — Owner Group Pre-order

## Accepted submission scope — 2026-11-04

Completion sprint: local Customer Group Pre-Order navigation and explicit draft
replacement confirmation added. Node62/62, app/spec TypeScript and production
build/postbuild PASS. Backend group76/76, routing56/56, Python24/24 PASS.
The new frontend build is not yet published; authenticated group E2E remains
pending separate approval. Recovery is DONE; never repeat it. Current evidence
and review checklist: [Level 3 submission](../../LEVEL_3_SUBMISSION.md).

User-approved scope: Owner participant view, cart statuses, subtotals and group
totals, live updates/Refresh, submitted-session consolidation and manual Submit.
Full original BA US1, automatic deadline finalization and US2 Hospitality Rules
are excluded from today's required scope. No full BA/Figma compliance claim.
Production group E2E is not accepted yet. The target group was recovered with one
approved conditional Put; no duplicate booking/order is planned.
Before Submit, explicitly resolve the existing Owner draft Demo Bowl x1: ordinary
Order items are not automatically copied to Owner GuestSession, and consolidation
replaces the existing draft items. Never silently discard that draft.
One-off recovery does not prove correct booking lifecycle. Current remote source
is stale and must be updated under separate commit/push approval before submission.
Known UX/timezone/availability findings remain deferred; no fixes are included here.

Local implementation of EPAM Frontend Levels 1/2 and preparation for Level 3.
Backend deployed; authenticated live frontend integration is not yet verified. AI assisted implementation
and local verification; original EPAM homework, PNG designs and tests were used.

## Run

Use the existing Node/NuGet-independent frontend dependencies and supported Node.
From this directory:

```sh
npm start -- --host 127.0.0.1
# Open http://localhost:4200/reservations/demo-reservation/group-order?demo
npm run test:hw
npm run test:hw:node
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.spec.json --noEmit
NG_BUILD_MAX_WORKERS=1 NODE_OPTIONS=--max-old-space-size=768 BACKEND_URL=https://2v8o0dlq2g.execute-api.eu-north-1.amazonaws.com/develop npm run build
```

The API base includes /develop once; services append paths without another stage.
Login uses backend POST /signin and /register, not Cognito Hosted UI.
The deployed backend owns Cognito settings: region eu-north-1,
pool eu-north-1_N6Ct4Bj3m, client 1gqbood80bc33e7hab9nqscmm2.
No frontend Cognito SDK or OAuth callback configuration is needed for this flow.
Catalog images use API-returned URLs under https://d14f8spjgetu2u.cloudfront.net/.
Local metadata allows Origin * and Authorization/Content-Type without cookies.
Live browser preflight, Gateway-generated error CORS, login and image loading
still need post-publication checks; no AWS configuration was changed here.
Demo login and mock interceptor are registered only in Angular development mode.
The mock accepts only demo IDs; real IDs use the configured API. Demo identities
must sign out before using a real backend; no unsigned demo token should be sent
to it. Mock data resets on page reload. Production uses the real API URL above.

## Implemented

- Semantic, responsive Owner Review with participant cards, dish quantities,
  subtotals, text statuses, dates and guest counts using existing color tokens.
- Submitted-only consolidation by dish ID; Grand Total ignores draft baskets.
- Loading, recoverable error/404, empty, pending warning and read-only sent states.
- Shared confirmation modal, guarded single Submit, retry after failure and one
  success toast. Error toasts remain the interceptor's responsibility.
- Backend #5 camelCase sessions/Owner ID/submit/DELETE service contracts. Existing
  PascalCase invitation contract is preserved. Owner snapshots carry Cognito auth;
  ordinary guest requests retain guest authorization.
- Every 15 seconds while Open: silent refresh, last-good-data retention, manual
  Refresh and update timestamp, no overlapping requests, cleanup on destroy.
- DELETE HTTP adapter is prepared; optional Remove Guest UI is not implemented.
  Owner cart editing and general backend concurrency redesign remain out of scope.

## Verification and limits

GT-10A (2026-11-03): real-API production build and postbuild scan PASS;
58/58 Node HTTP/logic/auth tests PASS; app/spec TypeScript checks PASS.
The first stricter postbuild scan detected retained mock imports. Angular
production file replacement now excludes those modules; final scan verifies
the real staged API URL and absence of placeholder/demo markers in all JS.
Build: dist/restaurant-frontend-app/browser (not uploaded).
Initial bundle 638.27kB; existing warning budgets/CommonJS warnings remain.
Backend/infra preservation check: 330 files unchanged. No AWS calls or writes.
Live CORS (including generated 401/403 responses), login, Owner/guest flows,
seed-backed catalog images and DOM/375px checks remain separate gates.

Recorded 2026-11-03 local time: production build and placeholder check passed;
app/spec TypeScript and Angular spec-template compilation passed. Node fallback:
58 passed, 0 failed (pure helpers, mock store/auth, HTTP services, request lifecycle
and Owner/guest authorization). Node tests do not render components or prove UI.
The first browser run compiled Level 1 tests but Chrome failed to initialize its
OS sandbox. No sandbox bypass was used. Final DOM tests, 375px visual review and
screenshots are therefore not verified; no level is declared fully accepted.

Production warnings: initial bundle above 500kB warning threshold, existing SCSS
warnings and CommonJS dependencies; build error budgets passed. No dependencies
were installed/upgraded. Full unrelated suite and live API tests were not run.
Actual Level 3 needs an approved deployed backend, real login/reservation/order
and staged end-to-end checks. Backend GSI/concurrent-writer limitations remain.
