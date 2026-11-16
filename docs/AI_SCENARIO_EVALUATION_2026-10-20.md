# AI scenario smoke test — 2026-10-20

For the follow-up rights-screened CC0 image, synthetic negatives, backend rebuild
and frozen-feed probe, see [AI visual benchmark](AI_VISUAL_BENCHMARK_2026-10-20.md).

## Follow-up: labeled COCO8 check and stream safety

**Decision: AI PERFORMANCE: NEEDS TARGETED IMPROVEMENT.** This is not approval
for a field pilot: the small, non-CCTV sample and incomplete stream evaluation
cannot establish suitability for a live operational pilot.

- Model/device: existing YOLOv8n, CPU. No model or confidence threshold changed.
- Labeled data: the four `val` images of the public
  [COCO8 smoke-test set](https://docs.ultralytics.com/datasets/detect/coco8/),
  with their provided bounding boxes; these images are selected from COCO
  train2017 and may overlap model training. They are not independent or police
  CCTV. Ten person boxes and no boxes for the five requested vehicle classes
  occur in this subset. No private imagery was uploaded or committed.
- Unlabeled robustness: nine non-original variants per image (36 derived frames),
  including dark, very dark, overexposed, low contrast, mild/strong blur, JPEG,
  center occlusion and low resolution. Unmodified boxes were not scored against
  occluded images; therefore no ground-truth accuracy is claimed for variants.
- On original images, class-matched greedy IoU >= 0.5 matching, confidence 0.50:
  person TP 1, FP 0, FN 9, precision 1.00, recall 0.10, F1 0.182. This is a
  tiny smoke test, not a general accuracy estimate. Car, motorcycle, bus, truck,
  bicycle: TP/FP/FN 0/0/0, precision/recall/F1 undefined (no labeled examples).
- Threshold comparison on the same four frames: 0.35 gives person 3/0/7
  TP/FP/FN, precision 1.00, recall 0.30, F1 0.462; 0.50 and 0.65 both give
  1/0/9. Predictions are obtained in one run at 0.35 and filtered afterward;
  max detections is 30. The sample is too small and biased to tune a threshold,
  particularly without representative negative scenes, so 0.50 is unchanged.
- Warm model-call timing, 40 frames at candidate conf 0.35: nearest-rank p50
  88.0 ms, p95 155.1 ms, max 258.7 ms, mean 101.75 ms (9.83 model calls/sec,
  reciprocal of mean). This is not camera-to-observation latency or capacity.
- Four labeled originals produced zero target-class false positives, equivalent
  to 0 per 100 frames when scaled; this tiny sample gives no credible false
  alarm estimate. False alerts/camera-hour, end-to-end p50/p95/max, CPU/memory,
  real nighttime, crowd/distance strata, weather, headlight glare, reflections,
  mannequins and representative negative videos were not measured.
- Stream tests pass for timeout/unavailability, disconnected/no-frame/reconnect,
  bounded sampling and human review. Old supplied timestamps and frames aging
  out during inference are now dropped before observation; regression tests
  cover both. The FFmpeg adapter timestamps decoded arrival, not the camera's
  original exposure, so frozen or delayed source video can still appear fresh.
  Static/repeated frame detection, true capture-time verification, service
  restart recovery, and end-to-end latency require further testing.
- The service already filters raw `tie` detections; an additional regression
  verifies that the approved person/car classes remain while `tie` is excluded.
  No newly enabled classes, identity inference, or crime classification.

The evaluation runner reports original-image labeled matches and derived-frame
raw results separately. Run locally with `--labels-dir` pointing to the
corresponding COCO8 YOLO labels and the four image paths. The source images and
results used for this run are in a local temporary directory, not the repository.
Candidate thresholds are post-filtered from one model prediction per frame.


This is an exploratory local check, not a production acceptance or accuracy
evaluation. No field, victim, or police records were used. The model is a COCO
object detector; object presence does not establish a crime, intent, identity,
danger, or a need for dispatch. All observations require human review.

## Context and method

NIST's public-safety video analytics work identifies robustness to variable
video and operational integration as important challenges; examples include
objects and perimeter crossings, which are not validated by this test:
https://www.nist.gov/ctl/pscr/multi-tiered-video-analytics-abnormality-detection-and-alerting

Two public example images were downloaded for local analysis from the
[Ultralytics assets repository](https://github.com/ultralytics/assets):
`im/bus.jpg` (street, bus and people) and `im/zidane.jpg` (people in a sports
setting). These are not police CCTV or a representative field sample. Five
variants per image were evaluated with the existing `yolov8n.pt`, CPU,
640-pixel inference, 0.5 confidence and max 30 detections. Darkening scales pixel
values to 35%; blur uses a 15-pixel Gaussian kernel; occlusion masks the center
third; low-resolution downscales by four and then upscales. The reproducible
runner is `ai-service/scripts/evaluate_scenarios.py`.

The runner directly invokes the raw model; it does not measure HTTP, camera
transport, app-side label filtering, observation persistence, human review, or
dispatch. Counts are not compared with labeled ground truth. Timings are warm
single-process model-call wall times under local conditions, not an SLO.

| Image | Variant | Raw detections | Time (ms) |
| --- | --- | --- | ---: |
| Street | Original | bus 1, person 3 | 165.2 |
| Street | Darkened | bus 1, person 3 | 164.6 |
| Street | Blurred | bus 1, person 3 | 90.3 |
| Street | Center occluded | person 2 | 92.2 |
| Street | Low resolution | bus 1, person 3 | 79.8 |
| Sports | Original | person 2 | 94.7 |
| Sports | Darkened | person 2 | 65.2 |
| Sports | Blurred | person 2, tie 1 | 67.5 |
| Sports | Center occluded | person 2 | 67.7 |
| Sports | Low resolution | person 2 | 73.5 |

Masking the street image changed the raw output: the bus and one person were no
longer detected. The blurred sports image produced an extra raw `tie` detection;
without a ground-truth label this is not classified as correct or false.
These transformations do not represent the range of actual lighting, weather,
camera angle, compression, traffic, or occlusion conditions.

The running AI service separately reports model loaded and plate OCR unavailable.
No new model weights, thresholds, business logic, or UI were changed. Altering a
threshold from these two images would be unjustified and might increase missed
detections or false alerts.

## Required before operational acceptance

- Acquire permissioned, representative and independently labeled local footage,
  including negative scenes and diverse cameras, lighting, weather, angles,
  crowding, occlusion, and image quality. Avoid using actual sensitive data
  without appropriate authorization and retention controls.
- Agree on object classes and use cases. Evaluate precision, recall, missed
  detections, false alerts per camera-hour, and end-to-end latency with confidence
  intervals and an untouched test set; report per-condition results.
- Test stream failures, load, outages and human review workflows; assess the
  system in a supervised pilot. Human reviewers and operational owners must set
  acceptance thresholds and approve intended use.
- Crime recognition, identity, weapon recognition, plate OCR and other unsupported
  capabilities must not be inferred from these object-detection results.

## 2026-10-21 follow-up

See the [visual benchmark](AI_VISUAL_BENCHMARK_2026-10-20.md) for the single-image,
two-truck manual-label smoke test and two-minute synthetic persistence replay.
Neither establishes pilot readiness, camera-hour false-observation rate, nor
end-to-end latency. The legacy evidence analyze endpoint was found to generate
canned detections and now fails closed in the working tree. Real evidence-image
analysis is still unavailable. No model or production confidence threshold
was changed.
