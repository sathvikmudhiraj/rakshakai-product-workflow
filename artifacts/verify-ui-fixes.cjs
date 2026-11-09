const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const BASE = "http://localhost:3000";

async function login(page, email, password) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill(email);
  await page.locator("#loginForm input[name='password']").fill(password);
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 15000 });
}

async function logout(page) {
  await page.locator("#logoutButton").click();
  await page.locator("#loginForm").waitFor({ state: "visible", timeout: 15000 });
}

async function testGisTabs(page) {
  await login(page, "police@rakshakai.local", "demo123");
  await page.goto(`${BASE}/gis`, { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap").waitFor({ state: "visible", timeout: 15000 });
  for (const mode of ["map", "route", "navigate"]) {
    await page.locator(`#gisMode${mode[0].toUpperCase()}${mode.slice(1)}`).click();
    await page.waitForFunction(
      (m) => document.querySelector(".gis-toolbar").dataset.gisMode === m,
      mode
    );
    const state = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".gis-toolbar [data-gis-mode-panel]")].map((el) => ({
        panel: el.dataset.gisModePanel,
        display: getComputedStyle(el).display
      }));
      return panels;
    });
    const visible = state.filter((p) => p.display !== "none");
    assert.equal(visible.length, 1, `mode ${mode}: exactly one tool group must be visible, got ${JSON.stringify(state)}`);
    assert.equal(visible[0].panel, mode, `mode ${mode}: visible group must match`);
  }
  console.log("PASS GIS tabs filter per mode");
  await logout(page);
}

async function testMobileMapControls(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "police@rakshakai.local", "demo123");
  await page.goto(`${BASE}/gis`, { waitUntil: "domcontentloaded" });
  await page.locator("#gisMap").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  const controls = await page.evaluate(() => {
    const fit = document.querySelector("#gisMap .map-control.zoom-fit");
    if (!fit) return null;
    const rect = fit.getBoundingClientRect();
    const arrowLayer = document.querySelector("#gisMap .map-layer-toggle");
    const arrow = arrowLayer ? getComputedStyle(arrowLayer, "::after").content : null;
    const sizes = [...document.querySelectorAll("#gisMap .map-control")].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, w: Math.round(r.width), h: Math.round(r.height), overflow: el.scrollWidth > el.clientWidth };
    });
    return { fit: { w: Math.round(rect.width), h: Math.round(rect.height), overflow: fit.scrollWidth > fit.clientWidth }, sizes, arrow };
  });
  assert.ok(controls, "GIS map controls must exist");
  for (const c of controls.sizes) {
    assert.ok(c.w >= 44 && c.h >= 44, `control ${c.cls} must be at least 44x44, got ${c.w}x${c.h}`);
    assert.equal(c.overflow, false, `control ${c.cls} text must not overflow`);
  }
  assert.ok(controls.arrow === '"\u25be"' || controls.arrow === '"\u25be "', `layer toggle arrow must render the glyph, got ${controls.arrow}`);
  console.log("PASS mobile map controls 44px, no FIT overflow, arrow glyph renders:", controls.arrow);
  await logout(page);
}

async function testLogoutClearsCredentials(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, "police@rakshakai.local", "demo123");
  await logout(page);
  const values = await page.evaluate(() => {
    const email = document.querySelector("#loginForm input[name='email']");
    const password = document.querySelector("#loginForm input[name='password']");
    return { email: email?.value, password: password?.value };
  });
  assert.equal(values.email, "", `email must be empty after logout, got "${values.email}"`);
  assert.equal(values.password, "", "password must be empty after logout");
  console.log("PASS logout clears login credentials");
}

async function testCitizenSilentRedirect(page) {
  await page.goto(`${BASE}/rakshak/live-vision`, { waitUntil: "domcontentloaded" });
  await page.locator("#loginForm input[name='email']").fill("citizen@rakshakai.local");
  await page.locator("#loginForm input[name='password']").fill("demo123");
  await page.locator("#loginForm button[type='submit']").click();
  await page.locator("#logoutButton").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.body.dataset.view === "missing", null, { timeout: 15000 });
  const state = await page.evaluate(() => ({
    title: document.querySelector("#viewTitle")?.textContent,
    permissionElement: Boolean(document.querySelector("#permissionMessage")),
    livePanelActive: document.querySelector('[data-panel="live-vision"]')?.classList.contains("active"),
    bodyText: document.body.innerText
  }));
  assert.equal(state.title, "My Reports & Public Safety Help");
  assert.equal(state.permissionElement, false, "permissionMessage element must be removed");
  assert.equal(state.livePanelActive, false, "live-vision panel must stay hidden for Citizen");
  assert.equal(/permission to view/i.test(state.bodyText), false, "no permission error text anywhere for Citizen");
  await logout(page);
  console.log("PASS citizen deep link redirects silently to Missing & Found");
}

async function testFileUploadKeyboard(page) {
  // Citizen: missing persons report form
  await login(page, "citizen@rakshakai.local", "demo123");
  await page.goto(`${BASE}/missing`, { waitUntil: "domcontentloaded" });
  await page.locator("#appShell").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.body.dataset.view === "missing", null, { timeout: 15000 });
  await page.locator("#personFile").waitFor({ state: "attached", timeout: 15000 });
  const person = await page.evaluate(() => {
    const input = document.querySelector("#personFile");
    input.focus();
    const label = input.closest(".file-drop");
    return {
      active: document.activeElement === input,
      display: getComputedStyle(input).display,
      outline: label ? getComputedStyle(label).outlineStyle : null
    };
  });
  assert.equal(person.active, true, "#personFile must be keyboard focusable");
  assert.ok(person.display !== "none", "#personFile must not be display:none");
  assert.equal(person.outline, "solid", "file-drop label must show focus outline");
  console.log("PASS person file input keyboard accessible with focus-within outline");
  await logout(page);

  // Officer: video evidence upload
  await login(page, "police@rakshakai.local", "demo123");
  await page.goto(`${BASE}/video-evidence`, { waitUntil: "domcontentloaded" });
  await page.locator("#appShell").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.body.dataset.view === "video-evidence", null, { timeout: 15000 });
  await page.locator("#videoEvidenceFile").waitFor({ state: "attached", timeout: 15000 });
  const video = await page.evaluate(() => {
    const input = document.querySelector("#videoEvidenceFile");
    input.focus();
    const label = input.closest(".file-drop");
    return {
      active: document.activeElement === input,
      display: getComputedStyle(input).display,
      outline: label ? getComputedStyle(label).outlineStyle : null
    };
  });
  assert.equal(video.active, true, "#videoEvidenceFile must be keyboard focusable");
  assert.ok(video.display !== "none", "#videoEvidenceFile must not be display:none");
  assert.equal(video.outline, "solid", "file-drop label must show focus outline");
  console.log("PASS video evidence file input keyboard accessible with focus-within outline");
  await logout(page);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  const tests = [
    ["GIS tabs", testGisTabs],
    ["Mobile map controls", testMobileMapControls],
    ["Logout credentials", testLogoutClearsCredentials],
    ["Citizen silent redirect", testCitizenSilentRedirect],
    ["File upload keyboard", testFileUploadKeyboard]
  ];
  for (const [name, fn] of tests) {
    try {
      await fn(page);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} verification failure(s)`);
    process.exit(1);
  }
  console.log("\nAll UI fixes verified.");
})();
