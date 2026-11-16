"""Small observational robustness check; not a labeled accuracy benchmark.

Run with the AI runtime dependencies and local weights:
  python evaluate_scenarios.py --weights /models/yolov8n.pt image.jpg ...
Only use images you are authorized to process. Results contain no image data.
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO


def scenarios(image):
    height, width = image.shape[:2]
    occluded = image.copy()
    occluded[height // 3:2 * height // 3, width // 3:2 * width // 3] = 0
    return {
        "original": image,
        "darkened": cv2.convertScaleAbs(image, alpha=0.35),
        "very_dark": cv2.convertScaleAbs(image, alpha=0.12),
        "overexposed": cv2.convertScaleAbs(image, alpha=1.7, beta=55),
        "low_contrast": cv2.convertScaleAbs(image, alpha=0.35, beta=80),
        "mild_blur": cv2.GaussianBlur(image, (5, 5), 0),
        "blurred": cv2.GaussianBlur(image, (15, 15), 0),
        "jpeg_compression": cv2.imdecode(cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 10])[1], cv2.IMREAD_COLOR),
        "center_occluded": occluded,
        "low_resolution": cv2.resize(cv2.resize(image, (max(1, width // 4), max(1, height // 4))), (width, height)),
    }


TARGETS = {0: "person", 1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


def score_boxes(predictions, labels):
    """Greedy confidence-ordered, same-class IoU >= 0.5 matching."""
    counts = {name: {"tp": 0, "fp": 0, "fn": 0} for name in TARGETS.values()}
    unmatched = set(range(len(labels)))
    for label, confidence, box in sorted(predictions, key=lambda p: -p[1]):
        best, best_iou = None, 0.5
        for index in unmatched:
            gt_label, gt = labels[index]
            if gt_label != label:
                continue
            ix = max(0, min(box[2], gt[2]) - max(box[0], gt[0]))
            iy = max(0, min(box[3], gt[3]) - max(box[1], gt[1]))
            intersection = ix * iy
            union = (box[2]-box[0])*(box[3]-box[1]) + (gt[2]-gt[0])*(gt[3]-gt[1]) - intersection
            iou = intersection / union if union else 0
            if iou >= best_iou:
                best, best_iou = index, iou
        if best is None:
            counts[label]["fp"] += 1
        else:
            unmatched.remove(best)
            counts[label]["tp"] += 1
    for index in unmatched:
        counts[labels[index][0]]["fn"] += 1
    return counts


def read_labels(path, shape):
    height, width = shape[:2]
    labels = []
    for line in path.read_text().splitlines():
        fields = line.split()
        class_id = int(fields[0])
        if class_id not in TARGETS:
            continue
        x, y, w, h = map(float, fields[1:5])
        labels.append((TARGETS[class_id], [(x-w/2)*width, (y-h/2)*height, (x+w/2)*width, (y+h/2)*height]))
    return labels


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--labels-dir", type=Path, help="YOLO annotation directory; only original images are scored")
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()
    model = YOLO(args.weights)
    # Warm-up is excluded from timings, which are local model-call times only.
    model.predict(np.zeros((640, 640, 3), dtype=np.uint8), imgsz=640, conf=0.5, device="cpu", verbose=False)
    output = []
    for path in args.images:
        image = cv2.imread(path)
        if image is None:
            raise SystemExit(f"Cannot read image: {path}")
        for name, frame in scenarios(image).items():
            start = time.perf_counter()
            result = model.predict(frame, imgsz=640, conf=0.30, max_det=30, device="cpu", verbose=False)[0]
            elapsed_ms = round((time.perf_counter() - start) * 1000, 1)
            predictions = []
            for box in result.boxes:
                label = str(result.names[int(box.cls.item())])
                if label in TARGETS.values():
                    predictions.append((label, float(box.conf.item()), box.xyxy[0].tolist()))
            row = {"image": Path(path).name, "scenario": name, "latency_ms": elapsed_ms, "thresholds": {}}
            for threshold in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60):
                selected = [prediction for prediction in predictions if prediction[1] >= threshold]
                counts = {label: sum(1 for item in selected if item[0] == label) for label in TARGETS.values()}
                entry = {"detections": counts}
                if args.labels_dir and name == "original":
                    label_path = args.labels_dir / (Path(path).stem + ".txt")
                    if not label_path.is_file():
                        raise SystemExit(f"Missing ground-truth annotation: {label_path}")
                    entry["matched_iou_0_5"] = score_boxes(selected, read_labels(label_path, image.shape))
                row["thresholds"][str(threshold)] = entry
            output.append(row)
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
