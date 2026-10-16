const { readDatabase, writeDatabase } = require("./core.service");
const { applyHealthSample } = require("./cameraHealth.service");
const realtimeEvents = require("./realtimeEvents.service");

// This monitor evaluates telemetry supplied by camera/stream adapters. It deliberately
// does not attempt RTSP decoding in the API process; video AI remains a separate path.
async function runCameraHealthSweep() {
  const db = await readDatabase();
  const results = [];
  for (const camera of db.cameraSources || []) {
    if (camera.enabled === false || camera.maintenanceMode || !camera.healthTelemetry) continue;
    const result = applyHealthSample(db, camera.id, camera.healthTelemetry);
    if (!result.changed && !result.createdAlerts.length && !result.resolvedAlerts.length) continue;
    results.push(result);
  }
  if (!results.length) return { changed: false, results };
  await writeDatabase(db);
  for (const result of results) {
    const payload = { camera: result.camera, status: result.status, severity: result.severity, preservation: result.preservation };
    realtimeEvents.emit("camera_health_changed", payload);
    if (result.changed) realtimeEvents.emit(`camera_${String(result.status).toLowerCase()}`, payload);
    for (const alert of result.createdAlerts) realtimeEvents.emit("camera_health_alert_created", { alert, camera: result.camera });
    for (const alert of result.resolvedAlerts) realtimeEvents.emit("camera_health_alert_resolved", { alert, camera: result.camera });
  }
  return { changed: true, results };
}

module.exports = { runCameraHealthSweep };
