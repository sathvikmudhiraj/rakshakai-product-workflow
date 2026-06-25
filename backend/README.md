# RakshakAI Backend

Express API for RakshakAI.

## Run

```powershell
npm install
npm run dev
```

The API runs on `http://localhost:5000/api`.

Without `DATABASE_URL`, development data is stored in `data/db.json`. For
production PostgreSQL/Neon setup, see [POSTGRESQL_SETUP.md](POSTGRESQL_SETUP.md).

```powershell
npm run migrate
npm run import:json
```

## Health

```text
GET /api/health
```

The response reports `"database": "postgres"` or `"database": "json"` and
`"auth": "jwt"`.

## Real AI Detection

Set `AI_SERVICE_URL` to the external AI service base URL. RakshakAI forwards
frames to `POST {AI_SERVICE_URL}/analyze-frame` and checks `GET
{AI_SERVICE_URL}/health`.

When it is empty, AI routes return `configured: false` and never create an
alert or incident. Actionable results must pass threat-specific confidence
thresholds. Possible missing-person matches always require human verification.

General `object_detected` results are informational and do not create alerts.
`missing_object_possible_match`, `abandoned_object`, and `suspicious_object`
require at least `0.85` confidence. Missing-object possible matches are stored
as `verification_required` and must be reviewed by a human; RakshakAI never
marks an object as found or confirmed automatically. No synthetic object
detections are generated.

Possible object-condition results use `damaged_object_possible` or
`missing_object_damaged_possible_match`, both with a `0.85` threshold and human
verification. The API uses possible-damage wording only; it never confirms
damage, recovery, or a final object match automatically.

## GIS Services

The backend proxies authenticated Admin/Police geocoding requests so browser
clients do not call Nominatim directly:

```text
GET /api/maps/search?q=India%20Gate
GET /api/maps/reverse?lat=28.6129&lng=77.2295
POST /api/maps/route
```

Search and reverse-geocoding responses are cached for 24 hours. Calls to the
public Nominatim service are serialized to at most one request per second.

Configuration:

```env
OSRM_BASE_URL=https://router.project-osrm.org
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
MAP_COUNTRY_CODES=in
MAP_USER_AGENT=RakshakAI/1.0 public-safety-command-center
```

Use self-hosted Nominatim/OSRM and a commercial or self-hosted tile service for
high-volume production usage.

## Incident Command API

AI alerts and citizen reports use a mandatory review step:

```text
POST /api/alerts/:id/review
POST /api/reports/:id/create-incident
POST /api/incidents/:id/assign-nearest
PATCH /api/incidents/:id/status
```

AI review actions:

```json
{ "action": "create_incident" }
{ "action": "observation" }
{ "action": "dismiss" }
```

Only Admin and Police users may review intelligence, create operational
incidents, assign units, or update incident status. Citizen users can submit
reports and view only their own public-safe report state.

Every conversion, verification, assignment, lifecycle update, resolution,
closure, and false-alarm rejection is recorded in the audit log.
