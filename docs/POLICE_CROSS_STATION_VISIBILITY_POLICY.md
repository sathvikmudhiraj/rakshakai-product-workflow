# Police Cross-Station Incident Visibility — Policy Decision Material

**Status: DECISION PENDING — no code has been changed.** This document records the current behavior with code evidence, the viable options, a recommendation, and the test plan. The product/security owner must pick an option before any authorization change is implemented.

**Date:** 2026-11-09 · **Repo state:** PR #4 head `248a3d5`, release gate green.

## 1. Current behavior (verified against source)

| Surface | Location | Current scoping for Police Officer |
|---|---|---|
| Active incident list `GET /api/incidents`, `/api/incidents/live` | `backend/services/core.service.js:5450` | **Role-only** — sees ALL active incidents, every station |
| Incident history `GET/DELETE /api/incidents/history` | `core.service.js:6825`, `:6834` | **Role-only** — ALL closed/resolved/rejected incidents |
| SLA monitoring `GET /api/sla/monitoring` | `core.service.js:5454-5473` | **Scoped** — own station refs + jurisdiction; 403 if neither registered |
| Video evidence access | `core.service.js:3594` (`canAccessVideoEvidence`) | **Strictest** — only incident investigator or assigned-unit member |
| Socket incident rooms `join_incident_room` | `backend/services/socketIncidentAccess.service.js` | **Role-only + existence** — any officer can join ANY incident's room |
| Unit dispatch | `backend/services/incidentOfficerAssignment.service.js:22` (`assertAssignmentActor`) | Admin always; Police only with `DISPATCHER`/`SUPERVISOR` operational role (approved policy) |

The inconsistency is user-visible: an officer sees every active incident in the operational list, but only their station's incidents in SLA monitoring, and cannot open evidence for incidents they are not assigned to — while still being able to join any incident's real-time room.

## 2. Constraints and context

- **Mutual aid:** emergency coordination legitimately requires cross-station visibility (neighboring-station response, control-room oversight). A blanket lock-down can break real workflows.
- **Data quality:** scoping depends on `stationId` / `jurisdiction` being present and correct on incidents and officer profiles. SLA already fails closed (403) when an officer has neither. Demo/seed records frequently lack station metadata; any scoping must define behavior for records without it (currently SLA hides such records from scoped officers).
- **Approved precedent:** dispatch authorization already keys off `operationalRole` (`DISPATCHER`/`SUPERVISOR`), and evidence keys off assignment. Building on these two mechanisms keeps the model coherent.
- **UX dependency:** the evidence-upload incident dropdown currently lists incidents the officer cannot attach evidence to (server correctly 403s). Whatever policy is chosen, list surfaces should reflect accessibility.

## 3. Options

| Option | Description | Pros | Cons |
|---|---|---|---|
| **A. Status quo** | Role-only visibility on list/history/sockets | Simple; supports mutual aid; no migration | Over-exposure vs need-to-know; internally inconsistent with SLA/evidence; unacceptable for real deployments handling personal data |
| **B. Station/jurisdiction everywhere** | Mirror the SLA filter onto list, history, sockets | Consistent; least privilege | Breaks mutual aid and control-room use; hides incidents with missing station metadata; larger UX migration |
| **C. Tiered assignment-first model (recommended)** | Grants = assignment (investigator / unit member) **always visible**, plus: Police Officer → own station + jurisdiction; `DISPATCHER`/`SUPERVISOR` → cross-station read; Admin → unrestricted. Applied uniformly to list, history, socket rooms, evidence, SLA | Aligns with the two already-approved mechanisms; keeps mutual aid via dispatcher/supervisor roles; least surprise; scoped officers keep a coherent view | Requires `operationalRole` to be provisioned deliberately; needs data-quality support (station metadata); test matrix grows |
| **D. Deployment config flag** (`INCIDENT_VISIBILITY_MODE=all\|station`) | Per-environment choice | Pragmatic for pilot vs production | Authorization semantics behind a config knob invite misconfiguration; rejected unless C cannot be adopted |

## 4. Recommendation

Adopt **Option C**, phased:

1. Keep assignment-based access exactly as today (evidence + investigator/unit already correct).
2. Add station+jurisdiction scoping to the **active list** and **history** for Police Officers; `DISPATCHER`/`SUPERVISOR` retain cross-station read; Admin unchanged.
3. Scope **socket incident rooms** with the same rule (a room joins only what the officer could read over HTTP).
4. SLA monitoring keeps its current stricter rule; reconcile any drift (e.g., missing-metadata behavior) with this decision.
5. Fail closed: an officer with no station and no jurisdiction and no assignment gets an empty list (not the world) — matching the SLA endpoint's existing 403 posture, expressed as an empty result + explicit `visibilityScope` field for the UI.
6. Frontend: filter dropdowns/options by the same visibility (fixes the evidence-dropdown note in the readiness report §16.6).

**Explicitly out of scope:** write/escalation permissions (dispatch stays as approved); audit-log visibility; CCTV source visibility.

## 5. Test plan (after the owner picks an option)

Authorization matrix per surface (list, history, socket, evidence, SLA), asserting allow **and** deny for every combination of: role (Admin / Officer / Citizen), station match (yes / no / missing metadata), jurisdiction match (yes / no), assignment (investigator / unit member / none), `operationalRole` (`DISPATCHER` / `SUPERVISOR` / `FIELD` / none). Required regressions: Admin unaffected; dispatcher cross-station read allowed; plain officer denied cross-station list item but allowed on an assigned incident; socket join denied for a room the officer cannot read; no 200→403 flip on any already-denied path (same rule as the dispatch fix).

## 6. Decision

- [ ] Option A — status quo
- [ ] Option B — station scope everywhere
- [x] Option C — tiered assignment-first model *(recommended, awaiting owner approval)*
- [ ] Option D — deployment config flag

**Approved by:** ____________________  **Date:** ____________
