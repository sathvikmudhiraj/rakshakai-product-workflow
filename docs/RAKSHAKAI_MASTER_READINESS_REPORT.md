# RakshakAI Master Readiness Report

**Assessment date:** 2026-11-09
**Repository:** `sathvikmudhiraj/rakshakai-product-workflow`
**Branch / assessed HEAD:** `bug-fix-of-mvp` / `5db536e7b6ca2759eaeddd17c2ecae1d8e212963`
**Scope:** Readiness audit, narrowly scoped safety fixes, and local isolated tests. No deployment, commit, push, merge, Docker restart, operational database mutation, or volume operation was performed.

## 1. Executive summary

Several important application controls and regression checks pass, including isolated backend, frontend, and AI-service suites, a production frontend build, and a read-only Neon connectivity check. The backend now validates incident-room subscriptions against server-side records, explicitly marked demo incidents are filtered from Copilot/alerts/notifications and skipped by SLA escalation, and citizen registration can be disabled explicitly in production configuration.

The system is **not verified as a live single-host pilot**. Docker Desktop was unavailable, no application services were listening locally, authenticated live-browser checks were not possible, and staging/rollback was not run. GitHub PR #4 is open and draft; its latest required verification workflow failed at `npm run test:release`, with the exact underlying failure unavailable. The release gate is therefore blocked. Real public-safety production requires independent organizational, infrastructure, model, security, and operational validation.

The Neon `SELECT 1` check passed after the helper was run. It confirms that the local backend configuration authenticated to the intended Neon host at check time; it does not independently prove how or when the manually rotated credential was changed or that the old credential was revoked.

## 2. Readiness verdicts

Updated 2026-11-09 by a later verification session after the CI release failure was root-caused and the isolated runtime gates were executed (full evidence in §16). Sections 3-15 below record the earlier audit and remain as written for that run.

| Area | Verdict | Evidence / reason |
|---|---|---|
| APPLICATION | **PASS (application gates)** | All unit/regression suites green; full `npm run test:release` passes end-to-end locally (14/14 integration + 45/45 authenticated browser scenarios on built images); production build passes. Real-provider AI quality and regional GIS data remain externally owned. |
| SECURITY | **PARTIAL** | All security/authorization tests pass; production fail-closed validations observed live (unencrypted remote DB refused, camera-credential key enforced, evidence storage probe). Outstanding: credential-revocation provenance (manual), GitHub secret-scanning review (not queryable from this environment), external controls. |
| JARVIS | **PASS (suite level)** | Read-only restrictions, clear-chat, multilingual, badge/location lookup, location qualifiers, and prompt-injection/write-request blocking all pass in the backend suites. Real external model-provider quality was not evaluated. |
| SINGLE-HOST PILOT | **PASS (isolated runtime verification)** | Verified in isolated Docker on built images: graceful-shutdown drill (SIGTERM drain, in-flight writes committed, socket notification, clean exit), PostgreSQL-backed full suite (574/574), TLS verification drill, paired backup+restore drill, 2-replica operational load drill, 45-scenario authenticated browser matrix. Staging deployment/rollback on real infrastructure remains outstanding. |
| GITHUB RELEASE | **GATE GREEN (PR still draft)** | Owner authorized commit+push on 2026-11-09. Commits `030e9fd` (order-independent evidence scenario, transient-timeout login retry) and `248a3d5` (843 artifact files / 352 MB untracked; `artifacts/` gitignored) pushed to `origin/bug-fix-of-mvp`. Release checks run #42633958636: ai-service-checks, verify, release-gate all **success**. PR #4 head `248a3d5`, mergeable_state `clean`; it remains a draft — marking ready and merging are owner decisions. |
| REAL PUBLIC-SAFETY PRODUCTION | **NOT READY** | Requires independent operational, organizational, infrastructure, model, privacy, and emergency-integration approvals. |

## 3. Baseline, worktree, and preservation

