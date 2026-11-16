# RakshakAI production gap audit

> **2026-11-10 release update:** Sections A–N below are the dated 2026-11-09 audit snapshot, not a statement of the current branch head. Since that inspection, remote HEAD advanced to `248a3d5ed7c216cf7c933974d1ef254e7f4d85e2`, generated `artifacts/` files were removed from the tracked tree, and GitHub Release checks run #51 (`42633958636`) completed successfully on that commit. A new local commit will need its own CI result. `login.json` still exists in earlier reachable Git history; it is being removed from tracking while preserving the local file, and its credential validity/revocation remains unresolved. The GoCardless alert metadata and production field gates remain unresolved. This update does not convert the pilot or production verdict to GO.

**Assessment:** 2026-11-09 · **Mode:** strict read-only inspection of application, configuration, Git, existing test evidence, and authorized GitHub metadata. This document is the only file created by this audit. No application test, database connection, migration, Docker operation, credential operation, commit, push, or deployment was performed for this report.

## A. Executive summary

**Overall: NO-GO for a public-safety deployment.** The repository implements substantial incident, dispatch, role, GIS, AI ingestion, and operational features. Existing reports describe successful isolated tests on the current *local worktree*. They do not establish a passing release gate on the current PR commit or prove field readiness. The latest GitHub Release checks run for the PR head failed at `npm run test:release`; the exact job error was inaccessible. The committed integration fixture has a source-backed policy mismatch that plausibly explains the failure, and a local, uncommitted test change addresses it. This is a hypothesis, not a verified CI log diagnosis.

Two credential investigations remain open: a credential-shaped `login.json` is tracked in the PR, and the original GitHub GoCardless secret-scanning alert metadata could not be retrieved. Neither value is reproduced here. A small AI smoke evaluation recorded person recall of 0.10 at its default threshold; it explicitly does not qualify the model for a pilot. Real cameras, regional road routing, emergency-service integration, staging rollback, and operational approvals remain unverified.

**Evidence rule:** “Verified” below refers to directly inspected source, Git metadata, GitHub run state, or a cited existing test report within its stated scope. This audit did not rerun tests. Prior reports are evidence of earlier sessions, not a fresh independent result and not proof that the same code is in PR #4.

## B. Exact codebase, release, and evidence boundary

| Item | Observed state |
| --- | --- |
| Repository / branch | `sathvikmudhiraj/rakshakai-product-workflow` / `bug-fix-of-mvp` |
| Assessed HEAD | `5db536e7b6ca2759eaeddd17c2ecae1d8e212963` |
| PR | #4, open draft, unmerged; base `main` at `f6d5eea95044fd8b03501cabf728f0e7fba24d63` |
| PR scale | 44 commits; GitHub reports 1,205 files changed, 73,984 additions, 1,852 deletions |
| Worktree before this report | 22 modified tracked files, 6 untracked files, 0 staged files; 732 tracked insertions and 127 deletions, excluding untracked files |
| Current GitHub release run | “Release checks” #50, ID `42590173650`: AI service job passed; `verify` failed at `npm run test:release`; dependent `release-gate` failed. Earlier build, unit, audits, and critical UX steps passed in that run. The underlying failure log was unavailable through the connector. |
| Branch protection | GitHub connector returned 403 for live protection settings; earlier documentation's required-check claim is **NOT VERIFIED** here. |

All current local modifications and untracked files predate this document and were preserved. The local fix is absent from the assessed PR head until the owner reviews and publishes it. `docs/RAKSHAKAI_MASTER_READINESS_REPORT.md` contains an appended later isolated-runtime verification section; its earlier “Docker unavailable” passage describes a different session. Treat its test claims as reported prior evidence, not as a current CI result. The current application ports 3001, 5000, and 5432 had no listener when inspected; port 8000 had a listener whose identity was not established. Current Docker runtime health was not established. No live application or database probe was attempted.

## C. Completed or verified functionality

