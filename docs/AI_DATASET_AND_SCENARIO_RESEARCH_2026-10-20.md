# AI dataset and scenario research — 2026-10-20

## Scope and status

This is research and evaluation material, not a deployed retrieval source. It
does not add scenario text to YOLO, modify the Copilot, or confirm incidents.
The object detector provides observations only; a person must review them.
The structured [dataset manifest](ai-evaluation/visual_dataset_manifest.json)
and [scenario corpus](ai-evaluation/scenario_corpus.json) contain no images or
personal contact information. Synthetic example phrases are authored for this
evaluation, not quotations from witnesses. Source confidence describes the
source type, not verification of a scenario or a technical capability.

## Visual datasets and licensing

| Dataset | Source and suitability | Rights / usage status | Images used in this task |
| --- | --- | --- | ---: |
| COCO8 | [Ultralytics COCO8](https://docs.ultralytics.com/datasets/detect/coco8/), 8-image smoke-test set | [COCO terms](https://github.com/cocodataset/cocodataset.github.io/blob/master/dataset/termsofuse.htm): annotations CC BY 4.0; image copyrights and Flickr terms are separate. Individual image rights require review. | 0 new; 4 val images were measured in the preceding pass. |
| ExDark | [Project](https://github.com/cs-chan/Exclusively-Dark-Image-Dataset), low-light scenes | [Current terms](https://github.com/cs-chan/Exclusively-Dark-Image-Dataset/blob/master/Dataset/DATASET_TERMS.md) require permission for commercial product validation and company-supported research; image rights also separate. No download here. | 0 |
| VisDrone | [Original dataset project](https://github.com/VisDrone/VisDrone-Dataset), aerial small objects and crowds; viewpoint differs from fixed CCTV | Product use and redistribution rights not established. Contact owners before acquisition. | 0 |

COCO8 `val` is selected from COCO train2017 and may overlap model training; it
is not independent field evidence. Previous downloaded COCO8 material is local
temporary data, not redistributed. The earlier public bus/sports examples also
need individual rights review before reuse or redistribution. No new dataset was
downloaded in this pass because terms for the intended product evaluation were
not established. The next expanded dataset should only include image-level
rights and attribution that have been checked for the intended use.

## Public-safety and community sources

- [India ERSS 112](https://112.gov.in/) describes police, fire and medical
  emergency assistance. It supports broad response categories, not a claim that
  the detector recognizes those emergencies.
- [NIST public-safety video research](https://www.nist.gov/ctl/pscr/multi-tiered-video-analytics-abnormality-detection-and-alerting)
  discusses left-object and perimeter-crossing research and the difficulty of
  real-world video and workflow integration. Neither capability is validated by
  the existing single-frame object detector.
- One manually accessed public [community discussion](https://www.reddit.com/r/indianrailways/comments/1exwfqh)
  was reviewed as an unverified account about reporting an unattended bag. The
  corpus stores only a short generic scenario and source URL, with no username,
  personal contact, exact journey details, or copied post. It is not evidence
  that a bag is dangerous or that any incident occurred. No automated scraping
  was performed; community content was not used for visual ground truth.

## Taxonomy and test phrases

The corpus covers missing-person reports, road incidents, crowd congestion,
public-disturbance reports, unattended items, restricted-zone reports, vehicle
violations, medical emergencies, fire/smoke reports, and assault/theft **case
reports**. Each item records the suggested module, human-review requirement,
source and limitations. The 112 source supports the overall emergency-response
context; the synthetic subcategories and phrases are evaluation hypotheses,
not official definitions or verified reports.

Observable behavior vocabulary for possible future, separately validated
analytics: walking, running, standing, sitting, lying/fallen person, crowd
forming/dispersing, entering/leaving a configured region, vehicle stopped, and
multiple people moving rapidly. These are not claims that the present detector
recognizes actions. Never infer identity, personality, guilt, criminal intent,
danger, panic, assault, or theft from object detection. Descriptions involving
injury or falling require particular care and human verification.

Example prompts in the corpus include a crowd near a gate, a reported person on
the road, a bike reportedly entering a restricted lane, and a bag near an
entrance. These are **proposed tests, not tests executed against Copilot** and
must not automatically create incidents.

## Vision benchmark results and gaps

No expanded visual benchmark was run in this pass. The previous four-image
COCO8 result is recorded in [AI scenario evaluation](AI_SCENARIO_EVALUATION_2026-10-20.md):
at threshold 0.50, person TP 1, FP 0, FN 9, precision 1.00, recall 0.10 and F1
0.182; other requested classes had no labeled examples. This small, potentially
training-overlapping sample cannot establish field accuracy. Prior warmed model
timing was p50 88 ms and p95 155.1 ms over 40 original/transformed frames, not
end-to-end latency. False alerts per camera-hour and end-to-end latency remain
unmeasured.

The requested close/distant vehicles, motorcycles, buses, trucks, bicycles,
crowds, true night/weather, camera shake, hard negatives, object size and
occlusion strata have **not** been covered by a representative labeled set.
Acquire licensed, independently labeled images or authorized local footage;
record class, size, occlusion and conditions; include empty/negative video;
measure TP/FP/FN, precision/recall/F1, misses per 100 objects, false alerts per
camera-hour and camera-to-observation latency with uncertainty. Confirm rights,
privacy, retention and access controls before using any footage.

## Follow-up — 2026-10-21: sourced scenario examples

Six additional structured entries in the [scenario corpus](ai-evaluation/scenario_corpus.json)
use UK Health and Safety Executive event guidance, Singapore Police Force's 31 July
2025 event advisory, UK Police collision guidance, FEMA hurricane preparedness,
and NIST research. They describe guidance and anticipated conditions, not verified
observations from particular CCTV incidents. Dates absent from the source are null.
Example phrases are authored, not attributed as witness quotations. Source review
is not a frequency study: frequencies remain **NOT MEASURED**. Community material
remains anecdotal. The corpus is evaluation-only and is not YOLO training data.
Person and five vehicle classes remain testable object signals; crowd flow,
queue formation, bottlenecks, zone crossing and unattended-object persistence
remain **VALIDATION_REQUIRED**. No identity, intent, guilt, or political attributes
are inferred.
