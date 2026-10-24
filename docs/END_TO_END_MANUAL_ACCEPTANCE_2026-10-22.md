# Rakshak AI manual browser acceptance — Sathvik

Open http://localhost:3001. Use your existing local demo accounts. Use only records explicitly marked TEST or simulated, never real 112 or an important active incident. Do not make changes when a suitable test record or authorized control is absent; record BLOCKED and the reason. Screen captures must exclude passwords, tokens and personal data.

For **every numbered test**, if it fails, screenshot the named page including the relevant control, result and browser address bar. Optionally inspect DevTools Console and Network and record the error or failed request method, path and status without secrets. Each row below supplies the test number, role, page, action and expected result; this paragraph supplies the requested failure screenshot and optional console/network check for each row.

| # | Role | Page | Action | Expected |
|---|---|---|---|---|
| 01 | Admin | Login | Sign in with the local Admin account. | Admin shell opens. |
| 02 | Admin | Dashboard | Inspect KPIs and open available shortcuts. | Counts reflect current data; shortcuts open their named pages. |
| 03 | Admin | Sidebar | Open each available group and select its pages. | Correct page and active sidebar item appear without blank screens. |
| 04 | Admin | Sidebar pages | Use Back, Forward and Refresh after visiting several pages. | The intended page and selection remain consistent. |
| 05 | Admin | Alerts | Open Alerts and inspect a safe TEST alert. | Correct details and current status display; no automatic conversion. |
| 06 | Admin | Incident Command | Open a safe TEST incident and inspect details and lifecycle. | Details and status match the record; unauthorized transitions are unavailable. |
| 07 | Admin | Police Management | Open the officer directory. | Officers and their actual station, duty and availability are shown. |
| 08 | Admin | Police Management | Open an officer profile. | Unit membership and deployment are identified accurately; completed assignments are not presented as cases solved. |
| 09 | Admin | Settings | Open the police stations section. | Station details and explicit demo/real classification match the record. |
| 10 | Admin | Settings | Open the police units section. | Unit, station, status and telemetry are consistent. |
| 11 | Admin | Police Management / Settings | Compare a test officer's response-unit membership with the unit record. | Both show the same membership. |
| 12 | Admin | Unit Assignment | Inspect a safe test deployment. | Assignment belongs to the unit and matches Incident Command. |
| 13 | Admin | Unit Assignment | Inspect responding members for that unit. | Eligible unit members are shown without claiming individual incident assignment. |
| 14 | Admin | GIS Monitoring | Open the map and select Street Map. | Road map appears with available incident and unit markers. |
| 15 | Admin | GIS Monitoring | Select Set Start and click a safe map point. | Start marker and selected location appear. |
| 16 | Admin | GIS Monitoring | Select Set Destination and click another map point. | Destination marker and selected location appear. |
| 17 | Admin | GIS Monitoring | Calculate Route. | A healthy road provider gives a road route and ETA; if unavailable, degradation and any straight-line estimate are clearly labeled with no fabricated road ETA. |
| 18 | Admin | GIS Monitoring | Clear Destination after calculating a route. | Destination, old route line, distance and ETA clear. |
| 19 | Admin | GIS Monitoring | Switch to Satellite and back to Street Map. | Basemap changes without corrupting route state. |
| 20 | Admin | GIS Monitoring | Use My Location and allow or deny browser permission. | Location or a clear permission error appears; incident location is not silently verified. |
| 21 | Admin | CCTV Monitoring | Inspect camera list and open an available camera. | Authorized details and reported status appear; demo data is not represented as field proof. |
| 22 | Admin | CCTV Monitoring | Inspect available camera health information. | Health and freshness are consistent with the camera details. |
| 23 | Admin | Live Vision | Open Live Vision and inspect an available safe sample or observation. | Detections are presented as observations pending human review. |
| 24 | Admin | CCTV Monitoring | Review a disposable TEST observation if one exists. | The chosen review state persists; no automatic dispatch or confirmed incident occurs. |
| 25 | Admin | Video Evidence | Open an authorized test evidence record and preview it. | Correct evidence details and preview appear. |
| 26 | Admin | Video Evidence / Notifications | Open an evidence-image observation with no camera, if one exists. | It opens the relevant evidence safely without a null-camera error. |
| 27 | Admin | Video Evidence | Re-analyze disposable TEST evidence if permitted. | A new analysis appears or an explicit safe service error is shown. |
| 28 | Admin | Multi-Camera Tracking | Open a test track and inspect any candidate. | Details and review status are clear; candidate is not presented as proven identity. |
| 29 | Admin | Notifications | Open the drawer and an available notification. | Details and related destination match and respect authorization. |
| 30 | Admin | Settings / Incident Command | Inspect SLA settings and a test incident's escalation. | Configured thresholds and actual escalation are consistent; missing values are not invented. |
| 31 | Admin | Call Taker / Dispatcher | With simulated test data only, follow call, triage and dispatcher flow and explicitly confirm any conversion. | The simulated workflow persists and requires human action; no real 112 call is made. |
| 32 | Admin | Copilot | Ask total units, available units, dispatch eligible units, and a question about a selected test incident. | Answers distinguish the categories, use current authorized data and do not mutate records. |
| 33 | Admin | Settings / Audit | Inspect audit logs for an authorized test action. | Relevant action appears without passwords, tokens or keys. |
| 34 | Admin | Settings | Inspect available settings without changing production values. | Current values load and unauthorized options are not exposed. |
| 35 | Admin | Any | Sign out. | Login form appears and session is invalidated. |
| 36 | Admin | Browser | Press Back after sign-out. | Protected content does not reappear. |
| 37 | Police | Login | Sign in with the local Police Officer account. | Police shell opens. |
| 38 | Police | Dashboard | Inspect the dashboard and available shortcuts. | Data is appropriate to the account and shortcuts work. |
| 39 | Police | Dashboard / Unit Assignment | Inspect current unit and deployment, if assigned. | Unit membership and deployment reflect actual records. |
| 40 | Police | Incident Command | Open an assigned TEST incident. | Authorized details match its current unit deployment. |
| 41 | Police | Incident Command | Acknowledge that TEST incident if allowed. | State persists and appears consistently after refresh. |
| 42 | Police | Incident Command | Set the TEST incident En Route if allowed. | Valid transition persists; invalid transitions are rejected. |
| 43 | Police | Incident Command | Set the TEST incident On Scene if allowed. | Valid transition persists and is visible to authorized users. |
| 44 | Police | Video Evidence | Open authorized test evidence and attempt an unassigned record if safely available. | Authorized evidence opens; unassigned metadata is denied. |
| 45 | Police | GIS Monitoring | Open GIS and inspect the assigned unit/incident if available. | Authorized map data and routing degradation are accurately shown. |
| 46 | Police | CCTV Monitoring / Live Vision | Open allowed camera and AI views. | Authorized content appears; restricted controls remain unavailable. |
| 47 | Police | Incident Command | Open an applicable test investigation if assigned. | Authorized details appear, otherwise a safe unavailable state. |
| 48 | Police | Browser | Open /police-management and /settings directly. | Admin-only content is not displayed. |
| 49 | Police | Any | Sign out and press Back. | Login remains visible and protected data stays hidden. |
| 50 | Citizen | Login | Sign in with the local Citizen account. | Citizen shell opens. |
| 51 | Citizen | Missing Persons | Inspect the landing page and available navigation. | Citizen-appropriate features appear without operational data. |
| 52 | Citizen | Missing Persons | Submit a clearly labeled safe TEST report using valid test data. | Validation works and the report is accepted without using real personal data. |
| 53 | Citizen | Missing Persons | Open own report/history and refresh. | The test report is visible to its owner and persists. |
| 54 | Citizen | Notifications | Open an available notification for the test report. | Own details and destination display; if no notification exists record BLOCKED. |
| 55 | Citizen | Browser | Open /police-management directly. | Police Management content is denied or safely redirected. |
| 56 | Citizen | Browser | Open /cctv directly. | CCTV operational content is denied or safely redirected. |
| 57 | Citizen | Browser | Open /unit-assignment directly. | Unit Assignment content is denied or safely redirected. |
| 58 | Citizen | Browser | Open /video-evidence directly. | Restricted evidence content is denied or safely redirected. |
| 59 | Citizen | Browser | Open /erss-call-taker directly. | ERSS operational content is denied or safely redirected. |
| 60 | Citizen | Any | Sign out and press Back. | Login remains visible and protected data stays hidden. |
| 61 | Admin | Desktop | Sign in; at about 1440×900 inspect Dashboard, Incident Command, GIS Monitoring, Unit Assignment, Police Management and Notifications. | Text and controls are visible, reachable and usable without clipping. |
| 62 | Admin | Tablet | At about 768×1024 inspect those same pages and drawer. | Navigation, text and controls remain usable without overlap. |
| 63 | Admin | Mobile | At about 390×844 inspect those same pages and drawer. | Navigation, text and controls remain usable without overlap or inaccessible actions. |

