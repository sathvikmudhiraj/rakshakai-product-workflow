import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { detectionBadgeText, renderDetectionBoxes } from "../src/liveVisionOverlay.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

function buildLayer() {
  const dom = new JSDOM(`<!doctype html><div id="liveDetectionBoxes"></div>`);
  return { dom, layer: dom.window.document.querySelector("#liveDetectionBoxes") };
}

test("Live Vision overlay renders multiple detections with labels and confidence", () => {
  const { layer } = buildLayer();
  renderDetectionBoxes([
    { label: "Person", confidence: 0.92, box: [10, 20, 100, 160] },
    { label: "Backpack", confidence: 0.74, box: [140, 30, 60, 80] }
  ], 200, 400, layer);

  const boxes = [...layer.querySelectorAll(".detection-box")];
  const badges = [...layer.querySelectorAll(".detection-label-badge")].map((badge) => badge.textContent);

  assert.equal(boxes.length, 2, "every detection must render a bounding box");
  assert.deepEqual(badges, ["Person 92%", "Backpack 74%"]);
  assert.equal(boxes[0].style.left, "5%");
  assert.equal(boxes[1].style.left, "70%");
});

test("Live Vision overlay keeps suppressing identity claims on rendered boxes", () => {
  const { layer } = buildLayer();
  renderDetectionBoxes([{ label: "Recognized: Admin", confidence: 0.99, box: [0, 0, 1, 1] }], 1, 1, layer);
  assert.equal(layer.querySelector(".detection-label-badge").textContent, "Object 99%");
  assert.equal(detectionBadgeText({ className: "Vehicle", confidence: 1 }), "Vehicle 100%");
});

test("Live Vision sampling options stay inside the dedicated AI-frame limiter budget", () => {
  const indexHtml = fs.readFileSync(path.join(root, "frontend", "index.html"), "utf8");
  const backendEnvExample = fs.readFileSync(path.join(root, "backend", ".env.example"), "utf8");

  const selectBlock = indexHtml.match(/<select id="liveVisionInterval">([\s\S]*?)<\/select>/)?.[1] || "";
  const intervals = [...selectBlock.matchAll(/value="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(intervals, [800, 1000, 1500],
    "Live Vision sampling options must remain 800/1000/1500 ms");

  const frameLimit = Number(backendEnvExample.match(/AI_FRAME_RATE_LIMIT=(\d+)/)?.[1]);
  assert.ok(Number.isFinite(frameLimit) && frameLimit >= 75,
    "AI_FRAME_RATE_LIMIT must allow the fastest intended sampling rate (one frame every 800 ms = 75 requests/minute)");
  assert.ok(75 / frameLimit <= 0.5,
    "the fastest intended sampling rate must stay under half of the dedicated AI-frame budget");
});
