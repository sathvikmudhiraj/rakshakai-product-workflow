import base64
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="RakshakAI AI Service")

AI_SERVICE_API_KEY = os.getenv("AI_SERVICE_API_KEY", "").strip()


@app.middleware("http")
async def api_key_auth(request: Request, call_next):
    # Allow health and docs endpoints without API key
    if request.url.path in ("/health", "/", "/docs", "/openapi.json"):
        return await call_next(request)
    if AI_SERVICE_API_KEY:
        received = request.headers.get("X-API-Key", "").strip()
        if received != AI_SERVICE_API_KEY:
            raise HTTPException(status_code=401, detail="Missing or invalid API key")
    return await call_next(request)


MODEL_NAME = os.getenv("YOLO_MODEL_NAME", "yolov8n.pt").strip() or "yolov8n.pt"
MIN_CONFIDENCE = max(0.0, min(1.0, float(os.getenv("YOLO_MIN_CONFIDENCE", "0.50"))))
IMAGE_SIZE = max(320, min(1280, int(os.getenv("YOLO_IMAGE_SIZE", "640"))))
MAX_DETECTIONS = max(1, min(100, int(os.getenv("YOLO_MAX_DETECTIONS", "30"))))
INFERENCE_DEVICE = os.getenv("YOLO_DEVICE", "cpu").strip() or "cpu"
DUPLICATE_WINDOW_SECONDS = max(1.0, float(os.getenv("AI_DUPLICATE_WINDOW_SECONDS", "8")))
TRACK_TTL_SECONDS = max(2.0, float(os.getenv("AI_TRACK_TTL_SECONDS", "15")))
PLATE_OCR_ENABLED = os.getenv("PLATE_OCR_ENABLED", "false").strip().lower() == "true"

SUPPORTED_LABELS = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck", "backpack",
    "handbag", "suitcase", "bottle", "umbrella", "cell phone", "laptop",
}
VEHICLE_LABELS = {"bicycle", "car", "motorcycle", "bus", "truck"}
BAG_LABELS = {"backpack", "handbag", "suitcase"}

model = None
model_error = None
model_lock = Lock()
state_lock = Lock()
track_sequence = defaultdict(int)
session_tracks = defaultdict(list)
recent_detections = defaultdict(list)


class AnalyzeFrameRequest(BaseModel):
    sourceType: str
    sourceId: str | None = None
    sourceName: str
    zone: str = "Unassigned"
    timestamp: str
    imageBase64: str


def iso_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_model() -> None:
    global model, model_error
    try:
        from ultralytics import YOLO
        model = YOLO(MODEL_NAME)
        model_error = None
    except Exception as error:
        model = None
        model_error = str(error)


def decode_image(value: str) -> np.ndarray | None:
    encoded = value.split(",", 1)[1] if "," in value else value
    try:
        raw = base64.b64decode(encoded, validate=True)
        return cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except (ValueError, TypeError):
        return None


def clip_crop(image: np.ndarray, box: list[float]) -> np.ndarray | None:
    height, width = image.shape[:2]
    x, y, box_width, box_height = box
    x1, y1 = max(0, int(x)), max(0, int(y))
    x2, y2 = min(width, int(x + box_width)), min(height, int(y + box_height))
    return image[y1:y2, x1:x2] if x2 > x1 and y2 > y1 else None


