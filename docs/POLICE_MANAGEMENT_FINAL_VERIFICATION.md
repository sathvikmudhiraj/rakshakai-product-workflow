# Police Management & Unit Assignment Verification

**Verdict: PASS** (2026-10-29, Asia/Calcutta)

Police Management and Unit Assignment were verified against a disposable local PostgreSQL 17 cluster and a real Playwright Chromium browser. The final backend suite passed all 544 tests. The five failures recorded in the earlier report were reproduced, traced, fixed, and rerun; the focused run passed 8/8 tests. No operational database or Docker volume was used or modified. Docker Desktop was unavailable, so PostgreSQL ran in a fresh temporary embedded cluster on loopback.

No registration rate limiting was added. Existing working-tree changes were preserved; all changes remain uncommitted.

## Original five failures and findings

The original run reported 469 tests, 458 passed, 5 failed, and 6 skipped. The five failing cases were:

| Test | Original failure evidence | Root cause and fix |
|---|---|---|
| `backend/tests/debug-mg.test.js` — `debug rtsp acknowledge` | Test module load failed: `Cannot find module '../integration/simulatorConnector'`. | The diagnostic test imported a nonexistent module/path. It now imports `MediaGateway` and `SimulatorConnector` from `../services/mediaGateway.service`. |
| `backend/tests/hybrid-membership-lifecycle-postgres.test.js` — `actual hybrid confirmation and releases preserve membership and separate support roles` | The first run lacked an explicitly approved test database. Once run against isolated PostgreSQL, `assert.equal(p.availabilityStatus, 'busy')` failed for active primary-unit members (actual value: `available`); the subsequent Copilot roster assertions also required the assigned primary-unit members to appear in the response. | Primary-unit deployments were not reflected in profile availability and the Copilot reader only included explicit deployments. Availability now includes active primary/support deployments; Copilot includes active on-duty members of the assigned primary unit, while explicit released assignment history suppresses stale inference. |
| `backend/tests/hybrid-support-release-postgres.test.js` — `support release persists while primary unit and investigation remain assigned` | Could not initialize PostgreSQL integration because no explicit `TEST_DATABASE_URL` was supplied. | Environment/setup failure, not a failed support-release assertion. Rerun with a loopback-only disposable database passed. |
| `backend/tests/hybrid-support-release-postgres.test.js` — `support release route enforces roles, records audit and preserves the primary unit` | Could not initialize PostgreSQL integration because no explicit `TEST_DATABASE_URL` was supplied. | Same missing isolated test database setup. With the disposable database, role, audit, support-release, and primary-unit assertions passed. |
| `backend/tests/media-gateway-api.test.js` — `simulated RTSP pipeline creates a review observation, then a reviewed alert and linked incident` | A reviewed alert acknowledgement expected HTTP `200` but received `404`. | Alert consolidation treated separate camera observations with the same camera/type/zone as duplicates because its key omitted `sourceObservationId`. Distinct alerts (and corresponding converted incidents) now retain observation identity in the consolidation key. |

The initial PostgreSQL errors were not treated as permission to use an application database. The suite ran only after creating a loopback disposable test database and setting its explicit test name. The later isolated run exposed and verified the hybrid-membership behavior described above.

## Changes in this pass

- Fixed the diagnostic media-gateway test import.
- Kept separate observations distinct during AI alert and incident consolidation.
- Reflected active primary-unit deployment in officer availability and surfaced its on-duty roster in Copilot responses.
- Returned the primary `unitId` from officer-assignment member records so PostgreSQL assignment inserts satisfy their required `unit_id` column; added a unit assertion to the service test.
- Included persisted incident-officer assignments in the core database read so refreshes show newly deployed officers and actions.
- Fixed Police Management Add Member and Retry controls, and converted a NodeList to an array before disabling assignment form controls.
- Narrowed Phase 1 test fixture cleanup to its own synthetic records and made its station codes unique. The prior global cleanup could delete records belonging to other integration tests; the ERSS workflow test now deletes its own synthetic event after assertions.

These fixture adjustments preserve assertions and avoid cross-test cleanup of unrelated records. No registration rate limiter was added.

## Commands and results

