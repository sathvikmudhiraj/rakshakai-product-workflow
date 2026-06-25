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
- CCTV demo feeds and camera source management
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
