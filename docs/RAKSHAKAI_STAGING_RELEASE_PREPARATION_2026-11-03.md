# RakshakAI staging release preparation — 2026-11-03

## Decision

**Reviewable draft; staging deployment and Docker acceptance NOT TESTED.** Docker Desktop's Linux Engine is unavailable on this host. No container, network, volume, operational PostgreSQL database, Neon database, or staging/production service was changed. The earlier release-gate results in [RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md](RAKSHAKAI_FINAL_RELEASE_GATE_REPORT.md) are historical; only the checks listed below were rerun on this revision.

The PR should remain a draft until the isolated Docker acceptance, staging credentials/configuration review, and staging smoke checks pass. A production release requires the separate open gates in [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md).

## Current evidence

The starting branch was `bug-fix-of-mvp` at `457b9d0cd218a09932a615993901459b881fab6b`, with GitHub's default branch `main`. Two prior `Bug fix of MVP` commits and their feature ancestors are already pushed. The branch is broad (314 files versus `origin/main` before this preparation commit); reviewers should examine the full diff and migration order. Local diagnostic scratch files, `artifacts/` traces, and `login.json` are outside this PR and remain untouched. Traces may contain authenticated browser state.

| Check on 2026-11-03 | Exit | Evidence / limit |
|---|---:|---|
| `docker version` | 1 | Client 29.5.3, context `desktop-linux`; Engine request to `npipe:////./pipe/dockerDesktopLinuxEngine` failed because the pipe does not exist. |
| `docker info --format '{{json .ServerVersion}}'` | 1 | Same Engine pipe failure. |
| `docker compose version` | 0 | Compose v5.1.4. CLI availability does not prove Engine availability. |
| `docker ps -a --format '{{.ID}} {{.Names}} {{.Status}}'` | 1 | Same Engine pipe failure; container inventory unavailable. |
| `docker network ls --format '{{.Name}}'` | 1 | Same Engine pipe failure; network inventory unavailable. |
| `docker volume ls --format '{{.Name}}'` | 1 | Same Engine pipe failure; volume inventory unavailable. |
| `Get-Service -Name 'com.docker.service'` | 0 | Service was `Stopped` (`Manual`). No Docker Desktop process was found. Neither was started to avoid auto-starting an operational stack. |
| `Get-NetTCPConnection -State Listen` filtered to 3000, 3001, 5000, 5432, 8000, 48123 | 0 | No matching listeners at inspection time; recheck before an actual start. |
| `docker compose -p rakshakai-release-static-verify -f compose.yaml config --quiet` | 0 | Parsed with **synthetic process-local** required values. No Engine or database involved. |
| `docker compose -p rakshakai-release-static-verify --profile osrm -f compose.yaml config --quiet` | 0 | Optional OSRM profile parsed with the same synthetic values; map data/service readiness not proved. |
| `docker compose -p rakshakai-release-static-verify -f compose.test.yaml config --quiet` | 0 | Disposable integration Compose parsed with synthetic `RELEASE_TEST_*` values; no container started. |
| `docker compose -p rakshakai-release-static-verify --profile osrm -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml config --quiet` | 0 | Staging override parsed with synthetic values. Extracted config confirms project `rakshakai-release-static-verify`, frontend `127.0.0.1:48123:8080` (unprivileged Nginx listener), read-only `/data` OSRM bind, and backend database host `postgres`. |
| `npm run check` | 0 | Syntax checked 291 JavaScript files. |
| `npm test` with `DATABASE_URL`, `TEST_DATABASE_URL`, and `RAKSHAKAI_TEST_DATABASE_NAME` unset and `NODE_ENV=test` | 0 | Backend 464 passed, 10 PostgreSQL-only skipped, 0 failed; frontend 131/131 passed. This does not refresh the historical 549/549 PostgreSQL result. |
| `npm --prefix backend test -- tests/copilot-history.test.js` with the same test environment | 0 | 11/11 passed after whitespace-only review cleanup. |
| `npm run frontend:build` | 0 | Vite built successfully; existing >500 kB bundle warning remains. |
| `git diff --check origin/main...HEAD` at starting commit | 1 | Existing whitespace on the PR branch in Copilot/schema files. |
| `git diff --check origin/main...HEAD` after review-hygiene commit `1b07ffa` | 0 | Whitespace-only cleanup resolved the PR diff warnings. |

The expected default OSRM path `docker/osrm-data/region.osrm` is absent on this machine. Some generated sidecars exist, but the full required MLD set was not validated and OSRM was not started. `.env.docker` exists but its values were neither read nor used for this check. No migration was run.

