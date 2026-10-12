# RTSP AI Media Gateway Validation

**Date:** October 13, 2026 (Asia/Calcutta)  
**Scope:** Project-scope validation with a controlled RTSP test stream and real local YOLO inference  
**Physical CCTV:** Not tested; physical-camera field validation remains a separate gate

## Environment

- Python 3.13.1 isolated in `ai-service/.venv`
- Pinned dependencies installed from `ai-service/requirements.txt`
- AI authentication enabled with a temporary local API key; insecure mode disabled
- Local model: `ai-service/yolov8n.pt`
- Model SHA-256: `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36`
- AI device: CPU
- RTSP server: MediaMTX 1.21.2 in a temporary Docker container
- RTSP publisher: FFmpeg 7.1 Alpine container looping the public Ultralytics bus test image at 25 FPS
- Gateway decoder: portable FFmpeg 9.0.2 outside the repository
- Test camera label: `TEST / SIMULATED RTSP - BUS` / `TEST-RTSP-01`

No model download occurred at runtime. The weights, temporary JPEG, evidence objects,
runtime database, API key, logs, and container state were not added to Git.

## Results

| Validation | Result | Evidence |
|---|---|---|
| AI-service regression | Pass | 15 unittest cases passed, including authentication, fail-closed behavior, image validation, missing weights, SHA validation, and remote URL rejection |
| Model integrity and health | Pass | Configured SHA matched the local file; `/health` reported `modelLoaded: true`, `modelName: yolov8n.pt`, `device: cpu` |
| Direct real inference | Pass | Public bus JPEG returned one bus and three person detections; measured inference was 249.7 ms |
| RTSP ingest | Pass | MediaMTX reported one H.264 publisher; gateway transitioned `CONNECTING -> STREAMING` |
| Real RTSP to real YOLO | Pass | FFmpeg-decoded JPEG frames reached the authenticated AI service and returned real bus/person detections |
| Gateway telemetry | Pass | Live `lastConnectedAt`, `lastFrameAt`, `frameAgeMs`, FPS, latency, reconnect count, and health timestamps were observed |
| Sampling | Pass | At a 1,000 ms interval, 28 decoded frames produced five sampled frames and five AI requests |
| Backpressure | Pass | A temporary 700 ms forwarding delay retained real YOLO inference; 94 sampled frames produced 39 AI requests and 93 stale-sample replacements with only one pending frame slot |
| Observation | Pass | Real detections created `PENDING_REVIEW` observations with a stored JPEG preview; no direct incident was created |
| Confirm | Pass | Confirmation created a normal alert only |
| Alert lifecycle | Pass | Acknowledge, verify, and convert created a linked incident retaining `sourceCameraId`, `sourceObservationId`, and `sourceAlertId` |
| Reject | Pass | A separate observation became `REJECTED` with no alert or incident |
| Uncertain | Pass | A separate observation became `UNCERTAIN` with no alert or incident and remains eligible for later review |
| AI outage isolation | Pass | With AI stopped, sampled states showed `AI_UNAVAILABLE` while stream state stayed `STREAMING` and gateway health stayed `HEALTHY`; inference recovered after AI restart |
| Missing frames | Pass | Pausing the publisher produced `NO_FRAMES`, `DEGRADED`, and a deduplicated `camera_no_frames` notification |
| RTSP outage and recovery | Pass | Sustained outage reached bounded `OFFLINE`; a second run returned from `RECONNECTING` to `STREAMING` automatically when the publisher resumed before retry exhaustion |
| Notifications | Pass | AI-unavailable, no-frames, and pending-review notifications were deduplicated and resolved authoritative camera/observation details |
| Secret hygiene | Pass | Camera, gateway, observation, notification, and audit responses contained no RTSP URL, encrypted envelope, API-key value, password, stream URL, or token fields |
| RBAC | Pass | Admin start/stop 200; Police health/review 200 and stream start 403; Citizen restricted endpoints 403; unauthenticated endpoints 401 |
| Stale worker regression | Pass | Targeted test proves callbacks from a replaced worker cannot alter the current stream |
| Out-of-order dedupe regression | Pass | Targeted test proves frames outside either side of the dedupe window do not merge incorrectly |

## Regression Summary

- AI service: 15 passed
- Targeted media gateway: 17 passed
- Backend: 400 passed
- Frontend: 71 passed
- JavaScript syntax: 185 files passed
- Production frontend build: passed
- `git diff --check`: passed before commit

## Accurate Completion Boundary

Real/test RTSP ingest with real AI-assisted detection and mandatory human review is
implemented and verified for project scope. This is not a field-certified CCTV
system, a production police deployment, or evidence that physical cameras have been
validated. Physical-camera networking, credentials, codecs, NVR behavior, load,
retention, and site reliability require separate field validation.

The interactive browser surface was unavailable to the validation agent. UI behavior
was therefore verified by the 71-test frontend suite, including the advisory language,
camera/timestamp/snapshot/detection/confidence/health fields, Confirm/Reject/Uncertain
actions, notification navigation, responsiveness, and role gating.
