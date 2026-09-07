# Operational Load Baseline

Run the isolated drill:

```powershell
node --test backend/integration/operational-load.test.cjs
```

Docker builds the current backend and starts an isolated PostgreSQL 16 database
and evidence volume. It generates temporary credentials and synthetic records.
The client shares only the test backend's PID namespace to read Linux VmRSS/VmHWM;
it does not inspect the production process or use production data. Only generated
test containers and volumes are removed afterward. No production service is stopped.

## Workload and Measurements

Observed on local Docker Desktop, 2026-09-06, with the current uncommitted worktree:

| Measure | Result |
| --- | --- |
| Assignments | 40, concurrency 8, two authenticated operator sessions |
| Assignment latency | p50 581 ms; p95 1,646 ms; maximum 1,944 ms |
| Assignment throughput | 9.83 requests/second over the measured batch |
| Contention injection | Application advisory lock held for 750 ms |
| Maximum observed PostgreSQL lock waiters | 8 |
| Upload/preview workload | 12 synthetic 384 KiB MP4-signature payloads, concurrency 4 |
| Upload plus preview latency | p50 2,833 ms; p95/max 3,400 ms |
| Upload plus preview throughput | 1.32 operations/second |
| Backend RSS before/after uploads | 123,512 / 138,064 KiB |
| Backend high-water RSS before/after uploads | 124,332 / 141,972 KiB |
| Retry after removing forced commit failure | 64 ms, HTTP 200 |

The test checks successful assignments, exactly one dispatch/audit event per
assignment, all upload/preview checksums, an HTTP 500 for forced COMMIT failure,
successful retry, and healthy readiness afterward. It does not disable rate limits.

## Interpretation and Limits

These are short, closed-loop batches against one backend. Assignment percentiles
include the deliberate contention burst. Upload latency includes reading and
hashing the preview. Memory numbers describe the whole backend process; the
high-water difference is not a per-request allocation or a leak diagnosis.

OSRM is deliberately unavailable, so approximate routing is exercised. The drill
does not measure real route-provider latency, concurrent GIS polling, AI inference,
CCTV streams, real video decoding, multiple application replicas, long-running
memory growth, large historical databases, or geographically remote networks.
No operational SLO or production capacity is claimed from this run.

Before production approval, agree expected operators, polling rates, incident
volume, permitted upload sizes, p95/p99 targets and error budgets. Repeat on a
representative staging environment with realistic data size, real OSRM/AI
services, mixed workloads, increasing concurrency and a sustained soak. Measure
CPU, pool saturation, database lock waits, disk latency, memory/GC and request
errors. Add database restart/network interruption and storage exhaustion drills.
Do not change assignment locking based only on this small benchmark.
