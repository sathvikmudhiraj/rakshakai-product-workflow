# RakshakAI

RakshakAI is split into three services:

- `frontend/` - Vite UI on `http://localhost:3000`
- `backend/` - Express API on `http://localhost:5000/api`
- `ai-service/` - FastAPI AI service on `http://127.0.0.1:8000`

The complete stack can also run with Docker Compose. See
[DOCKER.md](DOCKER.md).

## Run the Full App

```powershell
npm install
npm run dev
```

Run this from the project root. It starts the backend and frontend together.
Press `Ctrl+C` once to stop both services.

If port `3000` or `5000` is already occupied, stop the older app process and run the command again.

## Local Demo Data

By default, leave `DATABASE_URL` empty to run with `backend/data/db.json`.
If you configure PostgreSQL for development, run migrations first:

```powershell
npm --prefix backend run migrate
```

Reset the local/demo accounts only in development:

```powershell
npm run reset:demo-users
```

Demo credentials:

```text
admin@rakshakai.local / demo123
police@rakshakai.local / demo123
citizen@rakshakai.local / demo123
```

The reset script refuses to run when `NODE_ENV=production`.

## Run the AI Service

```powershell
cd ai-service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
py -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

AI health: `http://localhost:8000/health`

After the AI service starts, restart the backend. Authenticated Admin and Police
users can check `http://localhost:5000/api/ai/health`.

If `AI_SERVICE_URL` is empty or the service is down, the backend stays online and
the UI reports the AI service as offline. Operational AI/CCTV/Live Vision remains
restricted to Admin and Police users.

## CCTV Camera Registry

CCTV Monitoring separates simulated demo feeds from real authorized camera
configuration. Seeded demo feeds are marked as `DEMO CAMERA / SIMULATED FEED`
and use `sourceType=demo_seed` with `isDemo=true`.

Real CCTV requires authorized RTSP, HLS, ONVIF, NVR, DVR, or webcam
configuration by an Admin. Stream URLs and credentials are stored backend-side
only and are never returned to the frontend API. Do not use unauthorized public
CCTV streams.

Browsers do not play RTSP directly. Production RTSP cameras require a backend
stream proxy or transcoder to HLS, WebRTC, or MJPEG before live browser viewing.
Until that exists, the UI shows camera health, safe metadata, and snapshot/proxy
status instead of pretending the RTSP stream is directly viewable.

AI camera detections are possible observations. Admin or Police users must
review and verify observations before an operational incident is created.

## Health Check

```text
GET http://localhost:5000/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "RakshakAI Backend",
  "timestamp": "ISO timestamp"
}
```

## Security Verification

Run the backend security and role-access suite from the project root:

```powershell
npm test
```

The backend uses:

- HttpOnly, SameSite session cookies
- trusted-origin enforcement for mutations
- request-size limits and JSON validation
- authentication and general API rate limits
- Helmet response headers
- role isolation tests for Admin, Police, and Citizen users

Production credentials must remain in ignored `.env` files or a deployment
secret manager. Rotate any database password or JWT secret that has been shared
outside the trusted deployment environment.

See [SECURITY.md](SECURITY.md) for the complete session, API, GIS, HTTPS, proxy,
and production-secret requirements.

## Included MVP Features

- Login/register with roles
- Role-based dashboard UI
- GIS/map monitoring
- CCTV demo feed separation and secure real camera registry
- Rakshak Live Vision phone-camera SOS mode
- Missing person and evidence reporting
- Alerts and incident response
- Device health, audit logs, and integration status
- JSON persistence in `backend/data/db.json`

## Incident Command Workflow

Admin and Police users have an **Incident Command** workspace that connects:

- AI alerts waiting for human review
- citizen reports waiting for verification
- verified operational incidents
- GIS incident and response-unit markers
- nearest-unit dispatch and OSRM ETA
- incident status timelines and audit records

AI detections and citizen reports are review records first. They do not become
operational incidents until an authorized Admin or Police user explicitly
creates or verifies the incident.

Supported incident statuses:

```text
New → Verified → Assigned → En Route → On Scene → Resolved → Closed
```

Incidents can also be closed as `Rejected / False Alarm`.

## Free GIS Stack

RakshakAI uses a free, open mapping stack:

- OpenStreetMap for street-map data and tiles
- Esri World Imagery for satellite view
- Nominatim for place search and reverse geocoding
- OSRM for driving routes and turn instructions
- Browser Geolocation for the operator's current position

The GIS screen supports place suggestions, map-click destinations, readable
addresses, route distance/ETA, route steps, satellite mode, incident markers,
and opening the complete route in OpenStreetMap.

The public Nominatim, OpenStreetMap tile, and OSRM services are appropriate for
development and low-volume demonstrations. For a production command center,
self-host these services or use a provider with an SLA and suitable usage
limits.

The browser loads map images from:

```text
https://tile.openstreetmap.org
https://server.arcgisonline.com
```

The production CSP also permits the standard OpenStreetMap subdomain tile hosts
`https://a.tile.openstreetmap.org`, `https://b.tile.openstreetmap.org`, and
`https://c.tile.openstreetmap.org` so OSM templates can switch to subdomains
without weakening the policy. Browser code must call RakshakAI `/api/maps/*`
endpoints for routing/geocoding; OSRM and Nominatim remain backend-only.

Production routing should use a private OSRM service:

```text
GIS_ROUTING_PROVIDER=self_hosted
OSRM_BASE_URL=http://osrm:5000
PUBLIC_OSRM_FALLBACK=false
ROUTE_TIMEOUT_MS=3000
```

With `PUBLIC_OSRM_FALLBACK=false`, RakshakAI never silently sends route
requests to the public OSRM service. If the private OSRM service is offline or a
route falls outside the loaded regional extract, the backend returns the
existing approximate fallback route and keeps dispatch workflows available.
Docker setup and one-time regional data preparation are documented in
[DOCKER.md](DOCKER.md).
