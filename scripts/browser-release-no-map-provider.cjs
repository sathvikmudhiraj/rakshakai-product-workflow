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

async function openNavigation(page, view) {
  const item = page.locator(`.nav-item[data-view="${view}"]`);
  const group = item.locator("xpath=ancestor::details[1]");
  if (await group.count() && !await group.evaluate((element) => element.open)) {
    await group.locator("summary").click();
  }
  await item.click();
}

for (const name of browserNames) {
  if (!browserTypes[name]) throw new Error(`Unsupported release browser: ${name}`);
}

function launchOptions(name) {
  if (name === "chromium") return { channel: "chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] };
  if (name === "firefox") return { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } };
  return {};
}

async function waitForUsableMapLayer() { return { providerTiles: "NOT TESTED: external tile provider unreachable in this environment" }; }
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

let syntheticEvidenceMedia;

async function recordSyntheticEvidence(page) {
  // Generate a playable synthetic clip, never a recording of an operator or device.
  return page.evaluate(async () => {
    if (typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
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
      // A 500 ms recording can stop before Chromium writes a complete WebM
      // cluster. Keep the clip synthetic, but long enough to be independently
      // decoded by the evidence preview path.
      for (let i = 0; i < 30; i++) {
        context.fillStyle = i % 2 ? "#008577" : "#ffffff";
        context.fillRect(0, 0, 160, 120);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      recorder.stop();
      await stopped;
      return { bytes: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())), mimeType };
    } finally { stream.getTracks().forEach((track) => track.stop()); }
  });
}

async function syntheticEvidenceFor(page) {
  if (syntheticEvidenceMedia) return syntheticEvidenceMedia;
  syntheticEvidenceMedia = await recordSyntheticEvidence(page);
  if (syntheticEvidenceMedia) return syntheticEvidenceMedia;
  const generator = await chromium.launch(launchOptions("chromium"));
  try {
    const generatorPage = await generator.newPage();
    syntheticEvidenceMedia = await recordSyntheticEvidence(generatorPage);
    if (!syntheticEvidenceMedia) throw new Error("Chromium could not generate synthetic evidence media");
    return syntheticEvidenceMedia;
  } finally {
    await generator.close();
  }
}

async function checkEvidenceUpload(page, role, width, browserName) {
  const media = await syntheticEvidenceFor(page);
  await openNavigation(page, "video-evidence");
  await page.waitForFunction(() => document.querySelector("#videoLinkedIncident").options.length > 1);
  await page.locator("#videoLinkedIncident").selectOption({ index: 1 });
  if (role === "Admin") {
    // This runs only against the isolated release stack. Give its fixture
    // incident an explicit investigator before exercising scoped evidence access.
    const assignment = await page.evaluate(async () => {
      const incidentId = document.querySelector("#videoLinkedIncident").value;
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/investigation/assign-officer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officerId: "u_fixture_officer" })
      });
      return response.status;
    });
    assert.equal(assignment, 200, "Admin must assign the release fixture investigator");
  }
  await page.locator("#videoEvidenceFile").setInputFiles({
    name: `acceptance-${role.replaceAll(" ", "-")}-${width}.${media.mimeType.includes("mp4") ? "mp4" : "webm"}`,
    mimeType: media.mimeType.split(";")[0], buffer: Buffer.from(media.bytes)
  });
  // WebKit's multipart bridge can take longer than the default UI timeout on
  // a freshly-built container; evidence persistence is intentionally checked
  // rather than treated as a fast UI interaction.
  const upload = page.waitForResponse(
    (response) => response.url().endsWith("/api/video-evidence") && response.request().method() === "POST",
    { timeout: 60000 }
  );
  await page.locator('#videoEvidenceForm button[type="submit"]').click();
  const response = await upload;
  assert.equal(response.status(), 201, "Evidence upload must persist successfully");
  const { evidence } = await response.json();
  const reviewAction = page.locator(`#videoEvidenceList [data-evidence-select="${evidence.id}"]`);
  try {
    await reviewAction.waitFor({ state: "visible", timeout: 10000 });
  } catch (error) {
    const evidenceListState = await page.evaluate(async () => {
      const response = await fetch("/api/video-evidence");
      const payload = await response.json();
      return {
        status: response.status,
        apiIds: (payload.evidence || []).map((item) => item.id),
        uiIds: [...document.querySelectorAll("#videoEvidenceList [data-evidence-select]")].map((item) => item.dataset.evidenceSelect),
        loading: document.body.classList.contains("ui-loading")
      };
    });
    throw new Error(`New evidence review action did not appear: ${JSON.stringify({ uploadedId: evidence.id, evidenceListState })}`, { cause: error });
  }
  await reviewAction.click();
  await page.locator("#videoReviewSplit video").scrollIntoViewIfNeeded();
  if (browserName === "webkit") {
    await page.waitForFunction((id) => document.querySelector("#videoReviewSplit video")?.src.includes(id), evidence.id, { timeout: 60000 });
    const preview = await page.locator("#videoReviewSplit video").evaluate(async (video) => {
      const response = await fetch(video.src);
      return { status: response.status, size: (await response.arrayBuffer()).byteLength };
    });
    assert.equal(preview.status, 200, "Evidence preview must be retrievable in WebKit");
    assert.ok(preview.size > 0, "Evidence preview must contain media bytes");
    assert.match(await page.locator("#videoReviewSplit").innerText(), /Human verification is required/i);
    return;
  }
  try {
    await page.waitForFunction(({ previewUrl }) => {
      const video = document.querySelector("#videoReviewSplit video");
      if (!video || video.videoWidth <= 0 || video.readyState < 2) return false;
      return new URL(video.currentSrc || video.src, window.location.href).pathname
        === new URL(previewUrl, window.location.href).pathname;
    }, { previewUrl: evidence.previewUrl }, { timeout: 60000 });
  } catch (error) {
    const mediaState = await page.locator("#videoReviewSplit").evaluate((root) => {
      const video = root.querySelector("video");
      return { html: root.innerHTML, video: video && {
        src: video.src, currentSrc: video.currentSrc, readyState: video.readyState,
        videoWidth: video.videoWidth, videoHeight: video.videoHeight, networkState: video.networkState,
        error: video.error?.message || null, rect: video.getBoundingClientRect().toJSON()
      } };
    });
    throw new Error(`Synthetic evidence preview did not load: ${JSON.stringify(mediaState)}`, { cause: error });
  }
  const preview = page.locator("#videoReviewSplit video");
  await preview.evaluate(async (video) => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => document.querySelector("#videoReviewSplit video").currentTime > 0);
  await preview.evaluate((video) => video.pause());
  assert.match(await page.locator("#videoReviewSplit").innerText(), /Human verification is required/i);
}