| Area | Status | Evidence and scope |
| --- | --- | --- |
| Role and session controls | **IMPLEMENTED AND VERIFIED in source and prior focused tests** | Login and password-change throttles default to 10; global API throttle defaults to 600; signed `HttpOnly`, `SameSite=Strict` session cookies use `Secure` in production. Origin checks and Helmet are configured. See `backend/routes/auth.routes.js`, `backend/server.js`, and `backend/services/core.service.js`. No threshold was changed. |
| Incident and dispatch persistence | **IMPLEMENTED BUT NOT VERIFIED in this audit** | PostgreSQL transactions and advisory locking are present in `backend/services/postgres.service.js`; incident/assignment services and migration series 001–030 exist. Earlier isolated PostgreSQL testing is reported in the master readiness report §16. No operational Neon writes or read check were run here. |
| Dispatcher assignment authorization | **IMPLEMENTED AND VERIFIED in source** | `backend/services/incidentOfficerAssignment.service.js` permits Admin or Police with `DISPATCHER`/`SUPERVISOR` operational role, otherwise 403. The seeded test officer has `DISPATCHER` role in `backend/data/db.example.json`. |
| GIS road routing and fallback | **PARTIALLY IMPLEMENTED** | `backend/services/core.service.js` validates OSRM route geometry and endpoints, ranks road routes, and falls back to an explicitly approximate straight-line route if routing fails. The local OSRM service is behind an optional Compose profile; regional data and production route acceptance are unverified. |
| AI RTSP inference path | **IMPLEMENTED AND VERIFIED on a controlled test stream only** | `backend/services/mediaGateway.service.js` uses FFmpeg to decode RTSP frames for inference. `docs/RTSP_AI_GATEWAY_VALIDATION.md` records a synthetic RTSP stream through the model and human review. No physical CCTV or sustained field video was tested. |
| AI model loading | **IMPLEMENTED BUT NOT FIELD VERIFIED** | `ai-service/main.py` loads local YOLOv8n weights, supports model hash validation and health reporting. The evaluation in `docs/AI_SCENARIO_EVALUATION_2026-10-20.md` is a small COCO8 smoke test, not a field acceptance study. |
| Copilot/JARVIS controls | **IMPLEMENTED AND VERIFIED at suite level** | `backend/services/copilotConversation.service.js` expires and clears user-scoped state; focused history tests cover TTL/clear. Prior suites report role-scoped reads, badge/location queries, prompt-injection and write-request rejection. Real external model-provider quality and every live UI path are unverified. |
| Local isolated release exercises | **IMPLEMENTED AND REPORTED VERIFIED by a previous session** | Master readiness report §16 records local check, isolated backend 574/574, AI 21/21, release integration 14/14, 45/45 browser scenarios across three browsers/five viewports/three roles, TLS, paired backup/restore, two-replica load, and graceful shutdown. This report did not rerun or independently attest those results. They apply to local changes absent from PR #4. |

## D. Functional and product gaps

| Area | Status | Exact gap / evidence |
| --- | --- | --- |
| “Three nearest eligible units” | **PARTIALLY IMPLEMENTED** | `backend/services/core.service.js` ranks eligible units with a composite route/jurisdiction score and returns the ranked set; `frontend/src/app.js` displays the first **five**. The `.slice(0,3)` in routing code limits OSRM **alternative routes**, not response units. Product policy must define “nearest,” eligibility, tie-breaks, and the count; acceptance testing must reflect that policy. |
| Cross-station access | **PARTIALLY IMPLEMENTED** | Jurisdiction enters dispatch scoring, while some Police incident views are broader than evidence/SLA scope. Explicit cross-station authorization and escalation policy is not settled; see `backend/services/core.service.js` and the prior master report. |
| Browser CCTV playback | **NOT IMPLEMENTED as a verified browser stream** | RTSP ingestion supplies inference frames; `backend/services/core.service.js` explicitly notes that browser playback requires an HLS, WebRTC, or MJPEG proxy. No browser-compatible stream gateway was found in backend/frontend/AI code. |
| Frontend role and accessibility coverage | **IMPLEMENTED BUT NOT FULLY VERIFIED** | Prior 45-case browser matrix is broad but does not prove all routes, keyboard/assistive technology behavior, slow networks, or field devices. Current PR head has not passed its release workflow. |
| External emergency integration | **NOT IMPLEMENTED for a live agency** | `backend/routes/erss.routes.js` and `backend/services/erss.service.js` expose a simulator; a live ERSS-112 agreement, contract, credentials, interface, and end-to-end acceptance are absent. |
| JARVIS provider and operational quality | **NOT TESTED** | Suite-level read restrictions and conversation controls exist; independent provider output quality, multilingual field comprehension, latency under load, and human-use acceptance are not established. |

