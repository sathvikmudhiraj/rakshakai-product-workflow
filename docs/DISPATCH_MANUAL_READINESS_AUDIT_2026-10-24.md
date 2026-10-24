# Dispatch architecture and manual-readiness audit — 2026-10-24

Historical audit snapshot: the code defects below were subsequently addressed in the same working tree. See `DISPATCH_FIX_VERIFICATION_2026-10-24.md` for fix verification and deployment limitations. The original evidence is retained here.

## Verdict

**ISSUES REMAIN.** This is a local functional audit, not a production-readiness certification. Existing regressions pass, but additional behavioral checks reproduce eight failures. No application implementation was changed by this audit.

The canonical write models exist and are separate: `incidents.assignedUnitId`, `response_unit_members`, `incident_officer_assignments`, and hybrid `police_officers.assigned_incident_id`/support allocations. Some consumers and lifecycle guards do not respect those boundaries.

## Blocking findings

### 1. Unit/hybrid dispatch RBAC is broader than officer-deployment RBAC

`backend/services/core.service.js:3056` checks only the account's broad role. The `POST /api/incidents/:id/assign-unit` branch at line 6282 accepts any `Police Officer` or `Admin`, including `CALL_TAKER` and unauthorized `FIELD_OFFICER`. The same branch dispatches both manual primary assignment and hybrid confirmation. Recommendation, assign-nearest and primary-release handlers also use the broad check. `backend/routes/incidents.routes.js` does not add an operational-role restriction.

The audit invokes the real mutation-handler branch with a call taker and demonstrates entry into `assignSelectedIncidentUnit`. It does not perform a live request or assignment. In contrast, `incidentOfficerAssignment.service.js:11` correctly restricts officer deployment to Admin and Dispatcher/Supervisor, and its denial tests pass.

### 2. Primary release strands active officer deployments

`backend/services/core.service.js:1453` (`releaseAssignedIncidentUnit`) guards existing hybrid allocations, but not active `incidentOfficerAssignments`. It can clear the primary and make the unit available while officer deployments remain active.

`backend/services/incidentOfficerAssignment.service.js:68` then calls `context()`, which requires a current primary unit, before releasing an officer. The audit reproduces successful primary release followed by `409 PRIMARY_UNIT_REQUIRED` on officer release. Ordinary officer release while the primary remains assigned passes and preserves membership, primary unit, history and support state.

### 3. Hybrid availability does not consult primary officer deployments

`backend/services/hybridDispatch.service.js:46` (`officerUnavailableReason`) checks profile availability, support commitment and occupied permanent-membership units, but not `incident_officer_assignments`.

After the primary-release sequence above, a still-deployed officer's unit is available. With permanent membership unchanged, the audit shows `stationCapacitySnapshot` offers that officer for hybrid support on another incident. This breaks the requested separation and cross-model busy protection. The test establishes candidate eligibility, not a live double deployment.

### 4. Current primary deployment is missing from member availability data

`backend/services/incidentOfficerAssignment.service.js:25` filters deployment rows to the requested incident and populates `currentIncidentId` only from the hybrid officer profile. It does not expose active primary deployment on another incident.

The audit models the released-unit/orphan sequence, then membership transfer to another unit before that unit receives its next incident. The member response reports `null` instead of the still-active old incident. The primary deployment service itself checks all active deployment rows and rejects a second deployment; the member display remains misleading.

### 5. Police Assignment permits selection of off-duty members

`frontend/src/app.js:4846` computes `busy` from active status, availability and hybrid/current incident, but ignores `member.dutyStatus`. An `off_duty` member with availability `available` has an enabled checkbox. The backend rejects this off-duty case. Badge IDs supplied by the member service are also not rendered, and the member row does not disclose fixture/demo provenance.

### 6. View Officers hides undeployed members

`frontend/src/app.js:4986` loads real permanent members, but renders names only from `deployed`. Immediately after primary assignment, **View Officers** shows counts such as `1 Unit Members · 1 Available · 0 Deployed`, not the member's identity. The audit exercises the actual renderer and button with JSDOM.

### 7. Police Management still equates membership with deployment

`backend/services/copilotOfficers.service.js:205` derives `deployments` from permanent unit memberships and incidents assigned to those units. It does not consult `incident_officer_assignments`. An undeployed member therefore appears deployed as soon as the primary unit is assigned. This violates explicit manual officer deployment even though the primary assignment write path creates no officer-deployment rows.

### 8. Recommendation timeout ends before the response body completes

`frontend/src/services/api.js:115` clears the abort timeout when `fetch()` resolves headers; body parsing is awaited afterward at line 117. A stalled response body has no remaining application timeout. The coordinator's `finally` cannot run while that promise stays pending.

The audit supplies a pending response body and proves the timeout has already been cleared. Normal success, failure and unavailable results terminate loading correctly; an unconditional claim that loading always terminates is false. This is a remaining edge case, not proof that it caused the earlier manually observed missing-request bug.

## Additional audit-compatibility finding

The current working-tree diff changes hybrid confirmation audit event `DISPATCH_CONFIRMED` to `HYBRID_SUPPORT_CONFIRMED` at `core.service.js:986`, and timeline event `dispatch_confirmed` to `hybrid_support_confirmed`. The existing audit infrastructure is reused, and the three officer audit events are present and persisted. However, the requested preservation of existing hybrid event names is not met. Compatibility of downstream historical-event consumers was not demonstrated. Overall AUDIT is therefore FAIL, not a claim that officer actions have no logging.

## Verified working behavior

