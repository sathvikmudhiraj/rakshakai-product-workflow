"""Regression tests for the RakshakAI AI service authentication and weights handling.

Run from ai-service with the runtime dependencies installed:

    py -m unittest discover -s tests -v

Model inference is mocked; real YOLO weights are never required and never
downloaded by these tests.
"""

import asyncio
import base64
import hashlib
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

AI_SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_SERVICE_DIR))

TEST_KEY = "rakshakai-test-ai-key-1234567890"
MISSING_WEIGHTS = "missing-test-weights.pt"

os.environ.setdefault("YOLO_MODEL_NAME", MISSING_WEIGHTS)

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import main  # noqa: E402


def reload_service(api_key=TEST_KEY, allow_insecure=None, model_name=None, model_sha256=None):
    os.environ["AI_SERVICE_API_KEY"] = api_key
    os.environ["YOLO_MODEL_NAME"] = model_name or MISSING_WEIGHTS
    if allow_insecure is None:
        os.environ.pop("AI_SERVICE_ALLOW_INSECURE", None)
    else:
        os.environ["AI_SERVICE_ALLOW_INSECURE"] = allow_insecure
    if model_sha256 is None:
        os.environ.pop("YOLO_MODEL_SHA256", None)
    else:
        os.environ["YOLO_MODEL_SHA256"] = model_sha256
    return importlib.reload(main)


def asgi_response(app, method, path, headers=None, body=b""):
    messages = []

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
        "client": ("127.0.0.1", 54321),
        "server": ("127.0.0.1", 8000),
    }
    asyncio.run(app(scope, receive, send))
    start_message = next((m for m in messages if m["type"] == "http.response.start"), None)
    payload = b"".join(m.get("body", b"") for m in messages if m["type"].startswith("http.response"))
    return start_message["status"] if start_message else None, payload


def analyze_body(image):
    return {
        "sourceType": "browser_camera",
        "sourceName": "Regression Test Camera",
        "timestamp": "2026-01-01T00:00:00.000Z",
        "imageBase64": image,
    }