## E. Security and privacy blockers

1. **Potential tracked credential in PR — P0, unresolved.** `login.json` is tracked in HEAD, introduced by commit `5db536e7b6ca2759eaeddd17c2ecae1d8e212963`, and added in PR #4. It has a nonempty `password` field; scripts `scripts/live-ui-features-acceptance.cjs` and `scripts/verify-live-ux-review.cjs` consume it for browser login. Its validity and scope are unproven. Do not expose its contents. Owner must establish whether it is synthetic; if valid, revoke/rotate it, remove it from the PR and any other reachable history as appropriate, and review repository artifacts and logs. `.gitignore` does not exclude this file.
2. **GoCardless alert investigation — P0, PARTIAL / UNVERIFIED.** `docs/GITHUB_SECRET_EXPOSURE_REMEDIATION.md` correctly states that original GitHub alert IDs, exact repository/path/commit/secret type, and blob location were inaccessible through authorized access. A purported live credential must be treated as potentially compromised until the owner obtains alert metadata and revocation evidence. No alert is dismissed as false positive here. Do not introduce blanket `artifacts/**` secret-scan exclusions.
3. **Artifact exposure review — P1.** 843 tracked `artifacts/**` files were added relative to `origin/main`; the PR changes 1,205 files overall. Inspect each sensitive artifact class, especially browser traces, auth state, media, and logs, with tooling that never prints secret values. Keep scanning active for artifacts. The current inventory is a review gate, not proof of a leak in every artifact.
4. **Identity and privacy — P1.** Local role/session controls exist, but production SSO/MFA, account lifecycle, consent/privacy retention, video access audit, jurisdiction approvals, and organization-specific permissions require operational evidence. Test accounts and demo footage must not be used as production authority.
5. **CCTV and evidence — P1.** Production camera URLs/credentials require managed secrets and access logs. Evidence has filesystem storage and checksum/custody controls (`backend/services/evidenceStorage.service.js` and migrations), but object-store durability, retention/legal hold, malware handling, deletion policy, and access reviews are unverified.

No passwords, API keys, tokens, full connection strings, or secret bytes are included in this report.

## F. Environment, database, and infrastructure