## Isolated Docker acceptance to execute on a Docker-capable review host

The base Compose stack starts `postgres`, `ai-service`, `backend`, and `frontend`; OSRM requires the optional profile and prepared regional MLD files. `compose.test.yaml` runs a separate integration stack with PostgreSQL tmpfs but deliberately omits AI/OSRM, so it cannot replace five-service acceptance. The base backend entrypoint runs migrations and a sanitized JSON import on startup. **Use a fresh project and new test-only credentials; never point these commands at an existing project or database.** `-p` overrides the base Compose project name and prefixes its named volumes. `compose.staging-verify.yaml` binds the frontend only to loopback and mounts optional regional OSRM data read-only.

1. Confirm the Engine is reachable with `docker version`, `docker info`, `docker compose version`, `docker ps -a`, `docker network ls`, and `docker volume ls`. Record exact output/exit codes and avoid name/port collisions. Verify that the chosen project name has no pre-existing containers or volumes. Verify the chosen loopback port is free. Do not start Docker Desktop automatically if its startup policy could launch operational containers.
2. Create a **new** ignored environment file for this run; do not reuse `.env.docker`. Set fresh URL-safe random `POSTGRES_PASSWORD`, 32+ character `JWT_SECRET`, 64-hex-character `CAMERA_CREDENTIAL_ENCRYPTION_KEY`, fresh `AI_SERVICE_API_KEY`, unique `SEED_ADMIN_PASSWORD`, `SEED_POLICE_PASSWORD`, `SEED_CITIZEN_PASSWORD`, `CORS_ORIGIN=http://127.0.0.1:48123`, `FRONTEND_ORIGINS=http://127.0.0.1:48123`, `STAGING_VERIFY_PORT=48123`, `GIS_ROUTING_PROVIDER=self_hosted`, and `PUBLIC_OSRM_FALLBACK=false`. Keep the file outside Git and redact it from logs. Recheck database URL interpolation and confirm it resolves only to the new Compose `postgres` service before any migration. Use a different free port if 48123 is occupied.
3. From the repository root, with `<unique-project>` and `<new-test-env>` replaced by actual values, run `docker compose -p <unique-project> --env-file <new-test-env> -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml config --quiet`, then `docker compose -p <unique-project> --env-file <new-test-env> -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml up -d --build`. Do not combine `compose.test.yaml` with these deployment files. Start `--profile osrm` only after verifying every required nonempty prepared MLD file under a test-approved `OSRM_DATA_HOST_PATH` and `OSRM_DATA_PATH`; otherwise label OSRM NOT TESTED and use the explicit approximate fallback.
4. Wait for PostgreSQL and backend health, then check real readiness: SQL `SELECT 1` in the new PostgreSQL volume; `GET /health` from AI inside its container; `GET /api/health` and authenticated `GET /api/ai/health` through the frontend proxy; `GET /healthz` and browser load at the loopback frontend; internal DNS resolution of `postgres`, `ai-service`, `backend`, and (if enabled) `osrm`; a Socket.IO connection through `/socket.io/`; a route response against known synthetic coordinates if OSRM is enabled. Assert response bodies and status, not only `docker compose ps`.
5. In the isolated stack only, create a clearly synthetic record via the browser/API, read its ID directly from PostgreSQL, restart the backend container with `docker compose -p <unique-project> ... restart backend`, and verify the record and linked audit/timeline data after refresh. Restart PostgreSQL separately and repeat the read to prove named-volume persistence. Exercise a failed request and recovery without weakening expected status assertions. Check service logs for errors and secrets without copying credential-bearing output into the PR.
6. Capture exact commands, exit codes, health responses, SQL row IDs/counts, browser screenshots/traces after removing authentication state, and failure logs. Stop only the new project with `docker compose -p <unique-project> ... stop`; retain its volumes unless a separate authorized cleanup is made. Never use `down -v`, prune, or operate on the base `rakshakai` project.

## Staging handoff and rollback

Before a real staging deployment, provide a staging-only host, database/volume ownership, DNS/TLS origin, approved test users and credentials, prepared routing data if required, and a backup/restore location. Review the migrations against a fresh staging database and record a schema version before/after. Confirm external ERSS, CCTV, map-provider and AI services as simulated or live in the release notes. Test RBAC, login/session cookies, WebSocket proxying, API-to-AI authentication, evidence storage, health monitoring, and backup restore on staging. Do not infer production readiness from these isolated checks.

