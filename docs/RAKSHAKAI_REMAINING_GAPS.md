# RakshakAI Remaining Gaps

**As of:** 2026-10-30
**Overall verification:** **PARTIAL**
**Production readiness:** **NOT TESTED**

These are evidence gaps, not assumptions that unimplemented features are defects. The application should not be described as fully verified or production-ready until the applicable items below are exercised in a safe acceptance environment.

## Priority 1 — Safety-critical workflow browser coverage

| Gap | Current evidence | Needed to close |
|---|---|---|
| Citizen report → Admin review/verification → incident → unit assignment → Police response → resolution → Citizen status | Backend/API regression tests cover report ownership, verification, assignment, authorization, and status transitions separately. No single Playwright journey ran this flow. | Run the complete journey in isolated PostgreSQL with synthetic identities and verify DB rows, audit/timeline, status refresh, and role restrictions at each step. |
| Remaining Police Management browser coverage | A focused Admin browser run created/edited a synthetic officer, set Supervisor role and off-duty/unavailable state, added the officer to a unit, changed membership to commander, verified it after refresh, and removed the membership. It passed at 1920 px and 390 px against isolated PostgreSQL. | Test duplicate/invalid badge feedback, activate/deactivate and reset-password controls in the browser, plus unauthorized Police access and broader filtering/search/pagination behavior. |
| Deploy → reassign → release → visible audit history | Backend tests include concurrent unit/incident assignments, stale-write protection, reassignment, release, and membership lifecycle. | Verify the end-to-end UI workflow against PostgreSQL, including two concurrent browser/API actors, final officer/unit statuses, and audit history. |
| Incident Command, ERSS-112, supervisor, field, and assistance workflows | Extensive API/unit/database regressions exist; browser release smoke does not traverse these panels. | Exercise each authorized role’s real form actions, validation, refresh/realtime updates, duplicate protection, and failure/retry state in Playwright. |

## Priority 2 — Complete navigation and control audit

- The browser run verified login role, a Citizen deep-link denial, selected GIS/Live Vision/Video Evidence/Tracking/CCTNS interactions, and Police Management create/edit/unit-membership controls at desktop/mobile widths. It did not test Back, Forward, refresh, and direct navigation for every sidebar view or every allowed/denied role.
- The shell audit rendered 20 panels at five widths, but stripped JavaScript and APIs. It cannot prove that every visible dropdown, form, tab, filter, sort, pagination control, notification, modal, export, or button works.
- Dashboard, Alerts, Missing Persons submission, History, Settings subsections, the five ERSS panels, CCTV management, and most admin forms still need page-specific browser interaction tests, including empty/loading/error/success states.
- The full 15-scenario Admin/Police/Citizen browser matrix has now passed in one run at all five requested viewport sizes, backed by one isolated PostgreSQL schema. This closes the broad role/viewport smoke-matrix gap; the cross-module workflows listed above remain open.
- The browser script checks uncaught page exceptions and CSP events but does not record a complete `console.error` stream or HTTP status ledger. Add those checks before making a blanket console/network health claim.

## Priority 3 — Provider and AI acceptance

- OSM/ArcGIS tiles and external geocoding/routing were not available. The isolated browser run used an unreachable loopback routing provider and verified fallback UI; map tile rendering, road-route accuracy, ETA, provider failover, and provider SLA remain unverified.
- Live CCTV hardware/credentials were not used. Camera testing used browser fake media; camera health and access controls have automated tests, but live stream reconnect, real device health telemetry, and operational feed integrity remain unverified.
- The AI service URL was unset in the isolated browser environment. AI service unit/API tests and Copilot multilingual read workflows passed, but production inference, model accuracy, latency, failure handling against the deployed AI service, and detection-to-human-review workflow remain unverified.
- CCTNS behavior is a simulator; it must remain labeled simulated. No live external police case-management integration was tested.
- ERSS browser workflows and live emergency service infrastructure were not tested. Existing simulator/API behavior is not proof of integration with emergency dispatch networks.

## Priority 4 — Security, recovery, and operations

- Automated security/access regression coverage passed, including session cookies, role gates, account administration, citizen data scope, camera/evidence protections, and dispatch authorization. This is not a full penetration test: broad stored/reflected XSS, SQL injection, object authorization fuzzing, prompt injection, dependency exploitability, and deployment misconfiguration review were not performed in this run.
- No implemented MFA flow was found in the inspected page/API inventory. Treat MFA and account recovery as requirements/deployment decisions to resolve, not as a claim that the current application supports them.
- Session expiry during long-running workflows, database outage/recovery, process restart during active incident/dispatch operations, backup restore, multi-node consistency, rate/capacity limits, production monitoring/alert delivery, and disaster recovery were not tested.
- PostgreSQL testing used a local isolated test database and schemas. No production-like failover, replication, encryption-at-rest, external identity provider, or infrastructure security configuration was verified.
- Docker Desktop was unavailable. Docker-dependent release orchestration and any containerized deployment checks remain untested. The Docker test/release script was deliberately not run because it removes volumes.
- Frontend build succeeded with a non-blocking 567.48 kB minified JavaScript chunk warning. Bundle splitting/performance under realistic networks remains a performance follow-up.

