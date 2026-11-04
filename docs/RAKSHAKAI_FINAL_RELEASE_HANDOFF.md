# RakshakAI Final Release Handoff — 2026-11-04

## Release decision

**Keep PR #4 as a draft. Staging deployment: NOT TESTED. Production readiness: NOT TESTED.** The isolated Docker stack, PostgreSQL suite, service health, OSRM route, AI model load, and database restart persistence passed. The combined Citizen → Admin → Police → Resolution Chromium journey stopped at a post-refresh route assertion, so the full browser workflow is PARTIAL. Do not label the release fully accepted.

PR: [#4 — RakshakAI MVP fixes and staging release preparation](https://github.com/sathvikmudhiraj/rakshakai-product-workflow/pull/4)

## Git and PR review

- Branch: `bug-fix-of-mvp`.
- Reviewed branch head before this handoff: `6a3f7cd0de84f81832e3f9d74b2f9915b42a1695` (`docs: prepare isolated staging Docker verification`). It was pushed to the PR branch; no force push is appropriate.
- At that head, `git diff origin/main...HEAD --stat` covered 316 files. The branch includes the MVP feature/fix history and remains broader than a narrow bug-fix PR. The final PR review must include API authorization, database migrations, generated assets, and all other changed files; passing tests alone do not reduce that review obligation.
- Identified 19 tracked local diagnostic/mutating scripts that do not belong in the release: `backend/add_composite_fks.js`, `backend/add_composite_fks2.js`, `backend/check_fks.js`, `backend/check_fks2.js`, `backend/check_fks3.js`, `backend/check_schema.js`, `backend/check_schema2.js`, `backend/check_schema3.js`, `backend/check_users.js`, `backend/remove_migration_025.js`, `scripts/_debug-gis-click.cjs`, and eight `data/osrm-telangana-build/diag-*.cjs` files. Search found no product/runtime references. Their tracked copies are removed from the PR and exact paths are ignored; local files were retained on disk. The intentional `backend/tests/debug-mg.test.js` test and SQL navigation fixture remain.
- The PR does not include local `artifacts/`, screenshots/traces, model weights, `.env` files, `login.json`, or local diagnostic scratch files. Existing user changes to `backend/check_users.js`, other untracked check scripts, `backend/test_output.txt`, and `login.json` are preserved and must not be staged.
- The reviewed Compose override adds an explicit read-only YOLO weights bind and hash requirement, AI health dependency, loopback-only frontend port, and read-only OSRM data. No production deployment is configured by this override.
- Review risk: `backend/scripts/migrate.js` skips already-recorded migration versions and `schema_migrations` has no checksums, while migration `002_phase1_police_foundation.sql` changed in the branch. An existing environment already marked at version 002 will not automatically rerun the edited SQL. Migration `025` performs data backfills and migration `030` adds a partial unique index. Review the complete ordered migrations against a fresh staging snapshot and prepare a rollback/restore plan before deployment.

The GitHub PR connector previously returned 403; the draft PR was created through the authenticated Git credential helper. Update the draft description with the verified evidence below. Do not mark it ready or merge it while the browser failure and staging gates remain.

## Verification evidence from the isolated run

Exact command invocations and results are recorded in [the staging preparation report](RAKSHAKAI_STAGING_RELEASE_PREPARATION_2026-11-03.md#follow-up-acceptance--2026-11-04). The test stack used project `rakshakai-stage-verify-1103-a4b7`, loopback ports 48123/55441, fresh test-only credentials, and new project-prefixed Docker volumes.

| Gate | Result | Evidence / remaining limit |
|---|---|---|
| Docker Engine and Compose | PASS during run | Engine/client 29.5.3, Docker Desktop 4.78.0, Compose v5.1.4. Docker later became unreachable from the shell; stack shutdown/inventory could not be completed. |
| PostgreSQL backend suite | PASS | 549/549 passed, 0 failed, 0 skipped against `rakshakai_test_release_1103` inside the isolated PostgreSQL service. |
| Copilot/AI regression | PASS | 89/89 passed against the same isolated database. |
| Default backend/frontend suite | PASS | Backend 464 passed, 10 PostgreSQL-only skipped, 0 failed; frontend 131/131 passed. |
| Security regression | PASS | 121 passed. |
| Syntax check and production frontend build | PASS | 291 JavaScript files passed syntax checks; Vite build succeeded with existing >500 kB chunk warning. Docker's `npm ci` reported one high-severity advisory; not triaged. |
| Frontend, API, AI, database, routing readiness | PASS | `/healthz`, `/api/health`, authenticated `/api/ai/health` returned 200; AI model reported loaded; OSRM returned one route for synthetic coordinates; Socket.IO connected over websocket. |
| Isolated persistence | PASS | Synthetic probe row survived isolated backend restart and isolated PostgreSQL restart. Existing operational containers and volumes were not operated on. |
| Police Management/deployment browser actions | PARTIAL | Synthetic officer and unit membership writes, deployment, response role update, release, and incident transitions to Resolved succeeded. The overall combined browser run then failed. |
| Citizen → Admin → Police → resolution browser journey | PARTIAL | Runner timed out waiting for Incident Command to restore after reload. Citizen refresh assertion and final DB audit/timeline assertions were not reached. |
| Live ERSS-112, CCTV, GIS providers, staging and production | NOT TESTED | Local OSRM and local YOLO model are isolated simulations/local fixtures. No live providers, cameras, emergency network, or deployment were used. |

Local browser evidence is in `artifacts/staging-verify-1103/` and is not included in Git. `priority-workflows-docker.cjs` line 313 timed out after `page.reload()` while waiting for `document.body.dataset.view === 'incident-command'`. I fixed a confirmed startup coupling: authenticated route restoration previously waited for the entire dashboard-data refresh, and any one failed API request could route the page into the generic startup error handler. It now restores the authorized deep link immediately after session confirmation and logs non-auth refresh failures without hiding the authenticated page; HTTP 401 errors still reach the sign-in handler. Regression coverage passes 3/3, the frontend suite passes 134/134, and the production build passes. The original failed browser run did not capture enough request detail to prove that this was its sole cause; the full Chromium workflow must still be rerun with the URL, `/api/me` status/role, page errors, console errors, failed requests, and HTTP statuses recorded.

The failed browser run is evidence against a blanket browser pass. Screenshots, traces, and test uploads remain local and may contain synthetic personal details or authenticated state; sanitize them before sharing outside the test workspace.

## Remaining blockers and next release steps

1. Rerun the combined browser workflow on a reachable, isolated Docker Engine. Confirm reload route restoration with browser URL/session/network logs; assert citizen refresh, persisted audit/timeline, notifications, and RBAC after successful navigation.
2. Inspect project `rakshakai-stage-verify-1103-a4b7` before operating it. Docker became unavailable before the isolated services could be inspected or stopped. Do not remove project volumes; no `down -v` or prune was run.
3. Triage the high-severity npm advisory from the Docker build. Capture package name, advisory, dependency path, and reachable version; fix only if confirmed and rerun affected suites/build.
4. Have an independent reviewer inspect the full 316-file feature diff and the migration order, especially modified migration 002, data backfill in 025, and unique index in 030.
5. Perform a staging-only deployment after credentials, origins, model provenance, routing-data provenance, database snapshot, and rollback plan are approved. Verify backup/restore, TLS, monitoring, and the required external integrations there.
6. Only then update the PR with the complete browser evidence and request review. Merge/production deployment remain separately authorized actions.

No operational PostgreSQL, Neon database, or pre-existing Docker volume was modified. No registration rate limiting was added.