async function checkCctnsWorkspace(page, viewport, screenshots, browserName, role) {
  await openNavigation(page, "cctns");
  const workspace = page.locator("#cctnsWorkspace");
  await workspace.locator("h2", { hasText: "CCTNS Search" }).waitFor({ state: "visible" });
  assert.match(await workspace.innerText(), /SIMULATED CCTNS RECORDS/i);

  const search = workspace.locator('[data-cctns-search]');
  await search.fill("TS09 AB 1234");
  const vehicle = workspace.locator('[data-cctns-record="CCTNS-VEH-2026-4587"]');
  await vehicle.waitFor({ state: "visible" });
  await vehicle.click();
  await workspace.locator(".cctns-detail-title", { hasText: "TS09 AB 1234" }).waitFor({ state: "visible" });
  await workspace.locator('[data-cctns-record="CCTNS-CASE-2026-0456"]').last().click();
  await workspace.locator(".cctns-detail-title", { hasText: "CASE-2026-0456" }).waitFor({ state: "visible" });

  await search.fill("Smuggling");
  await workspace.locator('[data-cctns-category="crime"]').click();
  if (viewport.width <= 700) await workspace.locator('[data-cctns-toggle-filters]').click();
  await workspace.locator('[data-cctns-filter="crimeType"]').selectOption("Smuggling");
  await workspace.getByText(/Possible Match.*Human verification required/i).waitFor({ state: "visible" });
  const smuggling = workspace.locator('[data-cctns-record="CCTNS-CASE-2026-1042"]');
  await smuggling.waitFor({ state: "visible" });
  await smuggling.click();
  await workspace.locator(".cctns-detail-title", { hasText: "CASE-2026-1042" }).waitFor({ state: "visible" });
  const layout = await workspace.evaluate((element) => ({
    workspace: element.scrollWidth > element.clientWidth + 1,
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  assert.deepEqual(layout, { workspace: false, document: false }, "CCTNS workspace must not overflow horizontally");

  // Exercise the complete authorized officer workflow in every supported browser.
  if (role === "Police Officer" && viewport.width === 1920) {
    await page.goto(`${new URL(page.url()).origin}/cctns?type=vehicle&query=TS09%20AB%201234`, { waitUntil: "networkidle" });
    await workspace.locator('[data-cctns-record="CCTNS-VEH-2026-4587"]').click();
    await workspace.getByRole("button", { name: "LINK TO INCIDENT" }).click();
    const dialog = page.locator("#cctnsLinkDialog");
    await dialog.waitFor({ state: "visible" });
    const incident = dialog.locator('select[name="incidentId"]');
    await incident.selectOption("fixture_incident_active");
    const linkedIncidentId = await incident.inputValue();
    await dialog.locator('textarea[name="verificationReason"]').fill("Vehicle record and linked FIR reviewed by an authorized operator.");
    await dialog.locator('input[name="humanConfirmed"]').check();
    await dialog.getByRole("button", { name: "Confirm Link" }).click();
    await workspace.getByText("Incident link confirmed and audited.").waitFor({ state: "visible" });
    await page.reload({ waitUntil: "networkidle" });
    await workspace.locator('[data-cctns-record="CCTNS-VEH-2026-4587"]').click();
    await workspace.getByText(/Linked RakshakAI Incidents/i).waitFor({ state: "visible" });
    assert.ok((await workspace.innerText()).includes(linkedIncidentId), "Confirmed CCTNS incident link must persist after refresh");
  }
  await page.screenshot({ path: path.join(screenshots, `cctns-${browserName}-${role.replaceAll(" ", "-")}-${viewport.width}.png`), fullPage: true });
}

async function checkTrackingLayout(page, viewport, screenshots, browserName, role) {
  const now = "2026-10-13T20:00:00.000Z";
  const entityStates = [
    { id: "visual-person", trackType: "PERSON", candidateStatus: "PENDING_REVIEW", sessionStatus: "HUMAN_REVIEW", label: "Person" },
    { id: "visual-vehicle", trackType: "VEHICLE", candidateStatus: "CONFIRMED", sessionStatus: "CONFIRMED", label: "Vehicle", confirmed: true },
    { id: "visual-object", trackType: "OBJECT", candidateStatus: "REJECTED", sessionStatus: "REJECTED", label: "Object" },
    { id: "visual-animal", trackType: "ANIMAL", candidateStatus: "UNCERTAIN", sessionStatus: "HUMAN_REVIEW", label: "Animal" }
  ];
  const sessions = entityStates.map((state, index) => ({
    id: state.id, trackType: state.trackType, status: state.sessionStatus,
    verificationStatus: state.confirmed ? "CONFIRMED" : "PENDING",
    referenceDetectionId: `reference-${state.id}`, referenceCameraId: "cam_c19",
    referenceTimestamp: now, referenceObservationId: `reference-observation-${state.id}`,
    createdAt: now, updatedAt: now, pendingCandidateCount: state.candidateStatus === "PENDING_REVIEW" ? 1 : 0,
    lastSeenCameraId: state.confirmed ? "cam_c12" : null, lastSeenAt: state.confirmed ? "2026-10-13T20:04:00.000Z" : null
  }));
  const details = Object.fromEntries(entityStates.map((state) => {
    const reference = {
      id: `reference-observation-${state.id}`, sessionId: state.id, detectionId: `reference-${state.id}`,
      cameraId: "cam_c19", detectedAt: now, trackType: state.trackType, detectionConfidence: .96,
      upperClothingColor: state.trackType === "PERSON" ? "navy" : undefined,
      lowerClothingColor: state.trackType === "PERSON" ? "black" : undefined,
      plateText: state.trackType === "VEHICLE" ? "TS09AB1234" : undefined,
      vehicleColor: state.trackType === "VEHICLE" ? "white" : undefined,
      vehicleType: state.trackType === "VEHICLE" ? "SUV" : undefined,
      objectClass: state.trackType === "OBJECT" ? "backpack" : undefined,
      animalSpecies: state.trackType === "ANIMAL" ? "dog" : undefined,
      primaryColor: ["OBJECT", "ANIMAL"].includes(state.trackType) ? "black" : undefined,
      sizeClass: ["OBJECT", "ANIMAL"].includes(state.trackType) ? "medium" : undefined
    };
    const observation = { ...reference, id: `candidate-observation-${state.id}`, detectionId: `candidate-${state.id}`, cameraId: "cam_c12", detectedAt: "2026-10-13T20:04:00.000Z" };
    const candidate = {
      id: `candidate-${state.id}`, sessionId: state.id, observationId: observation.id,
      cameraId: observation.cameraId, detectedAt: observation.detectedAt, status: state.candidateStatus,
      overallConfidence: .91, appearanceSimilarity: .9, spatialConsistency: .88, timingConsistency: .86,
      directionConsistency: .82, activityConsistency: .8, plateSimilarity: .95, colorSimilarity: .9,
      vehicleTypeSimilarity: .9, routeConsistency: .87, classSimilarity: .94, speciesSimilarity: .93,
      sizeSimilarity: .88, markingsSimilarity: .84, humanVerificationRequired: true
    };
    return [state.id, { session: sessions.find((session) => session.id === state.id), observations: [reference, observation], candidates: [candidate], verifications: state.confirmed ? [{ id: `verification-${state.id}`, sessionId: state.id, candidateId: candidate.id, decision: "CONFIRM_MATCH", actorId: "release-admin", aiConfidence: .91, createdAt: observation.detectedAt }] : [] }];
  }));
  await page.route("**/api/tracking/sessions**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.continue();
    if (url.pathname === "/api/tracking/sessions") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessions, total: sessions.length, offset: 0, limit: 50 }) });
    const sessionId = decodeURIComponent(url.pathname.split("/").at(-1));
    if (details[sessionId]) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(details[sessionId]) });
    return route.continue();
  });
  await openNavigation(page, "multi-camera-tracking");
  const panel = page.locator('[data-panel="multi-camera-tracking"]');
  await panel.locator(".tracking-header h1").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#trackingSessionsList .tracking-loading"));
  const layout = await panel.evaluate((element) => ({
    panelOverflow: element.scrollWidth > element.clientWidth + 1,
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    heading: element.querySelector(".tracking-header h1")?.textContent?.trim(),
    createVisible: Boolean(element.querySelector("#createTrackingBtn")?.getClientRects().length),
    workspaceVisible: Boolean(element.querySelector("#trackingContent")?.getClientRects().length)
  }));
  assert.equal(layout.panelOverflow, false, "Tracking panel must not overflow horizontally");
  assert.equal(layout.documentOverflow, false, "Tracking page must not create document-level horizontal overflow");
  assert.equal(layout.heading, "Tracking Operations");
  assert.equal(layout.createVisible, true, "Tracking session action must remain visible");
  assert.equal(layout.workspaceVisible, true, "Tracking workspace must remain visible");

  assert.deepEqual(await panel.locator(".session-type").allInnerTexts(), entityStates.map((state) => state.label));
  for (const state of entityStates) {
    await panel.locator(`.session-card[data-session-id="${state.id}"]`).click();
    await panel.locator(".tracking-session-identity h2").filter({ hasText: state.id }).waitFor({ state: "visible" });
    assert.match(await panel.locator(".tracking-session-meta-grid").innerText(), new RegExp(`Entity Type\\s+${state.label}`, "i"));
    await panel.locator('.tab-btn[data-tab="candidates"]').click();
    const candidate = panel.locator(`[data-candidate-id="candidate-${state.id}"]`);
    await candidate.waitFor({ state: "visible" });
    assert.match(await candidate.locator(".candidate-status").innerText(), new RegExp(state.candidateStatus.replaceAll("_", " "), "i"));
    assert.match(await candidate.innerText(), /Possible match/i, "Candidate cards must remain explicitly advisory");
    if (state.candidateStatus === "PENDING_REVIEW") {
      assert.match(await candidate.innerText(), /Human verification required/i);
      await candidate.getByRole("button", { name: "Side-by-Side" }).click();
      assert.match(await panel.locator(".comparison-container").innerText(), /Human Verification Required/i);
      assert.match(await panel.locator(".comparison-container").innerText(), /do not establish identity/i);
    }
    if (state.confirmed) {
      assert.match(await panel.locator(".tracking-session-overview").innerText(), /Confirmed/i);
      assert.equal(await panel.getByRole("button", { name: "Response Options" }).isVisible(), true);
      assert.equal(await candidate.getByRole("button", { name: "Search CCTNS Vehicle" }).isVisible(), true);
    }
    const stateLayout = await panel.evaluate((element) => ({ panel: element.scrollWidth > element.clientWidth + 1, document: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
    assert.deepEqual(stateLayout, { panel: false, document: false }, `${state.trackType} tracking detail must not overflow horizontally`);
  }

  await page.locator("#createTrackingBtn").click();
  const dialog = page.locator('.tracking-session-modal [role="dialog"]');
  await dialog.waitFor({ state: "visible" });
  const trackType = dialog.locator('[name="trackType"]');
  assert.deepEqual(await trackType.locator("option").evaluateAll((options) => options.map((option) => option.value)), ["PERSON", "VEHICLE", "OBJECT", "ANIMAL"]);
  await trackType.selectOption("OBJECT");
  assert.equal(await dialog.locator("#trackingEntityLabelGroup").isVisible(), true);
  assert.equal(await dialog.locator("#trackingEntityLabelText").innerText(), "Object class");
  await trackType.selectOption("ANIMAL");
  assert.equal(await dialog.locator("#trackingEntityLabelText").innerText(), "Animal species");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("#createTrackingBtn").evaluate((button) => button === document.activeElement), true, "Closing the tracking dialog must restore focus");

  await page.screenshot({ path: path.join(screenshots, `tracking-${browserName}-${role.replaceAll(" ", "-")}-${viewport.width}.png`), fullPage: true });
}

async function checkPoliceManagementWorkflow(page, viewport, screenshots, browserName, { retainMembership = false, dutyStatus = "off_duty", availabilityStatus = "unavailable" } = {}) {
  const unitsResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/response-units") && response.status() === 200);
  const referenceResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/police-reference") && response.status() === 200);
  await openNavigation(page, "police-management");
  await page.locator("#policeUserList article").first().waitFor({ state: "visible" });
  const unitsPayload = await (await unitsResponsePromise).json();
  const referencePayload = await (await referenceResponsePromise).json();
  const units = unitsPayload.units || [];
  const stations = (referencePayload.stations || []).filter((item) => item.operational !== false);
  const ranks = (referencePayload.ranks || []).filter((item) => item.active !== false);
  assert.ok(units.length && stations.length && ranks.length, "Police Management requires registered units, stations, and active ranks");
  const targetUnit = units.find((unit) => unit.id === "fixture_unit_alpha")
    || units.find((unit) => stations.some((station) => station.id === (unit.stationId || unit.linkedStationId)))
    || units[0];
  const stationId = targetUnit.stationId || targetUnit.linkedStationId || stations[0].id;
  assert.ok(stations.some((station) => station.id === stationId), "Test unit must have a registered station");
  const rankId = ranks[0].id;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `qa-officer-${suffix}@example.test`;
  const badgeId = `QA-${suffix}`;
  const officerName = `QA Officer ${suffix}`;

  await page.locator("#addPoliceUserBtn").click();
  const create = page.locator("#policeUserForm");
  await create.locator('[name="name"]').fill(officerName);
  await create.locator('[name="email"]').fill(email);
  await create.locator('[name="temporaryPassword"]').fill("Synthetic-QA-Password-2026!");
  await create.locator('[name="badgeId"]').fill(badgeId);
  await create.locator('[name="stationId"]').selectOption(stationId);
  await create.locator('[name="rankId"]').selectOption(rankId);
  await create.locator('[name="operationalRole"]').selectOption("DISPATCHER");
  const createResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/police-users") && response.request().method() === "POST");
  await create.getByRole("button", { name: "Create Police Account" }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 201, "Admin must create the synthetic officer through the UI");
  await page.locator("#policeCreateDialog").waitFor({ state: "hidden" });
  await page.locator("#policeSearch").fill(email);
  let card = page.locator("#policeUserList article").filter({ hasText: email });
  await card.waitFor({ state: "visible" });
  const officerId = await card.locator("form[data-police-user-id]").getAttribute("data-police-user-id");
  assert.ok(officerId, "Created officer must appear in the refreshed directory");

  await card.getByRole("button", { name: "Edit Officer" }).click();
  const edit = card.locator("form[data-police-user-id]");
  await edit.locator('[name="name"]').fill(`${officerName} Edited`);
  await edit.locator('[name="operationalRole"]').selectOption("SUPERVISOR");
  await edit.locator('[name="dutyStatus"]').selectOption(dutyStatus);
  await edit.locator('[name="availabilityStatus"]').selectOption(availabilityStatus);
  const updateResponsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/admin/police-users/${officerId}`) && response.request().method() === "PATCH");
  await edit.getByRole("button", { name: "Save" }).click();
  assert.equal((await updateResponsePromise).status(), 200, "Admin officer edits must save through the API");
  card = page.locator("#policeUserList article").filter({ hasText: email });
  await card.getByText(`${officerName} Edited`).waitFor({ state: "visible" });
  assert.match(await card.innerText(), /Supervisor/i);
  assert.match(await card.innerText(), new RegExp(dutyStatus === "on_duty" ? "On Duty" : dutyStatus === "leave" ? "Leave" : dutyStatus === "suspended" ? "Suspended" : "Off Duty", "i"));
  assert.match(await card.innerText(), new RegExp(availabilityStatus === "available" ? "Available" : "Unavailable", "i"));

  const unitSelect = page.locator("#unitMembershipUnitSelect");
  await unitSelect.selectOption(targetUnit.id);
  await page.locator("#openUnitMembershipAdd").click();
  const membershipForm = page.locator("#unitMembershipAddForm");
  await membershipForm.waitFor({ state: "visible" });
  await membershipForm.locator('[name="officerUserId"]').selectOption(officerId);
  await membershipForm.locator('[name="role"]').selectOption("member");
  const addMembershipResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/admin/response-units/${targetUnit.id}/members`) && response.request().method() === "POST");
  await membershipForm.getByRole("button", { name: "Add Member" }).click();
  const addMembershipResponse = await addMembershipResponsePromise;
  assert.equal(addMembershipResponse.status(), 201, `Admin must add the synthetic officer to the selected unit (${addMembershipResponse.status()}): ${JSON.stringify(await addMembershipResponse.json())}`);
  await page.getByText("Member added successfully.").waitFor({ state: "visible" });
  let member = page.locator("#unitMembershipList .unit-member-card").filter({ hasText: `${officerName} Edited` });
  await member.waitFor({ state: "visible" });
  const membershipRole = member.locator("[data-member-role]");
  const roleChangeResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/admin/response-units/${targetUnit.id}/members/`) && response.request().method() === "PATCH");
  await membershipRole.selectOption("commander");
  assert.equal((await roleChangeResponsePromise).status(), 200, "Membership role change must persist through the API");
  member = page.locator("#unitMembershipList .unit-member-card").filter({ hasText: `${officerName} Edited` });
  await member.locator("[data-member-role]").waitFor({ state: "visible" });
  assert.equal(await member.locator("[data-member-role]").inputValue(), "commander");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible" });
  await openNavigation(page, "police-management");
  await page.locator("#policeSearch").fill(email);
  card = page.locator("#policeUserList article").filter({ hasText: email });
  await card.waitFor({ state: "visible" });
  assert.match(await card.innerText(), /Supervisor/i);
  assert.match(await card.innerText(), new RegExp(dutyStatus === "on_duty" ? "On Duty" : dutyStatus === "leave" ? "Leave" : dutyStatus === "suspended" ? "Suspended" : "Off Duty", "i"));
  await page.locator("#unitMembershipUnitSelect").selectOption(targetUnit.id);
  member = page.locator("#unitMembershipList .unit-member-card").filter({ hasText: `${officerName} Edited` });
  await member.waitFor({ state: "visible" });
  assert.equal(await member.locator("[data-member-role]").inputValue(), "commander", "Membership role must survive refresh");
  const mobileLayout = await page.evaluate(() => {
    const intro = document.querySelector('.view.active[data-panel="police-management"] .page-intro').getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const overlaps = intro.left < topbar.right && intro.right > topbar.left && intro.top < topbar.bottom && intro.bottom > topbar.top;
    return { overlaps, topbarPosition: getComputedStyle(document.querySelector(".topbar")).position, intro: { top: intro.top, bottom: intro.bottom }, topbar: { top: topbar.top, bottom: topbar.bottom }, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  if (viewport.width <= 720) {
    assert.equal(mobileLayout.topbarPosition, "static", "Officer directory mobile header must not cover page content");
    assert.equal(mobileLayout.overlaps, false, "Officer directory title and mobile header must not overlap after refresh");
    assert.equal(mobileLayout.horizontalOverflow, false, "Officer directory must not overflow horizontally on mobile");
    console.log(`Police Management mobile layout: ${JSON.stringify(mobileLayout)}`);
  }
  await page.screenshot({ path: path.join(screenshots, `police-management-${browserName}-Admin-${viewport.width}.png`), fullPage: true });
  if (!retainMembership) {
    const removeMembershipResponsePromise = page.waitForResponse((response) => response.url().includes(`/api/admin/response-units/${targetUnit.id}/members/`) && response.request().method() === "DELETE");
    page.once("dialog", (dialog) => dialog.accept());
    await member.getByRole("button", { name: "Remove" }).click();
    assert.equal((await removeMembershipResponsePromise).status(), 200, "Admin must remove the synthetic unit membership");
    await member.waitFor({ state: "detached" });
  }
  console.log(`Police Management browser workflow passed: ${officerId}, ${email}, unit ${targetUnit.id}, role change persisted${retainMembership ? " and membership retained for deployment acceptance" : " and membership removed"}`);
  return { officerId, email, badgeId, officerName: `${officerName} Edited`, unitId: targetUnit.id, stationId, rankId };
}

async function runBrowserChecks({ baseUrl, password, beforeScenario }) {
  const users = JSON.parse(fs.readFileSync(path.join(__dirname, "../backend/data/db.example.json"), "utf8")).users;
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-browser-release-"));
  const allViewports = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];
  const viewportFilter = process.env.RELEASE_TEST_VIEWPORTS?.split(",").map(Number).filter(Number.isFinite);
  const roleFilter = process.env.RELEASE_TEST_ROLES?.split(",").map((role) => role.trim()).filter(Boolean);
  const viewports = viewportFilter?.length ? allViewports.filter((viewport) => viewportFilter.includes(viewport.width)) : allViewports;
  const roles = roleFilter?.length ? roleFilter : ["Admin", "Police Officer", "Citizen"];
  let scenarios = 0;
  const diagnostics = [];
  const diagnosticsFile = process.env.RELEASE_TEST_DIAGNOSTICS_FILE;
  for (const browserName of browserNames) {
    const browser = await browserTypes[browserName].launch(launchOptions(browserName));
    try {
    for (const viewport of viewports) {
      for (const role of roles) {
        if (beforeScenario) await beforeScenario({ browserName, viewport, role });
        const scenarioBaseUrl = browserName === "webkit"
          ? baseUrl.replace(/^http:/, "https:")
          : baseUrl;
        const context = await browser.newContext({
          viewport,
          permissions: browserName === "firefox" ? ["geolocation"] : ["camera", "geolocation"],
          geolocation: { latitude: 17.5109, longitude: 78.3276 }
        });
        if (browserName === "webkit") {
          const proxyCookies = new Map();
          await context.route(`${scenarioBaseUrl}/**`, async (route) => {
            const headers = await route.request().allHeaders();
            if (proxyCookies.size) {
              const requestPath = new URL(route.request().url()).pathname;
              headers.cookie = [...proxyCookies.values()]
                .filter((cookie) => requestPath.startsWith(cookie.path))
                .sort((a, b) => b.path.length - a.path.length)
                .map(({ name, value }) => `${name}=${value}`)
                .join("; ");
            }
            const response = await route.fetch({
              url: route.request().url().replace(/^https:/, "http:"),
              headers
            });
            const setCookies = (await response.headersArray())
              .filter(({ name }) => name.toLowerCase() === "set-cookie")
              .map(({ value }) => value);
            if (route.request().url().endsWith("/api/auth/login") && response.status() === 200 && !setCookies.length) {
              throw new Error("WebKit loopback proxy did not receive the login Set-Cookie header");
            }
            for (const setCookie of setCookies) {
              const [pair, ...attributes] = setCookie.split(";").map((part) => part.trim());
              const separator = pair.indexOf("=");
              const attributeText = attributes.join(";");
              const name = pair.slice(0, separator);
              const value = pair.slice(separator + 1);
              const cookiePath = attributes.find((attribute) => /^Path=/i.test(attribute))?.slice(5) || "/";
              const cookieKey = `${name}\0${cookiePath}`;
              if (/Max-Age=0/i.test(attributeText)) proxyCookies.delete(cookieKey);
              else proxyCookies.set(cookieKey, { name, value, path: cookiePath });
            }
            await route.fulfill({ response });
          });
        }
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        const failedRequests = [];
        const consoleErrors = [];
        const httpErrors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push({ text: message.text(), location: message.location() });
        });
        page.on("request", (request) => requests.push(new URL(request.url()).pathname));
        page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), path: new URL(request.url()).pathname, error: request.failure()?.errorText || "failed" }));
        page.on("response", (response) => {
          if (response.status() >= 400) httpErrors.push({ status: response.status(), method: response.request().method(), url: response.url(), path: new URL(response.url()).pathname });
        });
        await page.addInitScript(() => {
          window.releaseCspViolations = [];
          document.addEventListener("securitypolicyviolation", (event) => window.releaseCspViolations.push({
            directive: event.effectiveDirective,
            blockedUri: event.blockedURI,
            sourceFile: event.sourceFile,
            lineNumber: event.lineNumber
          }));
        });
        try {
          await page.goto(scenarioBaseUrl, { waitUntil: "networkidle" });
          assert.notEqual(await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily), '"Times New Roman"');
          await page.locator('#loginForm input[name="email"]').fill(users.find((user) => user.role === role).email);
          await page.locator('#loginForm input[name="password"]').fill(password);
          await page.locator('#loginForm button[type="submit"]').click();
          try {
            await page.locator("#appShell:not(.app-hidden)").waitFor({ state: "visible" });
          } catch (error) {
            const loginError = await page.locator("#loginError").innerText().catch(() => "");
            throw new Error(`Authenticated application shell did not become visible: ${loginError || "no login error shown"}`, { cause: error });
          }
          await page.locator("#logoutButton").waitFor({ state: "visible" });
          const authenticatedSession = await page.evaluate(async () => {
            const response = await fetch("/api/auth/me", { credentials: "same-origin" });
            return { status: response.status, body: await response.json() };
          });
          assert.equal(authenticatedSession.status, 200, "Browser login must establish an authenticated session");
          assert.equal(authenticatedSession.body?.user?.role, role, "Authenticated browser role must match the release scenario");
          assert.equal(requests.filter((route) => route === "/api/auth/login").length, 1);
          if (role === "Admin" && [1920, 390].includes(viewport.width)) await checkPoliceManagementWorkflow(page, viewport, screenshots, browserName);
          if (role === "Citizen") {
            await page.waitForLoadState("networkidle");
            await page.goto(`${scenarioBaseUrl}/rakshak/live-vision`, { waitUntil: "networkidle" });
            if (browserName === "webkit") {
              assert.ok(errors.every((message) => /\/api\/missing-persons due to access control checks\.$/.test(message)), "WebKit deep-link navigation may only cancel the prior page's report request");
              errors.length = 0;
            }
            await page.waitForFunction(() => document.body.dataset.view === "missing");
            assert.match(await page.locator("#permissionMessage").innerText(), /permission/i);
            assert.equal(requests.some((route) => /^\/api\/ai\//.test(route)), false);
          } else {
            if (role === "Police Officer") assert.equal(await page.locator('.nav-item[data-view="settings"]').isVisible(), false);
            await openNavigation(page, "gis");
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
            await page.waitForFunction(() => !document.querySelector("#navigateMap").disabled && document.querySelector("#clearMapRoute").disabled);
            assert.equal(await page.locator("#navigateMap").isDisabled(), false);
            assert.equal(await page.locator("#clearMapRoute").isDisabled(), true);
            await waitForUsableMapLayer(page, "satellite", "server.arcgisonline.com");
            await page.screenshot({ path: path.join(screenshots, `gis-${browserName}-${role.replaceAll(" ", "-")}-${viewport.width}.png`), fullPage: true });
            await openNavigation(page, "live-vision");
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
                await context.grantPermissions(["geolocation"], { origin: scenarioBaseUrl });
                await page.evaluate(() => {
                  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
                    configurable: true,
                    value: async () => {
                      throw new DOMException("Camera permission denied for acceptance test", "NotAllowedError");
                    }
                  });
                });
              }
              await page.locator("#startLiveVision").click();
              await page.waitForFunction(() => document.querySelector("#liveVisionError").textContent.includes("permission denied"));
              if (browserName !== "firefox") await context.grantPermissions(["camera", "geolocation"], { origin: scenarioBaseUrl });
            } else {
              await page.waitForFunction(() => document.querySelector("#liveVisionError").textContent.includes("not supported"));
            }
            const preEvidenceCspViolations = await page.evaluate(() => window.releaseCspViolations);
            assert.deepEqual(preEvidenceCspViolations.filter((violation) => !(
              browserName === "webkit"
              && violation.directive === "style-src-elem"
              && violation.blockedUri === "inline"
              && violation.sourceFile === ""
              && violation.lineNumber === 5
            )), [], "No application CSP violations before rendering native media controls");
            await checkEvidenceUpload(page, role, viewport.width, browserName);
            await checkTrackingLayout(page, viewport, screenshots, browserName, role);
            await checkCctnsWorkspace(page, viewport, screenshots, browserName, role);
          }
          assert.deepEqual(errors, [], "No uncaught browser errors");
          const cspViolations = await page.evaluate(() => window.releaseCspViolations);
          const unexpectedCspViolations = cspViolations.filter((violation) => !(
            browserName === "webkit"
            && violation.directive === "style-src-elem"
            && violation.blockedUri === "inline"
            && violation.sourceFile === ""
            && violation.lineNumber === 5
          ));
          // Playwright WebKit's native video controls inject an internal inline style and
          // report it without a source file. The application CSP remains enforced.
          assert.deepEqual(unexpectedCspViolations, [], "No CSP violations");
          const allowedHttpError = (item) => role === "Citizen" && item.path === "/api/missing-persons" && [401, 403].includes(item.status);
          const allowedProviderFailure = (item) => /https?:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//i.test(item.url);
          const allowedProviderConsoleError = (item) => /(?:tile\.openstreetmap\.org|server\.arcgisonline\.com)/i.test(`${item.text} ${item.location?.url || ""}`);
          const unexpectedHttpErrors = httpErrors.filter((item) => !allowedHttpError(item));
          const unexpectedFailedRequests = failedRequests.filter((item) => !allowedProviderFailure(item));
          const unexpectedConsoleErrors = consoleErrors.filter((item) => !allowedProviderConsoleError(item));
          const scenarioDiagnostics = {
            browser: browserName, role, viewport,
            pageErrors: [...errors], consoleErrors, failedRequests, httpErrors,
            allowlists: {
              http: "Citizen access-control denial for /api/missing-persons (401/403)",
              network: "External GIS tile hosts tile.openstreetmap.org and server.arcgisonline.com are unavailable in this isolated environment",
              console: "External GIS tile host load errors from the same two known providers"
            },
            unexpectedHttpErrors, unexpectedFailedRequests, unexpectedConsoleErrors
          };
          diagnostics.push(scenarioDiagnostics);
          if (diagnosticsFile) fs.writeFileSync(diagnosticsFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
          assert.deepEqual(unexpectedHttpErrors, [], "No unexpected HTTP 4xx/5xx responses");
          assert.deepEqual(unexpectedFailedRequests, [], "No unexpected failed browser requests");
          assert.deepEqual(unexpectedConsoleErrors, [], "No unexpected browser console errors");
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
  if (diagnosticsFile) fs.writeFileSync(diagnosticsFile, `${JSON.stringify(diagnostics, null, 2)}\n`);
  console.log(`Browser scenarios passed: ${scenarios}. GIS screenshots: ${screenshots}. Diagnostics: ${diagnosticsFile || "not persisted"}`);
}

module.exports = { runBrowserChecks, checkPoliceManagementWorkflow };
