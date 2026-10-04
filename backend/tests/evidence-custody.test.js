const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { eventsFromEvidence } = require("../repositories/evidenceCustody.repository");

test("custody persistence retains every event beyond the previous 50-entry cap", () => {
  const chainOfCustody = Array.from({ length: 75 }, (_, index) => ({
    action: `event_${index}`,
    actorId: "u_admin",
    actorName: "Admin",
    actorRole: "Admin",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    notes: `event ${index}`
  }));

  const events = eventsFromEvidence([{ id: "evd_long_history", chainOfCustody }]);

  assert.equal(events.length, 75);
  assert.equal(new Set(events.map((event) => event.id)).size, 75);
  assert.ok(events.every((event) => event.evidenceId === "evd_long_history"));
});

test("custody event IDs are stable while explicit IDs are preserved", () => {
  const evidence = [{
    id: "evd_stable",
    chainOfCustody: [
      { action: "uploaded", timestamp: "2026-01-01T00:00:00.000Z", notes: "initial" },
      { id: "custody_explicit", action: "reviewed", timestamp: "2026-01-02T00:00:00.000Z" }
    ]
  }];
  const first = eventsFromEvidence(evidence);
  const second = eventsFromEvidence(evidence);

  assert.deepEqual(first.map((event) => event.id), second.map((event) => event.id));
  assert.equal(first[1].id, "custody_explicit");
});

test("PostgreSQL schema enforces append-only custody records", () => {
  const root = path.resolve(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "database/schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(root, "database/migrations/005_append_only_evidence_custody.sql"), "utf8");
  const service = fs.readFileSync(path.join(root, "services/core.service.js"), "utf8");

  assert.match(schema, /CREATE TABLE IF NOT EXISTS evidence_custody_events/);
  assert.match(schema, /BEFORE UPDATE OR DELETE ON evidence_custody_events/);
  assert.match(schema, /BEFORE TRUNCATE ON evidence_custody_events/);
  assert.match(migration, /jsonb_array_elements[\s\S]*chainOfCustody/);
  assert.doesNotMatch(service, /chainOfCustody\s*=\s*\[[^\n]+\.slice\(0,\s*50\)/);
});
