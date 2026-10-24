# Dispatch fix verification — 2026-10-24

## Scope

Fixed the preceding dispatch audit's code defects in the current working tree, preserving unrelated edits. No migrations, database resets, seeding, unit assignments or officer deployments were performed on the application database. All mutation tests use in-memory fixtures or a temporary JSON database.

## Changes

- Primary assignment, hybrid confirmation, recommendation, nearest assignment and primary release now require Admin or Police Officer with explicit Dispatcher/Supervisor authorization. Officer deployment uses the same existing policy. The legacy PATCH implementation delegates to the authoritative assignment function; that PATCH endpoint is not currently exposed by Express.
- Primary release/reassignment and terminal incident transitions reject active primary-officer deployments with `409 ACTIVE_OFFICER_DEPLOYMENTS`. Operators must release those officers explicitly. Reassignment also rejects active hybrid allocations. No automatic officer assignment/release was introduced.
- Existing orphaned deployment history can be listed/released through the authorized officer API without recreating a primary assignment.
- Hybrid eligibility consults active `incident_officer_assignments`, including legacy orphans; a primary-deployed officer cannot be offered as hybrid support merely because their permanent unit appears available.
- Member data reports current primary deployments across incidents, real badge/rank data and recorded demo/test provenance. Missing/inactive/non-police profiles, off-duty/leave/suspended officers and unrecorded availability are rejected for deployment.
- View Officers renders all actual permanent members, including undeployed members, and shows a controlled empty-membership message. Police Assignment disables unavailable members, renders real identifiers and ignores stale incident responses.
- Police Management and incident-responder answers derive actual primary deployment from deployment records, not permanent membership. Support and investigation remain separate.
- The existing recommendation API has an end-to-end deadline covering headers and body parsing; stalled bodies terminate in the error state. Successful assignment publishes updated primary state before a recommendation-state reset can start an extra request.
- Preserved original hybrid confirmation audit/timeline event names (`DISPATCH_CONFIRMED`, `dispatch_confirmed`) with additional-support context in their descriptions. Existing officer audit events and realtime infrastructure remain in use.

Canonical models remain `incidents.assignedUnitId`, `response_unit_members`, `incident_officer_assignments`, and hybrid `police_officers.assigned_incident_id` plus support allocations. No new recommendation engine, audit system or realtime transport was created.

## Verification

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| All frontend test files | 129 | 0 | 0 |
| Focused backend services/safety/read-model regressions | 105 | 0 | 0 |
| Selected isolated HTTP/security/socket regressions | 16 | 0 | 0 |
| Behavioral dispatch audit checks | 11 | 0 | 0 |
| **Unique Node test-runner tests** | **261** | **0** | **0** |

The audit script comprises six frontend checks and five backend checks: combined frontend total **135/0**, combined backend total **126/0**. Reruns and the legacy tracking test's internal assertion count are not double-counted.

The isolated HTTP lifecycle test exercises two-officer deployment, role update, release, primary release/reassignment protection, unchanged permanent membership and hybrid profile state, persisted audit events, and actual Socket.IO dashboard delivery. RBAC tests deny call taker/field officer/missing operational role and permit Dispatcher/Supervisor to reach incident validation. Existing tests cover no-primary hybrid rejection, primary-first hybrid support, concurrent primary assignments, GIS, SLA/escalation, ERSS, investigation monitoring and account/socket authorization.

Build: `frontend/npm run build` **PASS**, 60 modules. Output JavaScript is 554.73 kB; the existing non-blocking chunk-size warning remains.

Docker image build: `docker compose --env-file .env.docker -f compose.yaml -f compose.dev.yaml build backend frontend` **PASS** for both images. This builds images only; it does not recreate running containers, run migrations or import data.

Commands:

```powershell
# frontend
$testFiles = @(Get-ChildItem tests -Filter '*.test.js' | ForEach-Object FullName)
node --test --test-concurrency=1 $testFiles
npm run build

# repository root (in-memory/JSDOM only)
node --test scripts/dispatch-readiness-audit.cjs
```

