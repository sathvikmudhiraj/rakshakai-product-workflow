export const HIGH_ACCURACY_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 5000
});

export function geolocationErrorMessage(error = {}) {
  if (error.code === 1) return "Location permission denied. Use manual search or map click.";
  if (error.code === 2) return "Current location is unavailable. Move to an open area or use manual search or map click.";
  if (error.code === 3) return "Location request timed out. Retry or use manual search or map click.";
  return "Current location could not be read. Use manual search or map click.";
}

export function locationPoint(position, label = "Current device location") {
  const lat = Number(position?.coords?.latitude);
  const lng = Number(position?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error("The device returned invalid location coordinates.");
  }
  const numeric = (value) => value === null || value === undefined
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const timestamp = Number(position?.timestamp);
  return {
    lat,
    lng,
    label,
    locationSource: "browser_gps",
    accuracy: numeric(position.coords.accuracy),
    altitude: numeric(position.coords.altitude),
    heading: numeric(position.coords.heading),
    speed: numeric(position.coords.speed),
    capturedAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString()
  };
}

function availableGeolocation(geolocation) {
  return geolocation || globalThis.navigator?.geolocation || null;
}

export function getBrowserLocation(geolocation, options = HIGH_ACCURACY_LOCATION_OPTIONS) {
  return new Promise((resolve, reject) => {
    const provider = availableGeolocation(geolocation);
    if (!provider?.getCurrentPosition) {
      reject(new Error("Location is not supported by this browser."));
      return;
    }
    provider.getCurrentPosition(
      (position) => {
        try { resolve(locationPoint(position)); }
        catch (error) { reject(error); }
      },
      (error) => reject(new Error(geolocationErrorMessage(error))),
      options
    );
  });
}

export function watchBrowserLocation({
  geolocation,
  onLocation,
  onError,
  options = HIGH_ACCURACY_LOCATION_OPTIONS
} = {}) {
  const provider = availableGeolocation(geolocation);
  if (!provider?.watchPosition) throw new Error("Continuous location tracking is not supported by this browser.");
  return provider.watchPosition(
    (position) => {
      try { onLocation?.(locationPoint(position)); }
      catch (error) { onError?.(error); }
    },
    (error) => onError?.(new Error(geolocationErrorMessage(error))),
    options
  );
}

export function clearBrowserLocationWatch(watchId, geolocation) {
  const provider = availableGeolocation(geolocation);
  if (watchId === null || watchId === undefined || !provider?.clearWatch) return false;
  provider.clearWatch(watchId);
  return true;
}
