# RakshakAI AI Service

FastAPI service for real pretrained YOLO object detection.

The default implementation is deliberately safe:

- It does not generate fake or random detections.
- It does not confirm missing-person or missing-object identity.
- It does not confirm object damage.
- It uses `yolov8n.pt` for supported COCO person, vehicle, and object labels.
- Its default inference profile is optimized for CPU-only live vision.
- Normal YOLO detections remain non-actionable.

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

The first run may download `yolov8n.pt` automatically.

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

API documentation is available at:

```text
http://localhost:8000/docs
```

Configure the Node backend:

```env
AI_SERVICE_URL=http://127.0.0.1:8000
```

## Endpoints

### `GET /health`

Reports service availability, actual model loading status, model name, and the
current UTC timestamp.

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
