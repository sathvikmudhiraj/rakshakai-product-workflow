import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 30));

test("tracking workspace renders real KPIs, compact sessions, and human-reviewed detail", async () => {
  const dom = new JSDOM('<!doctype html><body><div id="multiCameraTrackingPanel"></div></body>', { url: "http://localhost:3000" });
  const previous = { window: globalThis.window, document: globalThis.document, Event: globalThis.Event, fetch: globalThis.fetch };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  const sessions = [
    { id: "trk-active", trackType: "PERSON", status: "SEARCHING", referenceCameraId: "CAM-01", createdAt: "2026-10-11T08:00:00Z" },
    { id: "trk-review", trackType: "VEHICLE", status: "HUMAN_REVIEW", referenceCameraId: "CAM-02", createdAt: "2026-10-11T08:05:00Z", pendingCandidateCount: 1 },
    { id: "trk-confirmed", trackType: "PERSON", status: "CONFIRMED", referenceCameraId: "CAM-03", createdAt: "2026-10-11T08:10:00Z" },
    { id: "trk-closed", trackType: "VEHICLE", status: "CLOSED", referenceCameraId: "CAM-04", createdAt: "2026-10-11T08:15:00Z" }
  ];
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.endsWith("/tracking/sessions/trk-review")) {
      return new Response(JSON.stringify({
        session: { ...sessions[1], referenceDetectionId: "det-ref", referenceTimestamp: "2026-10-11T08:05:00Z", lastSeenCameraId: "CAM-02", lastSeenAt: "2026-10-11T08:05:00Z" },
        observations: [{ id: "obs-ref", detectionId: "det-ref", cameraId: "CAM-02", detectedAt: "2026-10-11T08:05:00Z", trackType: "VEHICLE", detectionConfidence: .93 }],
        candidates: [{ id: "cand-1", observationId: "obs-next", cameraId: "CAM-05", detectedAt: "2026-10-11T08:09:00Z", status: "PENDING_REVIEW", overallConfidence: .82 }],
        verifications: []
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ sessions }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const module = await import(`../src/components/MultiCameraTracking.js?workspace=${Date.now()}`);
    module.configureTracking({ cameraSources: () => [] });
    module.renderTrackingPage();
    await waitForRender();
    assert.match(document.querySelector(".tracking-header").textContent, /human-reviewed candidate matching/i);
    assert.equal(document.querySelectorAll(".tracking-kpi").length, 4);
    assert.deepEqual([...document.querySelectorAll(".tracking-kpi strong")].map((element) => element.textContent), ["3", "1", "1", "1"]);
    assert.equal(document.querySelectorAll(".session-card").length, 4);
    document.querySelector('[data-session-id="trk-review"]').click();
    await waitForRender();
    assert.match(document.querySelector(".tracking-main").textContent, /Reference Observation/);
    assert.match(document.querySelector(".tracking-main").textContent, /Last Confirmed Seen/);
    assert.match(document.querySelector(".possible-next-sighting").textContent, /Pending human review/);
    assert.match(document.querySelector(".tracking-main").textContent, /Candidates \(1\)/);
    module.cleanupTracking();
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.Event = previous.Event;
    globalThis.fetch = previous.fetch;
    dom.window.close();
  }
});

test("tracking CSS uses natural-height responsive panels without the legacy forced workspace height", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const professionalBlock = css.slice(css.indexOf("/* Professional multi-camera tracking workspace */"), css.indexOf(".copilot-launcher"));
  assert.match(professionalBlock, /grid-template-columns:\s*minmax\(280px, 320px\) minmax\(0, 1fr\)/);
  assert.match(professionalBlock, /min-height:\s*0/);
  assert.match(professionalBlock, /height:\s*fit-content/);
  assert.match(professionalBlock, /@media \(max-width: 1000px\)[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(professionalBlock, /\.tracking-sidebar \{ position: static; top: auto; \}/);
  assert.doesNotMatch(professionalBlock, /min-height:\s*600px/);
});
