# Rights-screened visual evaluation — 2026-10-20

**Decision: AI PERFORMANCE: NEEDS TARGETED IMPROVEMENT.** This pass is not a
field-pilot acceptance benchmark. Dataset rights screening and a small smoke
test are complete; the requested representative labeled benchmark is not.

## Dataset and license review

See [visual manifest](ai-evaluation/visual_dataset_manifest.json) for source,
image and annotation rights, intended use and status. An individually reviewed
CC0 street photograph by Gary Todd is approved for local exploratory use:
[Wikimedia Commons file page](https://commons.wikimedia.org/wiki/File:1991_Beijing_Street_with_Bicycles_%26_Bus_(10564018185).jpg).
The page records CC0 and commercial reuse; attribution is not required by CC0,
but credit is retained. Rights outside copyright, including privacy, can still
apply. It has no independently verified bounding-box annotations, so it is
**not a labeled benchmark**. The file remains in a local temporary directory.

COCO8 remains blocked for further product evaluation until image-by-image Flickr
rights are reviewed; its annotations have separate CC BY 4.0 terms. Open Images
also requires individual license verification per its
[official licensing notice](https://storage.googleapis.com/openimages/web/factsfigures_v7.html).
ExDark commercial evaluation needs permission under its current terms; VisDrone
product rights remain unresolved. No restricted dataset was downloaded in this
pass. Earlier COCO8 data is not counted as approved for this benchmark.

## Current model, no changes

- YOLOv8n CPU; deployed confidence threshold 0.50, approved service class filter.
- Approved labeled objects: **0** for person, car, motorcycle, bus, truck and
  bicycle. Precision, recall, F1, FP and FN by class and overall: **not
  measurable**. No threshold sweep or model comparison has an adequate labeled
  basis; no best threshold is selected and the threshold and model are unchanged.
- One CC0 original image, ten original/derived frames: unlabeled exploratory
  counts, not accuracy. At 0.50 the original returned 5 persons, 3 bicycles,
  1 bus. Very dark returned 4/2/0; low contrast 3/2/0; center occlusion 3/3/1.
  These figures do not establish whether the detections are correct or complete.
  No target-class ground truth was authored from the model's output.
- One hundred deterministic **synthetic** negative frames containing blank
  backgrounds, basic rectangles, noise and lines: raw detections 0, operational
  detections 0, i.e. 0/100 for each on these inputs. They are not actual empty
  streets, rooms, posters, reflections, trees, headlights, rain or video; no
  claim is made about real false-positive or false-alert rates.
- False alerts per camera-hour, end-to-end p50/p95, labeled performance by
  object size/occlusion/lighting and night/weather accuracy: **not measured**.
  Earlier 40-frame inference p50 88 ms and p95 155.1 ms used an unapproved-for-
  further-use COCO8 smoke-test sample, not this rights-screened benchmark.

## Stream checks and rebuild

The backend-only Docker image was rebuilt after 24 relevant gateway/AI tests
passed. The running backend is healthy and an isolated in-container mock
confirmed that a frame timestamped two seconds old was not analyzed or recorded
as a new frame with a one-second freshness limit. No database reset or volume
deletion was performed. Startup runs the existing migration/import checks.

An isolated in-memory probe supplied 31 identical frames over a simulated 30
seconds with fresh timestamps. The gateway issued **31 AI calls** and reported
`STREAMING`. The probe used no observation persistence, so it does not establish
the number of duplicate observations; it demonstrates that the current gateway
does not reliably recognize a frozen source. No speculative freeze-blocking
algorithm was enabled, since a genuinely static scene can also produce similar
frames. Near-identical frames, source PTS, 5-second freezes, reconnect after
freeze, service restart and camera-to-observation timing remain unverified.
Existing tests cover timeout, outage, disconnect, reconnect, sampling and human
review but do not constitute full end-to-end recovery or camera-hour testing.

## Next steps

Obtain or create a rights-cleared, independently annotated, representative
sample including all six classes and genuine negative scenes; obtain permission
for real-world footage and agree privacy/retention conditions. Evaluate labeled
object and condition strata, negatives, thresholds and end-to-end latency.
Separately validate a freeze strategy using real static and motion scenes before
it can prevent repeat observations without suppressing valid activity.

## Additional public-only investigation

An individually rights-reviewed [CC0 aerial road photograph](https://commons.wikimedia.org/wiki/File:Empty_Roads_1_(Unsplash).jpg)
by Matt Seymour was manually reviewed once as an exploratory negative image.
At the current 0.50 threshold the raw model returned one `train` detection;
`train` is not in the deployed operational allowlist, so it would be filtered
before operational output. This is one aerial still, not fixed CCTV; small or
distant content requires a second independent review and this is not a credible
false-positive rate or a camera-hour test. The public image remains in a local
temporary directory and is not committed. An additional CC0 road photograph was
inspected but excluded as a negative because a distant vehicle-like shape could
not be ruled out.

`node backend/scripts/evaluate-frame-repetition.js` replays exact synthetic
bytes for 5 and 30 seconds and alternating near-identical bytes for 30 seconds,
then checks a changed frame. With an isolated mock AI and a no-write observation
callback, every submitted frame was sent for AI: 6/6, 31/31, 31/31 and 7/7
respectively. This exposes missing duplicate/freeze identification but **does
not measure stored observations**. No automatic frame blocking was added:
static real scenes can produce identical frames, and suppressing them without
validated capture timestamps and recovery behavior could hide legitimate data.

## Follow-up — 2026-10-21: rights-cleared labeled truck smoke test

One additional [CC0 photograph by Brad232](https://commons.wikimedia.org/wiki/File:PenskeRamp.jpg)
was downloaded locally after reviewing its file page and copyright dedication.
The [manifest](ai-evaluation/visual_dataset_manifest.json) records provenance;
[manual ground truth](ai-evaluation/penske_ground_truth.json) contains two
approximately drawn truck boxes, made by one reviewer before inference. The
partially occluded pickup was labeled truck; this choice and box geometry have not
been independently reviewed. This is an ordinary still, not CCTV or an independent
representative sample. No photo is committed.

On the original image, existing YOLOv8n CPU at 640 input, 0.50 confidence,
max 30 detections and IoU matching 0.50 gave truck TP 2, FP 0, FN 0: precision,
recall and F1 each 1.0 **on these two manually labeled objects only**. Person,
car, motorcycle, bus and bicycle each have zero labeled objects; their metrics
are undefined. Sweep 0.30, 0.35, 0.40, 0.45, 0.50, 0.55 and 0.60 each gave
truck 2/0/0, using a single prediction at 0.30 and post-filtering. These data do
not justify changing the threshold or model. At 0.50, original, darkened,
overexposed and low-contrast frames produced two truck detections each; very dark,
mild/strong blur, JPEG, center occlusion and low resolution produced one each.
Variants are unlabeled, so these are counts, not condition-specific accuracy.
The ten warmed model-call times gave nearest-rank p50 49.4 ms, p95/max 66.8 ms;
this tiny set is not camera-to-observation latency or a capacity estimate.

An isolated 120-second simulated clock replay using the **real observation
persistence code**, a mock AI response and synthetic JPEG-like bytes yielded 121
frames received, 121 requests/responses, one pending observation with 121
occurrences, zero alerts and zero incidents. Run
`node backend/scripts/evaluate-persisted-repetition.js`. This exercises the
JSON persistence implementation, not a physical camera, production database,
real inference, near-identical images or capture timestamps. The same-label
sliding dedupe may also merge distinct real objects; it is not proof of safe
freeze classification or adequate recall. Earlier 5/30-second mock tests still
show repeated frames sent to AI. Camera-to-observation latency and false
observations per camera-hour remain NOT YET MEASURABLE.

The existing uploaded-evidence analyze route was found to create canned detections
without examining media. The working tree now fails it closed with HTTP 503 and
preserves evidence and existing review records. Actual JPEG/PNG/WEBP image
inference, content/dimension validation and duplicate-evidence re-analysis are
**not implemented or validated**. Face quality is not implemented. This change
is not deployed to the running container. Human review tests for gateway
observations pass, but this does not validate evidence image analysis.

A second rights-cleared [CC0 car photograph by Tokumeigakarinoaoshima](https://commons.wikimedia.org/wiki/File:Citro%C3%ABn_C-ZERO.jpg)
was labeled before inference: two approximate car boxes, one heavily occluded.
See [local ground truth](ai-evaluation/citroen_ground_truth.json). At 0.50 this
image produced no target detections: car TP 0, FP 0, FN 2. At 0.30, 0.35 and
0.40 it produced car TP 1, FP 0, FN 1; at 0.45–0.60 it produced 0/0/2. The
boxes have a single reviewer and the visible-only occluded box is uncertain.
Across both original stills the exploratory aggregate at 0.50 is TP 2, FP 0,
FN 2 (precision 1.0, recall 0.5, F1 0.667); truck 2/0/0, car 0/0/2, all other
classes have no labeled instances. It is not a field estimate. Across 20 warm
single-frame model calls for the originals and transformations, p50 66.8 ms,
p95 87.2 ms and max 105.1 ms; model-call timing only, no camera or observation
latency. Different images were run sequentially in separate warmed invocations.
