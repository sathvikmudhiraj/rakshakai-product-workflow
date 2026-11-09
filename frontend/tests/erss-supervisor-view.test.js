import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderErssSupervisorQueue } from "../src/erssSupervisorView.js";

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <div id="supervisorCritical"></div>
    <div id="supervisorTimeouts"></div>
    <div id="supervisorDisputes"></div>
  </body>`);
  return dom;
}

test("supervisor queue renders correct empty states for every section", () => {
  const dom = fixture();
  try {
    renderErssSupervisorQueue({
      document: dom.window.document,
      queue: { criticalEvents: [], unitTimeouts: [], assistanceTimeouts: [], jurisdictionDisputes: [], ownershipTransfers: [] }
    });
    assert.equal(dom.window.document.querySelector("#supervisorCritical").textContent, "No critical events without response.");
    assert.equal(dom.window.document.querySelector("#supervisorTimeouts").textContent, "No active timeouts.");
    assert.equal(dom.window.document.querySelector("#supervisorDisputes").textContent, "No recent jurisdiction or ownership disputes.");
    assert.doesNotMatch(dom.window.document.body.textContent, /\[object HTMLElement\]/);
  } finally {
    dom.window.close();
  }
});

test("supervisor queue renders critical events, unit and assistance timeouts, and disputes as text cards", () => {
  const dom = fixture();
  const elementValue = dom.window.document.createElement("span");
  elementValue.textContent = "EXT-1";
  try {
    renderErssSupervisorQueue({
      document: dom.window.document,
      queue: {
        criticalEvents: [{
          externalEventId: "EXT-1", emergencyType: "MEDICAL", incidentLocationText: "Sector 7",
          triageStatus: "RECEIVED", createdAt: "2026-11-04T08:00:00.000Z"
        }, {
          externalEventId: elementValue, id: "erss-ui-element", emergencyType: "MEDICAL", incidentLocationText: "Sector 7",
          triageStatus: "RECEIVED", createdAt: "2026-11-04T08:00:00.000Z"
        }],
        unitTimeouts: [{ status: "TIMEOUT", erssEventId: "erss-unit", unitId: "UNIT-7", timeoutAt: "2026-11-04T08:01:00.000Z" }],
        assistanceTimeouts: [{ status: "TIMEOUT", erssEventId: "erss-assist", requestedStationId: "STATION-2", requestedAt: "2026-11-04T08:02:00.000Z" }],
        jurisdictionDisputes: [{ erssEventId: "erss-jur", oldJurisdictionId: "STATION-1", newJurisdictionId: "STATION-2", reason: "Boundary review", changedAt: "2026-11-04T08:03:00.000Z" }],
        ownershipTransfers: [{ erssEventId: "erss-transfer", fromStationId: "STATION-1", toStationId: "STATION-2", status: "TRANSFER_REQUESTED", reason: "Cross-border response", requestedAt: "2026-11-04T08:04:00.000Z" }]
      }
    });
    const text = dom.window.document.body.textContent;
    assert.match(text, /CRITICAL: EXT-1/);
    assert.match(text, /CRITICAL: Emergency event/);
    assert.match(text, /Type: MEDICAL \| Location: Sector 7/);
    assert.match(text, /UNIT-7/);
    assert.match(text, /STATION-2/);
    assert.match(text, /Boundary review/);
    assert.match(text, /Cross-border response/);
    assert.doesNotMatch(text, /\[object HTMLElement\]/);
    assert.equal(dom.window.document.querySelectorAll("article.supervisor-alert").length, 6);
  } finally {
    dom.window.close();
  }
});

test("supervisor queue shows loading and error states instead of a false empty state", () => {
  const dom = fixture();
  try {
    renderErssSupervisorQueue({ document: dom.window.document, queue: null, loading: true });
    assert.equal(dom.window.document.querySelectorAll('[role="status"]').length, 3);
    assert.doesNotMatch(dom.window.document.body.textContent, /No critical events/);

    renderErssSupervisorQueue({ document: dom.window.document, queue: null, error: new Error("API timeout") });
    assert.equal(dom.window.document.querySelectorAll('[role="alert"]').length, 3);
    assert.match(dom.window.document.body.textContent, /Use Refresh to try again/);
    assert.doesNotMatch(dom.window.document.body.textContent, /No active timeouts/);
  } finally {
    dom.window.close();
  }
});
