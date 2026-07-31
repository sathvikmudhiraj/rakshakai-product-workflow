const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const net = require("node:net");
const crypto = require("node:crypto");

const authRoutes = require("./routes/auth.routes");
const incidentRoutes = require("./routes/incidents.routes");
const alertRoutes = require("./routes/alerts.routes");
const cameraRoutes = require("./routes/cameras.routes");
const aiRoutes = require("./routes/ai.routes");
const missingPersonRoutes = require("./routes/missingPersons.routes");
const deviceHealthRoutes = require("./routes/deviceHealth.routes");
const auditRoutes = require("./routes/audit.routes");
const incidentController = require("./controllers/incidents.controller");
const auditController = require("./controllers/audit.controller");
const { errorMiddleware } = require("./middleware/error.middleware");
const { validateJson } = require("./middleware/validate.middleware");
const { readDatabase, userFromReq, hasRole, repairLegacyPersistedData } = require("./services/core.service");
const { getDatabaseMode, query } = require("./services/postgres.service");
const { resolveOsrmBaseUrl, routeTimeoutMs, routeUnavailableWarning, routingProvider } = require("./services/routingConfig.service");
const { normalizeNominatimResult, normalizeNominatimResults } = require("./services/geocoding.service");
const { approximateRouteResponse, haversineDistanceKm, normalizeOsrmRoutes } = require("./services/routeNormalization.service");
const { legacyHandler } = require("./services/legacyRoute.service");
const { helmetDirectives } = require("../csp.config.cjs");

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const port = Number(process.env.PORT || 5000);
const geocodeCache = new Map();
let geocodeQueue = Promise.resolve();
let lastGeocodeRequestAt = 0;
const gisHealth = {
  geocoder: { provider: "nominatim", configured: true, reachable: null, status: "unknown", lastSuccess: null, lastError: null },
  routing: { provider: routingProvider(), configured: false, reachable: null, mode: "approximate-fallback", status: "unknown", lastSuccess: null, lastError: null },
  lastSuccessfulRoute: null,
  lastRouteError: null
};
const allowedOrigins = new Set([
  ...(process.env.NODE_ENV === "production" ? [] : [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173"
  ]),
  ...(process.env.FRONTEND_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  ...(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (allowedOrigins.has(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return true;

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(hostname) === 4) {
      const [first, second] = hostname.split(".").map(Number);
      return first === 10
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168);
    }

    return hostname === "fc00::/7" || hostname.startsWith("fc") || hostname.startsWith("fd");
  } catch (error) {
    return false;
  }
}

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT || 600),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 10),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts. Please wait and try again." }
});
const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.GEOCODE_RATE_LIMIT || 30),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many place searches. Please wait and try again.", code: "GEOCODER_RATE_LIMIT" }
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: helmetDirectives()
  }
}));
app.use(generalLimiter);
app.use((req, res, next) => {
  req.requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 120);
  res.setHeader("X-Request-Id", req.requestId);
  next();
});
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin is not allowed" });
  }
  next();
});
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1.5mb", strict: true }));
app.use(validateJson);

