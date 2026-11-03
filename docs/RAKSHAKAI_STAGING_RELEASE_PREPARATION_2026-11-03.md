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
| `docker compose -p rakshakai-release-static-verify --profile osrm -f compose.yaml -f compose.prod.yaml -f compose.staging-verify.yaml config --quiet` | 0 | Staging override parsed with synthetic values. Extracted config confirms project `rakshakai-release-static-verify`, frontend `127.0.0.1:48123:80`, read-only `/data` OSRM bind, and backend database host `postgres`. |
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