- The assessed branch and HEAD are recorded above. The remote branch was observed at the same commit during this audit. PR #4 targets `main` and is open, draft, mergeable, and unmerged.
- PR #4 contains 1,205 changed files and 44 commits; most of the broad diff consists of artifacts/evidence. Review the exact PR diff before release.
- Main requires `verify` and `release-gate` checks. The latest observed PR workflow was run #50 (`42590173650`): `ai-service-checks` passed; `verify` failed at `npm run test:release`; `release-gate` failed because verify failed. The job log connector did not provide the failing test's underlying error, so root cause is **NOT VERIFIED**.
- Another development session advanced the branch during the larger audit. Its worktree changes were preserved. The current worktree includes unrelated concurrent changes to `backend/services/shutdown.service.js` and `backend/tests/shutdown.test.js`; they were not edited as part of this report. Other worktrees were left untouched.
- Docker Desktop's Linux engine was unavailable. No Docker start, restart, teardown, volume deletion, or recovery attempt was made. No local listeners were present on the inspected frontend/backend/AI/PostgreSQL ports.
- All operational database data, PostgreSQL rows, Docker volumes, evidence, and audit records were preserved. The only live database operation was the requested read-only `SELECT 1` connectivity check.

## 4. Completed features and code-level fixes

- **Socket.IO incident rooms:** Admin and Police Officer clients can join only a room corresponding to an existing server-side incident. Unauthorized roles, malformed/unknown IDs, and database lookup failures are denied. Focused tests cover these outcomes.
- **Explicit demo classification:** Copilot operational counts/lists, dashboard alert counts, active alert listing, incident-derived notifications, and SLA escalation now exclude records explicitly marked demo. Classification uses authoritative markers, not title text. Existing demo alerts/timeline are preserved; the SLA sweep skips demo incidents without resolving or rewriting history.
- **Citizen registration:** Existing enabled behavior remains the default for local compatibility; production Compose requires an explicit `PRODUCTION_ALLOW_CITIZEN_REGISTRATION` choice and invalid settings fail closed. Authentication rate-limit thresholds were not changed.
- **Human authorization:** Existing operational mutation paths remain human-supervised; tests verify Copilot operational mutation requests are refused. No real emergency alert or external public-safety integration was triggered.
- **Location and Send Alert source review:** Incident detail shows location/address separately from location/dispatch status. Send Alert is visible without expanding the advanced manual-coordinate section; real alert submission was not tested.
- **Password policy and authentication:** Shared password-policy checks, HttpOnly session behavior, revocation, role authorization, and rate limiting have test coverage. No existing credential was changed.

## 5. Remaining application and security issues

| Priority | Finding / root cause | Status and recommended action |
|---|---|---|
| P1 | **Police cross-station visibility policy unresolved.** Active incident listing permits Police/Admin access to all active incidents, while SLA/evidence endpoints apply narrower station, jurisdiction, or assignment scope. No authoritative product policy was located. | Do not silently change access. Product/security owner must decide the intended visibility model, document it, then add scoped authorization tests. |
| P1 | **Live application unavailable for verification.** Docker engine unavailable and no local services were listening. | Restore Docker availability through the normal operator workflow, then verify health endpoints and authenticated UI using isolated data. |
| P1 | **Credential rotation/revocation provenance.** `SELECT 1` passes against the intended Neon endpoint, but manual rotation and revocation of the historical credential are outside local evidence. | Database owner should verify rotation/revocation in Neon's credential/audit controls. Keep credentials out of logs and reports. |
| P1 | **Production database topology is undecided.** The production Compose overlay currently targets its local Compose PostgreSQL service, while host-run backend uses Neon. | Choose and document the production topology before deployment; validate backup, TLS, access, and failover strategy. Do not point configs at another DB without review. |
| P1 | **CI release gate failure.** `npm run test:release` failed in latest PR verification; underlying job error was not retrievable. | Retrieve the full GitHub Actions job log, reproduce only in a disposable environment, and fix the underlying cause without disabling the check. |
| P1 | **Operator-controlled Docker secret quality warnings.** Docker configuration checks warn that the AI API key is below the recommended length and that seed passwords are duplicate/short. Values are intentionally omitted. | Rotate/update through the coordinated secret process. Confirm seed account behavior first; seed settings do not change existing passwords. |
| P2 | **Demo classification coverage depends on authoritative markers.** Title-only suspected records remain operational until explicitly reviewed/classified. | Data owner should use the authorized classification workflow and reason/audit requirements. No title-only records were automatically reclassified. |
| P2 | **Authenticated browser evidence absent for this run.** Automated viewport fixture checks are not equivalent to live authenticated role walkthroughs. | After services are available, capture desktop/tablet/mobile checks for Admin, Police, and Citizen, including keyboard/accessibility and network/console results. |
| P2 | **Independent public-safety validation outstanding.** No Indian operational dataset evaluation, independent model validation, authorized ERSS-112/CCTV integration, or organizational sign-off was performed. | Treat as an external production-readiness requirement; see the plan below. |

