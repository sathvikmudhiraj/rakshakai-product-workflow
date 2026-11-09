const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { decryptCameraSecrets } = require("./cameraSecrets.service");
const { validateCameraEndpoint, sanitizeGatewayError } = require("./cameraEndpointPolicy.service");

const STREAM_STATES = Object.freeze(["CONFIGURED", "CONNECTING", "STREAMING", "RECONNECTING", "DEGRADED", "NO_FRAMES", "AUTH_FAILED", "OFFLINE", "DISABLED"]);
const AI_STATES = Object.freeze(["AI_READY", "AI_PROCESSING", "AI_UNAVAILABLE", "AI_TIMEOUT", "AI_ERROR", "AI_DISABLED"]);

function streamUrl(camera) {
  return String(camera.rtspUrl || camera.streamUrl || "").trim();
}

function cameraWithDecryptedSecrets(camera) {
  const decrypted = decryptCameraSecrets(camera);
  const raw = streamUrl(decrypted);
  if (!raw) throw new Error("Camera stream configuration is missing");
  const url = new URL(raw);
  if (decrypted.username && !url.username) url.username = decrypted.username;
  if (decrypted.password && !url.password) url.password = decrypted.password;
  return { ...decrypted, gatewayStreamUrl: url.toString() };
}

function jpegFrames(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 12_000_000) buffer = buffer.subarray(Math.max(0, buffer.length - 2_000_000));
    while (buffer.length) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (start < 0) { buffer = Buffer.alloc(0); return; }
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (end < 0) { if (start > 0) buffer = buffer.subarray(start); return; }
      const frame = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);
      onFrame(frame, { capturedAt: new Date().toISOString() });
    }
  };
}

class FfmpegRtspConnector {
  constructor(camera, options = {}) {
    this.camera = cameraWithDecryptedSecrets(camera);
    validateCameraEndpoint(this.camera.gatewayStreamUrl, options);
    this.ffmpegPath = options.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg";
    this.process = null;
    this.stopped = false;
  }

  start(handlers) {
    const maxAcquireFps = Math.max(1, Math.min(10, Number(this.camera.gatewayAcquireFps || 5)));
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "warning", "-rtsp_transport", "tcp",
      "-i", this.camera.gatewayStreamUrl, "-an", "-vf", `fps=${maxAcquireFps}`,
      "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
    ];
    this.process = spawn(this.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    let connected = false;
    const frames = jpegFrames((frame, meta) => {
      if (!connected) { connected = true; handlers.onConnected?.(); }
      handlers.onFrame?.(frame, meta);
    });
    this.process.stdout.on("data", frames);
    this.process.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    this.process.on("error", (error) => handlers.onError?.(error));
    this.process.on("close", (code) => {
      if (this.stopped) return;
      if (code !== 0) handlers.onError?.(new Error(stderr || `RTSP worker exited with code ${code}`));
      handlers.onClose?.({ code });
    });
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.process && !this.process.killed) this.process.kill("SIGTERM");
  }
}

class SimulatorConnector {
  constructor(camera, options = {}) {
    this.camera = camera;
    this.intervalMs = Math.max(40, Number(options.intervalMs || camera.simulatorFrameIntervalMs || 200));
    this.frame = options.frame || Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
    this.timer = null;
  }

