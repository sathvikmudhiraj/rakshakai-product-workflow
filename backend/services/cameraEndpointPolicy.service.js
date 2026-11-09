const net = require("node:net");

const SAFE_PROTOCOLS = new Set(["rtsp:", "rtsps:"]);

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 169 && parts[1] === 254);
}

function configuredHosts(env = process.env) {
  return String(env.CAMERA_NETWORK_ALLOWLIST || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function hostMatches(hostname, allowed) {
  return allowed.some((entry) => hostname === entry || (entry.startsWith("*.") && hostname.endsWith(entry.slice(1))));
}

function validateCameraEndpoint(value, { env = process.env } = {}) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw Object.assign(new Error("Camera stream endpoint is invalid"), { status: 400 }); }
  if (!SAFE_PROTOCOLS.has(url.protocol)) {
    throw Object.assign(new Error("Camera gateway accepts RTSP or RTSPS endpoints only"), { status: 400 });
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "0.0.0.0" || hostname === "::" || hostname.endsWith(".invalid")) {
    throw Object.assign(new Error("Camera stream host is not permitted"), { status: 400 });
  }
  const allowLoopback = String(env.CAMERA_ALLOW_LOOPBACK || "").toLowerCase() === "true" || env.NODE_ENV === "test";
  const loopback = hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  const privateNetwork = net.isIP(hostname) === 4 && isPrivateIpv4(hostname);
  const trustedLocalName = /\.(?:local|lan|internal)$/i.test(hostname);
  const explicit = hostMatches(hostname, configuredHosts(env));
  if ((loopback && !allowLoopback) || (!privateNetwork && !trustedLocalName && !explicit)) {
    throw Object.assign(new Error("Camera stream host is outside the authorized camera network policy"), { status: 400 });
  }
  const port = url.port ? Number(url.port) : 554;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error("Camera stream port is invalid"), { status: 400 });
  }
  return { protocol: url.protocol, hostname, port };
}

function sanitizeGatewayError(error, cameraId = "camera") {
  const message = String(error?.message || error || "Stream unavailable");
  if (/401|403|unauthori[sz]ed|authentication|invalid data found/i.test(message)) {
    return `Camera ${cameraId} RTSP authentication failed.`;
  }
  if (/timed?\s*out|timeout/i.test(message)) return `Camera ${cameraId} connection timed out.`;
  if (/no frames|frame timeout/i.test(message)) return `Camera ${cameraId} stopped sending frames.`;
  return `Camera ${cameraId} stream connection failed.`;
}

module.exports = { SAFE_PROTOCOLS, validateCameraEndpoint, sanitizeGatewayError, isPrivateIpv4 };