## 6. JARVIS verification

Backend regression coverage passed for operational grounding, incident/unit/officer lookups, bounded read-only query registry, role/station scoping, location qualifiers, conversation context, multilingual English/Telugu/Roman Telugu/Hindi/mixed input, safe navigation, prompt injection handling, sensitive-field refusal, and blocking operational mutation requests. The explicit-demo filter is covered by a test proving a marked demo is excluded while title-only suspicious text remains included.

**Not verified:** live authenticated browser interaction, real external model/provider quality, production AI credentials, streaming behavior against a running deployment, and model accuracy on an independently approved operational dataset. The AI-service unit suite is not real-provider verification.

## 7. CCTV, Police Management, and GIS

- **CCTV:** Backend tests cover health state transitions, alert preservation, credential encryption, access restrictions, and safe metadata responses. Source checks and automated frontend tests cover key health UI behavior. No live camera, RTSP feed, actual police CCTV system, or device credential was used.
- **Police Management:** Backend tests cover role authorization, officer/station/unit memberships, assignment integrity, and audit behavior. Live authenticated persistence-after-refresh was not checked because services were unavailable.
- **GIS:** Frontend tests/build passed and source/test coverage includes map interactions, marker projection, navigation controls, routing fallback, and mobile layers. Regional OSRM service health, live geocoding, regional routing data, and actual-network operation were not checked.
- No current-run real authenticated screenshots were captured. Existing screenshots/evidence under repository artifact directories are historical and must not be represented as this-run live verification.

## 8. SLA and data-quality verification

- Exact-severity SLA policy validation, deadline calculation/preservation, warning/breach progression, escalation deduplication, investigation workflow, and resolution history are covered by isolated tests.
- The new regression test proves explicitly classified demo incidents are skipped without changing existing demo escalation alerts or incident timeline.
- Existing deadline reconciliation remains a preview/authorized workflow. No operational reconciliation or write was run.
- Confirmed explicit demo data is filtered from operational alert counts/listings, notification generation/display, Copilot summaries, and new SLA escalation. Suspicious title-only records are not auto-classified.
- Send Alert was source-reviewed; real public/emergency alert behavior was not exercised.

## 9. Database, Neon, and Docker status

| Check | Result | Detail |
|---|---|---|
| Neon host intent | **PASS** | Backend `DATABASE_URL` metadata resolves to the configured Neon endpoint; full URL and secret fields were not printed. |
| Neon read-only connectivity | **PASS** | `SELECT 1` completed successfully after the user ran the password helper. This was read-only. |
| Historical password rotated/revoked | **NOT VERIFIED** | Requires confirmation from the Neon/database owner. |
| PostgreSQL data preserved | **PASS** | No migrations, writes, or operational record mutations were run. |
| Docker PostgreSQL / volumes | **NOT TESTED** | Docker engine unavailable. Compose's configured PostgreSQL volume was not touched. |
| Docker static configuration | **PASS WITH WARNINGS** | `npm run docker:config` passed service/network/frontend privacy checks; warnings remain for AI key strength and seed-password quality. |
| Production Compose syntax | **PASS** | Prior offline `docker compose config --quiet` validation passed using temporary process-only placeholders. |
| Live Nginx/backend/PostgreSQL/AI/OSRM health | **NOT TESTED** | Docker engine unavailable and no local service listeners observed. |

