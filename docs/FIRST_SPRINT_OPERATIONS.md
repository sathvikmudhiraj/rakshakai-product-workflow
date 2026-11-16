# First sprint operations

## SLA data quality

The SLA page reports active cases with missing or invalid deadlines. Admins can open **Review deadline gaps** to see a read-only plan. The plan separates generated demo records, possible fixtures, invalid timestamps, unavailable policies, and cases eligible for reconciliation. A title that looks synthetic is only a review flag; it never deletes or automatically excludes an incident.

New operational incidents require an active policy for their exact severity. Severity overrides enforce the same rule. Generated demo incidents remain explicitly marked as demo. Existing deadlines are never rewritten by the reconciliation endpoint.

Admin API workflow, using an existing authorized session:

1. `GET /api/sla/config` and review policy minutes and active flags. Obtain the approved operational targets before changing policy.
2. `GET /api/sla/deadlines/preview`. Review every entry and retain its `digest`.
3. For a suspected fixture, investigate its source. If classification is justified, `POST /api/sla/incidents/{id}/classification` with `{"classification":"demo"|"operational","reason":"..."}`. This writes audit and timeline records. Reopen the preview because its digest changes.
4. `POST /api/sla/deadlines/reconcile` with `{"ids":["..."],"digest":"...","reason":"...","acknowledgeHistoricalBreaches":true}`. The acknowledgement is required only when selected proposed deadlines are already overdue. At most 50 unique IDs may be changed per request. Every selected case must have `ready` status. The server rechecks the preview under its database write lock and writes only missing deadline fields plus audit and timeline events.
5. Reopen the preview and SLA Monitoring page. Review any remaining policy gaps, invalid timestamps, and true breaches. Historical deadlines are based on the original creation time; reconciliation does not reset the SLA clock.

No live classification or reconciliation is automatic. The release operator must review the actual incident identities and approved SLA targets before applying these writes.

## 429 and API health

The backend attaches request IDs and logs HTTP 429 responses even when a limiter rejects a request before routing. `GET /api/health` includes aggregate `rateLimits.http429LastMinute`, `http429Total`, and bounded route groups. These are per backend process and reset when it restarts. The health endpoint remains excluded from the general limiter. Existing rate-limit thresholds and authentication stay unchanged.

Run the monitor as an external process and capture its JSON output. In PowerShell:

```powershell
$env:MONITOR_BASE_URL = "http://127.0.0.1:3001"
node scripts/monitor-release.cjs
```

It raises `http_429_burst` after at least three 429 responses in the last minute and resolves when the count falls below three. It also checks readiness and can consume backend JSON logs on stdin for 5xx bursts. Configure `ALERT_WEBHOOK_URL` only for an approved HTTPS receiver. Do not raise production rate limits to silence an alert; use the request ID, `Retry-After`, route group, reverse-proxy configuration, and genuine client request volume to investigate.

## Exact-commit frontend promotion and rollback

The release script requires a clean working tree, the full expected HEAD commit SHA, and an existing `rakshakai` frontend container published on localhost port 3001. It uses the current base Compose stack plus `compose.frontend-release.yaml`; review this configuration if the live stack later uses extra frontend overlays. It checks the merged Compose configuration, builds an image labelled with that commit, recreates **frontend only** with `--no-deps --no-build`, waits for `/healthz`, checks that all other container IDs and images stayed the same, and compares the served index hash with the container's file. It records asset hashes, image IDs, container IDs, and the previous image tag. A failed deployment attempts an automatic frontend rollback.

```powershell
node scripts/release-frontend.cjs plan
node scripts/release-frontend.cjs deploy artifacts/frontend-release-YYYYMMDD.json <full-40-character-commit-sha>
node scripts/release-frontend.cjs rollback artifacts/frontend-release-YYYYMMDD.json
```

Use a fresh evidence filename for every deployment. Preserve the rollback image tag and JSON record until the rollback window closes. The script never runs migrations, changes volumes, or recreates backend, PostgreSQL, AI, or OSRM services. Backend changes in this sprint require a separately reviewed backend release. After any promotion, perform authenticated `/api/auth/me`, Admin `/api/sla/monitoring`, Audit Logs, GIS, and desktop/mobile UI acceptance on the actual port 3001 application before declaring live deployment PASS.

The current repository includes unrelated uncommitted work. An exact-commit promotion is blocked until the intended changes are reviewed and committed without absorbing unrelated changes. Required main-branch jobs, signed image digest promotion, and a staging rollback drill remain separate release gates.
