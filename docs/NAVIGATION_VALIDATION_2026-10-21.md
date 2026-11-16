# Navigation validation — 2026-10-21

The current application has 19 sidebar views. The table records browser tests against the current frontend and an isolated JSON fixture with separate Admin, Police and Citizen accounts; it does not represent a PostgreSQL production acceptance test. Every listed page requires an authenticated session. “Yes” means the menu item was clicked and its matching panel was active, and its direct URL subsequently loaded in that role. “No” means restricted by role. “Conditional” means the page requires the specified ERSS operational role; the Police fixture had no ERSS role and those variants were not browser-tested.

| Route | Page | Admin | Police | Citizen | Menu link | Direct URL |
|---|---|---|---|---|---|---|
| `/dashboard` | Dashboard | Yes | Yes | No | Yes | Tested for allowed roles |
| `/incident-command` | Incident Command | Yes | Yes | No | Yes | Tested for allowed roles; Citizen redirected |
| `/unit-assignment` | Unit Assignment | Yes | Yes | No | Yes | Tested for allowed roles; Citizen redirected |
| `/gis` | GIS Monitoring | Yes | Yes | No | Yes | Tested for allowed roles |
| `/cctv` | CCTV Monitoring | Yes | Yes | No | Yes | Tested for allowed roles; Citizen redirected |
| `/rakshak/live-vision` | Live Vision | Yes | Yes | No | Yes | Tested for allowed roles |
| `/video-evidence` | Video Evidence | Yes | Yes | No | Yes | Tested for allowed roles; Citizen redirected |
| `/multi-camera-tracking` | Multi-Camera Tracking | Yes | Yes | No | Yes | Tested for allowed roles |
| `/cctns` | CCTNS Records | Yes | Yes | No | Yes | Tested for allowed roles |
| `/missing` | Missing Persons / My Reports | Yes | Yes | Yes | Yes | Tested for all roles |
| `/alerts` | Alerts | Yes | Yes | No | Yes | Tested for allowed roles |
| `/history` | History | Yes | Yes | No | Yes | Tested for allowed roles |
| `/police-management` | Police Management | Yes | No | No | Yes | Admin tested; Police and Citizen redirected |
| `/settings` | Settings | Yes | No | No | Yes | Admin tested; Police and Citizen redirected |
| `/erss-call-taker` | Call Taker | Yes | Conditional: CALL_TAKER | No | Yes | Admin tested |
| `/erss-dispatcher` | Dispatcher | Yes | Conditional: DISPATCHER | No | Yes | Admin tested |
| `/erss-assistance` | Inter-Station Assistance | Yes | Conditional: DISPATCHER or SUPERVISOR | No | Yes | Admin tested |
| `/erss-supervisor` | Supervisor Queue | Yes | Conditional: SUPERVISOR | No | Yes | Admin tested; Police fixture redirected |
| `/erss-field` | Field Assignments | Yes | Conditional: FIELD_OFFICER | No | Yes | Admin tested |

Camera Health and AI Review are CCTV tabs; Copilot and Notifications are overlay controls, not separate sidebar routes. The settings sections use `#settings/<section>`. The code does not currently define parameterized frontend incident, evidence, report, or camera URLs; selections remain in page state. Unknown frontend paths safely return to the role landing page rather than showing a dedicated 404 page.

Browser checks exercised role landing, each visible sidebar item, direct URLs above, Admin and Police GIS refresh, a Citizen restricted direct URL and restricted APIs, logout followed by browser Back, Admin Back/Forward, unknown route fallback, and sidebar group open/close at 1440, 768 and 390 pixels. On a synthetic evidence-image observation with null camera ID, the review queue showed the evidence source and the notification opened its matching evidence. Its evidence card showed one pending observation and provided a link back to the review queue. These checks did not exhaustively traverse every dashboard shortcut, notification entity type, parameterized API ID, or ERSS operational-role variant.

## PostgreSQL runtime follow-up

The rebuilt frontend and backend were healthy. An Admin login through the frontend proxy and an authenticated incidents request both returned 200. Separate live API logins succeeded for Admin, Police and Citizen. Admin could read the tested operational and ERSS endpoints; Police could read incidents, cameras, observations, evidence, reports and ERSS events but received 403 for police administration, audit and the supervisor queue; Citizen received 403 for those operational endpoints and 200 for their reports endpoint. Logout invalidated all three tested sessions.

Against a synthetic assigned incident and evidence, Admin and the assigned Police user received 200 for the incident, evidence preview, analysis and observation; Citizen received 403. Missing and malformed incident and observation IDs returned 404 to authorized operators, and missing evidence previews returned 404 to Admin and 403 to non-admin users. The preview denial intentionally matches the response for unauthorized evidence so that non-admin users cannot distinguish its existence. The API does not consistently return a dedicated 400 for malformed IDs.

These are HTTP checks, not a live PostgreSQL-backed browser traversal. The browser automation surface was unavailable for the follow-up, so the live sidebar, direct-route/history, responsive, shortcut and notification matrices remain unverified. The earlier isolated browser results above must not be presented as PostgreSQL sign-off.