## Copy-paste result template

Mark each PASS, FAIL or BLOCKED. Include the test number for every issue.

```text
TEST 01: PASS/FAIL/BLOCKED
TEST 02: PASS/FAIL/BLOCKED
TEST 03: PASS/FAIL/BLOCKED
TEST 04: PASS/FAIL/BLOCKED
TEST 05: PASS/FAIL/BLOCKED
TEST 06: PASS/FAIL/BLOCKED
TEST 07: PASS/FAIL/BLOCKED
TEST 08: PASS/FAIL/BLOCKED
TEST 09: PASS/FAIL/BLOCKED
TEST 10: PASS/FAIL/BLOCKED
TEST 11: PASS/FAIL/BLOCKED
TEST 12: PASS/FAIL/BLOCKED
TEST 13: PASS/FAIL/BLOCKED
TEST 14: PASS/FAIL/BLOCKED
TEST 15: PASS/FAIL/BLOCKED
TEST 16: PASS/FAIL/BLOCKED
TEST 17: PASS/FAIL/BLOCKED
TEST 18: PASS/FAIL/BLOCKED
TEST 19: PASS/FAIL/BLOCKED
TEST 20: PASS/FAIL/BLOCKED
TEST 21: PASS/FAIL/BLOCKED
TEST 22: PASS/FAIL/BLOCKED
TEST 23: PASS/FAIL/BLOCKED
TEST 24: PASS/FAIL/BLOCKED
TEST 25: PASS/FAIL/BLOCKED
TEST 26: PASS/FAIL/BLOCKED
TEST 27: PASS/FAIL/BLOCKED
TEST 28: PASS/FAIL/BLOCKED
TEST 29: PASS/FAIL/BLOCKED
TEST 30: PASS/FAIL/BLOCKED
TEST 31: PASS/FAIL/BLOCKED
TEST 32: PASS/FAIL/BLOCKED
TEST 33: PASS/FAIL/BLOCKED
TEST 34: PASS/FAIL/BLOCKED
TEST 35: PASS/FAIL/BLOCKED
TEST 36: PASS/FAIL/BLOCKED
TEST 37: PASS/FAIL/BLOCKED
TEST 38: PASS/FAIL/BLOCKED
TEST 39: PASS/FAIL/BLOCKED
TEST 40: PASS/FAIL/BLOCKED
TEST 41: PASS/FAIL/BLOCKED
TEST 42: PASS/FAIL/BLOCKED
TEST 43: PASS/FAIL/BLOCKED
TEST 44: PASS/FAIL/BLOCKED
TEST 45: PASS/FAIL/BLOCKED
TEST 46: PASS/FAIL/BLOCKED
TEST 47: PASS/FAIL/BLOCKED
TEST 48: PASS/FAIL/BLOCKED
TEST 49: PASS/FAIL/BLOCKED
TEST 50: PASS/FAIL/BLOCKED
TEST 51: PASS/FAIL/BLOCKED
TEST 52: PASS/FAIL/BLOCKED
TEST 53: PASS/FAIL/BLOCKED
TEST 54: PASS/FAIL/BLOCKED
TEST 55: PASS/FAIL/BLOCKED
TEST 56: PASS/FAIL/BLOCKED
TEST 57: PASS/FAIL/BLOCKED
TEST 58: PASS/FAIL/BLOCKED
TEST 59: PASS/FAIL/BLOCKED
TEST 60: PASS/FAIL/BLOCKED
TEST 61: PASS/FAIL/BLOCKED
TEST 62: PASS/FAIL/BLOCKED
TEST 63: PASS/FAIL/BLOCKED

TEST NUMBER:
BUG:
EXPECTED:
ACTUAL:
SCREENSHOT: yes/no
CONSOLE ERROR:
NETWORK FAILURE: method + endpoint + status
```
