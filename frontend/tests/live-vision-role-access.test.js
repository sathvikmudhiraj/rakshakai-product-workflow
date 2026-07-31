import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isOperatorRole, landingForRole, loadAiVisionData, resolveViewAccess } from "../src/roleAccess.js";

const RESTRICTED_PATHS = ["/api/camera-feeds", "/api/camera-sources", "/api/video-evidence", "/api/ai/health"];

const HTML = `<!doctype html><html><body>
  <h1 id="viewTitle">RakshakAI</h1>
  <p id="permissionMessage" class="form-status error restricted-hidden" role="alert"></p>
  <nav>
    <button class="nav-item" data-view="dashboard" data-roles="Police Officer,Admin">Dashboard</button>
    <button class="nav-item" data-view="live-vision" data-roles="Police Officer,Admin">Live Vision</button>
    <button class="nav-item" data-view="missing" data-roles="Police Officer,Admin,Citizen">Missing Persons</button>
  </nav>
  <section class="view" data-panel="dashboard"></section>
  <section class="view" data-panel="live-vision"></section>
  <section class="view" data-panel="missing"></section>
</body></html>`;

function buildDom() {
  const dom = new JSDOM(HTML);
  const { document } = dom.window;
  const applyNavVisibility = (role) => {
    document.querySelectorAll(".nav-item").forEach((button) => {
      const roles = String(button.dataset.roles || "").split(",").map((r) => r.trim()).filter(Boolean);
      button.hidden = !(roles.length === 0 || roles.includes(role));
    });
  };
  return { dom, document, applyNavVisibility };
}

function recordApi(responses = {}) {
  const calls = [];
  const api = (path) => {
    calls.push(path);
    const handler = responses[path];
    if (handler) return Promise.resolve(typeof handler === "function" ? handler() : handler);
    return Promise.resolve({});
  };
  return { api, calls };
}

test("Citizen pure helper behavior: landing fallback and non-operator role", () => {
  assert.equal(landingForRole("Citizen"), "missing");
  assert.equal(isOperatorRole("Citizen"), false);
});

test("Citizen opening /rakshak/live-vision executes production access logic and falls back to missing", () => {
  const { document, applyNavVisibility } = buildDom();
  applyNavVisibility("Citizen");
  const liveNav = document.querySelector('.nav-item[data-view="live-vision"]');
  const missingNav = document.querySelector('.nav-item[data-view="missing"]');
  assert.equal(liveNav.hidden, true, "fixture must hide live-vision for Citizen");

  const resolved = resolveViewAccess({ view: "live-vision", role: "Citizen", document });

  assert.equal(resolved, "missing", "Citizen must resolve to missing");
  assert.equal(document.body.dataset.view, "missing");

  assert.equal(document.querySelector('.nav-item[data-view="live-vision"]').classList.contains("active"), false);
  assert.equal(document.querySelector('.nav-item[data-view="live-vision"]').getAttribute("aria-current"), "false");
  assert.equal(document.querySelector('.nav-item[data-view="missing"]').classList.contains("active"), true);
  assert.equal(document.querySelector('.nav-item[data-view="missing"]').getAttribute("aria-current"), "page");

  assert.equal(document.querySelector('[data-panel="live-vision"]').classList.contains("active"), false);
  assert.equal(document.querySelector('[data-panel="missing"]').classList.contains("active"), true);

  const permission = document.querySelector("#permissionMessage");
  assert.equal(permission.textContent, "You do not have permission to view this operational page.");
  assert.equal(permission.classList.contains("restricted-hidden"), false, "permission message must be visible");

  assert.equal(document.querySelector("#viewTitle").textContent, "Missing & Found Report Center");
});

test("Citizen AI Vision data loading calls api() zero times and returns safe empty results", async () => {
  const { api, calls } = recordApi();
  const role = "Citizen";
  const { cameras, sources, videoEvidence, aiHealth } = await loadAiVisionData({ role, api });

  assert.equal(calls.length, 0, "Citizen must not invoke any operational AI Vision API");
  for (const path of RESTRICTED_PATHS) assert.ok(!calls.includes(path), `${path} must not be requested for Citizen`);

  assert.deepEqual(cameras, { cameras: [] });
  assert.deepEqual(sources, { sources: [] });
  assert.deepEqual(videoEvidence, { evidence: [], observations: [] });
  assert.deepEqual(aiHealth, { configured: false, status: "restricted" });
});

test("Police Officer opening live-vision stays allowed and issues operational AI Vision requests", async () => {
  const { document, applyNavVisibility } = buildDom();
  applyNavVisibility("Police Officer");
  const liveNav = document.querySelector('.nav-item[data-view="live-vision"]');
  assert.equal(liveNav.hidden, false, "fixture must allow live-vision for Police Officer");

  const resolved = resolveViewAccess({ view: "live-vision", role: "Police Officer", document });

  assert.equal(resolved, "live-vision");
  assert.equal(document.body.dataset.view, "live-vision");
  assert.equal(document.querySelector('.nav-item[data-view="live-vision"]').classList.contains("active"), true);
  assert.equal(document.querySelector('.nav-item[data-view="live-vision"]').getAttribute("aria-current"), "page");
  assert.equal(document.querySelector('[data-panel="live-vision"]').classList.contains("active"), true);
  const permission = document.querySelector("#permissionMessage");
  assert.equal(permission.classList.contains("restricted-hidden"), true, "no permission warning for operator");
  assert.equal(permission.textContent, "");
  assert.equal(document.querySelector("#viewTitle").textContent, "Rakshak Live Vision");

  const responses = {
    "/api/camera-feeds": { cameras: [{ id: "c1", name: "Gate A" }] },
    "/api/camera-sources": { sources: [{ id: "s1", name: "NVR" }] },
    "/api/video-evidence": { evidence: [{ id: "v1" }], observations: [] },
    "/api/ai/health": { configured: true, status: "connected" }
  };
  const { api, calls } = recordApi(responses);
  const { cameras, sources, videoEvidence, aiHealth } = await loadAiVisionData({ role: "Police Officer", api });

  assert.deepEqual(calls.sort(), [...RESTRICTED_PATHS].sort(), "operator must call all operational AI Vision endpoints");
  assert.equal(cameras.cameras.length, 1);
  assert.equal(sources.sources.length, 1);
  assert.equal(videoEvidence.evidence.length, 1);
  assert.deepEqual(videoEvidence.observations, []);
  assert.equal(aiHealth.status, "connected");
});
