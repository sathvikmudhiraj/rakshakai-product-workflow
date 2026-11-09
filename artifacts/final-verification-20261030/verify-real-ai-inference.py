import base64
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from ultralytics.utils import ASSETS


root = Path.cwd()
image = Path(ASSETS) / "bus.jpg"
assert image.is_file(), f"Bundled safe COCO sample not found: {image}"
frame = {
    "sourceType": "synthetic_test",
    "sourceId": "release-gate-bus-image",
    "sourceName": "Bundled safe COCO sample",
    "zone": "isolated test",
    "timestamp": "2026-10-30T12:00:00Z",
    "imageBase64": base64.b64encode(image.read_bytes()).decode(),
}
port = 58127
proc = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
    cwd=root,
    env=os.environ.copy(),
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)


def call(path, body=None, key=None):
    headers = {"Content-Type": "application/json"}
    if key is not None:
        headers["X-API-Key"] = key
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


try:
    deadline = time.time() + 90
    health = None
    while time.time() < deadline:
        try:
            status, health = call("/health")
            if status in (200, 503):
                break
        except Exception:
            time.sleep(0.5)
    assert health and status == 200 and health["modelLoaded"] is True, json.dumps(health)
    assert call("/analyze-frame", frame)[0] == 401
    assert call("/analyze-frame", frame, key="wrong")[0] == 401

    status, payload = call("/analyze-frame", frame, key=os.environ["AI_SERVICE_API_KEY"])
    assert status == 200
    assert isinstance(payload["detections"], list)
    assert payload["personIdentity"]["identified"] is False
    assert payload["objectCondition"]["verification"] == "human_verification_required"
    assert payload["threatDetected"] is False
    assert payload["performance"]["inferenceMs"] >= 0
    assert payload["performance"]["device"] == "cpu"
    assert any(item["label"] in {"bus", "person"} for item in payload["detections"])

    repeated_status, repeated = call("/analyze-frame", frame, key=os.environ["AI_SERVICE_API_KEY"])
    assert repeated_status == 200
    assert any(item.get("duplicateSuppressed") is True for item in repeated["detections"])
    invalid_status, invalid = call(
        "/analyze-frame", {**frame, "imageBase64": "not-an-image"}, key=os.environ["AI_SERVICE_API_KEY"]
    )
    assert invalid_status == 200 and invalid["message"] == "Invalid image frame"

    evidence = {
        "image": image.name,
        "modelSha256": hashlib.sha256(Path("yolov8n.pt").read_bytes()).hexdigest(),
        "health": health,
        "status": status,
        "inference": payload["performance"],
        "threatDetected": payload["threatDetected"],
        "threatType": payload["threatType"],
        "detections": [{"label": item["label"], "confidence": round(item["confidence"], 4)} for item in payload["detections"]],
        "personIdentity": payload["personIdentity"],
        "objectCondition": payload["objectCondition"],
        "duplicateSuppression": all(item.get("duplicateSuppressed") is True for item in repeated["detections"]),
        "invalidMedia": {"status": invalid_status, "message": invalid["message"]},
        "authentication": ["missing=401", "wrong=401", "valid=200"],
    }
    output = Path("../artifacts/final-verification-20261030/ai-real-inference.json")
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    output = proc.stdout.read() if proc.stdout else ""
    Path("../artifacts/final-verification-20261030/ai-real-inference-server.log").write_text(output, encoding="utf-8")
