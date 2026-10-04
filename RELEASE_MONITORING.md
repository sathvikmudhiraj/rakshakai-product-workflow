# Release Gates and Monitoring

The `.github/workflows/release-checks.yml` workflow runs syntax/unit tests, frontend
builds, dependency audits, browser/PostgreSQL release checks, TLS verification,
paired backup/recovery, and the isolated operational load drill. The workflow
does not deploy. Require its `verify` job through repository branch protection
before merging. The repository currently requires the `verify` check on `main`,
enforces it for administrators, requires one approving review and last-push
approval, dismisses stale reviews, and blocks force pushes and branch deletion.

Run the same checks locally using the commands in that workflow. A failing
browser, audit or integration check blocks release; do not bypass it or claim
the deployment is validated based only on unit tests.

## Monitor Setup

The backend emits structured `http_request` summaries with request IDs, status
and elapsed time. It emits `request_failed`, evidence reconciliation failures,
and shutdown failures separately. Preserve these logs in restricted durable
storage, with retention governed by the organization's operational policy.

`scripts/monitor-release.cjs` consumes raw JSON log lines from stdin and probes
`MONITOR_BASE_URL/api/health` every 15 seconds with a 10-second timeout. Configure
`MONITOR_BASE_URL` explicitly using HTTPS, or loopback HTTP for local probes.
Optionally provide `ALERT_WEBHOOK_URL` through a secret manager to an HTTPS
receiver accepting JSON. It must support this generic payload or use an adapter;
the tool does not assume a Slack/PagerDuty-specific contract.

Example PowerShell invocation after selecting the intended backend container:

```powershell
# Set MONITOR_BASE_URL and optionally ALERT_WEBHOOK_URL securely first.
docker logs --follow --since 1m rakshakai-backend-1 2>&1 | node scripts/monitor-release.cjs
```

This command starts a long-lived monitor; it is not started by the code change.
Run it under a supervisor that restarts both the log follower and monitor.
Retarget it after backend container recreation. Alert on monitor absence from an
independent watchdog. A stopped log stream raises an alert but does not restart
the stream automatically. A loopback probe alone cannot detect public DNS/TLS or
external ingress failure; add an external synthetic monitor for those paths.

## Alert Conditions

- Readiness HTTP failure, timeout, or non-OK body: critical; healthy recovery:
  resolved. Liveness `/api/live` is process-only, not database/storage readiness.
- Three HTTP 5xx request summaries within 60 seconds: critical.
- Evidence reconciliation, journal/transaction cleanup errors, shutdown failure
  or shutdown deadline: immediate critical alert.
- Repeated alerts deduplicate for 60 seconds. Failed webhook deliveries emit
  `alert_delivery_failed` and retry on the next matching signal. There is no
  durable delivery queue; use a supervised log collector/alert platform when
  guaranteed delivery is required.

Only the alert kind, state, severity, timestamp and service are sent. Incoming
log payloads, URLs, JWTs, evidence keys and raw errors are not forwarded. Without
a configured webhook the monitor emits local JSON alerts only. Synthetic tests
use a mocked receiver; no external notification is sent during validation.

## Readiness and Shutdown

`/api/health` checks PostgreSQL connectivity and, in production, performs an
evidence-storage write/flush/delete probe. Storage failure returns 503 while
`/api/live` stays available. During graceful drain readiness returns 503. The
existing signal handler stops new connections, drains active HTTP requests and
closes the PostgreSQL pool; a 25-second HTTP deadline logs a shutdown alert.
Keep the container's stop grace period longer than the application's drain
deadline. Test representative long requests before setting production timeouts.

## Deployment Work Still Required

Maintain branch protection and configure a supervised monitor, a real alert
receiver, durable log retention, an external availability monitor, and an alert owner.
Perform a controlled notification drill and verify receipt/recovery at the
actual receiver. No production infrastructure, repository settings, secret
values or external notification destinations are changed by this implementation.

## Local Validation Status

On 2026-09-06 the six monitoring tests and graceful-shutdown test passed, as did
175 backend tests, 22 frontend tests, syntax/build checks and all three configured
dependency audits. The isolated PostgreSQL release suite passed all 13 checks,
including evidence-storage readiness failure and recovery.

Inspection found that login exposed the
navigation before refresh finished, then overwrote an early GIS selection with
the landing page. The fix establishes role access and the landing page before
refresh. A behavioral regression test verifies that delayed refresh preserves
subsequent GIS navigation and duplicate login submissions remain blocked.

On 2026-09-07 `npm run test:release` passed all 13 isolated integration checks
and all six Chromium browser scenarios (Admin, Police, Citizen at 1440x900 and
390x844). Operator scenarios cover GIS route selection/calculation/clear, camera
allow/deny, and case-linked synthetic WebM upload/playback. Citizen direct Live
Vision navigation is blocked without AI API requests. No uncaught browser errors
or CSP violations occurred. Temporary test containers and their evidence volume
were removed; the running application stack was not changed.

The default headless shell rejected fake-camera capture with NotSupportedError
on this Windows host; the runner now uses full Chromium headless mode and retains
the denied-permission assertion. A GIS click defect was also fixed: Leaflet events
use originalEvent for DOM cancellation, while native events remain supported.
Both event types have regression tests. All 175 backend and 25 frontend tests
passed, with no skips, and syntax/build checks passed.

This is a workflow acceptance gate, not complete visual or device certification.
Screenshots captured after Clear Route still show imagery loading and compact
control labels; external tile availability and final layout need a separate
visual pass. Real camera hardware, live AI inference, cross-browser acceptance,
and production TLS/device testing also remain outside this synthetic run.