Host-run backend configuration uses Neon. Docker Compose config builds the backend database URL from its local PostgreSQL service variables and service hostname `postgres`; the two configurations are intentionally distinct. Because no backend process was running, the **currently running backend's actual database is NOT VERIFIED**. The most recent successful backend connection check used the host-run configuration and reached Neon.

## 10. GitHub PR #4 and release integrity

- PR #4 is open, draft, unmerged, and reported mergeable; required branch-protection checks are `verify` and `release-gate`.
- Latest observed run #50: AI service checks passed; verification failed at `npm run test:release`; dependent release gate failed. Exact failure details remain unavailable.
- Staging deployment, rollback rehearsal, image digest verification, release asset hash verification, and post-deployment health checks were not run.
- This work did not commit, push, merge, deploy, disable CI, or edit PR metadata. The local worktree remains modified and contains other-session changes; it is not a clean release checkout.

## 11. Test and verification counts

| Suite/check | Result |
|---|---|
| Backend full suite, isolated no-DB mode | **489 passed, 0 failed, 10 skipped** (499 tests total). The skipped cases require PostgreSQL; no operational DB was used. |
| Focused alert/SLA/Copilot/socket/registration regressions | **58 passed, 0 failed** (subset of backend suite; do not add to totals). |
| Frontend test suite | **155 passed** (previously executed during this audit). |
| AI Python service suite | **21 passed** (previously executed during this audit). |
| Critical UX viewport fixture checks | **PASS, 5 viewports:** 1920×1080, 1440×900, 1024×768, 768×1024, 390×844. Fixture-based, not authenticated live app. |
| Frontend production build | **PASS** (previously executed during this audit). |
| JavaScript syntax | **PASS, 325 files**. |
| Docker configuration checker | **PASS WITH WARNINGS** as noted above. |
| Production Compose parse | **PASS** (offline config check). |
| `git diff --check` | **PASS** (line-ending normalization warnings only). |
| Live authenticated Chromium role walkthroughs | **NOT EXECUTED**; application services were unavailable. |
| Live Docker service health / staging / rollback | **NOT EXECUTED**; Docker engine unavailable. |
| GitHub CI root-cause reproduction | **NOT EXECUTED**; CI error details not retrieved and release script creates/removes its own Compose resources. It was not run locally to preserve all Docker volumes. |

## 12. Changed files and reasons

This worktree contains changes from the preceding environment-configuration task and the readiness review. Important readiness changes include:

- `backend/services/socketIncidentAccess.service.js`, `backend/server.js`, `backend/tests/socket-incident-access.test.js` — server-side authorization for incident-room subscriptions.
- `backend/services/slaDataQuality.service.js` integration in `backend/services/core.service.js`, `backend/services/copilotRead.service.js`, and `backend/services/notification.service.js` — filter explicitly demo-classified records from operational summaries and notifications.
- `backend/services/slaSweep.service.js`, `backend/tests/phase4_behavior.test.js` — skip explicitly demo incidents in new SLA escalation without mutating existing history.
- `backend/middleware/citizenRegistration.middleware.js`, `backend/routes/auth.routes.js`, `backend/tests/citizen-registration-policy.test.js`, `compose.yaml`, `compose.prod.yaml`, `.env.example`, `.env.docker.example`, `backend/.env.example`, `backend/tests/docker-safety.test.js`, `DOCKER.md`, `PRODUCTION_SETUP.md` — explicit production registration control and safe documentation.
- `backend/tests/copilot-read.test.js`, `backend/tests/notification-center.test.js` — demo classification regressions.
- `docs/ENV_CONFIGURATION_FINAL_REPORT.md` — environment findings updated to reflect later successful Neon connectivity check and current manual-verification limitation.
- `docs/RAKSHAKAI_MASTER_READINESS_REPORT.md` — this readiness record.