For a failed staging rollout, stop traffic and the affected new project, preserve its PostgreSQL/evidence volumes and logs, return traffic to the previous verified application image, and restore from a tested backup if a schema change is incompatible. Do not reverse migrations on an operational database without a reviewed plan. Record the exact rollback commands and post-rollback health/data checks in the staging change record.

## Open release gates

- Docker Engine and five-service acceptance, including restart/persistence and internal networking: **NOT TESTED** on this host.
- Optional OSRM road routing: **NOT TESTED**; expected `region.osrm` file missing here.
- Current isolated PostgreSQL 549-test suite and current browser workflow: **NOT RERUN** in this preparation phase. Historical results remain in the final release-gate report.
- Staging deployment, staging TLS/origin, external integrations, backup/restore, observability, load, and production operations: **NOT TESTED**.

## Follow-up acceptance — 2026-11-04

This section supersedes the 2026-11-03 Docker-unavailable observation for the isolated test run only. It does not change the status of staging or production deployment. All Docker work used the unique project `rakshakai-stage-verify-1103-a4b7`, fresh synthetic credentials in `%TEMP%\rakshakai-stage-verify-1103-a4b7.env`, frontend loopback port 48123, and PostgreSQL loopback port 55441. The isolated stack created its own project-prefixed volumes. Existing `rakshakai_*` containers and volumes were not targeted. Credentials and the database URL are deliberately omitted.

### Docker and service checks

| Command / check | Exit | Result |
|---|---:|---|
| `docker version` | 0 | Client and Engine 29.5.3; Docker Desktop 4.78.0; `desktop-linux` context. |
| `docker info` | 0 | Engine responded. |
| `docker compose version` | 0 | Compose v5.1.4. |
| `wsl -l -v` | 0 | `docker-desktop` was Running, WSL version 2. |
| `docker compose -p rakshakai-stage-verify-1103-a4b7 --env-file "$env:TEMP\rakshakai-stage-verify-1103-a4b7.env" --profile osrm -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml up -d --build` | 0 | Built and started isolated PostgreSQL, backend, frontend, AI service, and OSRM. No existing volume was reused. |
| `GET http://127.0.0.1:48123/healthz` | 200 | Frontend container served health response. |
| `GET http://127.0.0.1:48123/api/health` | 200 | Backend readiness through frontend proxy. |
| Authenticated `GET /api/ai/health` through frontend proxy | 200 | Backend-to-AI connectivity reported connected. AI `/health` reported `modelLoaded=true`. |
| OSRM route request from synthetic coordinates 78.4867,17.3850 to 78.4900,17.3900 | 200 | OSRM returned `code=Ok` and one route. The local map data was read-only. |
| Browser login, `/api/auth/me`, Socket.IO WebSocket | 200 / connected | Authenticated synthetic user loaded; Socket.IO connected using websocket transport. Smoke run recorded zero page errors or failed requests. |
| SQL migration inventory | 0 | Isolated application database reported 29 applied migrations. |

The previous Compose override lacked a model mount, so its AI container could not load weights. The override now requires `YOLO_MODEL_SHA256` and `YOLO_WEIGHTS_HOST_PATH`, mounts the model read-only, and waits for AI health before starting the backend. The local model file hash matched the declared digest `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36`. Its provenance is not controlled; this proves local isolated inference readiness only, not staging model supply-chain approval. The override also keeps the frontend loopback-only and OSRM data read-only.

### Isolated persistence and test suites

| Command / check | Exit | Result |
|---|---:|---|
| `docker compose -p rakshakai-stage-verify-1103-a4b7 --env-file "$env:TEMP\rakshakai-stage-verify-1103-a4b7.env" --profile osrm -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml exec -T postgres createdb -U rakshakai rakshakai_test_release_1103` | 0 | Created a dedicated test database inside the isolated PostgreSQL volume. |
| `$env:NODE_ENV='test'; $env:TEST_DATABASE_URL='<redacted isolated localhost:55441/rakshakai_test_release_1103 URL>'; $env:RAKSHAKAI_TEST_DATABASE_NAME='rakshakai_test_release_1103'; $env:PG_SSL_MODE='disable'; npm --prefix backend test` | 0 | 549/549 passed, 0 failed, 0 skipped against isolated PostgreSQL. |
| Same isolated PostgreSQL environment; `npm --prefix backend test -- tests/copilot-api.test.js tests/copilot-multilingual.test.js tests/copilot-history.test.js tests/copilot-read.test.js tests/copilot-officers.test.js tests/copilot-officers-postgres.test.js tests/ai-postgres-persistence.test.js tests/ai-security.test.js` | 0 | 89/89 Copilot/AI regression tests passed. |
| `npm test` with `DATABASE_URL`, `TEST_DATABASE_URL`, and `RAKSHAKAI_TEST_DATABASE_NAME` unset and `NODE_ENV=test` | 0 | Backend 464 passed, 10 PostgreSQL-only skipped, 0 failed; frontend 131/131 passed. |
| `npm run check` | 0 | Syntax check passed for 291 JavaScript files. |
| `npm --prefix backend run test:security` | 0 | 121 security tests passed. |
| `npm run frontend:build` | 0 | Production build succeeded. Existing Vite large-chunk warning (>500 kB) remains. Docker's `npm ci` build output also reported one high-severity dependency advisory; its package/advisory was not captured or assessed in this run. |

