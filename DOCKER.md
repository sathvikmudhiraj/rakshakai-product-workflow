# RakshakAI Docker Setup

For the current non-destructive manual-to-Docker transition, optional OSRM
profile, backup procedure, health expectations, and exact commands, see
[Safe Docker Startup](docs/SAFE_DOCKER_STARTUP.md).

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

Edit `.env.docker` and replace every placeholder with a local-only value. The
file is ignored by Git and must not be committed.

Keep `POSTGRES_PASSWORD` stable after the first successful Docker start. The
PostgreSQL password is stored inside the persistent Docker volume when the
database is initialized. Do not change `POSTGRES_PASSWORD` after first Docker
start unless you are also resetting the Postgres volume with `down --volumes`.

Generate a JWT secret with PowerShell:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower()
```

The three seed passwords are used only when the PostgreSQL database is first
created. Restarting the stack does not overwrite existing users or passwords.

## CCTV configuration

Seeded CCTV entries are simulated demo feeds only. They are marked as
`DEMO CAMERA / SIMULATED FEED` and must not be treated as production CCTV.

Real camera integrations must use authorized RTSP, HLS, ONVIF, NVR, DVR, or
webcam sources. Keep stream URLs, usernames, passwords, and tokens in ignored
environment files, Docker secrets, or backend-only storage. These secrets must
not be committed and must not be exposed to the frontend.

RTSP is not directly playable in browsers. Production viewing requires a
backend stream proxy/transcoder to HLS, WebRTC, or MJPEG. Without that proxy,
the app reports camera health and safe snapshot/proxy status only.

## 3. Start

```powershell
npm run docker:up
```

The first AI build is large and the first AI start may download
`yolov8n.pt`. Wait until all services are healthy:

```powershell
docker compose --env-file .env.docker ps
```

Open the app:

- App URL: [http://localhost:3000](http://localhost:3000/)
- Backend health: [http://localhost:5000/api/health](http://localhost:5000/api/health)
- AI health: [http://localhost:8000/health](http://localhost:8000/health)

Optional config validation:

```powershell
npm run docker:config
```

## CSP API and tile configuration

The production frontend CSP allows same-origin API calls with
`connect-src 'self'`. Leave `CSP_CONNECT_SRC` empty when Nginx proxies `/api`
to the backend in the same origin.

For a separately deployed production backend, set only the backend API origin:

```text
CSP_CONNECT_SRC=https://api.example.com
```

Do not include paths such as `/api`. Production CSP validation rejects wildcard
sources, `unsafe-eval`, malformed values, and non-HTTPS origins.

Map image sources include the OpenStreetMap standard tile hosts and ArcGIS World
Imagery:

```text
https://tile.openstreetmap.org
https://a.tile.openstreetmap.org
https://b.tile.openstreetmap.org
https://c.tile.openstreetmap.org
https://server.arcgisonline.com
```

Same-origin self-hosted map tiles work through `'self'`. Backend-only OSRM and
Nominatim services are intentionally not added to browser `connect-src`; the
frontend continues calling `/api/maps/*`.

## Private OSRM routing

Docker Compose includes an internal-only `osrm` service for driving routes.
The backend reaches it at `http://osrm:5000`; the service is exposed only on
the Compose network and does not publish a host port. The frontend must keep
calling the backend API for routes.

Prepare the regional OSRM dataset once before starting private routing. Do not
commit `.osm.pbf` or generated `.osrm*` files.

Recommended Windows host folder:

```text
D:\rakshak-gis\osrm-data
```

Place your regional extract there as `region.osm.pbf`, then run:

```powershell
.\scripts\prepare-osrm-data.ps1 -DataPath "D:\rakshak-gis\osrm-data" -PbfFile region.osm.pbf
```

The script runs these OSRM commands with the pinned Docker image:

```powershell
docker run --rm -v "D:\rakshak-gis\osrm-data:/data" osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run --rm -v "D:\rakshak-gis\osrm-data:/data" osrm/osrm-backend:v5.27.1 osrm-partition /data/region.osrm
docker run --rm -v "D:\rakshak-gis\osrm-data:/data" osrm/osrm-backend:v5.27.1 osrm-customize /data/region.osrm
```

Use these values in `.env.docker`:

```text
GIS_ROUTING_PROVIDER=self_hosted
OSRM_BASE_URL=http://osrm:5000
PUBLIC_OSRM_FALLBACK=false
ROUTE_TIMEOUT_MS=3000
OSRM_DATA_HOST_PATH=D:\rakshak-gis\osrm-data
OSRM_DATA_PATH=/data/region.osrm
```

For local development demos only, public OSRM can be enabled explicitly:

```text
GIS_ROUTING_PROVIDER=public
OSRM_BASE_URL=
PUBLIC_OSRM_FALLBACK=true
```

Production must keep `GIS_ROUTING_PROVIDER=self_hosted` and
`PUBLIC_OSRM_FALLBACK=false`. If local OSRM is offline or the request is outside
the regional extract, RakshakAI keeps the API online and returns an approximate
fallback route instead of silently calling public OSRM.

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
