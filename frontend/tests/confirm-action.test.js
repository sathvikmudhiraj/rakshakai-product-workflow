import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { confirmAction } from "../src/confirmAction.js";

test("confirmAction uses a stubbed window.confirm when tests replace the native dialog", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost:3000" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  window.confirm = () => true;
  assert.equal(await confirmAction("Replace native dialog?"), true);
  assert.equal(document.getElementById("appConfirmDialog"), null);
  window.confirm = () => false;
  assert.equal(await confirmAction("Stay on page?"), false);
  dom.window.close();
});