## Remaining test execution

1. Complete the remaining deployment matrix: incident unit reassignment/release and a simultaneous first-deployment race. Officer deployment, response-role change, officer release, and duplicate 409 submissions are now browser-tested.
2. Verify every panel’s navigation, active state, direct path, Back/Forward, refresh, error recovery, allowed roles, and denied roles.
3. Run the full acceptance suite against approved staging providers/services, with synthetic test tenants and captured browser console/network evidence.
4. Complete deployment security, MFA/account recovery decisions, backup/restore, capacity, and operational monitoring gates before a production-readiness verdict.

No registration rate limiting was added. Operational PostgreSQL, Docker containers, and volumes were left untouched.

## Supplemental verification update — 2026-10-30

The Citizen → Admin → Police → Resolution browser workflow now passed in Chromium on isolated PostgreSQL. Persisted evidence confirms the report/incident link, resolved statuses, `dispatch_events` timeline, notification rows, audit records, released officer assignment, and duplicate-deployment audit count. See [`RAKSHAKAI_E2E_TEST_RESULTS.md`](RAKSHAKAI_E2E_TEST_RESULTS.md) and [`priority-workflow-postgres-evidence.json`](../artifacts/full-app-audit-20261030/priority-workflow-postgres-evidence.json).

The simulated ERSS-112 workflow now creates and retries after an intentionally invalid simulated event, completes human-confirmed triage, and persists an approved dispatch request. Its final diagnostic check is PARTIAL: a separate incident recommendation request returns an unallowlisted 409 because the synthetic seeded response unit has stale GPS, so downstream eligible-unit response remains unverified. The ERSS scenario must not be treated as live 112 acceptance.

Confirmed UI defect fixed: Dispatcher Refresh had no event handler. It now reloads data and rerenders the queue; Playwright used it to open and approve the simulated dispatch. Confirmed Playwright runner listener accumulation was fixed by using a per-backend-process output stream; a focused browser rerun emitted zero `MaxListenersExceededWarning` messages. Browser diagnostic capture now records page exceptions, console errors, request failures, and HTTP 4xx/5xx with response bodies and narrow allowlists.

Current suite/build evidence: `npm test` exit 0 (backend 464/473 passed, 9 PostgreSQL-only tests skipped in default mode; frontend 131/131 passed); `npm run check` exit 0 (290 JavaScript files); and `npm --prefix frontend run build` exit 0. The build emitted a non-blocking large-chunk warning. The isolated Citizen and ERSS browser runs, their exact commands, logs, screenshots, traces, PostgreSQL evidence, and exit codes are in the E2E report and `artifacts/full-app-audit-20261030/`.

Outstanding: ERSS simulator dispatch to an eligible unit (the current 409 is retained, not allowlisted); incident unit reassignment/release and a concurrent first deployment; live CCTV and real AI inference; live ERSS integration; live map providers/tiles; Docker-based acceptance. These are PARTIAL or NOT TESTED and do not support a production-readiness claim. Operational PostgreSQL, Neon data, Docker containers/volumes were not modified. No registration rate limiting was added.

## Final verification correction — 2026-10-30

The prior remaining-gap list is stale for the two browser workflows and full backend suite: isolated PostgreSQL tests now pass 549/549; Citizen → Admin → Police → Resolution including UI unit reassignment/release passes in Chromium; simulated ERSS now passes through accepted unit and persisted incident linkage. A separate PostgreSQL concurrency test proves a simultaneous first deployment yields one 201 and one 409, with atomic audit/release/retry evidence. A simultaneous first-writer race was not performed with two Chromium clicks. The combined browser runner attempt did not exit 0, so those independent workflows are not called one combined pass. Live external integrations, full navigation across every module/role, Docker acceptance and production readiness remain unverified. See [`RAKSHAKAI_FINAL_TECHNICAL_VERIFICATION_20261030.md`](RAKSHAKAI_FINAL_TECHNICAL_VERIFICATION_20261030.md) for exact evidence and commands.

## Superseding final release-gate verification — 2026-10-30

The previous paragraph is superseded by the current final retest: repeated combined Citizen → Admin → Police → Resolution → simulated ERSS runs passed, and the first-deployment race was exercised in two simultaneous Chromium contexts twice. Independent Citizen-only and ERSS-only runs pass. The full PostgreSQL suite is 549/549. Docker remains NOT TESTED because the daemon pipe is unavailable; live ERSS, GIS providers, cameras, and production readiness remain unverified. Exact evidence and remaining limitations are in [`RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md`](RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md).
