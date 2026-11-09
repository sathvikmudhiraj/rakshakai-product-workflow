# RakshakAI Environment Configuration Final Report

Audit and safe configuration work completed 2026-11-09. Secret values and complete database URLs are intentionally omitted.

## Summary

- **Is the Docker configuration correct?** The local Compose configuration is structurally consistent: the backend resolves its database host to the Compose PostgreSQL service, the frontend uses the same-origin API route, and private backend credentials are not passed to the frontend build/runtime. Offline Compose validation passed. A live service/database check was not possible because Docker Desktop was unavailable; therefore runtime connectivity is **NOT TESTED**.
- **Are unnecessary environment files left?** The ignored, unreferenced `.env.example.tx` duplicate was removed after a reference/runtime-use check and with a rollback copy preserved outside the repository. No other discovered environment file was proven unnecessary. No root `.env` was created.
- **Are there exposed or weak secrets?** Live environment files are Git-ignored and no live secret was added to a tracked file. The configured Docker AI service key is below the recommended length, and the three Docker seed passwords are identical and below the documented recommendation. These values were not changed. Their values are not included here.
- **What remains before safe deployment?** An operator must confirm/update the host-run backend's Neon connection string after the manual password rotation, set production CORS origins and a production-appropriate database strategy, replace the weak Docker AI key, and review the existing seed password configuration. Start/redeploy and a live read-only connectivity check remain unperformed.

## Environment files before and after cleanup

| File | Before | After | Service/use | Recommended action |
|---|---|---|---|---|
| `.env` | Absent | Absent | None | None. Absence is intentional. |
| `.env.docker` | Present; ignored; Docker Compose source | Retained and updated with non-secret port, local PostgreSQL address/database/user, CORS, and production-origin settings | Docker Compose | Keep private. Replace the weak AI service key and review seed account settings through the operator's secret process. Do not put the Neon URL here: Compose targets local PostgreSQL. |
| `.env.docker.example` | Tracked template | Updated to document the Docker variables, safe sample CORS values, ports, and production origin fields; no live credentials | Docker Compose onboarding | Keep tracked; use placeholders/sample values only. |
| `backend/.env` | Present; ignored; standalone backend configuration | Retained unchanged | Host-run backend; configured for Neon | Update its local database credential to the manually rotated Neon credential using a secure local editor/secret manager. The credential was not available for insertion during this work; do not copy the Docker PostgreSQL password here. |
| `backend/.env.example` | Tracked template | Updated to include `FRONTEND_ORIGINS` | Standalone backend onboarding | Keep tracked and credential-free. |
| `frontend/.env` | Present; ignored | Retained unchanged | Host-run Vite frontend | Keep private; contains only the public API base URL setting. |
| `frontend/.env.example` | Tracked template | Retained | Vite onboarding | Keep tracked; `VITE_API_BASE_URL` is the only backend URL setting exposed to the browser build. |
| `ai-service/.env` | Present; ignored | Retained unchanged | Host-run AI service | Keep private; keep its service key aligned with the host backend's key. |
| `ai-service/.env.example` | Tracked template | Retained | AI service onboarding | Keep tracked and credential-free. |
| `.env.example` | Tracked general/host-run template | Retained | Host-run setup documentation | Keep tracked; its database setting is for the standalone/Neon workflow, not the Compose backend. |
| `.env.example.tx` | Present; ignored; duplicate-like and unreferenced | Removed; safe rollback copy was kept outside the repository | None found | No further action. |

The discovered inventory contains no other `.env`, `.env.*`, example, or backup environment file outside the paths above (excluding dependencies and Git internals). Tracked environment files are templates; live environment files are ignored by Git. Existing unrelated worktree changes were left untouched.

## Configuration by service

| Service/workflow | Required or relevant settings | Result |
|---|---|---|
| Docker PostgreSQL | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_PORT` | Compose defaults its internal hostname to `postgres`, and uses the same configured database/user/password for the PostgreSQL service and backend URL. Host port is separately configurable. Persistent volume declaration is unchanged. |
| Docker backend | `BACKEND_HOST_PORT`, `JWT_SECRET`, `CAMERA_CREDENTIAL_ENCRYPTION_KEY`, `CORS_ORIGIN`, `FRONTEND_ORIGINS`, `AI_SERVICE_URL`, `AI_SERVICE_API_KEY`, `SEED_ADMIN_PASSWORD`, `SEED_POLICE_PASSWORD`, `SEED_CITIZEN_PASSWORD` | Backend targets the local Compose PostgreSQL service; AI uses `http://ai-service:8000`. Backend does not receive Neon credentials in the Compose path. JWT and camera key formats passed offline validation. AI key and seed password quality warnings remain. |
| Docker frontend | `FRONTEND_PORT` | Frontend uses its same-origin `/api` route. No database password, JWT secret, or AI key is passed to Vite/browser variables. |
| Host-run backend | `PORT`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `FRONTEND_ORIGINS`, `AI_SERVICE_URL`, `AI_SERVICE_API_KEY` | `.env` is the standalone host configuration and points to Neon. The read-only `SELECT 1` check failed authentication (SQLSTATE 28P01). Synchronize the local Neon credential securely, then retry. |
| Host-run frontend | `VITE_API_BASE_URL` | `.env` retains the Vite API base URL configuration. |
| Host-run AI service | `HOST`, `PORT`, `AI_SERVICE_API_KEY`, `AI_SERVICE_ALLOW_INSECURE` and model/runtime settings | Host `.env` is retained; its API key was checked for alignment with the backend configuration without exposing values. |
| Production Compose overlay | `PRODUCTION_CORS_ORIGIN`, `PRODUCTION_FRONTEND_ORIGINS`, `PRODUCTION_FRONTEND_PORT` | Required production origins are intentionally left for the operator. Overlay changes the frontend port/CORS only and still inherits local Compose PostgreSQL; it does not connect to Neon. |

