import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { detectionBadgeText, renderDetectionBoxes } from "../src/liveVisionOverlay.js";

function buildLayer() {
  const dom = new JSDOM(`<!doctype html><div id="liveDetectionBoxes"></div>`);
  return { dom, layer: dom.window.document.querySelector("#liveDetectionBoxes") };
}

test("Live Vision overlay renders bounding box label and confidence", () => {
  const { layer } = buildLayer();
  renderDetectionBoxes([{ label: "Person", confidence: 0.92, box: [10, 20, 100, 160] }], 200, 400, layer);

  const box = layer.querySelector(".detection-box");
  const badge = layer.querySelector(".detection-label-badge");

  assert.ok(box, "bounding box must render");
  assert.equal(box.style.left, "5%");
  assert.equal(box.style.top, "5%");
  assert.equal(box.style.width, "50%");
  assert.equal(box.style.height, "40%");
  assert.equal(badge.textContent, "Person 92%");
});

test("Live Vision overlay supports alternate detection field names", () => {
  const { layer } = buildLayer();
  renderDetectionBoxes([{ className: "Vehicle", score: 87, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }], 1, 1, layer);

  assert.equal(layer.querySelector(".detection-label-badge").textContent, "Vehicle 87%");
  assert.equal(layer.querySelector(".detection-box").style.left, "10%");
});

test("Live Vision overlay uses safe fallback and does not show identity claims", () => {
  assert.equal(detectionBadgeText({ confidence: 0.4, box: [0, 0, 1, 1] }), "Object 40%");
  assert.equal(detectionBadgeText({ label: "Face match: Rahul", confidence: 0.99, box: [0, 0, 1, 1] }), "Object 99%");
});