Other modified files in `git status`, including shutdown service/tests, may belong to a concurrent session and were preserved. No live secret values were added to tracked files.

## 13. Preserved application data

No operational database data or rows were changed. No database migration, seed, reset, import, cleanup, delete, or reconciliation command was run. The only live database statement was read-only `SELECT 1`. No Docker volume was started, stopped, recreated, deleted, or otherwise modified. No evidence, incident, officer, camera, audit, notification, or session data was intentionally changed outside isolated test fixtures.

## 14. Production readiness plan and dependencies

Before real public-safety deployment, owners must complete and independently validate:

1. **Database:** HA PostgreSQL, failover, TLS, PITR, automated backups, restore drills, retention, least-privilege roles, and monitoring.
2. **Evidence:** Private durable object storage, encryption, checksums, malware scanning, legal holds, chain of custody, retention/deletion policy, and access audits.
3. **CCTV:** Authorized RTSP/media gateway design, browser playback controls, camera-scoped authorization, credential rotation, network resilience, and health/on-call procedures. No actual police CCTV without authorization.
4. **Network/security:** HTTPS termination, WAF, private networking/firewalls, service identities, secret manager, key rotation, vulnerability response, and security monitoring.
5. **Identity:** Organizational SSO, MFA, recovery, multi-instance session revocation, emergency access, and periodic access review.
6. **Operations:** Central logs/metrics, redaction, error monitoring, SLA and availability objectives, on-call, incident escalation, redundant application instances, WebSocket coordination, controlled deploys, rollback, and disaster recovery.
7. **AI:** Versioned model card, approved Indian operating dataset, per-class false-positive/false-negative analysis, shadow testing, drift tracking, human-review validation, independent evaluation, and operational sign-off.
8. **GIS:** Reliable regional OSRM data, map tile licensing/hosting policy, routing/geocoding monitoring, regional updates, recovery strategy, and availability targets.
9. **External integrations:** Written authorization, agreements, privacy/security approval, and operational owners for ERSS-112, police systems, CCTV, and other external services. No live emergency system was contacted.
10. **Policy:** Document Police incident visibility scope and obtain owner approval before changing cross-station access semantics.

## 15. Blockers and recommended next actions

1. Retrieve and inspect the complete GitHub Actions log for run #50's `test:release` failure; reproduce against disposable resources only, then restore required checks to green.
2. Ask the database owner to attest that the prior credential was revoked. Keep the successful `SELECT 1` result as connectivity evidence, not rotation provenance.
3. Resolve Police cross-station visibility policy with the product/security owner and add tests matching the approved policy.
4. Coordinate operator-controlled AI key and seed password improvements without disclosing values or changing existing user credentials inadvertently.
5. When Docker is available, validate services and health checks without deleting or recreating existing volumes; use an explicitly isolated staging database/volume for write tests.
6. Run authenticated Chromium verification at 1440×900, 768×1024, and 390×844 for Admin, Police, and Citizen, including navigation, accessibility, console/network errors, and persisted behavior.
7. Complete external production controls and approvals before any real public-safety use.

## 16. Addendum — release-gate resolution and isolated runtime verification (2026-11-09, later session)

Scope: this session resolved the CI release failure, completed the graceful-shutdown, PostgreSQL drain, Socket.IO, and browser verification gates in isolated Docker, and left all commit/push/merge decisions to the repository owner. Every drill used disposable, project-scoped containers and volumes that were removed afterward. The operational Docker stack, Neon configuration, and all operational data were untouched; no live ERSS/police integration was contacted.