  start(handlers) {
    handlers.onConnected?.();
    this.timer = setInterval(() => handlers.onFrame?.(Buffer.from(this.frame), { capturedAt: new Date().toISOString() }), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("AI analysis timed out"), { code: "AI_TIMEOUT" })), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

class MediaGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.connectorFactory = options.connectorFactory || ((camera) => new FfmpegRtspConnector(camera, options));
    this.analyzeFrame = options.analyzeFrame;
    this.persistObservation = options.persistObservation;
    this.onStateChange = options.onStateChange || (async () => {});
    this.clock = options.clock || (() => Date.now());
    this.maxReconnects = Math.max(0, Number(options.maxReconnects ?? process.env.MEDIA_GATEWAY_MAX_RECONNECTS ?? 5));
    this.baseBackoffMs = Math.max(50, Number(options.baseBackoffMs ?? process.env.MEDIA_GATEWAY_RECONNECT_BASE_MS ?? 1000));
    this.maxBackoffMs = Math.max(this.baseBackoffMs, Number(options.maxBackoffMs ?? process.env.MEDIA_GATEWAY_RECONNECT_MAX_MS ?? 30_000));
    this.noFramesMs = Math.max(500, Number(options.noFramesMs ?? process.env.MEDIA_GATEWAY_NO_FRAMES_MS ?? 10_000));
    this.aiTimeoutMs = Math.max(100, Number(options.aiTimeoutMs ?? process.env.MEDIA_GATEWAY_AI_TIMEOUT_MS ?? 8_000));
    this.sessions = new Map();
    this.metrics = { activeStreams: 0, reconnects: 0, sampledFrames: 0, aiRequests: 0, aiSuccesses: 0, aiTimeouts: 0, aiErrors: 0, detections: 0, droppedSamples: 0 };
  }

  snapshot(session) {
    const now = this.clock();
    return {
      cameraId: session.camera.id,
      streamState: session.streamState,
      gatewayHealth: session.gatewayHealth,
      aiState: session.aiState,
      connected: session.connected,
      lastConnectedAt: session.lastConnectedAt,
      lastFrameAt: session.lastFrameAt,
      frameAgeMs: session.lastFrameAt ? Math.max(0, now - Date.parse(session.lastFrameAt)) : null,
      fps: session.fps || null,
      latencyMs: session.latencyMs,
      reconnectCount: session.reconnectCount,
      lastError: session.lastError,
      lastHealthUpdate: new Date(now).toISOString(),
      lastAiSuccessAt: session.lastAiSuccessAt,
      lastDetectionAt: session.lastDetectionAt,
      samplingIntervalMs: session.samplingIntervalMs,
      metrics: { ...session.metrics }
    };
  }

  async publish(session, event = "camera_health_updated", force = false) {
    const state = this.snapshot(session);
    const fingerprint = JSON.stringify([state.streamState, state.gatewayHealth, state.aiState, state.connected, state.lastError, state.reconnectCount]);
    const now = this.clock();
    if (!force && fingerprint === session.lastFingerprint && now - session.lastPublishedAt < 5_000) return;
    session.lastFingerprint = fingerprint; session.lastPublishedAt = now;
    await this.onStateChange(session.camera, state, event);
    this.emit(event, state);
  }

  async startCamera(camera) {
    await this.stopCamera(camera.id);
    const samplingIntervalMs = Math.max(250, Math.min(60_000, Number(camera.samplingIntervalMs || 1_000)));
    const session = {
      camera, connector: null, stopped: false, connected: false,
      streamState: camera.streamEnabled === false || camera.enabled === false ? "DISABLED" : "CONFIGURED",
      gatewayHealth: "UNKNOWN", aiState: camera.aiEnabled === false ? "AI_DISABLED" : "AI_UNAVAILABLE",
      samplingIntervalMs, reconnectCount: 0, lastConnectedAt: null, lastFrameAt: null,
      lastSampleAt: 0, lastError: null, fps: null, latencyMs: null,
      frameTimes: [], aiBusy: false, pendingFrame: null, reconnectTimer: null, watchdog: null,
      lastAiSuccessAt: null, lastDetectionAt: null, lastFingerprint: "", lastPublishedAt: 0,
      metrics: { frames: 0, sampledFrames: 0, droppedSamples: 0, aiRequests: 0, aiSuccesses: 0, aiTimeouts: 0, aiErrors: 0, detections: 0 }
    };
    this.sessions.set(camera.id, session);
    if (session.streamState === "DISABLED") { await this.publish(session, "camera_stream_state_changed", true); return this.snapshot(session); }
    await this.connect(session, false);
    session.watchdog = setInterval(() => this.checkFrames(session), Math.min(1_000, this.noFramesMs));
    session.watchdog.unref?.();
    return this.snapshot(session);
  }

  async connect(session, retry) {
    if (session.stopped) return;
    session.streamState = retry ? "RECONNECTING" : "CONNECTING";
    session.gatewayHealth = retry ? "DEGRADED" : "CHECKING";
    await this.publish(session, "camera_stream_state_changed", true);
    try {
      const connector = this.connectorFactory(session.camera);
      session.connector = connector;
      const isCurrent = () => !session.stopped && session.connector === connector;
      connector.start({
        onConnected: () => { if (isCurrent()) this.connected(session); },
        onFrame: (frame, meta) => { if (isCurrent()) this.frame(session, frame, meta); },
        onError: (error) => { if (isCurrent()) this.connectionFailure(session, error); },
        onClose: () => { if (isCurrent()) this.connectionFailure(session, new Error("RTSP connection closed")); }
      });
    } catch (error) { await this.connectionFailure(session, error); }
  }

  async connected(session) {
    if (session.stopped) return;
    session.connected = true;
    session.streamState = "STREAMING";
    session.gatewayHealth = "HEALTHY";
    session.lastConnectedAt = new Date(this.clock()).toISOString();
    session.lastError = null;
    this.metrics.activeStreams = [...this.sessions.values()].filter((item) => item.connected).length;
    await this.publish(session, session.reconnectCount ? "camera_reconnected" : "camera_stream_state_changed", true);
  }

  async frame(session, frameBuffer, meta = {}) {
    if (session.stopped || !Buffer.isBuffer(frameBuffer) || !frameBuffer.length) return;
    const now = this.clock();
    // A supplied capture time must be recent; old frames must not revive stream
    // health or become fresh operational observations.
    const suppliedCapture = meta.capturedAt == null ? now : Date.parse(meta.capturedAt);
    if (!Number.isFinite(suppliedCapture) || suppliedCapture > now + 1000 || now - suppliedCapture > this.noFramesMs) {
      session.metrics.droppedSamples += 1; this.metrics.droppedSamples += 1;
      return;
    }
    session.connected = true; session.streamState = "STREAMING"; session.gatewayHealth = "HEALTHY";
    session.lastFrameAt = new Date(now).toISOString(); session.metrics.frames += 1;
    session.frameTimes.push(now); session.frameTimes = session.frameTimes.filter((value) => now - value <= 5_000);
    if (session.frameTimes.length > 1) session.fps = Number(((session.frameTimes.length - 1) / ((session.frameTimes.at(-1) - session.frameTimes[0]) / 1000)).toFixed(2));
    const capturedAt = isoCapture(meta.capturedAt, now);
    session.latencyMs = Math.max(0, now - Date.parse(capturedAt));
    if (now - session.lastSampleAt < session.samplingIntervalMs) { await this.publish(session); return; }
    session.lastSampleAt = now; session.metrics.sampledFrames += 1; this.metrics.sampledFrames += 1;
    const sample = { frameBuffer: Buffer.from(frameBuffer), capturedAt };
    if (session.aiBusy) {
      session.pendingFrame = sample; session.metrics.droppedSamples += 1; this.metrics.droppedSamples += 1;
      return;
    }
    await this.processSample(session, sample);
  }

  async processSample(session, sample) {
    if (session.stopped || this.clock() - Date.parse(sample.capturedAt) > this.noFramesMs) {
      session.metrics.droppedSamples += 1; this.metrics.droppedSamples += 1;
      return;
    }
    if (session.camera.aiEnabled === false || typeof this.analyzeFrame !== "function") {
      session.aiState = session.camera.aiEnabled === false ? "AI_DISABLED" : "AI_UNAVAILABLE";
      await this.publish(session, session.aiState === "AI_UNAVAILABLE" ? "ai_service_unavailable" : "camera_health_updated", true);
      return;
    }
    session.aiBusy = true; session.aiState = "AI_PROCESSING"; session.metrics.aiRequests += 1; this.metrics.aiRequests += 1;
    await this.publish(session);
    try {
      const payload = {
        sourceType: "cctv", sourceId: session.camera.id,
        sourceName: session.camera.name || session.camera.id,
        zone: session.camera.zone || session.camera.location || "Unassigned",
        timestamp: sample.capturedAt,
        imageBase64: `data:image/jpeg;base64,${sample.frameBuffer.toString("base64")}`
      };
      const result = await withTimeout(this.analyzeFrame(payload, session.camera), this.aiTimeoutMs);
      // Inference may have completed after the frame aged out or the stream was stopped.
      if (session.stopped || this.clock() - Date.parse(sample.capturedAt) > this.noFramesMs) {
        session.metrics.droppedSamples += 1; this.metrics.droppedSamples += 1;
        if (!session.stopped) { session.aiState = "AI_READY"; await this.publish(session); }
        return;
      }
      if (result?.serviceError) {
        session.aiState = /timed?\s*out/i.test(result.serviceError) ? "AI_TIMEOUT" : "AI_UNAVAILABLE";
        if (session.aiState === "AI_TIMEOUT") { session.metrics.aiTimeouts += 1; this.metrics.aiTimeouts += 1; }
        else { session.metrics.aiErrors += 1; this.metrics.aiErrors += 1; }
        await this.publish(session, "ai_service_unavailable", true);
      } else if (result?.configured === false) {
        session.aiState = "AI_UNAVAILABLE"; session.metrics.aiErrors += 1; this.metrics.aiErrors += 1;
        await this.publish(session, "ai_service_unavailable", true);
      } else {
        session.aiState = "AI_READY"; session.lastAiSuccessAt = new Date(this.clock()).toISOString();
        session.metrics.aiSuccesses += 1; this.metrics.aiSuccesses += 1;
        const observation = typeof this.persistObservation === "function"
          ? await this.persistObservation({ camera: { ...session.camera, ...this.snapshot(session) }, result, frameBuffer: sample.frameBuffer, capturedAt: sample.capturedAt, processedAt: session.lastAiSuccessAt })
          : null;
        if (observation) {
          session.lastDetectionAt = observation.capturedAt; session.metrics.detections += 1; this.metrics.detections += 1;
          this.emit("observation_created", { observation, cameraId: session.camera.id });
        }
        this.emit("ai_detection_received", { cameraId: session.camera.id, capturedAt: sample.capturedAt, observationId: observation?.id || null });
        await this.publish(session, "camera_health_updated", true);
      }
    } catch (error) {
      session.aiState = error?.code === "AI_TIMEOUT" ? "AI_TIMEOUT" : "AI_ERROR";
      if (session.aiState === "AI_TIMEOUT") { session.metrics.aiTimeouts += 1; this.metrics.aiTimeouts += 1; }
      else { session.metrics.aiErrors += 1; this.metrics.aiErrors += 1; }
      await this.publish(session, session.aiState === "AI_TIMEOUT" ? "ai_service_unavailable" : "camera_health_updated", true);
    } finally {
      session.aiBusy = false;
      const pending = session.pendingFrame; session.pendingFrame = null;
      if (pending && !session.stopped) await this.processSample(session, pending);
    }
  }

  async checkFrames(session) {
    if (session.stopped || !session.connected || !session.lastFrameAt) return;
    if (this.clock() - Date.parse(session.lastFrameAt) <= this.noFramesMs) return;
    session.streamState = "NO_FRAMES"; session.gatewayHealth = "DEGRADED";
    session.lastError = sanitizeGatewayError(new Error("No frames"), session.camera.cameraId || session.camera.id);
    await this.publish(session, "camera_stream_state_changed", true);
  }

  async connectionFailure(session, error) {
    if (session.stopped || session.failureRunning) return;
    session.failureRunning = true;
    session.connected = false;
    session.connector?.stop?.(); session.connector = null;
    session.lastError = sanitizeGatewayError(error, session.camera.cameraId || session.camera.id);
    const authFailed = /authentication failed/i.test(session.lastError);
    if (authFailed) {
      session.streamState = "AUTH_FAILED"; session.gatewayHealth = "FAILED";
      await this.publish(session, "camera_stream_state_changed", true);
      session.failureRunning = false; return;
    }
    if (session.reconnectCount >= this.maxReconnects) {
      session.streamState = "OFFLINE"; session.gatewayHealth = "OFFLINE";
      await this.publish(session, "camera_offline", true);
      session.failureRunning = false; return;
    }
    session.reconnectCount += 1; this.metrics.reconnects += 1;
    session.streamState = "RECONNECTING"; session.gatewayHealth = "DEGRADED";
    await this.publish(session, "camera_stream_state_changed", true);
    const delay = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** (session.reconnectCount - 1)));
    session.reconnectTimer = setTimeout(() => { session.failureRunning = false; this.connect(session, true); }, delay);
    session.reconnectTimer.unref?.();
  }

  async stopCamera(cameraId) {
    const session = this.sessions.get(cameraId);
    if (!session) return false;
    session.stopped = true; session.connector?.stop?.();
    if (session.watchdog) clearInterval(session.watchdog);
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    this.sessions.delete(cameraId);
    this.metrics.activeStreams = [...this.sessions.values()].filter((item) => item.connected).length;
    return true;
  }

  async stopAll() { await Promise.all([...this.sessions.keys()].map((id) => this.stopCamera(id))); }
  state(cameraId) { const session = this.sessions.get(cameraId); return session ? this.snapshot(session) : null; }
  health() { return { ...this.metrics, configuredStreams: this.sessions.size, activeStreams: [...this.sessions.values()].filter((item) => item.connected).length }; }
}

function isoCapture(value, fallbackMs) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date(fallbackMs).toISOString();
}

module.exports = { STREAM_STATES, AI_STATES, MediaGateway, FfmpegRtspConnector, SimulatorConnector, jpegFrames, cameraWithDecryptedSecrets };
