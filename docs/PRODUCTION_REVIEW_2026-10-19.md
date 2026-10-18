# RakshakAI application production review — 2026-10-19

## Decision

**NOT READY for enterprise/public-safety production.** The repository has a
substantial pilot implementation and useful tested controls. Passing application
tests does not establish deployed security, availability, operational capacity,
or field AI accuracy. No production deployment, commit, or push was performed
as part of this review.

Scope: authentication/session handling, role boundaries, PostgreSQL persistence,
ERSS dispatch, CCTNS, evidence/camera safeguards, browser state, dependencies,
deployment configuration, CI, and the existing recovery/monitoring documentation.
This is a code and automated-test review, not an independent penetration test.

## Confirmed defects corrected

| Area | Defect and correction |
| --- | --- |
| ERSS persistence | Event saves rewrote a full request snapshot, including unrelated collections. Saves now upsert only changed ERSS/incident/unit/audit/timeline records, preserve concurrent unrelated data, and reject stale changes with HTTP 409 under the shared persistence lock. JSON and actual isolated PostgreSQL tests cover preservation and conflicts. |
| ERSS routing | Imports referenced unavailable routing/normalization functions. Jurisdiction and recommendations now use the actual route and distance helpers, accepting both supported coordinate shapes. |
| ERSS route degradation | A missing road route generated an estimated time from straight-line distance. It now reports unavailable ETA; the UI handles the missing value. |
| ERSS dispatch | Acceptance could replace a unit's other incident assignment. It now rejects a busy conflicting unit before changing the request. |
| Workflow confirmation | ERSS forwarding and CCTNS linking accepted truthy non-boolean confirmation. Both now require literal JSON `true`. CCTNS also validates a bounded text verification reason. |
| ERSS live updates | Events could be broadcast before a successful save. Request-scoped events now publish only after the handler successfully saves; failed saves discard them. |
| AI authentication | Backend startup accepted the insecure development opt-in in production. Production now rejects this configuration. |
| CCTNS authorization/input | Direct service access now rejects non-operational roles even if station metadata is present. Malformed, fractional, non-finite and oversized pagination/filter inputs are rejected. Unsupported nonempty search text does not become a full-record search. |
| CCTNS browser state | Detail requests now ignore stale successes/failures. Operator changes and logout clear private workspace state and invalidate outstanding requests. Link submissions prevent duplicate submits and ignore late updates for another operator/selection. |
| CCTNS usability | Server pagination has corresponding page controls. Search focus and mobile filter expansion survive refreshes; selected-record headings can receive keyboard focus. |
| Python/CI | Upgraded PyTorch to 2.14.1 CPU, torchvision to 0.29.1 CPU, FastAPI to 0.146.0, Starlette to 1.9.0, and python-dotenv to 1.2.4. Docker pins match. The post-upgrade scan reports no known advisories. A Python 3.11 AI test/audit job now gates the existing `verify` job. The audit includes official CPU wheels using their upstream release version; it does not skip torch. |

## Verification

| Check | Result |
| --- | --- |
| `npm test` | PASS after identity remediation: 438 backend tests and 81 frontend tests; backend runner used an isolated PostgreSQL schema. |
| Final ERSS compatibility check | PASS: 9 focused tests after retaining the existing idle-unit acceptance behavior. |
| ERSS PostgreSQL isolation | PASS: concurrent inserts survive and stale updates fail with 409. Included in the full backend run. |
| `npm run check` | PASS: 215 JavaScript files. |
| `npm run frontend:build` | PASS. The approximately 507 kB JavaScript bundle remains a performance consideration, not a failed build. |
| JavaScript dependency audits | PASS: root and frontend full audits, backend production audit; no reported advisories at review time. |
| AI tests / dependency consistency | Post-upgrade: 17 Python tests and `pip check` PASS. A real local YOLOv8n CPU inference on a blank 320×320 frame PASS: one result, zero detections. This is a compatibility check, not an accuracy evaluation. |
| Linux wheel availability | PASS: official CPU wheels resolve for Linux x86-64/Python 3.11. This does not replace building and testing the Docker image. |
| `git diff --check` / workflow syntax | PASS. Workflow YAML parses and `verify` depends on the AI validation job. Remote execution is pending. |
| Python advisory scan | Original environment: 20 advisory entries across python-dotenv, Starlette and PyTorch, including repeated identifiers. Post-upgrade installed-package audit: PASS, no known advisories. The scan normalizes only official torch/torchvision `+cpu` suffixes and audits every installed distribution. |
| Docker browser/release matrix | NOT VERIFIED: Docker Desktop remains in `starting` state and its engine times out. Earlier partial runs do not establish a final passing release. |
| Docker PostgreSQL TLS, paired recovery and load suites | NOT VERIFIED for this change. Scripts exist; actual deployment/scale acceptance remains required. |
| GitHub checks and branch protection | NOT VERIFIED against a newly pushed revision. Workflow configuration alone does not prove remote branch policy. |

