# RakshakAI Final Technical Verification — 2026-10-30

## Verdict

**Overall: PARTIAL. Production readiness: NOT TESTED.** The full backend suite, root test suite, frontend build, focused UI viewport checks, and two isolated Chromium workflows passed. Docker acceptance and live external services were unavailable/not exercised. A later combined citizen+ERSS runner attempt was not green; the two workflows are reported separately based on their successful isolated runs.

## Confirmed defects fixed

1. ERSS approval created the canonical incident and updated `erss_events.incident_id`, but left `erss_dispatch_requests.incident_id` null. `approveDispatchRequest` now writes the canonical incident ID to the dispatch request. The ERSS service test asserts that link, and the Chromium/PostgreSQL workflow verified it persisted.
2. After selecting an already assigned incident for “Change Unit,” the Unit Assignment screen retained the default unassigned-only filter and hid that incident. The UI now switches the incident filter to “All” when opening an assigned incident.
3. The incident repository could prefer a stale JSON `assigned_unit_id` alias over the relational `assigned_unit_id` value after a unit change. The write path synchronizes both aliases and serialization omits the stale alias.
4. The Playwright harness now records page exceptions, console errors, failed requests, and HTTP responses >=400 with narrow method/path/code allowlists. The earlier `MaxListenersExceededWarning` came from reusing one log stream across restarted child processes; the runner now uses per-process streams and closes/unpipes them. Listener limits were not changed and the warning was not suppressed.

## Commands and evidence

All PostgreSQL runs used the local embedded test server at `127.0.0.1:55440`, database `rakshakai_test_copilot_utf8`, and per-run `rakshakai_test_full_*` schemas. The isolated server is bootstrapped by `artifacts/final-verification-20261030/start-isolated-pg.mjs`. Docker was not used.

| Command | Exit | Result |
|---|---:|---|
| `npm test` | 0 | 474 backend-mode tests: 464 passed, 10 database-only skips, 0 failed; frontend: 131/131 passed. Log: [`root-full-suite-after-erss-fix.log`](../artifacts/final-verification-20261030/root-full-suite-after-erss-fix.log). |
| `$env:NODE_ENV='test'; $env:TEST_DATABASE_URL='postgresql://rakshakai_test:test-only-password-ui-2026@127.0.0.1:55440/rakshakai_test_copilot_utf8'; $env:RAKSHAKAI_TEST_DATABASE_NAME='rakshakai_test_copilot_utf8'; $env:PG_SSL_MODE='disable'; npm --prefix backend test` | 0 | Full isolated PostgreSQL suite: 549/549 passed, 0 failed/skipped. Log: [`backend-full-postgres-suite-after-erss-fix.log`](../artifacts/final-verification-20261030/backend-full-postgres-suite-after-erss-fix.log). |
| `npm --prefix backend test -- tests/erss-112.test.js` | 0 | 10/10 ERSS service tests passed, including canonical incident linkage. |
| `npm --prefix backend test -- tests/incident-officer-assignment-concurrency-postgres.test.js` | 0 | Concurrent first deployment returned `[201,409]` (`CREATED`,`OFFICER_BUSY`); release/retry returned 201; final active rows 0, released rows 2, audit count 4. Log: [`concurrency-pg.log`](../artifacts/final-verification-20261030/concurrency-pg.log). |
| `npm run check` | 0 | Syntax checked 291 JavaScript files. Log: [`check-after-erss-fix.log`](../artifacts/final-verification-20261030/check-after-erss-fix.log). |
| `npm --prefix frontend run build` | 0 | Production bundle built. Existing non-blocking large chunk warning (about 568 kB minified) remains. Log: [`frontend-build-after-erss-fix.log`](../artifacts/final-verification-20261030/frontend-build-after-erss-fix.log). |
| `npm run test:critical-ux` | 0 | Critical banner/Copilot layout checks passed at 1920×1080, 1440×900, 1024×768, 768×1024 and 390×844. Log: [`critical-ux-after-erss-fix.log`](../artifacts/final-verification-20261030/critical-ux-after-erss-fix.log). |
| `node artifacts/full-app-audit-20261030/run-local-postgres-browser-release.cjs` with `RELEASE_TEST_SKIP_MATRIX=true`, `RELEASE_TEST_SKIP_ERSS=true`, `RELEASE_TEST_WORKFLOW_SCRIPT=artifacts/full-app-audit-20261030/priority-workflows.cjs`, frontend `http://127.0.0.1:3003`, backend port `5001`, and test-only `API_RATE_LIMIT=5000` | 0 | Actual Chromium Citizen → Admin → Police → resolution workflow passed, including Police Management/member role, unit reassignment and release, officer deployment/release, incident status transitions, refresh/history, citizen denial, and persisted report/timeline/notification/audit evidence. Log: [`citizen-workflow-current-isolated.log`](../artifacts/final-verification-20261030/citizen-workflow-current-isolated.log); DB evidence: [`priority-workflow-postgres-evidence.json`](../artifacts/full-app-audit-20261030/priority-workflow-postgres-evidence.json). |
| Same runner with `RELEASE_TEST_ERSS_ONLY=true` and `RELEASE_TEST_WORKFLOW_SCRIPT=artifacts/full-app-audit-20261030/priority-workflows.cjs` | 0 | Simulated ERSS workflow passed. Invalid simulated intake returned 400, corrected retry created a `simulated=true` event, human-confirmed triage forwarded it, approval created one unit request, and the request transitioned `REQUESTED` → `ACKNOWLEDGED` → `ACCEPTED`. PostgreSQL verified event/dispatch/canonical incident linkage, busy unit assignment, and audit actions `erss_dispatch_approved`, `erss_unit_requested`, `erss_unit_acknowledged`, `erss_unit_accepted`. Log: [`erss-browser-isolated.log`](../artifacts/final-verification-20261030/erss-browser-isolated.log). |

