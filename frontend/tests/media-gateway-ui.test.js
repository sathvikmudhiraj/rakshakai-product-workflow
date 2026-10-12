import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const realtime = fs.readFileSync(path.join(root, "src", "services", "realtime.js"), "utf8");
const notifications = fs.readFileSync(path.join(root, "src", "components", "NotificationCenter.js"), "utf8");

test("CCTV UI separates real/demo, stream, gateway, and AI states", () => {
  assert.match(html, /AI Observation Queue/);
  assert.match(html, /Stream processing/);
  assert.match(html, /AI sample interval/);
  assert.match(app, /streamState/);
  assert.match(app, /gatewayHealth/);
  assert.match(app, /aiState/);
  assert.match(app, /Credentials are never sent to this browser/);
  assert.match(app, /camera\.isDemo \? "DEMO"/);
  assert.doesNotMatch(app, /camera\.streamUrl|camera\.rtspUrl|camera\.password/);
});

test("human-review UI is advisory and offers confirm, reject, and uncertain decisions", () => {
  assert.match(app, /AI result is advisory\. Human verification is required/);
  assert.match(app, /\["Confirm", "CONFIRMED"/);
  assert.match(app, /\["Reject", "REJECTED"/);
  assert.match(app, /\["Mark Uncertain", "UNCERTAIN"/);
  assert.match(app, /Confirmation creates an alert, not an incident/);
  assert.match(app, /\/api\/ai-observations\/\$\{encodeURIComponent/);
});

test("gateway realtime and notification navigation open authoritative camera or observation records", () => {
  for (const event of ["camera_stream_state_changed", "camera_reconnected", "observation_created", "observation_reviewed", "ai_service_unavailable"]) {
    assert.match(realtime, new RegExp(event));
  }
  assert.match(notifications, /ai_observation: "cctv"/);
});

test("observation queue is responsive without horizontal overflow", () => {
  assert.match(css, /\.ai-observation-card\s*\{[^}]*grid-template-columns:/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.ai-observation-card\s*\{\s*grid-template-columns: 1fr/);
  assert.match(css, /\.ai-observation-body\s*\{[^}]*min-width: 0/s);
  assert.match(css, /\.ai-observation-card\s*\{[^}]*overflow: hidden/s);
});
