const OSM_TILE_SOURCES = [
  "https://tile.openstreetmap.org",
  "https://a.tile.openstreetmap.org",
  "https://b.tile.openstreetmap.org",
  "https://c.tile.openstreetmap.org"
];

const ARCGIS_TILE_SOURCES = [
  "https://server.arcgisonline.com"
];

const BASE_IMG_SOURCES = ["'self'", "data:", "blob:", ...OSM_TILE_SOURCES, ...ARCGIS_TILE_SOURCES];
const DEVELOPMENT_CONNECT_SOURCES = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "ws://localhost:3000",
  "ws://127.0.0.1:3000"
];

function splitSources(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map((source) => source.trim())
    .filter(Boolean);
}

function assertNoUnsafeSource(source) {
  if (source.includes("*")) throw new Error(`CSP source '${source}' is not allowed because wildcards are forbidden.`);
  if (source.includes("unsafe-eval")) throw new Error("CSP source 'unsafe-eval' is forbidden.");
}

function normalizeOriginSource(source, { environment, directive }) {
  assertNoUnsafeSource(source);
  if (source === "'self'") return source;
  if (directive === "img-src" && ["data:", "blob:"].includes(source)) return source;
  if (directive === "connect-src" && !["http://", "https://", "ws://", "wss://"].some((prefix) => source.startsWith(prefix))) {
    throw new Error(`CSP ${directive} source '${source}' must be an origin.`);
  }
  if (directive === "img-src" && !["http://", "https://"].some((prefix) => source.startsWith(prefix))) {
    throw new Error(`CSP ${directive} source '${source}' must be an origin.`);
  }

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`CSP ${directive} source '${source}' is malformed.`);
  }

  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`CSP ${directive} source '${source}' must be an origin without path, query, credentials, or hash.`);
  }

  if (environment === "production" && url.protocol !== "https:") {
    throw new Error(`Production CSP ${directive} source '${source}' must use HTTPS.`);
  }

  if (directive === "connect-src" && !["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error(`CSP ${directive} source '${source}' uses an unsupported protocol.`);
  }
  if (directive === "img-src" && !["http:", "https:"].includes(url.protocol)) {
    throw new Error(`CSP ${directive} source '${source}' uses an unsupported protocol.`);
  }

  return url.origin;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildRakshakaiCsp({
  environment = process.env.CSP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development"),
  connectSrc = process.env.CSP_CONNECT_SRC || "",
  imgSrc = process.env.CSP_IMG_SRC || "",
  allowInlineStyles
} = {}) {
  const normalizedEnvironment = environment === "production" ? "production" : "development";
  const includeUnsafeInlineStyles = allowInlineStyles ?? normalizedEnvironment === "development";
  const extraConnectSources = splitSources(connectSrc).map((source) => normalizeOriginSource(source, {
    environment: normalizedEnvironment,
    directive: "connect-src"
  }));
  const extraImgSources = splitSources(imgSrc).map((source) => normalizeOriginSource(source, {
    environment: normalizedEnvironment,
    directive: "img-src"
  }));

  const directives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    "style-src": includeUnsafeInlineStyles ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "img-src": unique([...BASE_IMG_SOURCES, ...extraImgSources]),
    "connect-src": unique([
      "'self'",
      ...(normalizedEnvironment === "development" ? DEVELOPMENT_CONNECT_SOURCES : []),
      ...extraConnectSources
    ]),
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'"]
  };
  if (normalizedEnvironment === "production") directives["upgrade-insecure-requests"] = [];

  return {
    directives,
    header: Object.entries(directives)
      .map(([name, sources]) => sources.length ? `${name} ${sources.join(" ")}` : name)
      .join("; ")
  };
}

function helmetDirectives(options = {}) {
  const { directives } = buildRakshakaiCsp({ allowInlineStyles: false, ...options });
  return Object.fromEntries(
    Object.entries(directives).map(([name, sources]) => [
      name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      sources
    ])
  );
}

module.exports = {
  ARCGIS_TILE_SOURCES,
  BASE_IMG_SOURCES,
  DEVELOPMENT_CONNECT_SOURCES,
  OSM_TILE_SOURCES,
  buildRakshakaiCsp,
  helmetDirectives,
  normalizeOriginSource,
  splitSources
};
