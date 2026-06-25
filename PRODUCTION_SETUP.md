# RakshakAI Real Service Setup

This local app now supports real-service configuration through `.env`.

## 1. Create `.env`

Copy `.env.example` to `.env`, then fill only the services you have.

```powershell
copy .env.example .env
```

Restart the server after editing `.env`.

```powershell
npm.cmd start
```

## 2. Real CCTV RTSP

Set:

```text
RTSP_CAMERA_URLS=rtsp://user:pass@camera-ip:554/stream1
```

Browsers cannot directly play raw RTSP. RakshakAI uses this config for real camera registration and AI processing. For browser playback in production, convert RTSP to HLS/WebRTC/MJPEG using FFmpeg, MediaMTX, or a camera gateway.

## 3. Python AI Face Recognition

Set:

```text
AI_SERVICE_URL=http://127.0.0.1:8000
```

The backend calls:

```text
POST /scan
```

Expected response:

```json
{
  "cameraId": "C-19",
  "confidence": 92
}
```

Use `real-product/ai-service` as the starting point for OpenCV, DeepFace, and YOLOv8.

## 4. PostgreSQL / Neon

Set:

```text
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

Then run `npm run migrate` and, if needed, `npm run import:json` from
`backend/`. The application uses `data/db.json` only when `DATABASE_URL` is
missing.

## 5. Firebase Push Notifications

Set:

```text
FIREBASE_SERVER_KEY=your_firebase_server_key
FIREBASE_TOPIC=/topics/rakshakai-alerts
```

When alerts are sent, the backend attempts Firebase Cloud Messaging and falls back to dashboard-only alerts if Firebase is not configured.

## 6. Police Route Assignment

The app includes a route endpoint:

```text
GET /api/route?fromLat=...&fromLng=...&toLat=...&toLng=...
```

It uses OSRM by default:

```text
OSRM_BASE_URL=https://router.project-osrm.org
```

For production, host a private OSRM/GraphHopper/Valhalla routing service.

## 7. Deployment

Frontend can go to Vercel. Backend can go to Render. Add the same `.env` variables in the hosting dashboard.

The Settings page shows which real services are configured.