### 16.1 Root cause and fix for the CI release failure

- Failure: `backend/integration/release.test.cjs` "real PostgreSQL concurrent assignment produces one winner and one audit/event" expected HTTP 403 for a Police Officer dispatch and received 200 (13 passed, 1 failed).
- Root cause: **test fixture bug, not an authorization regression.** The approved dispatch policy — `incidentOfficerAssignment.service.js` `assertAssignmentActor` — authorizes Admin always, and Police Officers whose `operationalRole` is DISPATCHER or SUPERVISOR. The seeded release officer (`officer@example.test`) **is** a DISPATCHER, so 200 is correct policy behavior. The failing 403 assertion was added later without matching the policy.
- Fix (mission option B — policy permits dispatcher dispatch): the test now documents the approved policy and, before the concurrency race, proves every denial the policy requires: a plain FIELD_OFFICER Police session → 403, a Citizen session → 403, unauthenticated → 401. The concurrent race then uses independent Admin and Dispatcher sessions expecting exactly one 200 and one 409 with a single audit/event and no duplicate notifications. **No authorization was weakened and no test was removed**; denial coverage was strengthened.
- Verified in the isolated `compose.test.yaml` release stack (real PostgreSQL, disposable volumes): 14/14 integration tests, repeatedly.

### 16.2 Browser release gate fixes (order-dependent test bugs)

1. **Police Officer evidence upload depended on scenario order.** Evidence access is scoped to the incident's investigator or assigned-unit members; the seed grants neither. A Police-only run failed with HTTP 403 because a preceding Admin scenario had established the investigator. Fixed in `scripts/browser-release.cjs`: the Police scenario now establishes the fixture investigator from an independent Admin session (Node-side `assignFixtureInvestigator`), leaving the scenario user's session intact.
2. **Login resilience for a host-network flake.** Two firefox runs failed at *different* steps (a stuck GIS calculation; a lost login response that nginx had already answered 200 in 0.9s) — consistent with transient WSL2-loopback packet loss, not an app defect. The frontend's own bounded-fetch recovery paths were audited (15s abort, `finally`-block state resets) and hold. The gate now retries login **once, only when the app displays its own "Network request timed out" error**; every other failure still fails the scenario. The stuck-calculation failure never reproduced afterward; recorded as an environment flake.
3. Earlier in the session: the gate was updated for the GIS Route-mode tab (`#gisModeRoute`) and the Citizen report-center title ("My Reports & Public Safety Help").

### 16.3 Runtime verification results

| Check | Result | Exit code |
|---|---|---|
| `npm run check` (JS syntax, 325 files) | PASS | 0 |
| `npm test` (no DB): backend 499 = 489 pass / 10 skipped / 0 fail; frontend 155/155 | PASS | 0 |
| Backend suite against disposable PostgreSQL (incl. `phase4_socketio_e2e`, real socket.io-client) | **574/574 pass, 0 skipped, 0 failed** | 0 |
| AI Python service suite + dependency audit | 21/21, no findings | 0 |
| `npm run test:release` (isolated compose: migrations, 14/14 integration, **45/45 browser scenarios** = chromium/firefox/webkit × 1920×1080, 1440×900, 1024×768, 768×1024, 390×844 × Admin/Police Officer/Citizen) | PASS | 0 |
| `test:critical-ux` fixture checks, 5 viewports | PASS | 0 |
| Production frontend build | PASS | 0 |
| npm audits (root, backend, frontend) | 0 vulnerabilities | 0 |
| `git diff --check` | PASS (CRLF warnings only) | 0 |
| `node --test backend/integration/postgres-tls.test.cjs` (6 checks: verified TLS default, sslmode=require keeps verification, untrusted cert/wrong-hostname/URL-flag bypass all fail closed, production plaintext refused) | 6/6 | 0 |
| `node --test backend/integration/backup-recovery.test.cjs` (paired PostgreSQL+evidence backup, restore into fresh containers, checksum verification) | 1/1 | 0 |
| `node --test backend/integration/operational-load.test.cjs` (2 backend replicas; 15s sustained reads 317 req, 20.9 rps, 155/162 per replica; 60 concurrent assignments p95 3.3s with single-winner correctness; 12 uploads RSS +5.3MB; failure recovery) | 1/1 | 0 |

