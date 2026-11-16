# Secure Media Gateway

RakshakAI's gateway keeps the RTSP lifecycle outside the browser and outside the AI model service:

`registered RTSP camera -> FFmpeg gateway -> sampled JPEG -> authenticated AI service -> AI observation -> human review -> alert -> verified alert -> incident`

The gateway supports up to three enabled streams by default. It uses bounded exponential reconnects, detects connected streams that stop producing frames, samples at the camera's configured interval, and keeps at most one newer sample while AI is busy. Stale samples are dropped and counted.

## Configuration

1. Install FFmpeg or use the backend container, which includes it.
2. Set `CAMERA_CREDENTIAL_ENCRYPTION_KEY` and the authenticated `AI_SERVICE_URL` / `AI_SERVICE_API_KEY` pair.
3. Restrict camera hosts with `CAMERA_NETWORK_ALLOWLIST`. Private camera-network addresses and `.local`, `.lan`, or `.internal` names are accepted by default. Loopback is opt-in outside tests.
4. Register the camera as Admin, save the backend-only RTSP URL/credentials, enable stream processing and AI, then start the gateway from CCTV Monitoring.

The normal camera-source API returns only booleans such as `hasStreamConfig` and `hasCredentials`. RTSP URLs, usernames, passwords, encrypted envelopes, and AI keys are never returned.

## Controlled local verification

For a local RTSP simulator, set `CAMERA_ALLOW_LOOPBACK=true` and register its `rtsp://127.0.0.1:<port>/<path>` endpoint. The automated gateway tests use an explicit in-process simulator/fake connector and mock AI response; they do not claim that CI ran a real YOLO model or a field CCTV camera.

An observation frame is retained only when a supported detection creates a review item. It is stored through the controlled evidence-object storage path and served only by an authenticated operator endpoint with `no-store` caching. Non-review samples are discarded.

## Operational boundaries

- Supported baseline labels: person, car, truck, bus, motorcycle, bicycle.
- AI cannot confirm identity, criminal intent, violence, murder, or weapon use.
- AI service failure changes the AI state without marking a healthy stream offline.
- Confirmation creates an alert, never an incident. The existing alert acknowledgement, verification, and conversion workflow remains mandatory.
- Production rollout still requires field-camera validation, network segmentation, retention/governance review, model validation, capacity testing, and security operations approval.