def valid_frame():
    image = np.zeros((32, 48, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok, "test JPEG encoding failed"
    return "data:image/jpeg;base64," + base64.b64encode(encoded.tobytes()).decode()


class FakeTensor:
    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class FakeArray:
    def __init__(self, values):
        self._values = values

    def tolist(self):
        return list(self._values)


class FakeBox:
    def __init__(self, cls, conf, xyxy):
        self.cls = FakeTensor(cls)
        self.conf = FakeTensor(conf)
        self.xyxy = [FakeArray(xyxy)]


class FakeResult:
    def __init__(self, boxes):
        self.boxes = boxes
        self.names = {0: "person", 1: "backpack"}


class FakeModel:
    def __init__(self, boxes):
        self.boxes = boxes

    def predict(self, **kwargs):
        return [FakeResult(self.boxes)]


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.service = reload_service()

    def tearDown(self):
        reload_service()

    def test_missing_api_key_rejects_inference(self):
        status, payload = asgi_response(
            self.service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json"},
            body=b'{"sourceType": "browser_camera", "sourceName": "x", "timestamp": "2026-01-01T00:00:00Z", "imageBase64": "AAAA"}',
        )
        self.assertEqual(status, 401)
        self.assertIn("Missing or invalid API key", payload.decode())

    def test_wrong_api_key_rejects_inference(self):
        status, payload = asgi_response(
            self.service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json", "X-API-Key": "wrong-key"},
            body=b'{"sourceType": "browser_camera", "sourceName": "x", "timestamp": "2026-01-01T00:00:00Z", "imageBase64": "AAAA"}',
        )
        self.assertEqual(status, 401)
        self.assertIn("Missing or invalid API key", payload.decode())

    def test_valid_api_key_allows_inference(self):
        self.service.model = FakeModel([FakeBox(0, 0.92, [10.0, 20.0, 110.0, 220.0])])
        body = json.dumps(analyze_body(valid_frame())).encode()
        status, payload = asgi_response(
            self.service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json", "X-API-Key": TEST_KEY},
            body=body,
        )
        self.assertEqual(status, 200)
        result = json.loads(payload)
        self.assertEqual(result["detections"][0]["label"], "person")

    def test_empty_configured_key_fails_closed(self):
        service = reload_service(api_key="")
        status, _ = asgi_response(
            service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json"},
            body=b'{"sourceType": "browser_camera", "sourceName": "x", "timestamp": "2026-01-01T00:00:00Z", "imageBase64": "AAAA"}',
        )
        self.assertEqual(status, 401)

    def test_explicit_insecure_development_mode_allows_requests(self):
        service = reload_service(api_key="", allow_insecure="true")
        status, _ = asgi_response(
            service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json"},
            body=b'{"sourceType": "browser_camera", "sourceName": "x", "timestamp": "2026-01-01T00:00:00Z", "imageBase64": "AAAA"}',
        )
        self.assertEqual(status, 200)

    def test_health_check_remains_public(self):
        status, payload = asgi_response(self.service.app, "GET", "/health")
        self.assertEqual(status, 503)
        result = json.loads(payload)
        self.assertFalse(result["modelLoaded"])

    def test_interactive_docs_disabled_in_secure_mode(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            status, _ = asgi_response(self.service.app, "GET", path)
            self.assertEqual(status, 404, path)

    def test_interactive_docs_enabled_only_in_insecure_mode(self):
        service = reload_service(api_key="", allow_insecure="true")
        status, _ = asgi_response(service.app, "GET", "/docs")
        self.assertEqual(status, 200)
        status, _ = asgi_response(service.app, "GET", "/openapi.json")
        self.assertEqual(status, 200)

    def test_malformed_base64_image_returns_safe_response(self):
        self.service.model = FakeModel([])
        body = json.dumps(analyze_body("data:image/jpeg;base64,not-valid-base64!!!")).encode()
        status, payload = asgi_response(
            self.service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json", "X-API-Key": TEST_KEY},
            body=body,
        )
        self.assertEqual(status, 200)
        result = json.loads(payload)
        self.assertIn("Invalid image frame", result["message"])
        self.assertFalse(result["threatDetected"])

    def test_valid_image_preserves_detections(self):
        self.service.model = FakeModel([
            FakeBox(0, 0.92, [10.0, 20.0, 110.0, 220.0]),
            FakeBox(1, 0.74, [30.0, 40.0, 90.0, 130.0]),
        ])
        body = json.dumps(analyze_body(valid_frame())).encode()
        status, payload = asgi_response(
            self.service.app, "POST", "/analyze-frame",
            headers={"Content-Type": "application/json", "X-API-Key": TEST_KEY},
            body=body,
        )
        self.assertEqual(status, 200)
        detections = json.loads(payload)["detections"]
        self.assertEqual(len(detections), 2)
        self.assertEqual(detections[0]["label"], "person")
        self.assertAlmostEqual(detections[0]["confidence"], 0.92)
        self.assertEqual(detections[0]["box"], [10.0, 20.0, 100.0, 200.0])
        self.assertEqual(detections[1]["label"], "backpack")
        self.assertAlmostEqual(detections[1]["confidence"], 0.74)
        self.assertEqual(detections[1]["box"], [30.0, 40.0, 60.0, 90.0])


class WeightsTests(unittest.TestCase):
    def tearDown(self):
        reload_service()

    def test_missing_weights_produce_clear_error_without_download(self):
        service = reload_service(model_name=MISSING_WEIGHTS)
        self.assertIsNone(service.model)
        self.assertIn("YOLO weights unavailable", service.model_error)
        self.assertIn("Runtime downloads are disabled", service.model_error)

    def test_missing_weights_return_503_health(self):
        service = reload_service(model_name=MISSING_WEIGHTS)
        status, payload = asgi_response(service.app, "GET", "/health")
        self.assertEqual(status, 503)
        result = json.loads(payload)
        self.assertFalse(result["modelLoaded"])
        self.assertIn("YOLO weights unavailable", result["modelError"])

    def test_checksum_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            weights = Path(directory) / "fake-yolov8n.pt"
            weights.write_bytes(b"not-real-weights")
            service = reload_service(model_name=str(weights), model_sha256="0" * 64)
            self.assertIsNone(service.model)
            self.assertIn("integrity check failed", service.model_error)

    def test_checksum_match_attempts_model_load(self):
        with tempfile.TemporaryDirectory() as directory:
            weights = Path(directory) / "fake-yolov8n.pt"
            weights.write_bytes(b"not-real-weights")
            digest = hashlib.sha256(weights.read_bytes()).hexdigest()
            service = reload_service(model_name=str(weights), model_sha256=digest)
            self.assertNotIn("integrity check failed", service.model_error or "")

    def test_remote_model_url_is_rejected(self):
        service = reload_service(model_name="https://example.com/yolov8n.pt")
        self.assertIsNone(service.model)
        self.assertIn("YOLO_MODEL_NAME must be a local weights file path", service.model_error)


if __name__ == "__main__":
    unittest.main()
