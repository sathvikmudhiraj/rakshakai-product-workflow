import test from "node:test";
import assert from "node:assert/strict";
import {
  clearBrowserLocationWatch,
  geolocationErrorMessage,
  getBrowserLocation,
  watchBrowserLocation
} from "../src/browserGeolocation.js";

const position = {
  coords: {
    latitude: 17.5109,
    longitude: 78.3276,
    accuracy: 12.4,
    altitude: 540,
    heading: 90,
    speed: 3.5
  },
  timestamp: Date.parse("2026-10-06T18:30:00.000Z")
};

test("one-time browser location retains coordinates, accuracy, movement, and timestamp", async () => {
  let requestedOptions;
  const geolocation = {
    getCurrentPosition(success, _error, options) {
      requestedOptions = options;
      success(position);
    }
  };
  const point = await getBrowserLocation(geolocation);
  assert.equal(point.lat, 17.5109);
  assert.equal(point.lng, 78.3276);
  assert.equal(point.accuracy, 12.4);
  assert.equal(point.speed, 3.5);
  assert.equal(point.heading, 90);
  assert.equal(point.locationSource, "browser_gps");
  assert.equal(point.capturedAt, "2026-10-06T18:30:00.000Z");
  assert.equal(requestedOptions.enableHighAccuracy, true);
});

test("continuous tracking forwards fixes and clears the active browser watch", () => {
  let successHandler;
  let requestedOptions;
  let clearedId;
  const geolocation = {
    watchPosition(success, _error, options) {
      successHandler = success;
      requestedOptions = options;
      return 27;
    },
    clearWatch(id) { clearedId = id; }
  };
  const fixes = [];
  const watchId = watchBrowserLocation({ geolocation, onLocation: (point) => fixes.push(point) });
  successHandler(position);
  assert.equal(watchId, 27);
  assert.equal(fixes[0].accuracy, 12.4);
  assert.equal(requestedOptions.maximumAge, 5000);
  assert.equal(clearBrowserLocationWatch(watchId, geolocation), true);
  assert.equal(clearedId, 27);
});

test("browser GPS errors distinguish denial, unavailability, and timeout", () => {
  assert.match(geolocationErrorMessage({ code: 1 }), /permission denied/i);
  assert.match(geolocationErrorMessage({ code: 2 }), /unavailable/i);
  assert.match(geolocationErrorMessage({ code: 3 }), /timed out/i);
});

test("unsupported movement fields stay unknown instead of becoming zero", async () => {
  const geolocation = {
    getCurrentPosition(success) {
      success({
        coords: { latitude: 17.5109, longitude: 78.3276, accuracy: null, altitude: null, heading: null, speed: null },
        timestamp: Date.now()
      });
    }
  };
  const point = await getBrowserLocation(geolocation);
  assert.equal(point.accuracy, null);
  assert.equal(point.altitude, null);
  assert.equal(point.heading, null);
  assert.equal(point.speed, null);
});
