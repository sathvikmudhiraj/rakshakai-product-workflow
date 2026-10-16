const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  authorizedTelemetryUnitIds,
  unitTelemetryDispatchQuality,
  unitTelemetryFreshness,
  validateUnitTelemetry
} = require("../services/unitTelemetry.service");

test("unit telemetry validates bounds, time windows, and replay protection", () => {
  const nowMs = Date.parse("2026-10-07T12:00:00.000Z");
  const valid = {
    latitude: 17.5109,
    longitude: 78.3276,
    accuracy: 9,
    capturedAt: "2026-10-07T11:59:30.000Z"
  };
  const observation = validateUnitTelemetry(valid, { nowMs });
  assert.equal(observation.latitude, valid.latitude);
  assert.equal(observation.receivedAt, "2026-10-07T12:00:00.000Z");
  assert.throws(() => validateUnitTelemetry({ ...valid, latitude: 91 }, { nowMs }), /outside the allowed range/);
  assert.throws(() => validateUnitTelemetry({ ...valid, accuracy: -1 }, { nowMs }), /outside the allowed range/);
  assert.throws(
    () => validateUnitTelemetry({ ...valid, capturedAt: "2026-10-07T12:02:00.000Z" }, { nowMs }),
    (error) => error.code === "GPS_TIMESTAMP_IN_FUTURE"
  );
  assert.throws(
    () => validateUnitTelemetry({ ...valid, capturedAt: "2026-10-07T11:50:00.000Z" }, { nowMs }),
    (error) => error.code === "GPS_OBSERVATION_TOO_OLD"
  );
  assert.throws(
    () => validateUnitTelemetry(valid, { nowMs, previousCapturedAt: valid.capturedAt }),
    (error) => error.code === "GPS_OBSERVATION_REPLAYED"
  );
});

test("unit telemetry freshness is centralized and fails closed for malformed records", () => {
  const at = Date.parse("2026-10-07T12:00:00.000Z");
  assert.deepEqual(
    unitTelemetryFreshness({ latitude: 17.5, longitude: 78.3, locationCapturedAt: "2026-10-07T11:59:00.000Z" }, at).state,
    "FRESH"
  );
  assert.equal(unitTelemetryFreshness({ latitude: 17.5, longitude: 78.3, locationCapturedAt: "2026-10-07T11:57:00.000Z" }, at).state, "STALE");
  assert.equal(unitTelemetryFreshness({ latitude: "invalid", longitude: 78.3, locationCapturedAt: "2026-10-07T11:59:00.000Z" }, at).state, "UNAVAILABLE");
});

test("primary dispatch requires fresh accurate authenticated live GPS", () => {
  const at = Date.parse("2026-10-07T12:00:00.000Z");
  const live = { latitude: 17.5, longitude: 78.3, locationCapturedAt: "2026-10-07T11:59:30.000Z", locationSource: "live_gps", locationAccuracy: 12 };
  assert.equal(unitTelemetryDispatchQuality(live, at).eligible, true);
  assert.equal(unitTelemetryDispatchQuality({ ...live, locationAccuracy: 180 }, at).eligible, false);
  assert.equal(unitTelemetryDispatchQuality({ ...live, locationSource: "admin_registry" }, at).eligible, false);
  assert.equal(unitTelemetryDispatchQuality({ ...live, locationCapturedAt: "2026-10-07T11:55:00.000Z" }, at).reason, "STALE GPS");
});

test("only active Police membership resolves a telemetry unit", () => {
  const db = {
    responseUnits: [{ id: "unit-1", unitCode: "P-1" }],
    responseUnitMembers: [{ unitId: "unit-1", officerUserId: "officer-1" }],
    policeOfficers: [{ userId: "officer-1", active: true }]
  };
  assert.deepEqual(authorizedTelemetryUnitIds({ id: "officer-1", role: "Police Officer", status: "active" }, db), ["unit-1"]);
  assert.deepEqual(authorizedTelemetryUnitIds({ id: "admin-1", role: "Admin" }, db), []);
  db.policeOfficers[0].active = false;
  assert.deepEqual(authorizedTelemetryUnitIds({ id: "officer-1", role: "Police Officer", status: "active" }, db), []);
});

test("response-unit schema and migration contain typed latest telemetry fields", () => {
  const root = path.join(__dirname, "..");
  const schema = fs.readFileSync(path.join(root, "database", "schema.sql"), "utf8");
  const migration = fs.readFileSync(path.join(root, "database", "migrations", "006_response_unit_live_gps.sql"), "utf8");
  for (const column of ["latitude", "longitude", "location_accuracy", "location_captured_at", "location_received_at", "location_source"]) {
    assert.match(schema, new RegExp(`\\b${column}\\b`));
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
});