The successful browser invocations used these PowerShell settings before running `node artifacts/full-app-audit-20261030/run-local-postgres-browser-release.cjs`:

```powershell
$env:API_RATE_LIMIT='5000'
$env:RELEASE_TEST_PASSWORD='Isolated-Test-Only-2026!'
$env:RELEASE_TEST_FRONTEND_URL='http://127.0.0.1:3003'
$env:RELEASE_TEST_BACKEND_PORT='5001'
$env:RELEASE_TEST_SKIP_MATRIX='true'
$env:RELEASE_TEST_SKIP_ERSS='true' # Citizen/Police workflow only
$env:RELEASE_TEST_WORKFLOW_SCRIPT='artifacts/full-app-audit-20261030/priority-workflows.cjs'
node artifacts/full-app-audit-20261030/run-local-postgres-browser-release.cjs
```

For the separate ERSS run, remove `RELEASE_TEST_SKIP_ERSS` and set `$env:RELEASE_TEST_ERSS_ONLY='true'`. The ERSS-only run used the same isolated runner and exited 0.

The citizen workflow browser diagnostics recorded zero page exceptions and zero failed requests; its observed HTTP/console errors were the asserted Citizen 403 and expected dispatch/resource conflicts. The ERSS-only diagnostics recorded zero page exceptions and zero failed requests; its allowlisted responses were the deliberately malformed-intake 400, pre-dispatch lookup 404, and no-primary-capacity 409 caused by stale seeded units. The test-only higher API request budget was used only to avoid exhausting the application-wide limiter during this request-heavy isolated browser workflow; it is not a production setting and does not add registration rate limiting.

## Superseding final release-gate verification — 2026-10-30

The earlier combined-workflow failure is resolved and retested. Combined Citizen → Admin → Police → Resolution → simulated ERSS Chromium/PostgreSQL runs now exit 0 repeatedly; independent Citizen-only and ERSS-only runs also exit 0. Two Chromium contexts raced simultaneous first deployments twice and verified 201/409, one active deployment, database audit/timeline atomicity, conflict messaging, and persistence after refresh. The complete current PostgreSQL suite passes 549/549. See [`RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md`](RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md) for final commands, exit codes, schemas, browser diagnostics, screenshots/traces, and limitations. This addendum supersedes this report's earlier statement that the combined browser runner was not green.

## Screenshots and traces

Latest Citizen workflow screenshots and traces are in `artifacts/full-app-audit-20261030/`, including `priority-citizen-report-submitted.png`, `priority-admin-verified-report.png`, `priority-officer-deployed.png`, `priority-officer-released.png`, `priority-admin-resolved.png`, `priority-citizen-resolved.png`, `priority-admin.zip`, and `priority-citizen-final.zip`. ERSS screenshots/traces include `priority-erss-simulated-intake.png`, `priority-erss-dispatched.png`, and `priority-erss-only.zip`. The existing before/after Police Management mobile title-overlap screenshots remain linked in [`RAKSHAKAI_E2E_TEST_RESULTS.md`](RAKSHAKAI_E2E_TEST_RESULTS.md).

## Failed attempts and residual limitations

- A combined Citizen+ERSS runner attempt exited 1 after its final diagnostics check because the allowlist initially omitted a pre-dispatch GET 404 and the expected `HYBRID_SUPPORT_UNAVAILABLE` conflict. A later attempt hit a Vite development-server/Playwright login startup failure. The independently isolated Citizen workflow and ERSS workflow each pass; the combined runner is not claimed as passing.
- One earlier combined attempt encountered the default general API limiter during the high-volume browser run. The final Citizen workflow used only a test-process `API_RATE_LIMIT=5000`; production limiter behavior was not changed.
- Simulated ERSS dispatch used seeded demo response-unit data and a simulated/manual caller location. Live ERSS-112 intake, carrier linkage, telephony, and operational dispatch are **NOT TESTED**.
- The deployment race was verified against PostgreSQL at the service/API integration level; two simultaneous first-writer clicks in Chromium were not run. The browser workflow did verify concurrent duplicate deployment attempts after an officer was deployed (both rejected with 409), plus UI reassignment/release.
- The critical UI viewport test covers its tested banner/Copilot surfaces; it is not a claim that every application panel was exhaustively checked at all five viewport sizes. GIS live tiles/routing, CCTV hardware, deployed AI inference, and other external integrations are **NOT TESTED**. Their simulated/local workflows do not prove external service acceptance.
- Docker daemon access was unavailable; Docker acceptance is **NOT TESTED**. No Docker command that could prune/remove volumes was run. No operational PostgreSQL, Neon data, or Docker volumes were targeted. No registration rate limiting was added.
- A full combined browser run after the final runner edits is not green; do not use this verification as a production-readiness sign-off.