- Default unassigned selection invokes the existing recommendation coordinator/API. Ten renderer calls produce one recommendation request in the added DOM test. No second engine exists.
- Coordinator states are explicit; normal completion/error clears loading; stale recommendation results are ignored. Manual **Assign Unit** remains enabled for an eligible available unit after an unavailable recommendation.
- Primary assignment requires an operator action/confirmation and writes primary/unit lifecycle state without automatically deploying members or reserving hybrid officers.
- Unassigned incidents hide hybrid confirmation. The assigned-unit card offers an explicit **Request Hybrid / Emergency Support** action. The backend rejects no-primary hybrid creation with `409 PRIMARY_UNIT_REQUIRED` and validates the primary unit before confirmation.
- Isolated HTTP regression verifies normal primary-first hybrid support, resource reservation and resolution cleanup. Hybrid does not replace the assigned primary in this path.
- Officer service supports multiple members, the five controlled response roles, non-member rejection, duplicate/cross-incident primary-deployment rejection, support-commitment rejection, role changes and ordinary release.
- Officer audit writes use the existing audit repository. Realtime uses the existing emitter and Socket.IO bridge to dashboard and incident rooms; frontend listeners refresh relevant views. These code paths were inspected. Existing tests check wiring and live socket authorization/revocation; no live officer mutation/event-delivery acceptance test was performed.
- Investigation remains a separate model. Safe Phase 4 tests cover investigation monitoring and escalation. GIS, ERSS and SLA focused regressions pass. Police Management regression fails as described above. Unit-ACK end-to-end and live Incident Command interaction were not exercised; do not infer their full acceptance from the SLA tests.

## Local database and application snapshot

Only local Docker `postgres`, database `rakshakai`, was queried. Queries were enclosed in `BEGIN READ ONLY` / `COMMIT` and executed using container-local `psql`.

- `schema_migrations`: `027` / `027_incident_officer_assignments` exists.
- `public.incident_officer_assignments` exists; row count **0**.
- `response_unit_members` row count **1**.
- **P-01** (`unit_p04`): available, **0 permanent members**.
- **FX-P-01** (`fixture_unit_alpha`): available, **0 permanent members**.
- The single membership belongs to another currently busy unit. Neither proposed manual-test unit can currently supply members for officer selection. No memberships or identities were fabricated to bypass this blocker.
- `http://localhost:3001/unit-assignment` returns HTTP **200** for the application shell. Docker reports frontend/backend/PostgreSQL/AI service healthy. This is not an authenticated screen acceptance test.

Migration 027 was not reapplied. No local/remote application database writes, resets, truncations, volume deletion, live unit assignment or live officer deployment were performed by this audit. No containers were restarted by this audit.

## Exact test and build results

| Run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Existing frontend `*.test.js` files | 124 | 0 | 0 |
| Focused backend service/safety regressions | 73 | 0 | 0 |
| Selected isolated JSON HTTP/security/socket regressions | 14 | 0 | 0 |
| Added frontend audit checks | 1 | 3 | 0 |
| Added backend audit checks | 0 | 5 | 0 |
| **Frontend total** | **125** | **3** | **0** |
| **Backend total** | **87** | **5** | **0** |

Counts use Node test-runner totals; a legacy tracking test also reports its own internal assertions and is not double-counted. Audit reruns are not counted as additional tests. The nine audit checks intentionally assert the required invariants and currently exit **1** with eight failures; they are not expected-failure passes.

Frontend command, from `frontend`:

```powershell
$testFiles = @(Get-ChildItem tests -Filter '*.test.js' | ForEach-Object FullName)
node --test $testFiles
npm run build
```

Build: **PASS**, 60 modules. Vite reports a non-blocking JavaScript chunk-size warning (552.94 kB). Build output was not deployed by this audit.

Backend focused files, from `backend`, using `node --test --test-concurrency=1`:

```text
tests/hybrid-primary-unit-policy.test.js
tests/hybrid-dispatch.test.js
tests/hybrid-support-release.test.js
tests/incident-officer-assignment.test.js
tests/gis-services.test.js
tests/erss-112.test.js
tests/phase4_behavior.test.js
tests/sla-config.test.js
tests/test-database-safety.test.js
```

These ran in a child process with `NODE_ENV=test`, empty `DATABASE_URL` and `TEST_DATABASE_URL`, and `RAKSHAKAI_DATA_FILE` pointing to a newly created OS-temp directory. OSRM was restricted to loopback with public fallback disabled. Repository SQL checks use fake clients; no PostgreSQL integration mutation suite ran.

Selected security command, from `backend`:

```text
node --test --test-name-pattern="primary assignment precedes|manual reassignment|concurrent assignment|citizen cannot assign a selected|SLA updates|valid verified incident|Citizen and unauthenticated|Admin can create, list|live dashboard sockets" tests/security-access.test.js
```

That test file explicitly clears `DATABASE_URL` and creates its own temporary JSON fixture before starting the test server. Test-only incidents/officers exist only in isolated fixtures, not in the application database.

Added audit command, from repository root:

```text
node --test scripts/dispatch-readiness-audit.cjs
```

This script uses in-memory fixtures/JSDOM and real pure services or production functions extracted into a VM with mocked persistence. It never imports the core service module, connects to a database or sends a live API mutation. These are behavioral diagnostics, not a replacement for PostgreSQL/real-browser end-to-end tests.

## Changes made by this audit

- Added `scripts/dispatch-readiness-audit.cjs`.
- Added this report.
- Generated ignored frontend build artifacts via the requested production build.

All preexisting application, migration, test and configuration changes were preserved. No application-source fix is included because the current request is an audit.

## Manual next step

Open `http://localhost:3001/unit-assignment` for inspection only. Stop before any assignment confirmation. Full acceptance remains blocked by the findings and absent P-01/FX-P-01 memberships; resolve these through an explicitly authorized follow-up, without fabricating operational records.