Backend focused files: `hybrid-primary-unit-policy`, `hybrid-dispatch`, `hybrid-support-release`, `incident-officer-assignment`, `gis-services`, `erss-112`, `phase4_behavior`, `sla-config`, `test-database-safety`, `copilot-officers`, `copilot-read` (all under `backend/tests`, `.test.js`). Run with `--test-concurrency=1`, `NODE_ENV=test`, empty `DATABASE_URL`/`TEST_DATABASE_URL`, and a fresh OS-temp `RAKSHAKAI_DATA_FILE`. OSRM was loopback-only with public fallback disabled.

HTTP command, from `backend`:

```text
node --test --test-name-pattern="dispatch readiness|primary assignment precedes|manual reassignment|concurrent assignment|citizen cannot assign a selected|SLA updates|valid verified incident|Citizen and unauthenticated|Admin can create, list|live dashboard sockets" tests/security-access.test.js
```

This file creates its own OS-temp JSON fixture and clears `DATABASE_URL` before server startup. No PostgreSQL mutation integration suite ran. PostgreSQL regression test expectations were updated for the restored historical audit event name, but that suite was not executed against application data.

## Deployment and manual-test limitation

After explicit user approval, the frontend/backend containers were safely reloaded with `compose.local-reload.yaml`. This override starts `node server.js` directly (no migration/import command) and sets `SKIP_STARTUP_DATA_REPAIR=true`. Normal startup behavior is unchanged without this opt-in flag. The backend log confirms startup repair was skipped.

```powershell
docker compose --env-file .env.docker -f compose.yaml -f compose.local-reload.yaml build backend
docker compose --env-file .env.docker -f compose.yaml -f compose.local-reload.yaml up -d --no-deps --no-build --force-recreate --wait --wait-timeout 60 backend frontend
```

Deployment verification: frontend/backend healthy; `/api/health` and `/unit-assignment` return HTTP 200; the page serves the new `index-BtrhD8tI.js` bundle. Deployed backend source hashes match the working tree. PostgreSQL, AI-service and OSRM container IDs/start timestamps did not change. Permanent-membership and officer-deployment table fingerprints are identical before/after. Normal operational background workers remain enabled; no live dispatch confirmation was performed.

The safe-startup change adds **3 passing tests** (`node --test backend/tests/startup-data-repair.test.js`), exercising skipped/default repair behavior and the override configuration. Cumulative verified total: **264 passed, 0 failed** (the 261 fix checks above plus these three); the full fix suite was not rerun solely for this opt-in startup wrapper.

P-01 and FX-P-01 had **zero permanent members** in the preceding read-only local snapshot. That data was not altered. An authorized administrator must register actual members before their officer-selection acceptance flow; do not fabricate operational users to make the test pass.

No production readiness or live PostgreSQL/browser acceptance claim is made. No application database, Docker volume or remote database was modified by these tests.

## Follow-up bug pass — 2026-10-24

After the request to resolve remaining bugs, three additional failures were reproduced in isolated tests before implementation:

- Repeated officer confirmation submitted two mutation requests. Assignment, role update and release now share an in-flight guard and disabled controls, with cleanup on every outcome.
- A member recorded as `responding` remained selectable even though the backend accepted only `available`. Frontend selection now follows the same availability rule.
- A resolved/closed incident with a retained primary-unit reference accepted new officer deployments. Deployment and role updates now require Assigned/En Route/On Scene; the read API exposes a controlled unavailable state. Release remains possible for historical commitments.

Also corrected unhandled role-change/release promise failures: failures display a controlled status message and restore controls. Added DOM tests for both actions and for completed-incident controls, alongside backend rejection/release checks.

Current-pass results (no double-counting reruns): **129 frontend tests + 46 focused service/audit/startup checks + 16 isolated HTTP/security/realtime tests = 191 passed, 0 failed, 0 skipped**. The 46-check command ran `scripts/dispatch-readiness-audit.cjs` plus `incident-officer-assignment`, `hybrid-primary-unit-policy`, `hybrid-dispatch`, `hybrid-support-release` and `startup-data-repair` backend test files. Earlier larger-suite results above remain historical, not a claim that every earlier suite was rerun in this pass.

Frontend production build and both Docker image builds passed. Only frontend/backend were recreated using the approved safe override. Both are healthy; the page serves **`index-fPDvkvQV.js`**, `/api/health` and `/unit-assignment` return 200, and the deployed officer service matches the source hash. PostgreSQL/AI/OSRM container IDs/start times and permanent-membership/officer-deployment fingerprints remained identical before/after. No live assignment, seeding, migration or repair was performed.
