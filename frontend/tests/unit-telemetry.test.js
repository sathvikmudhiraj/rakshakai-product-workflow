import test from "node:test";
import assert from "node:assert/strict";
import {
  movementMeters,
  shouldTransmitUnitTelemetry,
  unitTelemetryPayload,
  unitTelemetryRenderFingerprint
} from "../src/unitTelemetry.js";

const first = { lat: 17.5109, lng: 78.3276, accuracy: 8, capturedAt: "2026-10-07T00:00:00.000Z", speed: 2, heading: 90, altitude: 540 };

test("first unit GPS observation transmits with retained telemetry fields", () => {
  assert.equal(shouldTransmitUnitTelemetry({ point: first, nowMs: 1000 }), true);
  assert.deepEqual(unitTelemetryPayload(first), {
    latitude: 17.5109,
    longitude: 78.3276,
    accuracy: 8,
    capturedAt: "2026-10-07T00:00:00.000Z",
    speed: 2,
    heading: 90,
    altitude: 540
  });
});

test("telemetry throttle suppresses noisy callbacks and sends movement or heartbeat updates", () => {
  const lastSent = { point: first, sentAt: 1000 };
  const nearby = { ...first, lat: first.lat + 0.00001 };
  const moved = { ...first, lat: first.lat + 0.0002 };
  assert.ok(movementMeters(first, nearby) < 10);
  assert.ok(movementMeters(first, moved) > 10);
  assert.equal(shouldTransmitUnitTelemetry({ lastSent, point: moved, nowMs: 4000 }), false);
  assert.equal(shouldTransmitUnitTelemetry({ lastSent, point: nearby, nowMs: 7000 }), false);
  assert.equal(shouldTransmitUnitTelemetry({ lastSent, point: moved, nowMs: 7000 }), true);
  assert.equal(shouldTransmitUnitTelemetry({ lastSent, point: nearby, nowMs: 16000 }), true);
});

test("telemetry render fingerprint ignores second-level age churn but detects visible changes", () => {
  const base = [{ id: "unit-1", lat: 17.5, lng: 78.3, status: "available", locationAgeSeconds: 12, locationAgeMinutes: 0.2 }];
  const summary = { total: 1, available: 1 };
  const first = unitTelemetryRenderFingerprint(base, summary);
  assert.equal(unitTelemetryRenderFingerprint([{ ...base[0], locationAgeSeconds: 47, locationAgeMinutes: 0.8 }], summary), first);
  assert.notEqual(unitTelemetryRenderFingerprint([{ ...base[0], locationAgeSeconds: 61, locationAgeMinutes: 1 }], summary), first);
  assert.notEqual(unitTelemetryRenderFingerprint([{ ...base[0], lat: 17.6 }], summary), first);
});