| Component | Status | Evidence / production gap |
| --- | --- | --- |
| Local backend database setting | **IMPLEMENTED BUT NOT RECHECKED** | `backend/.env` has `DATABASE_URL` classified by host as Neon; only key names and host class were inspected. Earlier `docs/ENV_CONFIGURATION_FINAL_REPORT.md` reports a read-only `SELECT 1` pass after the password helper. This audit did not connect. Remote TLS verification is default in `backend/services/postgres.service.js`. |
| Compose database separation | **IMPLEMENTED AND VERIFIED statically** | `compose.yaml` constructs a local `postgres` URL for the backend and disables SSL for that local link. It does not substitute the host's Neon URL into the container by default. Local PostgreSQL data/volumes were untouched. |
| Environment inventory | **PARTIALLY VERIFIED** | Root `.env` absent; `.env.docker`, `backend/.env`, `frontend/.env`, `ai-service/.env`, and root/service `.env.example` templates are present. Inspected files had no duplicate key names. `frontend/.env` carries `VITE_API_BASE_URL` only; no private key was observed in that file. Value correctness for a future production origin/secret manager is deployment-specific. Do not assume local files represent staging or production secrets. |
| Production registration and CORS | **PARTIALLY IMPLEMENTED** | `compose.prod.yaml` requires an explicit citizen-registration choice and production CORS/origin values. Authentication limits remain as coded. Validate against the actual HTTPS origin and policy during staging. |
| Routing | **BLOCKED for field acceptance** | OSRM is an optional Compose profile in `compose.yaml`; regional road data, profile activation, route health, GPS freshness, and fallback behavior need a deployment proof. |
| Network/TLS | **PARTIALLY IMPLEMENTED** | Production Compose overlay exposes frontend port 80/8080; TLS/WAF/ingress must be supplied and tested externally. Container images use nonroot users and Nginx headers, but no production edge, network isolation, resource sizing, or multi-instance socket adapter is established by Compose alone. |
| Storage and recovery | **PARTIALLY VERIFIED** | Existing isolated paired PostgreSQL/evidence backup-and-restore drill is reported in master §16. Live HA, PITR, replication, recovery point/time objectives, offsite copy, object storage, and actual staging restoration are unverified. Backend startup currently runs migration/import commands; a controlled deployment migration job needs review. |
| Observability and operations | **PARTIALLY IMPLEMENTED** | Existing health/load/shutdown checks and runbooks provide a foundation. Production alerts, paging owner, SLOs, audit retention, capacity soak, failover/rollback, and incident drills need staging evidence. |

## G. CI failure: source-backed hypothesis and limits

The current PR head's Release checks run #50 failed in `verify` at `npm run test:release`; `release-gate` then failed. The GitHub connector did not return the failing test's actual log, so the **exact CI error and root cause are NOT VERIFIED**. Source shows a likely mismatch: the committed `backend/integration/release.test.cjs` expects 403 for a Police assignment attempt, while `backend/services/incidentOfficerAssignment.service.js` permits a Police dispatcher and the seeded officer in `backend/data/db.example.json` is a dispatcher. A local, uncommitted test revision uses separate field officer, dispatcher, Admin, citizen, and anonymous cases; the master report §16 says the full release command passes locally after that change. This does not repair the failing GitHub run until changes are reviewed, committed, pushed, and the workflow reruns. The owner should inspect the original job log and match its exact failing assertion before closing the incident.

CI workflow: `.github/workflows/release-checks.yml`. Manual signed-image promotion: `.github/workflows/promote-signed-images.yml`; no successful promotion for the assessed PR was observed. Live branch-protection configuration could not be queried (403); do not treat an older documentation claim as verification.

## H. Uncommitted work, PR scope, and release risk

The 22 modified tracked and six untracked files are not included in HEAD. They cover authentication policy, socket incident authorization, demo-incident filters, notification/SLA behavior, shutdown, Compose production flags, documentation, tests, and browser release tooling. Existing local green checks therefore do not make the PR green. Preserve these changes and review them as a coherent patch set; do not use `git reset`, clean, or force-push as a shortcut. PR #4 also contains the potential credential file and a large artifact set. Review by commit and file category, with secret-safe scanning and a clear provenance record. A mergeable PR state is not evidence of safe release.

## I. Evidence map and important limits

| Claim | Evidence source | Limit |
| --- | --- | --- |
| Current PR/run state | Authorized GitHub PR #4 and Release checks run #50 metadata | Underlying failed step log unavailable; branch protection 403 |
| Current tree/worktree and tracked file exposure | `git rev-parse`, `git status`, `git diff`, `git ls-tree` read-only inspections | Credential validity not tested |
| Local isolated test outcomes | `docs/RAKSHAKAI_MASTER_READINESS_REPORT.md` §16 and linked earlier test documents | Prior session; local uncommitted code; not reproduced in this audit |
| Neon connectivity | `docs/ENV_CONFIGURATION_FINAL_REPORT.md` | Prior read-only check only; no new DB connection |
| RTSP test stream | `docs/RTSP_AI_GATEWAY_VALIDATION.md` | Controlled stream, no physical camera |
| AI quality smoke | `docs/AI_SCENARIO_EVALUATION_2026-10-20.md` | Tiny dataset; person recall 0.10 at default threshold; no vehicle labels |
| Secret alert status | `docs/GITHUB_SECRET_EXPOSURE_REMEDIATION.md` | Original GitHub alert metadata unavailable; classification unresolved |
| Backup/load/shutdown | Master report §16 and operational docs | Isolated local drill, not staging HA/PITR/SLO proof |

