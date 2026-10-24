"""Deterministic synthetic negatives; not a substitute for real negative video."""
import argparse
import json
import time

import cv2
import numpy as np
from ultralytics import YOLO

OPERATIONAL = {"person", "bicycle", "car", "motorcycle", "bus", "truck", "backpack", "handbag", "suitcase", "bottle", "umbrella", "cell phone", "laptop"}


def frames(count):
    rng = np.random.default_rng(112)
    for index in range(count):
        image = np.full((320, 320, 3), index % 4 * 50, dtype=np.uint8)
        if index % 4 == 1:
            cv2.rectangle(image, (50, 40), (200, 260), (150, 150, 150), -1)
        elif index % 4 == 2:
            image = rng.integers(0, 90, size=image.shape, dtype=np.uint8)
        elif index % 4 == 3:
            cv2.line(image, (0, index * 3 % 320), (319, (index * 3 + 150) % 320), (255, 255, 255), 8)
        yield image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True)
    parser.add_argument("--count", type=int, default=100)
    args = parser.parse_args()
    model = YOLO(args.weights)
    raw = operational = 0
    timings = []
    for image in frames(args.count):
        start = time.perf_counter()
        result = model.predict(image, conf=0.5, imgsz=640, max_det=30, device="cpu", verbose=False)[0]
        timings.append(round((time.perf_counter() - start) * 1000, 1))
        for box in result.boxes:
            raw += 1
            operational += str(result.names[int(box.cls.item())]) in OPERATIONAL
    print(json.dumps({"frames": args.count, "raw_false_detections": raw, "operational_false_detections": operational,
                      "warning": "Synthetic negatives only; no camera-hour or field false-alert inference.", "latency_ms": timings}))


if __name__ == "__main__":
    main()
