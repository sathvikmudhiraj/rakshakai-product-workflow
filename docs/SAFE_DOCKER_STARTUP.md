# Safe Docker Startup

RakshakAI normal startup consists of `postgres`, `ai-service`, `backend`, and
`frontend`. The `osrm` service is optional and starts only with the Compose
profile named `osrm`. Without OSRM, the backend remains available and route
requests return the existing clearly labelled approximate fallback.

## Read-only preflight

From the project root:

```powershell
npm run docker:preflight
```

The preflight verifies:

- Docker daemon availability without starting Docker Desktop
- `.env.docker` existence
- required variable names and non-empty values without printing values
- ports 3000, 5000, and 8000, including owning PIDs/process names
- whether a RakshakAI PostgreSQL volume exists
- whether optional prepared OSRM MLD files exist
- `docker compose --env-file .env.docker config`

It does not stop processes, start or stop services, build images, modify
volumes, or change application data.

## JSON backup

Before the first PostgreSQL migration/import:

```powershell
npm run backup:json
```

This creates `backups/` when needed, copies `backend/data/db.json` to a
millisecond-timestamped file without overwriting any existing backup, and
verifies that the new file has non-zero size. It never prints record contents,
passwords, or hashes.

## Exact startup and operations commands

Normal stack without OSRM:

```powershell
docker compose --env-file .env.docker up -d --build
```

Stack with already prepared OSRM:

```powershell
docker compose --env-file .env.docker --profile osrm up -d --build
```

Status:

```powershell
docker compose --env-file .env.docker ps
```

Bounded logs:

```powershell
docker compose --env-file .env.docker logs --tail=100 postgres ai-service backend frontend
```

Stop without deleting data:

```powershell
docker compose --env-file .env.docker stop
```

Never use these during a normal migration, transition, or recovery:

```text
docker compose down --volumes
docker volume rm
docker system prune --volumes
```

They can permanently delete PostgreSQL data or cached model files.

## Optional OSRM profile

The OSRM container uses `http://osrm:5000` internally. Before `osrm-routed`
starts, the container verifies the required regional MLD file set, including
the `.osrm`, `.partition`, `.cells`, and `.mldgr` files. Missing or empty data
fails only the optional OSRM container with a clear log. RakshakAI never
downloads a regional map extract automatically.

Normal startup leaves the OSRM profile inactive. Backend startup has no hard
dependency on the OSRM container. `PUBLIC_OSRM_FALLBACK=false` remains the safe
default, so unavailable private OSRM produces the local approximate route
instead of an HTTP 500 or an implicit call to public OSRM.

## PostgreSQL import semantics

Backend startup runs migrations and then the existing JSON import with
`--if-empty`. The import is additive and idempotent by record ID:

- each collection/table reports `inserted`, `skipped-existing`, and `failed`
- existing IDs are skipped rather than synchronized or overwritten
- unrelated PostgreSQL rows are not deleted
- stale PostgreSQL rows may remain
- Docker demo-user passwords are determined by `SEED_ADMIN_PASSWORD`,
  `SEED_POLICE_PASSWORD`, and `SEED_CITIZEN_PASSWORD` in `.env.docker`

Import output never prints record contents, passwords, hashes, or secret
values.

## Expected health

- `http://localhost:3000` returns HTTP 200
- `http://localhost:5000/api/health` returns HTTP 200 with `database=postgres`
- `http://localhost:3000/api/health` returns HTTP 200 through the Nginx proxy
- `http://localhost:8000/health` reports AI process/model readiness
- routing health may report `approximate-fallback` while OSRM is inactive

## First Docker migration sequence

1. Stop the manual frontend, backend, and AI processes yourself after reviewing
   the PIDs reported by preflight.
2. Start Docker Desktop yourself and wait for the daemon to become available.
3. Run `npm run docker:preflight` again.
4. Run `npm run backup:json`.
5. Run `docker compose --env-file .env.docker config`.
6. Run `docker compose --env-file .env.docker up -d --build`.
7. Run `docker compose --env-file .env.docker ps`.
8. Run
   `docker compose --env-file .env.docker logs --tail=100 postgres ai-service backend frontend`.
9. Verify all four health expectations above.
10. Use the OSRM-profile command only after prepared regional files pass
    preflight.