## Remaining launch blockers

1. **Release evidence:** obtain a healthy Docker environment and pass the complete
   browser matrix, TLS, backup/recovery and operational-load suites. Build the
   updated Python 3.11 image and verify the resulting candidate. Then verify CI
   on the exact pushed revision. No early commit/push while required gates fail.
2. **Identity:** configure and live-test the Google Workspace adapter and enforce
   the organization's 2-Step Verification policy. Account session inventory,
   remote revocation, optional Workspace-only operator access and periodic live
   socket revalidation are now implemented. Validate privileged-access and
   offboarding/recovery procedures; automatic directory lifecycle synchronization
   is not implemented. See [Google Workspace setup](GOOGLE_WORKSPACE_SSO.md).
3. **Hosting and availability:** supply managed TLS ingress/WAF, private networks,
   secret management, verified database TLS and HA/PITR, resource limits, durable
   storage, immutable image promotion, and tested rollout/rollback. Compose is a
   pilot configuration, not evidence of these controls. Fully lock/hash Python
   transitive dependencies for reproducible promotion; direct pins alone do not
   provide a complete cross-platform dependency lock.
4. **Recovery and evidence:** approve RPO/RTO and test production-scale restores,
   encrypted off-site backups, retention/legal holds, malware scanning, privacy
   and jurisdiction rules, and an external immutable audit archive. Local private
   files and checksums are useful controls but do not complete these gates.
5. **Monitoring:** connect central logs/metrics/traces, external availability
   checks, durable alert delivery and an on-call owner; complete an alert drill.
6. **AI acceptance:** approve model provenance/digest and representative operating
   data, per-class error thresholds, target-hardware throughput, shadow mode,
   drift monitoring and rollback. Dependency/inference checks do not establish
   recognition accuracy. Review any remaining upstream advisory before release.
7. **Capacity/security acceptance:** benchmark the full-snapshot reads and shared
   persistence lock at the intended camera/operator/event volume; validate the
   production authorization matrix and connected-session revocation behavior in
   staging. This review does not certify arbitrary multi-replica scaling.
8. **Integration boundary:** CCTNS remains explicitly simulated. Any real
   government/provider integration requires its own authorized adapter, access
   agreement and acceptance testing.

See also [the production gate register](../PRODUCTION_READINESS.md) and
[deployment boundary](../PRODUCTION_SETUP.md).

## Files changed by this review

- `backend/services/core.service.js`, `backend/controllers/erss.controller.js`,
  `backend/services/erss.service.js`, `backend/services/realtimeEvents.service.js`:
  ERSS persistence, dispatch, routing and event corrections.
- `backend/server.js`, `backend/services/cctns.service.js`:
  production AI startup policy and CCTNS confirmation/input/role checks.
- `frontend/src/components/CctnsWorkspace.js`, `frontend/src/app.js`:
  private-state isolation, async results, pagination/focus and degraded ETA UI.
- Backend/frontend regression tests and the new
  `backend/tests/erss-postgres-isolation.test.js` cover these changes.
- `ai-service/requirements.txt`, `ai-service/Dockerfile`,
  `ai-service/tests/test_dependency_audit.py`, `scripts/audit-ai-dependencies.py`,
  `.github/workflows/release-checks.yml`: Python remediation and CI advisory gate.

The working tree also contains the previously implemented CCTNS feature. This
review preserved that unfinished work rather than resetting or staging it.

## Identity remediation follow-up

The user selected Google Workspace/Cloud Identity and asked to wait on the
hosting decision. Application-side work now includes the verified Google OIDC
adapter, approved-account/role binding, client-visible session management,
shared session revocation, live socket checks and access-log query redaction.
No Google/cloud resources or policies were changed. Real OAuth credentials,
domain configuration, tenant MFA enforcement and deployment acceptance are still
needed. See [the setup and acceptance guide](GOOGLE_WORKSPACE_SSO.md).

Follow-up validation: all 115 security-access tests passed, including private
session inventory, cross-user revocation denial, session rotation, approved
Google role/subject binding, and real Socket.IO revocation. The isolated
PostgreSQL live-event test passed after closing the authenticated-subscription
gap. Google protocol tests cover state, nonce, PKCE, hosted-domain and token
audience boundaries with a mocked provider exchange. Live Google and Nginx
container acceptance remain pending; no claim of tenant MFA enforcement is made.

Identity files: `backend/services/googleWorkspace.service.js`,
`backend/controllers/googleWorkspace.controller.js`,
`backend/services/socketSession.service.js`, existing auth routes/controller,
core session issuance, backend package/lock files and `.env.example`,
`frontend/src/components/AccountSessions.js`, application/login wiring,
`frontend/nginx.conf`, and dedicated Google/session/browser tests.