For persistence, a synthetic `release_verification_probe` row (UUID `9a5d3530-2485-4c64-a305-9a43170cbf3e`) was present after restarting only the isolated backend and again after restarting only the isolated PostgreSQL service; backend health returned 200 afterward. This was a test record in the isolated app database, separate from `rakshakai_test_release_1103` used for the backend suite.

### Browser result and current Docker limitation

The combined Chromium workflow did not pass. It successfully created the citizen report, completed Admin verification, created/edited the synthetic Police officer and unit membership, deployed the officer, changed the response role, released the officer, and persisted incident status transitions through `Resolved`. It then exited 1 at the refresh assertion in `artifacts/staging-verify-1103/priority-workflows-docker.cjs:313`, waiting for `document.body.dataset.view === 'incident-command'` after `page.reload()`. The exact error was `page.waitForFunction: Timeout 30000ms exceeded` (the later copy's explicit wait is 15 seconds). This means the cross-role browser journey, citizen-visible resolution after refresh, final PostgreSQL audit/timeline assertions, and a clean browser run are **PARTIAL / NOT VERIFIED**. The run's screenshots and diagnostic JSON are local under `artifacts/staging-verify-1103/`; they are intentionally not committed because browser evidence can contain synthetic personal data or authenticated state. Do not treat the preceding successful writes as a completed E2E pass.

Follow-up code fix: session bootstrap now restores the authorized deep link immediately after confirming the session, before the bulk dashboard-data refresh. A failed data refresh is logged while the session and selected view remain visible. The original browser timeout did not capture the failing request, so this change addresses the confirmed bootstrap coupling but does not prove it was the sole cause of that run's timeout. The full Chromium workflow still requires a rerun.

After that run, the current shell could no longer connect to `//./pipe/docker_engine` (`docker ps` exit 1; Docker configuration access was denied). The stack could not be inspected or stopped from this shell. It was not removed; no `down`, `down -v`, or prune command was run. Docker acceptance is **PASS for the recorded isolated service, readiness, restart-persistence, and PostgreSQL-suite checks; PARTIAL for browser acceptance; NOT TESTED for live staging**. A future Docker-capable session must inspect this named test project before deciding whether to stop it. Preserve all project volumes.

### Remaining release gates

- Combined Citizen → Admin → Police → Resolution browser workflow: **PARTIAL**, failed after incident resolution at post-refresh route restoration; rerun after diagnosis.
- Session deep-link restoration on transient startup refresh failure: **PASS at unit level** (`node --test frontend/tests/session-bootstrap.test.js`, 3/3); full browser confirmation **NOT TESTED** because the Docker Engine is unavailable.
- Frontend regression suite after the bootstrap fix: **PASS**, `node --test frontend/tests/*.test.js`, 134/134.
- Frontend production build after the bootstrap fix: **PASS**, `npm.cmd run frontend:build`, exit 0; existing >500 kB bundle warning remains.
- PostgreSQL backend and Copilot/AI suites: **PASS** in the isolated test stack above.
- Docker service readiness and isolated database persistence: **PASS** for the checks listed above. Full browser acceptance and safe stack shutdown: **NOT COMPLETED** because the Docker Engine became unreachable.
- Staging deployment, staging credentials/TLS, migration upgrade and rollback, external ERSS-112/CCTV/map integrations, backup/restore, observability, load, and production operations: **NOT TESTED**.
- Docker build emitted one high-severity npm advisory that needs package-specific triage. Vite bundle-size warning remains.

No operational PostgreSQL, Neon data, or existing Docker volume was targeted. No registration rate limiting was added.
