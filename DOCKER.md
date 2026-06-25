# RakshakAI Docker Setup

Docker runs the complete RakshakAI stack as four connected containers:

- `frontend` — production Vite build served by Nginx
- `backend` — secured Express API
- `ai-service` — FastAPI with YOLOv8 Nano
- `postgres` — PostgreSQL 16 with persistent storage

## 1. Install Docker Desktop

Install Docker Desktop for Windows and enable the WSL 2 backend. After
installation, open a new PowerShell terminal and verify:

```powershell
docker --version
docker compose version
```

## 2. Configure local Docker secrets

From the project root:

```powershell
Copy-Item .env.docker.example .env.docker
```

Edit `.env.docker` and replace every placeholder with a strong unique value.
The file is ignored by Git.

Generate a JWT secret with PowerShell:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower()
```

The three seed passwords are used only when the PostgreSQL database is first
created. Restarting the stack does not overwrite existing users or passwords.

## 3. Validate and start

```powershell
npm run docker:config
npm run docker:up
```

The first AI build is large and the first AI start may download
`yolov8n.pt`. Wait until all services are healthy:

```powershell
docker compose --env-file .env.docker ps
```

Open:

```text
http://localhost:3000
```

Optional direct health endpoints:

```text
http://localhost:5000/api/health
http://localhost:8000/health
```

## Operations

Follow logs:

```powershell
npm run docker:logs
```

Stop containers but preserve PostgreSQL and the downloaded model:

```powershell
npm run docker:down
```

Rebuild after dependency or Dockerfile changes:

```powershell
docker compose --env-file .env.docker up --build -d
```

Remove containers and all Docker-managed RakshakAI data:

```powershell
docker compose --env-file .env.docker down --volumes
```

The `--volumes` operation permanently deletes the Docker PostgreSQL database
and cached YOLO model. Use it only when intentionally resetting the stack.

## Persistent data

Compose creates:

- `postgres-data` for users, reports, incidents, alerts, units, and audits
- `ai-model-cache` for downloaded YOLO model files

Database migrations are run before each backend startup. Seed records are
inserted only when their IDs do not already exist.

## Production deployment

The included Compose file is a secure local-development baseline and uses HTTP.
For production:

- terminate HTTPS at a trusted reverse proxy or load balancer
- set `NODE_ENV=production` so session cookies require HTTPS
- store passwords and JWT secrets in a secret manager or Docker secrets
- do not publish PostgreSQL, backend, or AI ports publicly
- use verified PostgreSQL TLS for external databases
- back up the PostgreSQL volume and test restoration
- use SLA-backed or self-hosted GIS services for command-center traffic
- set resource limits and monitoring appropriate to the host

See [SECURITY.md](SECURITY.md) for the complete security requirements.
