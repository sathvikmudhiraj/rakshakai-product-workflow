const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

async function checkEvidenceUpload(page, role, width) {
  // Generate a playable synthetic clip, never a recording of an operator or device.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
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
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    } finally { stream.getTracks().forEach((track) => track.stop()); }
  });
  await page.locator('.nav-item[data-view="video-evidence"]').click();
  await page.waitForFunction(() => document.querySelector("#videoLinkedIncident").options.length > 1);
  await page.locator("#videoLinkedIncident").selectOption({ index: 1 });
  await page.locator("#videoEvidenceFile").setInputFiles({
    name: `acceptance-${role.replaceAll(" ", "-")}-${width}.webm`,
    mimeType: "video/webm", buffer: Buffer.from(bytes)
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
  const browser = await chromium.launch({ channel: "chromium", args: ["--use-fake-device-for-media-stream"] });
  let scenarios = 0;
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const role of ["Admin", "Police Officer", "Citizen"]) {
        const context = await browser.newContext({ viewport, permissions: ["camera", "geolocation"], geolocation: { latitude: 17.5109, longitude: 78.3276 } });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(new URL(request.url()).pathname));
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
            await page.screenshot({ path: path.join(screenshots, `gis-${role.replaceAll(" ", "-")}-${viewport.width}.png`), fullPage: true });
            await page.locator('.nav-item[data-view="live-vision"]').click();
            await page.locator("#startLiveVision").click();
            await page.waitForFunction(() => {
              const video = document.querySelector("#liveVisionVideo");
              return video.videoWidth > 0 && video.videoHeight > 0;
            });
            await page.locator("#stopLiveVision").click();
            await context.clearPermissions();
            await context.grantPermissions(["geolocation"], { origin: baseUrl });
            await page.locator("#startLiveVision").click();
            await page.waitForFunction(() => document.querySelector("#liveVisionError").textContent.includes("permission denied"));
            await context.grantPermissions(["camera", "geolocation"], { origin: baseUrl });
            await checkEvidenceUpload(page, role, viewport.width);
          }
          assert.deepEqual(errors, [], "No uncaught browser errors");
          assert.deepEqual(await page.evaluate(() => window.releaseCspViolations), [], "No CSP violations");
          await page.locator("#logoutButton").click();
          await page.locator("#loginForm").waitFor({ state: "visible" });
          scenarios++;
          console.log(`Browser passed: ${role}, ${viewport.width}x${viewport.height}`);
        } catch (error) {
          // Do not capture the login form or entered credentials on failure.
          console.error(`Browser scenario failed: ${role}, ${viewport.width}x${viewport.height}`);
          console.error(String(error.stack || "").split("\n").filter((line) => line.includes("browser-release.cjs")).join("\n"));
          console.error(await page.evaluate(() => ({
            view: document.body.dataset.view,
            calculateDisabled: document.querySelector("#navigateMap")?.disabled,
            locationDisabled: document.querySelector("#useMyLocation")?.disabled,
            cspDirectives: window.releaseCspViolations,
            camera: {
              secureContext: window.isSecureContext,
              supported: Boolean(navigator.mediaDevices?.getUserMedia),
              error: document.querySelector("#liveVisionError")?.textContent,
              videoWidth: document.querySelector("#liveVisionVideo")?.videoWidth,
              readyState: document.querySelector("#liveVisionVideo")?.readyState,
              hasStream: Boolean(document.querySelector("#liveVisionVideo")?.srcObject),
              hidden: document.hidden
            }
          })).catch(() => ({ pageUnavailable: true })));
          throw error;
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
  console.log(`Browser scenarios passed: ${scenarios}. GIS screenshots: ${screenshots}`);
}

module.exports = { runBrowserChecks };
