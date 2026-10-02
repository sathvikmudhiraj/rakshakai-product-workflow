const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium, firefox, webkit } = require("playwright");

const browserTypes = { chromium, firefox, webkit };
const browserNames = String(process.env.RELEASE_TEST_BROWSERS || "chromium,firefox,webkit")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

for (const name of browserNames) {
  if (!browserTypes[name]) throw new Error(`Unsupported release browser: ${name}`);
}

function launchOptions(name) {
  if (name === "chromium") return { channel: "chromium", args: ["--use-fake-device-for-media-stream"] };
  if (name === "firefox") return { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } };
  return {};
}

async function waitForUsableMapLayer(page, key, host) {
  await page.waitForFunction(({ key, host }) => {
    const map = document.querySelector("#gisMap");
    const button = document.querySelector(key === "satellite" ? "#satelliteMapLayer" : "#streetMapLayer");
    const tiles = [...map.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")];
    const usable = tiles.filter((tile) => {
      const rect = tile.getBoundingClientRect();
      const style = getComputedStyle(tile);
      return tile.src.includes(host)
        && tile.isConnected
        && tile.complete
        && tile.naturalWidth > 0
        && tile.naturalHeight > 0
        && rect.width > 0
        && rect.height > 0
        && style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0.01;
    });
    return map.dataset.baseLayer === key
      && map.classList.contains("tiles-ready")
      && button?.getAttribute("aria-pressed") === "true"
      && usable.length > 0;
  }, { key, host }, { timeout: 15000 });
  const report = await page.locator("#gisMap").evaluate((map, { key, host }) => {
    const layers = [...map.querySelectorAll(".leaflet-tile-pane > .leaflet-layer")]
      .filter((layer) => getComputedStyle(layer).display !== "none" && Number.parseFloat(getComputedStyle(layer).opacity || "1") > 0.01);
    const tiles = [...map.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")]
      .filter((tile) => tile.src.includes(host) && tile.complete && tile.naturalWidth > 0 && tile.naturalHeight > 0);
    return { key, activeLayers: layers.length, usableTiles: tiles.length, status: map.querySelector(".map-status")?.textContent || "" };
  }, { key, host });
  assert.equal(report.activeLayers, 1, `${key} must have exactly one visible base layer`);
  assert.ok(report.usableTiles > 0, `${key} must have a usable viewport tile`);
  assert.match(report.status, new RegExp(key === "satellite" ? "Satellite tiles" : "OpenStreetMap tiles", "i"));
}

async function checkGisLayout(page, viewport) {
  const result = await page.locator('[data-panel="gis"]').evaluate((panel, viewport) => {
    const toolbar = panel.querySelector(".gis-toolbar");
    const topbar = document.querySelector(".topbar");
    const map = panel.querySelector("#gisMap");
    const labels = [...toolbar.querySelectorAll(".gis-button-label")];
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      clippedLabels: labels.filter((label) => label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1).map((label) => label.textContent.trim()),
      topbarPosition: getComputedStyle(topbar).position,
      topbarOverMap: overlap(topbar.getBoundingClientRect(), map.getBoundingClientRect()),
      horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
      viewport
    };
  }, viewport);
  assert.deepEqual(result.clippedLabels, [], "GIS action labels must remain readable");
  assert.equal(result.horizontalOverflow, false, "GIS panel must not overflow horizontally");
  if (viewport.width <= 720) {
    assert.equal(result.topbarPosition, "static", "Mobile header must not cover GIS controls");
    assert.equal(result.topbarOverMap, false, "Mobile header must not overlap the map");
  }
}

async function checkEvidenceUpload(page, role, width) {
  // Generate a playable synthetic clip, never a recording of an operator or device.
  const media = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const stream = canvas.captureStream(10);
    const mimeType = ["video/webm;codecs=vp8", "video/webm", "video/mp4"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("No supported evidence recording format in this browser");
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = resolve;
      recorder.onerror = reject;
    });
    try {
      recorder.start();
      const context = canvas.getContext("2d");
      for (let i = 0; i < 5; i++) {
        context.fillStyle = i % 2 ? "#008577" : "#ffffff";
        context.fillRect(0, 0, 160, 120);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      await stopped;
      return { bytes: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())), mimeType };
    } finally { stream.getTracks().forEach((track) => track.stop()); }
  });
  await page.locator('.nav-item[data-view="video-evidence"]').click();
  await page.waitForFunction(() => document.querySelector("#videoLinkedIncident").options.length > 1);
  await page.locator("#videoLinkedIncident").selectOption({ index: 1 });
  await page.locator("#videoEvidenceFile").setInputFiles({
    name: `acceptance-${role.replaceAll(" ", "-")}-${width}.${media.mimeType.includes("mp4") ? "mp4" : "webm"}`,
    mimeType: media.mimeType.split(";")[0], buffer: Buffer.from(media.bytes)
  });
  const upload = page.waitForResponse((response) => response.url().endsWith("/api/video-evidence") && response.request().method() === "POST");
  await page.locator('#videoEvidenceForm button[type="submit"]').click();
  const response = await upload;
  assert.equal(response.status(), 201, "Evidence upload must persist successfully");
  const { evidence } = await response.json();
  await page.waitForFunction((id) => {
    const video = document.querySelector("#videoReviewSplit video");
    return video?.src.includes(id) && video.videoWidth > 0 && video.readyState >= 2;
  }, evidence.id);
  const preview = page.locator("#videoReviewSplit video");
  await preview.evaluate(async (video) => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector("#videoReviewSplit video").currentTime > 0);
  await preview.evaluate((video) => video.pause());
  assert.match(await page.locator("#videoReviewSplit").innerText(), /Human verification is required/i);
}