### 16.4 Graceful shutdown, PostgreSQL drain, and Socket.IO shutdown drill

Isolated production compose project (own credentials, including the required 64-hex `CAMERA_CREDENTIAL_ENCRYPTION_KEY`, model-preloaded AI service), backend stopped with `docker stop` (40s grace) while 60 staggered incident writes were in flight:

- `shutdown_started signal=SIGTERM timeoutMs=25000` → `shutdown_complete forced=false reason=drained durationMs=17769` → container `ExitCode=0` (no forced close, well inside the 25s deadline and 40s `stop_grace_period`).
- **60/60 in-flight writes committed and were found intact after restart** (HTTP 200 list; no partial writes; pool not closed prematurely). Drain-rejection and listener-close paths were covered by unit tests and the drill produced no 503s because everything drained in time.
- Real socket.io-client drill: Admin connects; authorized `join_incident_room` ack `{ok:true}`; fake incident `{ok:false}`; Citizen connection denied ("Authentication required"); on shutdown the client received `server_shutdown {reason:"shutdown"}` then disconnected cleanly. No duplicate events.
- Backend restart returned to health (200) with all data intact.

### 16.5 Files changed by this session

- `backend/integration/release.test.cjs` — policy documentation + strengthened denial assertions + independent-session race (§16.1). Committed as `030e9fd`.
- `scripts/browser-release.cjs` — GIS route-mode fix, Citizen title fix, order-independent investigator assignment, single bounded login retry (§16.2). Committed as `030e9fd`.
- `.gitignore` — `artifacts/` ignored; 843 tracked artifact files (352 MB) untracked from the index with local copies preserved (commit `248a3d5`, owner-approved).

Other modified/untracked files in `git status` belong to the concurrent session documented in §12 and were preserved uncommitted.

### 16.6 Updated blockers and manual actions

1. ~~**Commit + push authorization (release gate).**~~ **RESOLVED 2026-11-09:** owner authorized; commits `030e9fd` + `248a3d5` pushed; Release checks run #42633958636 (ai-service-checks, verify, release-gate) all **success**; PR #4 mergeable_state `clean`. Marking the draft ready and merging remain owner decisions.
2. **GitHub secret-scanning alerts: NOT QUERYABLE** from this environment (no `gh` CLI / `GH_TOKEN`). Local side is now **exhaustively verified clean** — see `docs/GITHUB_SECRET_EXPOSURE_REMEDIATION.md` addendum (full object database redacting audit: zero GoCardless/provider token shapes; 28 candidates all benign). A repository owner must still review the GitHub Security tab for alert IDs/state/validity; if GitHub reports an active GoCardless token, revoke it provider-side. Values must not be pasted anywhere.
3. **Credential-revocation provenance** — unchanged manual blocker (§5). Local evidence: `backend/.env` was never committed on any branch.
4. **Police cross-station visibility policy** — unchanged P1 (§5). Related UX note from this session's evidence: the evidence-upload incident dropdown offers incidents the officer cannot attach evidence to (the server correctly denies with 403); consider filtering dropdown options by accessibility once the visibility policy is decided.
5. **Operator-controlled secret quality warnings** (AI key length, seed passwords) — unchanged (§5).
6. Firefox scenarios on this WSL2 host flaked twice due to transient loopback packet loss (different steps, non-reproducible); the gate now tolerates exactly the app's own timeout-retry path. CI runs on Linux and was not affected.

---

**Assessment limit:** This report records only evidence actually observed or tests actually executed. Source-level checks, isolated fixtures, and a successful `SELECT 1` do not constitute independent production certification.