app.get("/api/health", async (req, res) => {
  try {
    if (getDatabaseMode() === "postgres") await query("SELECT 1");
    const routingStatus = gisHealth.routing.status === "connected"
      ? "connected"
      : "approximate-fallback";
    res.json({
      status: "ok",
      service: "RakshakAI Backend",
      database: getDatabaseMode(),
      auth: "jwt",
      incidentMode: "deduplicated-command-center",
      routing: {
        provider: routingProvider(),
        configured: Boolean(String(process.env.OSRM_BASE_URL || "").trim()),
        reachable: gisHealth.routing.reachable,
        status: routingStatus,
        mode: routingStatus,
        osrmRequiredForStartup: false
      },
      geocoder: {
        provider: "nominatim",
        configured: true,
        reachable: gisHealth.geocoder.reachable,
        status: gisHealth.geocoder.status
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      service: "RakshakAI Backend",
      database: getDatabaseMode(),
      auth: "jwt",
      error: "Database unavailable",
      timestamp: new Date().toISOString()
    });
  }
});

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function validPoint(point) {
  const rawLat = point?.lat;
  const rawLng = point?.lng ?? point?.lon;
  if (rawLat === null || rawLat === undefined || rawLat === "" || typeof rawLat === "boolean") return null;
  if (rawLng === null || rawLng === undefined || rawLng === "" || typeof rawLng === "boolean") return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function distanceKmBetween(start, destination) {
  return haversineDistanceKm(start, destination);
}

function geocodeConfidence(item) {
  const importance = Number(item?.importance);
  if (!Number.isFinite(importance)) return { importance: null, confidence: "low" };
  return {
    importance,
    confidence: importance >= 0.6 ? "high" : importance >= 0.35 ? "medium" : "low"
  };
}

async function requireMapUser(req) {
  const db = await readDatabase();
  const user = userFromReq(req, db);
  if (!user) throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!hasRole(user, ["Police Officer", "Admin"])) {
    throw Object.assign(new Error("You do not have permission for this action"), { status: 403 });
  }
}

function cachedGeocode(key) {
  const item = geocodeCache.get(key);
  if (!item || item.expiresAt < Date.now()) {
    geocodeCache.delete(key);
    return null;
  }
  return item.value;
}

function rememberGeocode(key, value, ttlMs = 10 * 60 * 1000) {
  if (geocodeCache.size >= 200) geocodeCache.delete(geocodeCache.keys().next().value);
  geocodeCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function nominatimJson(pathname, params) {
  const base = String(process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").trim().replace(/\/+$/, "");
  const url = new URL(`${base}${pathname}`);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw Object.assign(new Error("Geocoding provider must use HTTPS"), { status: 502, code: "GEOCODER_CONFIGURATION" });
  }
  Object.entries(params).forEach(([key, value]) => {
    if (key !== "requestId") url.searchParams.set(key, String(value));
  });
  const task = geocodeQueue.then(async () => {
    const waitMs = Math.max(0, 1000 - (Date.now() - lastGeocodeRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastGeocodeRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept-Language": "en",
          "User-Agent": process.env.MAP_USER_AGENT || "RakshakAI/1.0 public-safety-command-center"
        }
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Geocoding service returned HTTP ${response.status}`), {
          status: response.status === 429 ? 503 : 502,
          code: response.status === 429 ? "GEOCODER_RATE_LIMIT" : "GEOCODER_UNAVAILABLE"
        });
      }
      const data = await response.json();
      gisHealth.geocoder = { ...gisHealth.geocoder, reachable: true, status: "connected", lastSuccess: new Date().toISOString(), lastError: null };
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        error.status = 504;
        error.code = "GEOCODER_TIMEOUT";
        error.message = "Place search provider timed out";
      } else {
        error.status ||= 502;
        error.code ||= "GEOCODER_UNAVAILABLE";
      }
      gisHealth.geocoder = { ...gisHealth.geocoder, reachable: false, status: "degraded", lastError: error.message };
      console.warn(`[GIS ${params.requestId || "no-request-id"}] Geocoder error: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
  geocodeQueue = task.catch(() => {});
  return task;
}

function straightLineRoute(start, destination, warning = routeUnavailableWarning()) {
  return approximateRouteResponse(start, destination, warning);
}

async function buildRoute(start, destination, mode = "driving", requestId = "no-request-id") {
  let routingConfig;
  try {
    routingConfig = resolveOsrmBaseUrl();
  } catch (error) {
    gisHealth.routing = { ...gisHealth.routing, provider: routingProvider(), configured: false, reachable: false, mode: "approximate-fallback", status: "degraded", lastError: error.message };
    gisHealth.lastRouteError = { requestId, message: error.message, timestamp: new Date().toISOString() };
    return straightLineRoute(start, destination, routeUnavailableWarning());
  }
  const profile = mode === "walking" ? "foot" : "driving";
  const url = `${routingConfig.baseUrl.replace(/\/$/, "")}/route/v1/${profile}/${start.lng},${start.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), routeTimeoutMs());
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new Error("Route unavailable");
    const routeOptions = normalizeOsrmRoutes(data, start, destination);
    if (!routeOptions.length) throw new Error("Route unavailable");
    const calculatedAt = new Date().toISOString();
    routeOptions.forEach((route) => {
      route.calculatedAt = calculatedAt;
      route.requestedStart = start;
      route.requestedDestination = destination;
    });
    const result = {
      provider: "osrm",
      isApproximate: false,
      approximate: false,
      selectedRouteId: routeOptions[0].id,
      routes: routeOptions,
      ...routeOptions[0],
      provider: "osrm",
      routeType: "osrm",
      routeLabel: routeOptions[0].label,
      routeOptions,
      alternateRoutes: routeOptions.slice(1),
      alternativesSupported: routeOptions.length > 1,
      alternativeMessage: routeOptions.length > 1
        ? `${routeOptions.length} route options returned by current routing service.`
        : "Alternative routes unavailable from current routing service."
    };
    gisHealth.routing = { ...gisHealth.routing, provider: routingConfig.provider, configured: true, reachable: true, mode: "osrm", status: "connected", lastSuccess: result.calculatedAt, lastError: null };
    gisHealth.lastSuccessfulRoute = { requestId, calculatedAt: result.calculatedAt, distanceKm: result.distanceKm };
    return result;
  } catch (error) {
    gisHealth.routing = { ...gisHealth.routing, provider: routingConfig.provider, configured: true, reachable: false, mode: "approximate-fallback", status: "degraded", lastError: error.message };
    gisHealth.lastRouteError = { requestId, message: error.message, timestamp: new Date().toISOString() };
    console.warn(`[GIS ${requestId}] Routing error: ${error.message}`);
    return straightLineRoute(start, destination, routeUnavailableWarning(routingConfig.provider));
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/maps/search", geocodeLimiter, async (req, res, next) => {
  try {
    await requireMapUser(req);
    const search = String(req.query.q || "").trim().slice(0, 160);
    if (search.length < 2) return res.status(400).json({ error: "Enter at least two characters to search" });
    const cacheKey = `search:${search.toLowerCase()}`;
    const cached = cachedGeocode(cacheKey);
    if (cached) return res.json({ provider: "nominatim", results: cached, cached: true });
    const data = await nominatimJson("/search", {
      q: search,
      format: "jsonv2",
      addressdetails: 1,
      limit: 5,
      countrycodes: process.env.MAP_COUNTRY_CODES || "in",
      requestId: req.requestId
    });
    const results = normalizeNominatimResults(data).map((place) => ({
      ...place,
      name: place.label,
      displayName: place.label,
      shortName: place.shortLabel,
      confidence: place.importance >= 0.6 ? "high" : place.importance >= 0.35 ? "medium" : "low",
      locationStatus: "Provider result"
    }));
    rememberGeocode(cacheKey, results);
    return res.json({ provider: "nominatim", results, cached: false, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/maps/reverse", async (req, res, next) => {
  try {
    await requireMapUser(req);
    const point = validPoint({ lat: req.query.lat, lng: req.query.lng });
    if (!point) return res.status(400).json({ error: "Valid lat and lng are required" });
    const cacheKey = `reverse:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    const cached = cachedGeocode(cacheKey);
    if (cached) return res.json({ place: cached, cached: true });
    const data = await nominatimJson("/reverse", {
      lat: point.lat,
      lon: point.lng,
      format: "jsonv2",
      addressdetails: 1,
      zoom: 18,
      requestId: req.requestId
    });
    const normalized = normalizeNominatimResult(data);
    const place = normalized ? {
      ...normalized,
      name: normalized.label,
      displayName: normalized.label,
      shortName: normalized.shortLabel,
      confidence: normalized.importance >= 0.6 ? "high" : normalized.importance >= 0.35 ? "medium" : "low",
      locationStatus: "Provider result"
    } : {
      label: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
      shortLabel: "Selected location",
      name: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
      displayName: `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,
      shortName: "Selected location",
      lat: point.lat,
      lng: point.lng,
      type: "other",
      provider: "nominatim",
      importance: 0,
      address: { city: "", town: "", district: "", state: "", postcode: "", country: "" },
      confidence: "low",
      locationStatus: "Coordinates only"
    };
    rememberGeocode(cacheKey, place, 24 * 60 * 60 * 1000);
    return res.json({ place, cached: false, requestId: req.requestId });
  } catch (error) {
    next(error);
  }
});

app.post("/api/maps/route", async (req, res, next) => {
  try {
    const db = await readDatabase();
    const user = userFromReq(req, db);
    if (!hasRole(user, ["Police Officer", "Admin"])) {
      return res.status(user ? 403 : 401).json({ error: user ? "You do not have permission for this action" : "Authentication required" });
    }
    const body = await readJsonBody(req);
    const start = validPoint(body.start);
    const destination = validPoint(body.destination);
    if (!start || !destination) return res.status(400).json({ error: "Valid start and destination coordinates are required" });
    return res.json(await buildRoute(start, destination, body.mode || "driving", req.requestId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/maps/health", async (req, res, next) => {
  try {
    await requireMapUser(req);
    res.json({ status: "ok", ...gisHealth, timestamp: new Date().toISOString(), requestId: req.requestId });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRoutes);
app.get("/api/me", legacyHandler("/api/me"));
app.post("/api/login", authLimiter, legacyHandler("/api/login"));
app.post("/api/register", legacyHandler("/api/register"));
app.post("/api/logout", legacyHandler("/api/logout"));
app.get("/api/admin/users", legacyHandler("/api/admin/users"));
app.post("/api/admin/users", legacyHandler("/api/admin/users"));
app.get("/api/admin/police-users", legacyHandler("/api/admin/police-users"));
app.post("/api/admin/police-users", legacyHandler("/api/admin/police-users"));
app.patch("/api/admin/police-users/:id", legacyHandler((req) => `/api/admin/police-users/${req.params.id}`));
app.patch("/api/admin/police-users/:id/activate", legacyHandler((req) => `/api/admin/police-users/${req.params.id}/activate`));
app.patch("/api/admin/police-users/:id/deactivate", legacyHandler((req) => `/api/admin/police-users/${req.params.id}/deactivate`));
app.post("/api/admin/police-users/:id/reset-password", legacyHandler((req) => `/api/admin/police-users/${req.params.id}/reset-password`));
app.get("/api/dashboard", incidentController.dashboard);
app.get("/api/dashboard/summary", incidentController.dashboardSummary);
app.get("/api/route", incidentController.route);
app.get("/api/zones", incidentController.zones);
app.use("/api/incidents", incidentRoutes);
app.use("/api/alerts", alertRoutes);
app.post("/api/alerts/:id/review", legacyHandler((req) => `/api/alerts/${req.params.id}/review`));
app.post("/api/reports/:id/create-incident", legacyHandler((req) => `/api/reports/${req.params.id}/create-incident`));
app.post("/api/reports/:id/reject", legacyHandler((req) => `/api/reports/${req.params.id}/reject`));
app.post("/api/incidents/:id/assign-nearest", legacyHandler((req) => `/api/incidents/${req.params.id}/assign-nearest`));
app.post("/api/send-alert", legacyHandler("/api/send-alert"));
app.use("/api/cameras", cameraRoutes);
app.post("/api/camera-sources", legacyHandler("/api/camera-sources"));
app.get("/api/camera-sources", legacyHandler("/api/camera-sources"));
app.get("/api/camera-feeds", legacyHandler("/api/camera-feeds"));
app.patch("/api/camera-sources/:id/config", legacyHandler((req) => `/api/camera-sources/${req.params.id}/config`));
app.post("/api/camera-sources/:id/test", legacyHandler((req) => `/api/camera-sources/${req.params.id}/test`));
app.post("/api/camera-sources/:id/analyze", legacyHandler((req) => `/api/camera-sources/${req.params.id}/analyze`));
app.delete("/api/camera-sources/:id", legacyHandler((req) => `/api/camera-sources/${req.params.id}`));
app.use("/api/ai", aiRoutes);
app.post("/api/rakshak/analyze-frame", require("./controllers/ai.controller").analyzeFrame);
app.use("/api/missing-persons", missingPersonRoutes);
app.get("/api/reports", legacyHandler("/api/reports"));
app.post("/api/report-missing", legacyHandler("/api/report-missing"));
app.get("/api/video-evidence", legacyHandler("/api/video-evidence"));
app.post("/api/video-evidence", legacyHandler("/api/video-evidence"));
app.get("/api/video-evidence/:id/preview", legacyHandler((req) => `/api/video-evidence/${req.params.id}/preview`));
app.post("/api/video-evidence/:id/analyze", legacyHandler((req) => `/api/video-evidence/${req.params.id}/analyze`));
app.post("/api/video-observations/:id/review", legacyHandler((req) => `/api/video-observations/${req.params.id}/review`));
app.post("/api/video-observations/:id/convert-incident", legacyHandler((req) => `/api/video-observations/${req.params.id}/convert-incident`));
app.post("/api/browser-observations/:id/review", legacyHandler((req) => `/api/browser-observations/${req.params.id}/review`));
app.post("/api/reports/:id/evidence", legacyHandler((req) => `/api/reports/${req.params.id}/evidence`));
app.use("/api/device-health", deviceHealthRoutes);
app.get("/api/devices/health", legacyHandler("/api/devices/health"));
app.use("/api/audit-logs", auditRoutes);
app.get("/api/integrations/status", auditController.integrations);
app.get("/api/response-units", legacyHandler("/api/response-units"));
app.post("/api/response-units", legacyHandler("/api/response-units"));
app.patch("/api/response-units/:id", legacyHandler((req) => `/api/response-units/${req.params.id}`));
app.delete("/api/response-units/:id", legacyHandler((req) => `/api/response-units/${req.params.id}`));
app.get("/api/police-stations", legacyHandler("/api/police-stations"));
app.post("/api/police-stations", legacyHandler("/api/police-stations"));
app.patch("/api/police-stations/:id", legacyHandler((req) => `/api/police-stations/${req.params.id}`));
app.delete("/api/police-stations/:id", legacyHandler((req) => `/api/police-stations/${req.params.id}`));
app.get("/api/response-units/nearest", legacyHandler("/api/response-units/nearest"));

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});
app.use(errorMiddleware);

async function start(listenPort = port) {
  if (process.env.NODE_ENV === "production") {
    if (getDatabaseMode() !== "postgres") {
      throw new Error("DATABASE_URL is required in production");
    }
    const secret = String(process.env.JWT_SECRET || "");
    if (secret.length < 32 || secret === "dev_secret_change_later") {
      throw new Error("JWT_SECRET must be a strong value of at least 32 characters in production");
    }
    if (!process.env.CORS_ORIGIN && !process.env.FRONTEND_ORIGINS) {
      throw new Error("CORS_ORIGIN is required in production");
    }
  }
  if (getDatabaseMode() === "postgres") {
    const requiredTables = [
      "users",
      "incidents",
      "alerts",
      "response_units",
      "dispatch_events",
      "camera_sources",
      "audit_logs",
      "missing_persons",
      "app_state"
    ];
    const result = await query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])",
      [requiredTables]
    );
    const available = new Set(result.rows.map((row) => row.tablename));
    const missing = requiredTables.filter((table) => !available.has(table));
    if (missing.length) {
      throw new Error("PostgreSQL schema is missing. Run: npm run migrate");
    }
  }
  const legacyRepairs = await repairLegacyPersistedData();
  if (legacyRepairs.length) {
    console.log(`RakshakAI legacy location repair applied ${legacyRepairs.length} update(s).`);
  }
  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : listenPort;
      console.log(`RakshakAI Backend running at http://localhost:${activePort}/api (${getDatabaseMode()})`);
      resolve(server);
    });
    server.once("error", reject);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("RakshakAI Backend failed to start:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, start };