async function runBrowserChecks({ baseUrl, password }) {
  const users = JSON.parse(fs.readFileSync(path.join(__dirname, "../backend/data/db.example.json"), "utf8")).users;
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-browser-release-"));
  let scenarios = 0;
  for (const browserName of browserNames) {
    const browser = await browserTypes[browserName].launch(launchOptions(browserName));
    try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const role of ["Admin", "Police Officer", "Citizen"]) {
        const context = await browser.newContext({
          viewport,
          permissions: browserName === "firefox" ? ["geolocation"] : ["camera", "geolocation"],
          geolocation: { latitude: 17.5109, longitude: 78.3276 },
          // The isolated harness is HTTP; production CSP upgrades WebKit assets to HTTPS.
          // CSP itself is verified by integration tests and enforced in Chromium/Firefox.
          bypassCSP: browserName === "webkit"
        });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        const failedRequests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(new URL(request.url()).pathname));
        page.on("requestfailed", (request) => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText || "failed" }));
        await page.addInitScript(() => {
          window.releaseCspViolations = [];
          document.addEventListener("securitypolicyviolation", (event) => window.releaseCspViolations.push(event.effectiveDirective));
        });
        try {
          await page.goto(baseUrl, { waitUntil: "networkidle" });
          assert.notEqual(await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily), '"Times New Roman"');
          await page.locator('#loginForm input[name="email"]').fill(users.find((user) => user.role === role).email);
          await page.locator('#loginForm input[name="password"]').fill(password);
          const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/login" && response.request().method() === "POST");
          await page.locator('#loginForm button[type="submit"]').click();
          assert.equal((await loginResponse).status(), 200, "Browser login must succeed");
          await page.locator("#logoutButton").waitFor({ state: "visible" });
          assert.equal(requests.filter((route) => route === "/api/auth/login").length, 1);
          if (role === "Citizen") {
            await page.goto(`${baseUrl}/rakshak/live-vision`, { waitUntil: "networkidle" });
            await page.waitForFunction(() => document.body.dataset.view === "missing");
            assert.match(await page.locator("#permissionMessage").innerText(), /permission/i);
            assert.equal(requests.some((route) => /^\/api\/ai\//.test(route)), false);
          } else {
            if (role === "Police Officer") assert.equal(await page.locator('.nav-item[data-view="settings"]').isVisible(), false);
            await page.locator('.nav-item[data-view="gis"]').click();
            await page.locator("#gisMap .leaflet-tile-pane").waitFor({ state: "attached" });
            await waitForUsableMapLayer(page, "satellite", "server.arcgisonline.com");
            await page.locator("#streetMapLayer").click();
            await waitForUsableMapLayer(page, "streets", "tile.openstreetmap.org");
            await page.locator("#satelliteMapLayer").click();
            await waitForUsableMapLayer(page, "satellite", "server.arcgisonline.com");
            await checkGisLayout(page, viewport);
            assert.equal(await page.locator("#navigateMap").isDisabled(), true);
            await page.locator("#useMyLocation").click();
            await page.waitForFunction(() => !document.querySelector("#useMyLocation").disabled);
            assert.equal(await page.locator("#navigateMap").isDisabled(), true);
            await page.locator("#setMapDestination").click();
            const map = page.locator("#gisMap");
            await map.scrollIntoViewIfNeeded();
            const bounds = await map.boundingBox();
            await map.click({ position: { x: bounds.width * 0.65, y: bounds.height * 0.65 } });
            await page.waitForFunction(() => !document.querySelector("#navigateMap").disabled);
            const routeResponse = page.waitForResponse((response) => response.url().endsWith("/api/maps/route") && response.request().method() === "POST");
            await page.locator("#navigateMap").click();
            assert.equal((await routeResponse).status(), 200);
            await page.waitForFunction(() => !document.querySelector("#recalculateRoute").disabled);
            await page.locator("#clearMapRoute").click();
            assert.equal(await page.locator("#navigateMap").isDisabled(), true);
            assert.equal(await page.locator("#clearMapRoute").isDisabled(), true);
            await waitForUsableMapLayer(page, "satellite", "server.arcgisonline.com");
            await page.screenshot({ path: path.join(screenshots, `gis-${browserName}-${role.replaceAll(" ", "-")}-${viewport.width}.png`), fullPage: true });
            await page.locator('.nav-item[data-view="live-vision"]').click();
            await page.locator("#startLiveVision").click();
            const cameraSupported = await page.evaluate(() => Boolean(navigator.mediaDevices?.getUserMedia));
            if (cameraSupported) {
              await page.waitForFunction(() => {
                const video = document.querySelector("#liveVisionVideo");
                return video.videoWidth > 0 && video.videoHeight > 0;
              });
              await page.locator("#stopLiveVision").click();
              if (browserName === "firefox") {
                await page.evaluate(() => {
                  navigator.mediaDevices.getUserMedia = async () => {
                    throw new DOMException("Camera permission denied for acceptance test", "NotAllowedError");
                  };
                });
              } else {
                await context.clearPermissions();
                await context.grantPermissions(["geolocation"], { origin: baseUrl });
              }
              await page.locator("#startLiveVision").click();
              await page.waitForFunction(() => document.querySelector("#liveVisionError").textContent.includes("permission denied"));
              if (browserName !== "firefox") await context.grantPermissions(["camera", "geolocation"], { origin: baseUrl });
            } else {
              await page.waitForFunction(() => document.querySelector("#liveVisionError").textContent.includes("not supported"));
            }
            await checkEvidenceUpload(page, role, viewport.width);
          }
          assert.deepEqual(errors, [], "No uncaught browser errors");
          assert.deepEqual(await page.evaluate(() => window.releaseCspViolations), [], "No CSP violations");
          await page.locator("#logoutButton").click();
          await page.locator("#loginForm").waitFor({ state: "visible" });
          scenarios++;
          console.log(`Browser passed: ${browserName}, ${role}, ${viewport.width}x${viewport.height}`);
        } catch (error) {
          // Do not capture the login form or entered credentials on failure.
          console.error(`Browser scenario failed: ${browserName}, ${role}, ${viewport.width}x${viewport.height}`);
          console.error(String(error.stack || "").split("\n").filter((line) => line.includes("browser-release.cjs")).join("\n"));
          console.error(await page.evaluate(({ browserErrors, failedRequests }) => ({
            view: document.body.dataset.view,
            calculateDisabled: document.querySelector("#navigateMap")?.disabled,
            locationDisabled: document.querySelector("#useMyLocation")?.disabled,
            cspDirectives: window.releaseCspViolations,
            browserErrors,
            failedRequests,
            scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type })),
            camera: {
              secureContext: window.isSecureContext,
              supported: Boolean(navigator.mediaDevices?.getUserMedia),
              error: document.querySelector("#liveVisionError")?.textContent,
              videoWidth: document.querySelector("#liveVisionVideo")?.videoWidth,
              readyState: document.querySelector("#liveVisionVideo")?.readyState,
              hasStream: Boolean(document.querySelector("#liveVisionVideo")?.srcObject),
              hidden: document.hidden
            }
          }), { browserErrors: errors, failedRequests }).catch(() => ({ pageUnavailable: true })));
          throw error;
        } finally { await context.close(); }
      }
    }
    } finally { await browser.close(); }
  }
  console.log(`Browser scenarios passed: ${scenarios}. GIS screenshots: ${screenshots}`);
}

module.exports = { runBrowserChecks };