def dominant_color(image: np.ndarray | None) -> str:
    if image is None or image.size == 0:
        return "unknown"
    pixels = image.reshape(-1, 3)
    if len(pixels) > 4000:
        pixels = pixels[:: max(1, len(pixels) // 4000)]
    hsv = cv2.cvtColor(pixels.reshape(-1, 1, 3).astype(np.uint8), cv2.COLOR_BGR2HSV).reshape(-1, 3)
    hsv = hsv[(hsv[:, 2] > 35) & (hsv[:, 1] > 20)]
    if not len(hsv):
        brightness = float(np.mean(pixels))
        return "black" if brightness < 55 else "white" if brightness > 205 else "gray"
    hue, saturation, value = np.median(hsv, axis=0)
    if value < 55:
        return "black"
    if saturation < 35:
        return "white" if value > 205 else "gray"
    if hue < 8 or hue >= 172:
        return "red"
    if hue < 20:
        return "orange"
    if hue < 34:
        return "yellow"
    if hue < 85:
        return "green"
    if hue < 105:
        return "blue"
    if hue < 135:
        return "purple"
    if hue < 172:
        return "pink"
    return "unknown"


def shape_approximation(crop: np.ndarray | None) -> str:
    if crop is None or crop.size == 0:
        return "unknown"
    height, width = crop.shape[:2]
    aspect = width / max(1, height)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 160)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return "rectangular" if aspect < 3.5 else "unknown"
    contour = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return "unknown"
    vertices = len(cv2.approxPolyDP(contour, 0.04 * perimeter, True))
    if vertices == 4:
        return "rectangular"
    area = cv2.contourArea(contour)
    circularity = 4 * np.pi * area / (perimeter * perimeter)
    return "circular/oval" if circularity >= 0.65 else "unknown"


def intersection_over_union(first: list[float], second: list[float]) -> float:
    ax1, ay1, aw, ah = first
    bx1, by1, bw, bh = second
    ax2, ay2, bx2, by2 = ax1 + aw, ay1 + ah, bx1 + bw, by1 + bh
    intersection = max(0, min(ax2, bx2) - max(ax1, bx1)) * max(0, min(ay2, by2) - max(ay1, by1))
    union = aw * ah + bw * bh - intersection
    return intersection / union if union > 0 else 0


def source_key(request: AnalyzeFrameRequest) -> str:
    return request.sourceId or request.sourceName


def tracking_id(source: str, box: list[float], now_value: float) -> str:
    with state_lock:
        tracks = [item for item in session_tracks[source] if now_value - item["seen"] <= TRACK_TTL_SECONDS]
        match = max(tracks, key=lambda item: intersection_over_union(item["box"], box), default=None)
        if match and intersection_over_union(match["box"], box) >= 0.3:
            match.update({"box": box, "seen": now_value})
            session_tracks[source] = tracks
            return match["id"]
        track_sequence[source] += 1
        identifier = f"person-{track_sequence[source]:03d}"
        tracks.append({"id": identifier, "box": box, "seen": now_value})
        session_tracks[source] = tracks
        return identifier


def duplicate_status(source: str, label: str, box: list[float], now_value: float) -> bool:
    with state_lock:
        recent = [
            item for item in recent_detections[source]
            if now_value - item["seen"] <= DUPLICATE_WINDOW_SECONDS
        ]
        duplicate = any(item["label"] == label and intersection_over_union(item["box"], box) >= 0.55 for item in recent)
        recent.append({"label": label, "box": box, "seen": now_value})
        recent_detections[source] = recent[-100:]
        return duplicate


def plate_analysis(crop: np.ndarray | None) -> dict:
    unavailable = {
        "detected": False,
        "text": None,
        "confidence": 0,
        "status": "plate OCR unavailable",
        "verification": "human_verification_required",
    }
    if crop is None or crop.size == 0:
        return unavailable
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 90, 190)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidate = None
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:20]:
        x, y, width, height = cv2.boundingRect(contour)
        aspect = width / max(1, height)
        if 2.0 <= aspect <= 6.5 and width >= crop.shape[1] * 0.15 and height >= 8:
            candidate = crop[y:y + height, x:x + width]
            break
    if candidate is None:
        return unavailable
    result = {**unavailable, "detected": True, "status": "plate region detected; OCR unavailable"}
    if not PLATE_OCR_ENABLED:
        return result
    try:
        import pytesseract
        data = pytesseract.image_to_data(candidate, config="--psm 7", output_type=pytesseract.Output.DICT)
        tokens = []
        confidences = []
        for token, raw_confidence in zip(data.get("text", []), data.get("conf", [])):
            cleaned = "".join(character for character in token if character.isalnum()).upper()
            numeric_confidence = float(raw_confidence)
            if cleaned and numeric_confidence >= 0:
                tokens.append(cleaned)
                confidences.append(numeric_confidence / 100)
        text = "".join(tokens)
        if len(text) >= 4:
            result.update({
                "text": text[:16],
                "confidence": round(float(np.mean(confidences)), 3) if confidences else 0,
                "status": "possible plate text",
            })
    except Exception:
        pass
    return result


