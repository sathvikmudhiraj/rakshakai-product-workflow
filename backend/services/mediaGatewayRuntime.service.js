const aiService = require("./ai.service");
const { MediaGateway, FfmpegRtspConnector, SimulatorConnector } = require("./mediaGateway.service");
const { persistGatewayObservation } = require("./aiObservation.service");
const { readDatabase, writeSelectedRecords, addAuditLog } = require("./core.service");
const cameraSourcesRepository = require("../repositories/cameraSources.repository");
const auditLogsRepository = require("../repositories/auditLogs.repository");
const realtimeEvents = require("./realtimeEvents.service");

function gatewayConnector(camera) {
  if (camera.streamType === "simulator" && process.env.NODE_ENV !== "production") return new SimulatorConnector(camera);
  return new FfmpegRtspConnector(camera);
}

async function persistCameraState(camera, state, event) {
  const db = await readDatabase();
  const stored = (db.cameraSources || []).find((item) => item.id === camera.id);
  if (!stored) return;
  const previousState = stored.streamState;
  Object.assign(stored, {
    streamState: state.streamState,
    gatewayHealth: state.gatewayHealth,
    aiState: state.aiState,
    connected: state.connected,
    lastConnectedAt: state.lastConnectedAt,
    lastFrameAt: state.lastFrameAt,
    lastFrameReceivedAt: state.lastFrameAt,
    frameAgeMs: state.frameAgeMs,
    measuredFps: state.fps,
    fps: state.fps,
    latencyMs: state.latencyMs,
    reconnectCount: state.reconnectCount,
    lastGatewayError: state.lastError,
    lastHealthUpdate: state.lastHealthUpdate,
    lastHealthCheckAt: state.lastHealthUpdate,
    lastAiSuccessAt: state.lastAiSuccessAt,
    lastDetectionAt: state.lastDetectionAt,
    samplingIntervalMs: state.samplingIntervalMs,
    gatewayMetrics: state.metrics,
    status: state.streamState === "STREAMING" ? "online"
      : ["OFFLINE", "AUTH_FAILED"].includes(state.streamState) ? "offline" : "unknown",
    healthStatus: state.streamState === "STREAMING" ? "ONLINE"
      : state.streamState === "NO_FRAMES" ? "NO_VIDEO_FRAMES"
        : ["OFFLINE", "AUTH_FAILED"].includes(state.streamState) ? "OFFLINE" : "DEGRADED",
    healthReason: state.lastError || `${state.streamState}; AI ${state.aiState}`,
    updatedAt: state.lastHealthUpdate
  });
  const records = [[cameraSourcesRepository, [stored]]];
  if (previousState !== state.streamState) {
    const action = state.streamState === "STREAMING" && previousState === "RECONNECTING" ? "camera_connected"
      : state.streamState === "OFFLINE" ? "camera_disconnected"
        : state.streamState === "DISABLED" ? "camera_stream_disabled"
          : state.streamState === "STREAMING" ? "camera_connected" : null;
    if (action) {
      const audit = addAuditLog(db, action, null, null, stored.id, state.lastHealthUpdate);
      records.push([auditLogsRepository, [audit]]);
    }
  }
  await writeSelectedRecords(db, records);
  realtimeEvents.emit(event, { cameraId: stored.id, state });
}

const gateway = new MediaGateway({
  connectorFactory: gatewayConnector,
  analyzeFrame: (payload) => aiService.analyzeFrame(payload),
  persistObservation: persistGatewayObservation,
  onStateChange: persistCameraState
});

for (const event of ["ai_detection_received", "observation_created"]) {
  gateway.on(event, (payload) => realtimeEvents.emit(event, payload));
}

async function startConfiguredStreams() {
  const db = await readDatabase();
  const cameras = (db.cameraSources || [])
    .filter((camera) => camera.streamEnabled === true && camera.enabled !== false && camera.isDemo !== true)
    .slice(0, Math.max(1, Math.min(3, Number(process.env.MEDIA_GATEWAY_MAX_STREAMS || 3))));
  for (const camera of cameras) await gateway.startCamera(camera);
  return cameras.length;
}

module.exports = { gateway, startConfiguredStreams, persistCameraState };
