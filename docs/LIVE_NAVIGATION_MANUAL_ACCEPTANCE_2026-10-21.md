# Live navigation acceptance checklist

Use the rebuilt local frontend at `http://localhost:3000` with the running PostgreSQL-backed backend and the authorized demo accounts. Wait for any HTTP 429 rate-limit window to expire before starting. Do not change permissions, create incidents, submit reports, or modify evidence during this checklist. Record the browser, viewport, date, unexpected console exceptions, failed requests, unexpected 4xx/5xx responses, and redirect loops. Expected RBAC denials are not failures.

The application uses sidebar and page state for object selection; it does not expose parameterized frontend incident, evidence, report, or camera paths. Notifications and Copilot are overlays. In each row, write the observed route and result in **Actual result**, and mark **Pass/Fail** only after exercising the running application.

| Role | Start page | Action | Expected route | Expected result | Actual result | Pass/Fail |
|---|---|---|---|---|---|---|
| Admin | Sign in | Sign in with the authorized Admin demo account | `/dashboard` | Dashboard loads without an exception | Pending | Pending |
| Admin | Dashboard | Open each of the 19 sidebar views listed below; click, refresh, Back and Forward | Matching view route | Correct page and active navigation; data or legitimate empty state | Pending | Pending |
| Police | Sign in | Sign in; open every visible sidebar view, refreshing and using Back/Forward | Matching allowed route | Correct page and active navigation | Pending | Pending |
| Police | Dashboard | Open `/settings`, `/police-management`, and `/erss-supervisor` directly | Role landing or denied view | No restricted content; corresponding admin APIs deny access | Pending | Pending |
| Citizen | Sign in | Open landing, reports, own report details and available notifications | `/missing` | Own information only | Pending | Pending |
| Citizen | Reports | Directly open `/cctv`, `/unit-assignment`, `/video-evidence`, `/settings`, `/history`, and ERSS routes | Role landing or denied view | No operational data appears, including briefly during redirect | Pending | Pending |
| Admin and Police | Dashboard | Navigate Dashboard → Incident Command → CCTV → Video Evidence; open Notifications, then Back twice, Forward, and refresh | Current allowed view | View, URL and selected sidebar remain synchronized; no stale content or loop | Pending | Pending |
| Each role | Signed in | Open an allowed page directly in a new tab; open a restricted page directly; refresh each | Allowed route or role landing | Allowed view restores; restricted view is denied | Pending | Pending |
| Admin and Police | Dashboard | Exercise every visible KPI, quick action, View All and incident, alert, camera, evidence, unit, GIS and notification shortcut | Destination indicated by control | Each enabled control opens its intended authorized destination | Pending | Pending |
| Each applicable role | Notifications | Open each available incident, report, camera, tracking, SLA and evidence/observation notification; try a missing or unauthorized object only if a safe test fixture already exists | Matching authorized context | Correct destination or safe unavailable/denied state, without metadata leak | Pending | Pending |
| Admin or assigned Police | Evidence observation notification | Open an existing `evidence_image` observation whose `camera_id` is null; follow its review link | Evidence context, then observation queue | Evidence source is shown; no camera navigation or null-camera exception | Pending | Pending |
| Admin | ERSS menu | Open each ERSS page | Matching ERSS route | Pages permitted by Admin role render | Pending | Pending |
| Police | ERSS menu | Open permitted ERSS pages and the supervisor route directly | Allowed route or role landing | Existing ERSS role restrictions apply; supervisor queue denied if not authorized | Pending | Pending |
| Citizen | Reports | Open an ERSS operational route directly | Role landing or denied view | Access denied without operational data | Pending | Pending |
| Each role | Allowed page | At desktop, tablet and mobile widths, open and close the menu and groups; navigate, Back/Forward and sign out | Matching view, then login | Controls remain operable and content reachable | Pending | Pending |
| Each role | Signed in | Open `/random-invalid-route` and `/not-a-real-admin-page` | Role landing | Safe, consistent fallback without a loop | Pending | Pending |
| Each role | Allowed page | Sign out, then use browser Back | Login | No protected data becomes visible | Pending | Pending |

The Admin sidebar routes are `/dashboard`, `/incident-command`, `/unit-assignment`, `/gis`, `/cctv`, `/rakshak/live-vision`, `/video-evidence`, `/multi-camera-tracking`, `/cctns`, `/missing`, `/alerts`, `/history`, `/police-management`, `/settings`, `/erss-call-taker`, `/erss-dispatcher`, `/erss-assistance`, `/erss-supervisor`, and `/erss-field`. Police visibility for ERSS entries depends on the account's ERSS role; record the actual visible entries rather than assuming all are available.

**Automated supporting checks:** frontend and RBAC tests plus the isolated critical-UX browser fixture. **Live manual browser acceptance: PENDING.** The latest live Playwright attempt was blocked at login by the running application's 429 rate limit; it did not exercise the sidebar or other browser flows.