def proximity(first: list[float], second: list[float]) -> bool:
    fx, fy, fw, fh = first
    sx, sy, sw, sh = second
    first_center = (fx + fw / 2, fy + fh / 2)
    second_center = (sx + sw / 2, sy + sh / 2)
    return np.hypot(first_center[0] - second_center[0], first_center[1] - second_center[1]) <= max(fw, fh) * 0.8


def safe_response(message: str, threat_type: str = "no_threat", detections=None, **extra) -> dict:
    detections = detections or []
    return {
        "configured": True,
        "threatDetected": False,
        "threatType": threat_type,
        "confidence": max((item["confidence"] for item in detections), default=0),
        "severity": "low",
        "alertClassification": "observation",
        "detections": detections,
        "activity": None,
        "personMatch": None,
        "objectMatch": None,
        "personIdentity": {
            "identified": False,
            "status": "unsupported",
            "message": "Person identity is not inferred. Investigation-assist only; human review required.",
        },
        "objectCondition": {
            "status": "unknown",
            "damageLevel": None,
            "confidence": 0,
            "verification": "human_verification_required",
        },
        "message": message,
        **extra,
    }


def detect(image: np.ndarray) -> tuple[list[dict], float]:
    if model is None:
        return [], 0
    started = time.perf_counter()
    with model_lock:
        result = model.predict(
            source=image,
            conf=MIN_CONFIDENCE,
            imgsz=IMAGE_SIZE,
            max_det=MAX_DETECTIONS,
            device=INFERENCE_DEVICE,
            verbose=False,
        )[0]
    inference_ms = (time.perf_counter() - started) * 1000
    detections = []
    for box in result.boxes:
        confidence = float(box.conf.item())
        label = str(result.names[int(box.cls.item())])
        if confidence < MIN_CONFIDENCE or label not in SUPPORTED_LABELS:
            continue
        x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
        detections.append({"label": label, "confidence": confidence, "box": [x1, y1, x2 - x1, y2 - y1]})
    return detections, inference_ms


