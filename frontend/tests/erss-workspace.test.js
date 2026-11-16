import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("ERSS workspace has responsive professional layout styles", () => {
  assert.match(css, /\.erss-call-taker-workspace/);
  assert.match(css, /\.erss-dispatcher-workspace/);
  assert.match(css, /@media \(max-width: 900px\)/);
});

test("ERSS browser realtime listeners use canonical approved and fallback event names", () => {
  assert.match(app, /import \{ api, erssApi \} from "\.\/services\/api\.js"/);
  assert.match(app, /erss_dispatch_approved/);
  assert.match(app, /erss_fallback_recommended/);
  assert.doesNotMatch(app, /erss_fallback_ready/);
});
