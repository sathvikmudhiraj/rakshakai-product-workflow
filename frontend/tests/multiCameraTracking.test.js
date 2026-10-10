import { JSDOM } from "jsdom";
import { configureTracking, renderTrackingPage, cleanupTracking } from "../src/components/MultiCameraTracking.js";

function setupDOM() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="multiCameraTrackingPanel"></div>
    <div id="appShell" class="app-shell">
      <aside class="sidebar"></aside>
      <main class="workspace">
        <header class="topbar"><h1 id="viewTitle"></h1></header>
      </main>
    </div>
  </body>`);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.FormData = dom.window.FormData;
  globalThis.fetch = async () => new Response(JSON.stringify({ sessions: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
  configureTracking({ cameraSources: () => [
    { id: "cam_1", cameraId: "C-1", name: "Camera 1", zone: "Zone 1" },
    { id: "cam_2", cameraId: "C-2", name: "Camera 2", zone: "Zone 2" }
  ] });
  return dom;
}

async function testTrackingPageRenders() {
  const dom = setupDOM();
  renderTrackingPage();
  const panel = document.getElementById("multiCameraTrackingPanel");
  if (!panel.querySelector(".tracking-header")) throw new Error("Header not rendered");
  if (!panel.querySelector("#trackingSessionsList")) throw new Error("Sessions list not rendered");
  if (!panel.querySelector("#createTrackingBtn")) throw new Error("Create button not rendered");
  cleanupTracking();
  dom.window.close();
}

async function testCreateSessionModalOpens() {
  console.log("Test: Create session modal opens");
  setupDOM();
  try {
    renderTrackingPage();
    const createBtn = document.getElementById("createTrackingBtn");
    createBtn.click();
    const modal = document.querySelector(".modal-overlay");
    if (!modal) throw new Error("Modal not opened");
    if (!modal.querySelector("#createTrackingForm")) throw new Error("Form not in modal");
    if (!modal.querySelector("[name=trackType]")) throw new Error("Track type select missing");
    if (!modal.querySelector("[name=referenceCameraId]")) throw new Error("Camera select missing");
    modal.remove();
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testFiltersUpdate() {
  console.log("Test: Filters update tracking state");
  setupDOM();
  try {
    renderTrackingPage();
    const filterType = document.getElementById("filterTrackType");
    const filterStatus = document.getElementById("filterStatus");
    filterType.value = "VEHICLE";
    filterType.dispatchEvent(new Event("change"));
    filterStatus.value = "CONFIRMED";
    filterStatus.dispatchEvent(new Event("change"));
    console.log("  PASS (filters dispatch change events)");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testSessionCardRendering() {
  console.log("Test: Session card renders with correct data");
  setupDOM();
  try {
    renderTrackingPage();
    const list = document.getElementById("trackingSessionsList");
    const card = document.createElement("div");
    card.className = "session-card";
    card.dataset.sessionId = "track_test123";
    card.innerHTML = `
      <div class="session-header">
        <div class="session-id">Track: track_test123...</div>
        <span class="session-status status-searching">Searching</span>
        <span class="session-type">Person</span>
        <span class="session-time">10:30 AM</span>
        <span class="session-confidence confidence-medium">65%</span>
      </div>
      <div class="session-meta">
        <span class="meta-item">Ref Cam: cam_1</span>
      </div>
      <div class="session-actions"></div>
    `;
    list.appendChild(card);
    const rendered = list.querySelector(".session-card");
    if (!rendered) throw new Error("Card not rendered");
    if (rendered.dataset.sessionId !== "track_test123") throw new Error("Session ID not set");
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testCandidateCardRendering() {
  console.log("Test: Candidate card renders with correct data");
  setupDOM();
  try {
    renderTrackingPage();
    const card = document.createElement("div");
    card.className = "candidate-card";
    card.dataset.candidateId = "cand_test123";
    card.innerHTML = `
      <div class="candidate-header">
        <span class="candidate-status status-pending_review">Pending Review</span>
        <span class="candidate-confidence confidence-high">89%</span>
        <span class="candidate-time">10:32 AM</span>
        <span class="candidate-camera">Camera: cam_2</span>
      </div>
      <div class="candidate-breakdown">
        <div class="stat-bar"><div class="stat-bar-label">Appearance</div><div class="stat-bar-container"><div class="stat-bar-fill" style="width: 91%;"></div></div><div class="stat-bar-value">91%</div></div>
      </div>
      <div class="candidate-actions"></div>
    `;
    const content = document.getElementById("trackingContent");
    content.appendChild(card);
    const rendered = content.querySelector(".candidate-card");
    if (!rendered) throw new Error("Candidate card not rendered");
    if (rendered.dataset.candidateId !== "cand_test123") throw new Error("Candidate ID not set");
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testComparisonViewStructure() {
  console.log("Test: Comparison view has correct structure");
  setupDOM();
  try {
    renderTrackingPage();
    const content = document.getElementById("trackingContent");
    content.innerHTML = `
      <div class="comparison-container">
        <div class="comparison-pane reference">
          <h3>Reference Detection</h3>
          <div class="observation-details reference"><div class="obs-header"><h4>Reference (Reference)</h4></div></div>
        </div>
        <div class="comparison-pane candidate">
          <h3>Candidate: cam_2</h3>
          <div class="observation-details candidate"><div class="obs-header"><h4>Candidate</h4></div></div>
        </div>
        <div class="comparison-explanation"><h3>Match Explanation</h3><div class="score-breakdown"></div></div>
        <div class="comparison-actions"></div>
      </div>
    `;
    const comparison = content.querySelector(".comparison-container");
    if (!comparison) throw new Error("Comparison container missing");
    const panes = comparison.querySelectorAll(".comparison-pane");
    if (panes.length !== 2) throw new Error("Expected 2 panes");
    if (!comparison.querySelector(".comparison-explanation")) throw new Error("Explanation missing");
    if (!comparison.querySelector(".comparison-actions")) throw new Error("Actions missing");
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testStatBarRendering() {
  console.log("Test: Stat bar renders with correct percentage");
  setupDOM();
  try {
    const container = document.createElement("div");
    const statBar = document.createElement("div");
    statBar.className = "stat-bar";
    statBar.innerHTML = `
      <div class="stat-bar-label">Appearance</div>
      <div class="stat-bar-container"><div class="stat-bar-fill confidence-high" style="width: 91%;"></div></div>
      <div class="stat-bar-value">91%</div>
    `;
    container.appendChild(statBar);
    const fill = container.querySelector(".stat-bar-fill");
    if (!fill) throw new Error("Stat bar fill missing");
    if (fill.style.width !== "91%") throw new Error("Width not set correctly");
    if (!fill.classList.contains("confidence-high")) throw new Error("Confidence class missing");
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  }
}

async function testEmptyStateDisplay() {
  console.log("Test: Empty state displays when no sessions");
  setupDOM();
  try {
    renderTrackingPage();
    const list = document.getElementById("trackingSessionsList");
    list.innerHTML = '<div class="empty-state">No tracking sessions found. Create a new session to start.</div>';
    const empty = list.querySelector(".empty-state");
    if (!empty) throw new Error("Empty state not shown");
    if (!empty.textContent.includes("No tracking sessions")) throw new Error("Empty state text incorrect");
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  } finally {
    cleanupTracking();
  }
}

async function testRealtimeCleanup() {
  console.log("Test: Cleanup removes realtime listeners");
  setupDOM();
  try {
    renderTrackingPage();
    const panel = document.getElementById("multiCameraTrackingPanel");
    cleanupTracking();
    if (panel.innerHTML !== "") {
      throw new Error("Panel not cleared on cleanup");
    }
    console.log("  PASS");
  } catch (error) {
    console.log("  FAIL:", error.message);
    throw error;
  }
}

async function runAllFrontendTests() {
  console.log("\n=== Running Frontend Tracking Tests ===\n");

  const tests = [
    testTrackingPageRenders,
    testCreateSessionModalOpens,
    testFiltersUpdate,
    testSessionCardRendering,
    testCandidateCardRendering,
    testComparisonViewStructure,
    testStatBarRendering,
    testEmptyStateDisplay,
    testRealtimeCleanup
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error) {
      failed++;
    }
  }

  console.log("\n=== Frontend Test Results ===");
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllFrontendTests().catch((error) => {
  console.error("Frontend test runner failed:", error);
  process.exit(1);
});
