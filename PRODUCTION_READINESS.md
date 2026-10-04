# Production Readiness Gates

This register separates repository evidence from deployment and organizational
work. A checked repository control does not close an external gate.

| Area | Implemented evidence | Required before public production | Owner evidence required |
| --- | --- | --- | --- |
| Release integrity | Protected `main`, required `verify`, audits, browser, TLS, backup and load checks | Signed digest promotion and automated rollback in staging | Release record with image digest and rollback result |
| AI safety | Advisory results, role gates, API key, checksum-capable local weights, mandatory human review | Indian operating dataset; per-class precision, recall and false-alarm limits; low-light, weather, crowd and angle evaluation; shadow mode; drift monitoring; target hardware throughput; model registry; fine-tuning and independent validation | Versioned model card, dataset provenance, validation approval and rollback drill |
| Infrastructure | Health endpoints and Compose pilot | Managed TLS ingress and WAF; resource limits; replicas; autoscaling; segmentation; digest-pinned images; scanning; managed HA PostgreSQL; durable evidence storage; migration job; rollout automation | Reviewed infrastructure configuration and staging acceptance |
| Monitoring | Structured request/error logs and local monitor script | Central logs, metrics and tracing; external checks; durable alerts; SLOs; thresholds; on-call; watchdog; production alert drill | Dashboards, alert receipts, runbooks and drill record |
| Recovery | Paired local PostgreSQL/evidence backup and isolated restore drill | PITR; encrypted off-site evidence backup; schedules; retention; legal holds; production-scale restore; approved RPO/RTO; camera-key escrow and dual-key rotation | Backup reports and timed restore exercise |
| Identity | HttpOnly secure sessions, role checks, rate limits, 12-character public-registration policy | MFA; SSO/IdP; central revocation; session/device inventory; lockout policy; forced resets; privileged-access review | IdP policy, access review and revocation drill |
| Evidence governance | Checksummed private evidence, authorization, append-only relational custody history | Retention/deletion policy; immutable external audit archive; legal holds; classification; privacy impact assessment; malware scanning; jurisdiction review; access certification | Approved policies and enforcement test results |

## AI acceptance record

For each release candidate, record:

- model identifier, immutable digest, code revision, training configuration, and
  full dataset lineage;
- class-by-class precision, recall, false positives per camera-hour, calibration,
  and confidence threshold;
- results split by day/night, rain, haze, crowd density, occlusion, camera height,
  camera angle, compression, resolution, and relevant Indian operating context;
- CPU/GPU throughput, end-to-end latency, dropped-frame rate, memory, temperature,
  and sustained-load results on the exact target hardware;
- shadow-mode duration, sites, cameras, operator feedback, false-alarm review,
  drift baseline, approval decision, and rollback target.

No accuracy claim belongs in product or operator documentation unless it points
to an approved versioned acceptance record.

## Recovery acceptance record

Define and approve RPO and RTO before launch. A drill must restore the database,
evidence objects, application image, configuration, and camera encryption keys
into new targets. Verify authentication, evidence checksums, custody history,
legal holds, application health, and rollback before recording the achieved RPO
and RTO.

## Stop-ship conditions

- Any required workflow or vulnerability gate fails.
- AI validation, throughput, drift baseline, or independent approval is missing.
- AI output can bypass human review.
- Production secrets or the camera encryption key lack backup and recovery.
- Evidence retention, legal hold, privacy, or jurisdiction approval is missing.
- Monitoring has no durable delivery, watchdog, on-call owner, or successful drill.
- Staging rollback or representative restore testing fails.
