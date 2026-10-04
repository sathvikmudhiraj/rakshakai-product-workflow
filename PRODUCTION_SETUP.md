# RakshakAI Production Setup Boundary

This repository supplies a tested application and a Docker Compose pilot. It
does not supply a complete public-safety production platform. Do not expose the
Compose stack directly to the internet or treat a green CI run as field
certification. Track the remaining rollout gates in
[`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).

## Supported application services

- Node.js backend with PostgreSQL persistence.
- Static frontend served by Nginx with a restrictive production CSP.
- Authenticated FastAPI `POST /analyze-frame` integration using a local,
  checksum-verified YOLO weights file.
- Human-reviewed evidence and AI observations. AI output is advisory and cannot
  confirm identity, crime, threat, or a missing-person match.
- Private OSRM routing when prepared regional data is mounted explicitly.
- Filesystem evidence storage for isolated testing and a single-host pilot.

The application does not implement face recognition. It does not expose an AI
`POST /scan` endpoint. Raw RTSP ingest, transcoding, recording, and browser
playback are not implemented by the included AI service. Camera registry values
describe authorized sources; an independently secured media gateway is required
before a real RTSP deployment.

## Local release-equivalent validation

Copy the example environment file and replace every placeholder:

```powershell
Copy-Item .env.docker.example .env.docker
```

Run the release gates before creating a candidate image:

```powershell
npm ci --ignore-scripts
npm --prefix backend ci
npm --prefix frontend ci
npm run check
npm test
npm run frontend:build
npm audit --audit-level=moderate
npm --prefix backend audit --omit=dev --audit-level=moderate
npm --prefix frontend audit --audit-level=moderate
npm run test:release
node --test backend/integration/postgres-tls.test.cjs
node --test backend/integration/backup-recovery.test.cjs
node --test backend/integration/operational-load.test.cjs
```

The GitHub `verify` job runs these gates and must remain required on `main`.

## Required production services

Provision these outside this repository before deployment:

1. Managed ingress with TLS termination, WAF, request-size controls, external
   availability checks, and private backend routing.
2. A secret manager for database credentials, `JWT_SECRET`, AI service key, and
   `CAMERA_CREDENTIAL_ENCRYPTION_KEY`. Back up the camera key separately and
   test dual-key rotation before storing real credentials.
3. Managed PostgreSQL with verified TLS, high availability, point-in-time
   recovery, restricted roles, and a separate migration job.
4. Durable private object storage for evidence with encryption, versioning,
   retention, legal holds, malware scanning, and immutable audit integration.
5. A private container registry with immutable digest-pinned images, provenance,
   signing, vulnerability scanning, and rollback artifacts.
6. An orchestrator that provides multiple replicas, resource limits,
   health-based restarts, autoscaling, network policies, deployment rollout,
   and rollback.
7. Central logs, metrics, tracing, durable alert delivery, a watchdog, defined
   SLOs, and an owned on-call escalation path.

## Database and evidence

Production requires PostgreSQL. Use a verified TLS connection and run migrations
as an explicit pre-deployment job:

```powershell
$env:DATABASE_URL = "postgresql://user:password@host/database?sslmode=require"
$env:PG_SSL_CA_FILE = "C:\secure\postgres-ca.pem"
npm --prefix backend run migrate
```

Evidence bytes must remain private and must be served only through the authorized
preview API. The filesystem driver is acceptable for isolated release tests and
a controlled single-host pilot. Use a reviewed durable object-storage adapter
before a multi-replica deployment.

Custody history is stored in the append-only PostgreSQL
`evidence_custody_events` table. The database rejects updates and deletes from
that table. Retention, legal-hold, archival, and external immutability policies
still require deployment-level enforcement.

## AI service

The supported backend configuration is:

```text
AI_SERVICE_URL=http://ai-service:8000
AI_SERVICE_API_KEY=<secret-manager value>
YOLO_MODEL_NAME=/models/yolov8n.pt
YOLO_MODEL_SHA256=<approved digest>
```

The production decision gate requires a versioned model artifact, representative
Indian operating-environment evaluation, per-class thresholds, low-light and
weather tests, crowd and camera-angle tests, throughput certification, shadow
deployment, drift monitoring, independent validation, and a tested rollback.
Until those artifacts are approved, AI results remain advisory and require a
human decision.

## Routing and cameras

Use a private routing service and prepared regional data:

```text
GIS_ROUTING_PROVIDER=self_hosted
OSRM_BASE_URL=http://private-osrm:5000
PUBLIC_OSRM_FALLBACK=false
```

Do not put camera usernames or passwords in Git, image layers, URLs sent to the
browser, or logs. Raw RTSP cameras require a separately designed gateway with
network isolation, authorization, audit, and an approved HLS/WebRTC delivery
path. The repository does not provide that gateway.

## Promotion rule

Promote only a reviewed immutable image digest after:

- the protected `main` workflow is green;
- staging uses the intended ingress, identity, database, storage, secrets,
  monitoring, and network policies;
- backup restoration and deployment rollback succeed at representative scale;
- the production alert drill reaches the assigned on-call responder; and
- security, privacy, AI validation, and records-governance owners sign off.
