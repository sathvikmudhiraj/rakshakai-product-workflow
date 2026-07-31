const PUBLIC_OSRM_BASE_URL = "https://router.project-osrm.org";

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function boolEnv(key, fallback) {
  const value = envValue(key).toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function routingProvider() {
  const configured = envValue("GIS_ROUTING_PROVIDER").toLowerCase();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "self_hosted" : "public";
}

function publicOsrmFallbackEnabled(provider = routingProvider()) {
  if (process.env.NODE_ENV === "production") return false;
  const defaultValue = process.env.NODE_ENV !== "production" && provider === "public";
  return boolEnv("PUBLIC_OSRM_FALLBACK", defaultValue);
}

function isPublicOsrmUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "") === PUBLIC_OSRM_BASE_URL;
}

function routeTimeoutMs(defaultMs = 3000) {
  const value = Number(envValue("ROUTE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? value : defaultMs;
}

function resolveOsrmBaseUrl() {
  const provider = routingProvider();
  const configured = envValue("OSRM_BASE_URL");
  const publicFallback = publicOsrmFallbackEnabled(provider);

  if (process.env.NODE_ENV === "production" && provider === "public") {
    throw new Error("GIS_ROUTING_PROVIDER=public is not allowed in production");
  }

  if (process.env.NODE_ENV === "production" && isPublicOsrmUrl(configured)) {
    throw new Error("Public OSRM is not allowed in production");
  }

  if (provider === "self_hosted") {
    if (!configured) throw new Error("OSRM_BASE_URL is required when GIS_ROUTING_PROVIDER=self_hosted");
    return { baseUrl: configured, provider, publicFallback };
  }

  if (configured) return { baseUrl: configured, provider, publicFallback };
  if (publicFallback) return { baseUrl: PUBLIC_OSRM_BASE_URL, provider, publicFallback };
  throw new Error("OSRM_BASE_URL is required because public OSRM fallback is disabled");
}

function routeUnavailableWarning(provider = routingProvider()) {
  return provider === "self_hosted"
    ? "Self-hosted routing unavailable - approximate route shown."
    : "Routing service unavailable - approximate route shown.";
}

module.exports = {
  PUBLIC_OSRM_BASE_URL,
  publicOsrmFallbackEnabled,
  resolveOsrmBaseUrl,
  routeTimeoutMs,
  routeUnavailableWarning,
  routingProvider
};