Test database environment used for backend commands (temporary credential redacted here; URL was loopback only):

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL=''
$env:TEST_DATABASE_URL='postgresql://rakshakai_test:<temporary-test-password>@127.0.0.1:55439/rakshakai_test_local'
$env:RAKSHAKAI_TEST_DATABASE_NAME='rakshakai_test_local'
$env:PG_SSL_MODE='disable'
```

| Command | Exit | Evidence |
|---|---:|---|
| `npm --prefix backend test -- tests/debug-mg.test.js tests/media-gateway-api.test.js tests/hybrid-membership-lifecycle-postgres.test.js tests/hybrid-support-release-postgres.test.js` | 0 | 8 tests, 8 passed, 0 failed. Migrations applied to disposable PostgreSQL before test execution. |
| `npm --prefix backend test` | 0 | 544 tests, 544 passed, 0 failed, 0 skipped; duration 139240.8 ms. |
| `node --test backend/tests/incident-officer-assignment.test.js` | 0 | 13/13 service tests passed after adding an assertion that the member record includes `unitId`. |
| `node "$env:TEMP\rakshakai-isolated-pg-runtime\seed-browser-e2e.cjs"` | 0 | Created schema and migrations in `rakshakai_test_browser`; seed output identified database/schema as `rakshakai_test_browser`, with 2 initial users and 1 synthetic incident. |
| `node "$env:TEMP\rakshakai-isolated-pg-runtime\police-management-e2e.cjs"` | 0 | Final browser run printed `E2E PASS`; Admin membership and assignment flow passed, Citizen role-gate checks passed. |
| `node "$env:TEMP\rakshakai-isolated-pg-runtime\check-e2e-state.cjs"` | 0 | Persisted incident `e2e_incident_1` remained assigned to `e2e_unit_1`; both officer-assignment rows persisted with status `RELEASED`, with `TEAM_LEAD` and updated `FIELD_OFFICER` roles. |

The E2E seed, reset, browser, and database-inspection scripts are temporary files under `%TEMP%\rakshakai-isolated-pg-runtime`; they are not application source. The browser run used separate contexts for Admin and Citizen. Its first attempt revealed a harness issue: the Citizen login reused the Admin browser context. The harness was corrected to use a fresh context, and the final run passed.

The successful fixture and browser commands were run in this order, each with exit code 0:

```powershell
node "$env:TEMP\rakshakai-isolated-pg-runtime\seed-e2e-citizen.cjs"
node "$env:TEMP\rakshakai-isolated-pg-runtime\reset-browser-fixture.cjs"
node "$env:TEMP\rakshakai-isolated-pg-runtime\police-management-e2e.cjs"
node "$env:TEMP\rakshakai-isolated-pg-runtime\check-e2e-state.cjs"
```

The frontend ran with `npm run dev -- --host 127.0.0.1`; the backend ran with `node backend/server.js` and `NODE_ENV=test`, `RAKSHAKAI_TEST_DATABASE_NAME=rakshakai_test_browser`, `RAKSHAKAI_TEST_SCHEMA=rakshakai_test_browser`, a loopback `TEST_DATABASE_URL`, and a schema-scoped `DATABASE_URL` (`options=-csearch_path%3Drakshakai_test_browser`). PostgreSQL was started from the temporary embedded runtime using `node start-final-pg.mjs` with data directory `cluster-final` and port `55439`.

### Isolated PostgreSQL and browser setup

- Docker check: `docker version --format '{{.Server.Version}}'` — unable to connect to the Docker Desktop engine; no containers or volumes were touched.
- PostgreSQL alternative: embedded PostgreSQL 17, fresh temporary data directory `cluster-final`, loopback `127.0.0.1:55439`, `persistent: false`. Backend tests used `rakshakai_test_local`; browser E2E used separate database/schema `rakshakai_test_browser`.
- The backend test harness validated `NODE_ENV=test`, the `rakshakai_test_*` database name, loopback host, and matching scoped schema URL. `DATABASE_URL` was blank for the backend test suite and explicitly schema-scoped for the browser app. No operational database URL was used.
- Browser synthetic data used E2E-prefixed station, beat, officer, unit, and incident records. After the run, PostgreSQL confirmed the incident/unit assignment and released officer history described above.

## Browser evidence

The final Playwright run checked Admin navigation, officer creation, unit membership role change/removal/addition, mobile Police Management width (390/390 px), Unit Assignment of `INC-E2E-001` to `E2E-P01`, deployment of two officers, a response-role change, release of both officers, and Citizen navigation restrictions.

- [Police Management desktop](../artifacts/police-management-e2e/01-police-management-desktop.png)
- [Police Management membership and mobile layout](../artifacts/police-management-e2e/03-police-management-mobile.png)
- [Unit Assignment with deployed officers](../artifacts/police-management-e2e/04-unit-assignment-desktop.png)
- [Membership changes](../artifacts/police-management-e2e/02-police-management-membership.png)
- [Released officers on mobile](../artifacts/police-management-e2e/05-unit-assignment-released-mobile.png)

## Remaining limitations

- Docker-backed behavior was not tested because Docker Desktop was unavailable. Existing Docker volumes were preserved and untouched.
- The acceptance run used synthetic isolated data, not operational station/unit records. No operational database was queried or changed.
- Existing unrelated working-tree changes remain uncommitted. No commit was created.