## Changes made

- Added non-secret Docker settings to `.env.docker` and its tracked example so service host/ports, local database addressing, frontend origins, and production origin inputs are explicit.
- Updated `compose.yaml` to use the configured local PostgreSQL identity consistently and pass `FRONTEND_ORIGINS` to the backend.
- Updated `compose.dev.yaml` to use centralized local CORS/origin values and configurable published ports.
- Updated `compose.prod.yaml` to use separate production CORS/origin variables and a configurable frontend port. The database target remains the local Compose PostgreSQL service.
- Added `FRONTEND_ORIGINS` to the backend template.
- Updated Docker preflight/startup scripts to validate required names and report effective ports without rendering credentials.
- Added `scripts/docker-config-check.cjs`; `npm run docker:config` now validates Compose/routing/security without printing rendered secret-bearing configuration.
- Updated Docker documentation to describe configuration ownership and the production overlay's local PostgreSQL behavior.
- Updated the existing Docker safety test expectations for the centralized origin variables.
- Added `scripts/update-neon-password.ps1`, a masked local prompt helper that updates only the Neon password component in `backend/.env`; it verifies the configured host is Neon and suppresses the credential.
- Removed only `.env.example.tx`, after confirming no references/runtime dependency and preserving a rollback copy outside the repository.

No live secret value was edited, printed, logged, or committed. No database, schema, record, seed user, volume, rate limit, service state, or deployment was changed.

## Security findings and operator actions

1. **Neon credential:** The standalone backend configuration uses Neon. Run `powershell -ExecutionPolicy Bypass -File scripts/update-neon-password.ps1` from the repository root and enter the new credential at its masked prompt. This updates only the password component in `backend/.env`. Do not put it in reports, command arguments, tracked files, or `.env.docker`. Then rerun the read-only connectivity check.
2. **Docker AI key:** The configured key is below the 32-character recommendation. Replace it via the operator's coordinated secret process in `.env.docker` and the corresponding host AI/backend settings if that workflow is used. Do not rotate while dependent services are active without coordinating their matching values.
3. **Seed account values:** The three Docker seed password settings are duplicates and below the 16-character recommendation. Change only after confirming the application's seed behavior and account ownership; seed settings do not change existing users' passwords. Do not use a deployment/startup as a way to change existing account credentials.
4. **Production CORS:** Set `PRODUCTION_CORS_ORIGIN` and `PRODUCTION_FRONTEND_ORIGINS` to the exact deployed frontend origins before using the production overlay. They are intentionally blank in local config.
5. **Production database:** The current production overlay still uses the local Compose PostgreSQL service. Select and review the intended production database topology separately before deployment; this work did not redirect it to Neon.

## Validation results

| Check | Result | Notes |
|---|---|---|
| `npm run docker:config` | PASS with WARN findings | Compose service/routing, frontend privacy, authentication variable alignment, and configured ports passed. AI key strength and duplicate/short seed values are warnings. Values were suppressed. |
| Production Compose parse (`docker compose ... config --quiet`) | PASS | Temporary example origins were supplied in the process environment for validation only; rendered configuration was not printed. |
| `npm run check` | PASS | Syntax checked 321 JavaScript files. |
| Database safety tests | PASS | 5/5 existing tests passed. |
| Transaction safety tests | PASS | 13/13 existing tests passed. |
| Docker safety tests | PASS after expectation update | 9/9 existing tests passed. |
| `git diff --check` | PASS | Git reported only line-ending normalization warnings. |
| Git ignore/tracked-secret audit | PASS | Live `.env` files are ignored; tracked environment files are templates. No credential values are included in the report. |
| Docker daemon/service status | NOT TESTED | Docker Desktop engine was unavailable; no restart/start was attempted. |
| Neon read-only connectivity (`SELECT 1`) | FAIL | Authentication failed with SQLSTATE `28P01`. The rotated credential was not available in the local configuration; no credential was changed. |
| Running backend database selection | NOT TESTED | Configuration shows host-run backend uses Neon and Docker Compose targets local `postgres`; Docker was unavailable, so the actual running backend could not be observed. |

## Workflow impact and database strategy

The standalone backend/frontend/AI workflow continues to use their service-local `.env` files. The standalone backend's `DATABASE_URL` targets Neon, but the local read-only connection check failed authentication with SQLSTATE `28P01`; synchronize the rotated Neon credential before relying on that workflow. The Docker workflow reads root `.env.docker` and constructs the backend URL from local PostgreSQL variables, with service DNS host `postgres`; it does not consume the host backend's Neon URL. Docker services share the Compose network, while host-published ports remain configurable.

The PostgreSQL volume declaration and all data paths were preserved. No Compose `down`, volume operation, database query, migration, or record mutation was performed during this configuration cleanup. Runtime database connectivity remains unverified because the Docker engine was unavailable and the known Neon authentication check failed.