## J. Prioritized backlog with acceptance criteria

Effort estimates are engineering working days for implementation/evidence, excluding external agency and procurement lead time. Each item requires a reviewed change and a recorded result before its status can advance.

| Priority / item | Effort / dependency | Acceptance criteria and safe test |
| --- | --- | --- |
| **P0-1: Resolve tracked `login.json` credential** | 1–3 d; account owner + repo security | Owner determines validity without exposing value in chat/logs; any live credential is revoked/rotated; PR and reachable-history exposure addressed under an approved plan; secret scanning remains enabled; review verifies no usable credential is left in the release commit. |
| **P0-2: Resolve original GoCardless alerts** | 1–3 d plus provider lead time; GitHub security access + token owner | Capture each original alert ID, repo, path, line, commit/blob, and type through authorized read-only access; classify by exact bytes without reproducing them in reports; revoke any uncertain live credential and retain provider revocation evidence; do not dismiss without proof. |
| **P0-3: Public-safety AI acceptance** | 5–15 d plus data collection; agency/model owner, approved annotated field data | Predefined per-class recall/precision, false alerts per camera-hour, alert latency, adverse-weather/night/device cohorts, human-review load, bias/privacy criteria, drift and rollback thresholds pass on representative held-out field footage. Record model hash and dataset provenance; no live automatic incident creation without approved human control. |
| **P0-4: Legal/agency authority for operational use** | External; organization/agency owners | Document signed operating authority, privacy basis, CCTV/data-sharing agreements, role and incident jurisdiction rules, retention, emergency escalation, and named incident commander; approve a scoped field protocol before any live pilot. |
| **P1-1: Restore PR release gate** | 1–2 d; P0 credential containment before release | Obtain original run #50 step log; confirm exact failure; review the local dispatcher fixture/policy correction; rerun `npm run test:release` in CI on a reviewed commit; `verify`, `ai-service-checks`, and `release-gate` pass on the same SHA. Confirm live branch protection settings. No auto-commit/push from this audit. |
| **P1-2: Reconcile local work and PR artifacts** | 2–5 d; P0-1/2 | Review every uncommitted change and all 843 tracked artifact paths, especially auth state/traces; retain only justified evidence, document provenance, scan without blanket exclusions, and show reviewable PR diff plus passing gates on the exact release SHA. |
| **P1-3: Define and enforce dispatch/GIS policy** | 3–7 d; product/agency signoff | Approved specification for three nearest eligible units, travel-time vs composite ranking, freshness, cross-station access, fallback, and permission codes; backend and UI agree on three; fixture tests cover dispatcher 200, field officer/citizen/anonymous 403 or 401, concurrent conflict, stale GPS, route outage, and cross-jurisdiction cases. Validate on regional OSRM data. |
| **P1-4: Physical CCTV and authorized browser playback** | 5–10 d plus hardware; camera/network/infra | Approved camera inventory and secret storage; test real RTSP sources across disconnect/reconnect, backpressure and load; deliver authenticated HLS/WebRTC/MJPEG gateway with role checks, audit, retention, and browser test; no direct camera credential exposure to frontend. |
| **P1-5: Durable DB/evidence recovery** | 5–10 d; managed database/object store | Define RPO/RTO; prove encrypted HA/PITR, paired evidence backup, immutable/legal-hold policy, checksum verification, restore on staging, rollback after failed migration, and access/audit review. Preserve production records and volumes. |
| **P1-6: Production edge, scale, and release drill** | 5–10 d; infrastructure | HTTPS/TLS/WAF, origin/CORS, network segmentation, resource limits, health probes, zero-downtime migration procedure, multi-replica socket delivery, signed image digest promotion, rollback, capacity soak, and failure drill pass in controlled staging on the approved release SHA. |
| **P1-7: Identity and incident operations** | 5–10 d plus tenant setup; IAM/agency | SSO/MFA, lifecycle/deprovisioning, least-privilege and cross-station permissions, privileged audit trail, paging/on-call, incident response and privacy breach procedures tested with named owners. |
| **P2-1: Frontend accessibility and resilience** | 3–7 d; P1-1 | On the exact release build, role matrix across supported browsers/viewport classes, keyboard/screen-reader flow, color/contrast, slow/offline/retry, error recovery, and device camera/network limits meet agreed acceptance checks with evidence. |
| **P2-2: Environment and secret delivery** | 2–5 d; P0-1/2 + infra | Deploy through an approved secret manager; validate only required key names/ownership/rotation, Neon vs local PostgreSQL separation, verified DB TLS, exact API/AI URLs, production CORS, explicit citizen-registration choice, and absence of private `VITE_` values. Use a read-only database check only in an authorized staging procedure. |
| **P2-3: JARVIS field usability** | 3–7 d; approved provider and field users | Validate role-scoped answers, badge/location accuracy, multilingual phrasing, TTL/clear, refusal of write requests, prompt injection, latency and audit with representative operators; document human confirmation for consequential actions. |
| **P3-1: Reconcile readiness documents** | 1–2 d; earlier items | Replace stale claims that `login.json` is excluded or that current PR CI passes; link exact run/SHA/evidence date; separate local test reports from staging and production approvals. |

