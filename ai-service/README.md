# RakshakAI AI Service

FastAPI service for real pretrained YOLO object detection.

The default implementation is deliberately safe:

- It does not generate fake or random detections.
- It does not confirm missing-person or missing-object identity.
- It does not confirm object damage.
- It uses `yolov8n.pt` for supported COCO person, vehicle, and object labels.
- Its default inference profile is optimized for CPU-only live vision.
- Normal YOLO detections remain non-actionable.
- Inference fails closed: `POST /analyze-frame` requires a valid `X-API-Key`.

## Authentication

`POST /analyze-frame` is authenticated by default and fails closed:

| Request | Result |
| --- | --- |
| No `X-API-Key` header | `401` rejected |
| Wrong `X-API-Key` value | `401` rejected (timing-safe comparison) |
| Correct `X-API-Key` | allowed |
| `GET /health` | public, for container health checks |
| `AI_SERVICE_ALLOW_INSECURE=true` with no key configured | unauthenticated local development opt-in only |

Interactive documentation (`/docs`, `/redoc`, `/openapi.json`) is only enabled
in explicit insecure development mode and is disabled in production. Set the
same key in the Node backend (`AI_SERVICE_API_KEY`); the backend fails startup
when `AI_SERVICE_URL` is configured without it.

## Windows setup

From the project root:

```powershell
cd ai-service
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
```

## Run

```powershell
py -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The service never downloads weights at runtime; see "YOLO weights acquisition
and integrity" below.

## YOLO weights acquisition and integrity

`YOLO_MODEL_NAME` must point to a local weights file; it is resolved first
against the working directory, then against the `ai-service/` folder. If the
file is missing, model loading fails with a clear error, `GET /health` returns
HTTP 503, and inference keeps returning safe no-model responses.

- Existing weights on this machine: `ai-service/yolov8n.pt`
  (6,549,796 bytes, observed SHA-256
  `f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36`).
  This file is the standard Ultralytics `yolov8n.pt` COCO-pretrained release
  that earlier versions fetched automatically; its on-disk provenance is
  therefore uncontrolled.
- Deterministic acquisition: obtain `yolov8n.pt` explicitly from the official
  Ultralytics release assets, place it at the configured path, and set
  `YOLO_MODEL_SHA256` to the expected digest. Startup fails closed on a
  checksum mismatch.
- The weights file is not committed to git and is excluded from the Docker
  build context; containers receive it via the `ai-model-cache` volume or an
  explicit mount into `/models`.
- To enforce integrity for the current file:
  `YOLO_MODEL_SHA256=f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36`

## Pinned runtime versions

Exact pins in `requirements.txt` (verified mutually compatible on Python 3.11
for Docker and Python 3.13 for local development, CPU inference):

| Package | Version |
| --- | --- |
| ultralytics | 8.3.253 |
| torch | 2.9.1 (`+cpu` wheels in Docker) |
| torchvision | 0.24.1 (`+cpu` wheels in Docker) |
| opencv-python | 4.12.0.88 |
| numpy | 2.2.6 |
| fastapi | 0.115.14 |
| uvicorn | 0.34.3 |
| python-dotenv | 1.0.1 |
| pydantic | 2.10.6 |
| pytesseract | 0.3.13 |

`opencv-python-headless` is intentionally not used because ultralytics
transitively requires `opencv-python`, and installing both variants corrupts
the `cv2` package; the Dockerfile already carries the required system
libraries.

## Recommended model profile

The default profile is designed for the current CPU-only development machine:

```env
YOLO_MODEL_NAME=yolov8n.pt
YOLO_MIN_CONFIDENCE=0.50
YOLO_IMAGE_SIZE=640
YOLO_MAX_DETECTIONS=30
YOLO_DEVICE=cpu
AI_DUPLICATE_WINDOW_SECONDS=8
AI_TRACK_TTL_SECONDS=15
PLATE_OCR_ENABLED=false
```

`yolov8n.pt` is intentionally retained for responsive Live Vision performance.
Use `yolov8s.pt` only on a faster machine or a system with a supported GPU.

Then open:

```text
http://localhost:8000/health
```

API documentation (`/docs`) is only available in explicit insecure
development mode; it is disabled by default.

Configure the Node backend:

```env
AI_SERVICE_URL=http://127.0.0.1:8000
AI_SERVICE_API_KEY=<the same key configured above>
```

## Endpoints

### `GET /health`

Reports service availability, actual model loading status, model name, and the
current UTC timestamp. Remains public for container health checks and returns
HTTP 503 while the model is not loaded.

### `POST /analyze-frame`

Accepts:

- `sourceType`
- `sourceId`
- `sourceName`
- `zone`
- `timestamp`
- `imageBase64`

YOLO detections with confidence below `0.50` are discarded. Supported people,
vehicles, and objects are returned with bounding boxes, but remain
non-actionable:

- Person: `person_detected`
- Car, motorcycle, bus, or truck: `vehicle_detected`
- Supported portable object: `object_detected`

The response also includes CPU inference timing, approximate dominant colors,
simple object shape/size metadata, session-only person tracking IDs, and safe
vehicle/plate analysis fields. Vehicle brand/model and person identity are
always reported as unsupported. Plate OCR is disabled unless a compatible OCR
runtime is deliberately installed and enabled; all possible plate text still
requires human verification.

Live Vision should throttle requests to 800–1500 ms rather than analyzing every
video frame. Duplicate observations are marked using label, box overlap, and a
short time window.

The service does not fabricate weapons, fire, violence, theft, damage, or
missing-person/object matches. `personMatch` and `objectMatch` remain `null`,
and `objectCondition.status` remains `unknown` without separate real models.