def analyze_detections(image: np.ndarray, detections: list[dict], request: AnalyzeFrameRequest) -> dict:
    now_value = time.time()
    source = source_key(request)
    vehicles, people, objects = [], [], []
    vehicle_detections = [item for item in detections if item["label"] in VEHICLE_LABELS]
    bag_detections = [item for item in detections if item["label"] in BAG_LABELS]

    for item in detections:
        crop = clip_crop(image, item["box"])
        enriched = {
            **item,
            "approximateSizePixels": {
                "width": round(item["box"][2]),
                "height": round(item["box"][3]),
                "area": round(item["box"][2] * item["box"][3]),
            },
            "dominantColor": dominant_color(crop),
            "shape": shape_approximation(crop),
            "timestamp": request.timestamp,
            "duplicateSuppressed": duplicate_status(source, item["label"], item["box"], now_value),
        }
        item.update(enriched)
        if item["label"] in VEHICLE_LABELS:
            vehicles.append({
                "vehicleType": item["label"],
                "dominantColor": enriched["dominantColor"],
                "vehicleModel": "unsupported",
                "plate": plate_analysis(crop),
                "confidence": item["confidence"],
                "box": item["box"],
                "verification": "human_verification_required",
            })
        elif item["label"] == "person":
            height = crop.shape[0] if crop is not None else 0
            upper = crop[: max(1, height // 2)] if crop is not None else None
            lower = crop[max(1, height // 2):] if crop is not None else None
            people.append({
                "trackingId": tracking_id(source, item["box"], now_value),
                "upperClothingColor": dominant_color(upper),
                "lowerClothingColor": dominant_color(lower),
                "boundingBoxHeightPixels": round(item["box"][3]),
                "carryingBag": "yes" if any(proximity(item["box"], bag["box"]) for bag in bag_detections) else "unknown",
                "ridingVehicle": "yes" if any(proximity(item["box"], vehicle["box"]) for vehicle in vehicle_detections) else "unknown",
                "identity": "not_inferred",
                "message": "Person description is approximate and requires human verification.",
                "box": item["box"],
            })
        else:
            objects.append({
                "label": item["label"],
                "confidence": item["confidence"],
                "box": item["box"],
                "approximateSizePixels": enriched["approximateSizePixels"],
                "dominantColor": enriched["dominantColor"],
                "shape": enriched["shape"],
                "timestamp": request.timestamp,
            })
    return {
        "vehicleAnalysis": vehicles,
        "personAnalysis": people,
        "objectAnalysis": objects,
        "duplicateSuppressed": bool(detections) and all(item["duplicateSuppressed"] for item in detections),
    }


load_model()


@app.get("/")
def root() -> dict:
    return {**health(), "message": "RakshakAI AI Service is running", "endpoints": {
        "health": "/health", "documentation": "/docs", "analyzeFrame": "/analyze-frame",
    }}


@app.get("/health")
def health() -> dict:
    loaded = model is not None
    return {
        "status": "ok",
        "service": "RakshakAI AI Service",
        "modelLoaded": loaded,
        "modelName": MODEL_NAME if loaded else "not_loaded",
        "modelError": None if loaded else model_error,
        "device": INFERENCE_DEVICE,
        "imageSize": IMAGE_SIZE,
        "minimumConfidence": MIN_CONFIDENCE,
        "maxDetections": MAX_DETECTIONS,
        "duplicateWindowSeconds": DUPLICATE_WINDOW_SECONDS,
        "plateOcrAvailable": PLATE_OCR_ENABLED,
        "timestamp": iso_timestamp(),
    }


@app.post("/analyze-frame")
def analyze_frame(request: AnalyzeFrameRequest) -> dict:
    analyzed_at = iso_timestamp()
    if model is None:
        return safe_response("Object detection model is not loaded", performance={"inferenceMs": 0, "analyzedAt": analyzed_at})
    image = decode_image(request.imageBase64)
    if image is None:
        return safe_response("Invalid image frame", performance={"inferenceMs": 0, "analyzedAt": analyzed_at})
    try:
        detections, inference_ms = detect(image)
        analysis = analyze_detections(image, detections, request)
    except Exception:
        return safe_response("Object detection is temporarily unavailable", performance={"inferenceMs": 0, "analyzedAt": analyzed_at})

    performance = {
        "inferenceMs": round(inference_ms, 1),
        "analyzedAt": analyzed_at,
        "imageWidth": int(image.shape[1]),
        "imageHeight": int(image.shape[0]),
        "device": INFERENCE_DEVICE,
    }
    if not detections:
        return safe_response("No actionable threat detected", performance=performance, **analysis)
    labels = {item["label"] for item in detections}
    if "person" in labels:
        return safe_response("Person detected for observation", "person_detected", detections, performance=performance, **analysis)
    if labels & VEHICLE_LABELS:
        return safe_response("Vehicle detected for observation", "vehicle_detected", detections, performance=performance, **analysis)
    return safe_response("Object detected for observation", "object_detected", detections, performance=performance, **analysis)