## K. Safe implementation sequence

1. Contain and investigate potential credentials (P0-1/2) using the account owners; keep all values out of tickets and logs.
2. Obtain the exact failed CI log; review local changes and artifact inventory; publish only an approved, reviewable patch set. Rerun all release gates on that SHA.
3. Set product/agency policy for unit ranking, jurisdiction, privacy, AI thresholds, and emergency escalation. Implement and test against those signed criteria.
4. Build staging with managed secrets, regional OSRM, physical cameras, browser streaming, HA storage, HTTPS edge, observability, and controlled migration/rollback.
5. Run documented acceptance tests, restore/failure drills, security review, and operational signoffs. Only then consider a controlled field pilot; production requires separate sustained evidence and authority.

## L. Readiness decisions

| Use | Decision | Conditions / remaining evidence |
| --- | --- | --- |
| Portfolio or local demo with synthetic data | **CONDITIONAL GO** | Use an isolated nonoperational environment and synthetic accounts/video. First resolve or quarantine the tracked credential exposure and avoid publishing the current PR artifact set as a clean release. Prior local tests support a demo, but no live app check was run here. |
| Controlled staging / public-safety pilot | **NO-GO today** | CI must pass on the release SHA; credential alerts, real camera/route/AI acceptance, privacy/agency rules, staging security, recovery, and rollback need documented proof. |
| Real public-safety production | **NO-GO** | Requires all pilot gates plus independent operational/agency approval, HA/PITR and security controls, field model evidence, emergency integration, support/SLOs, and sustained drills. |

## M. Read-only audit compliance

This audit read source/configuration keys, Git state, existing reports, and authorized GitHub metadata. It did not print or copy secret values, connect to PostgreSQL or Neon, run migrations, start/restart Docker, modify volumes/records, change authentication rate limits, edit application code, or commit/push/merge. The only new file is this report. All existing uncommitted work was preserved.

## N. Next evidence to request from owners

The highest-value missing evidence is the original GitHub secret-scanning alert metadata and provider revocation record; the original Release checks failed-step log; the owner-reviewed status of tracked `login.json`; the reviewed patch and passing workflow on a single release SHA; and approved field/staging test protocols. Until those exist, security and release classifications remain **PARTIAL / UNVERIFIED**.
