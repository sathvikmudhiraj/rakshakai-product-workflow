#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const command = process.argv[2];
const evidencePath = path.resolve(root, process.argv[3] || "artifacts/frontend-release.json");
const compose = ["compose", "--env-file", ".env.docker", "-f", "compose.yaml", "-f", "compose.frontend-release.yaml", "-p", "rakshakai"];

function run(program, args, options = {}) {
  return execFileSync(program, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}
function docker(args, options) { return run("docker", args, options); }
function composeRun(args, image) { return docker([...compose, ...args], { env: { ...process.env, FRONTEND_RELEASE_IMAGE: image } }); }
function inspectContainer(id) { return JSON.parse(docker(["inspect", id]))[0]; }
function imageId(tag) { return JSON.parse(docker(["image", "inspect", tag]))[0].Id; }
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function containers() {
  return docker(["ps", "-a", "--filter", "label=com.docker.compose.project=rakshakai", "--format", "{{.ID}}"])
    .split(/\r?\n/).filter(Boolean).map((id) => {
      const item = inspectContainer(id);
      return { id: item.Id, service: item.Config.Labels?.["com.docker.compose.service"], imageId: item.Image };
    });
}
function frontend() {
  const matches = containers().filter((item) => item.service === "frontend");
  if (matches.length !== 1) throw new Error(`Expected one existing frontend container; found ${matches.length}`);
  const item = inspectContainer(matches[0].id);
  const ports = item.NetworkSettings.Ports?.["8080/tcp"] || [];
  if (!ports.some((port) => port.HostPort === "3001")) throw new Error("Existing frontend is not published on port 3001");
  return { ...matches[0], health: item.State.Health?.Status || item.State.Status };
}
function assertOtherContainers(before) {
  const current = containers();
  for (const item of before.filter((record) => record.service !== "frontend")) {
    if (!current.some((record) => record.id === item.id && record.imageId === item.imageId)) {
      throw new Error(`Unrelated ${item.service} container changed during frontend release`);
    }
  }
}
function assetHashes(containerId) {
  const files = ["/usr/share/nginx/html/index.html", ...docker(["exec", containerId, "find", "/usr/share/nginx/html/assets", "-type", "f"])
    .split(/\r?\n/).filter(Boolean).sort()];
  return Object.fromEntries(files.map((file) => {
    if (!file.startsWith("/usr/share/nginx/html/")) throw new Error("Unexpected asset path");
    const digest = docker(["exec", containerId, "sha256sum", file]).split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Could not hash ${file}`);
    return [file.slice("/usr/share/nginx/html/".length), digest];
  }));
}
async function waitForFrontend() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3001/healthz", { signal: AbortSignal.timeout(2000) });
      if (response.ok) return response.status;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Port 3001 frontend did not become healthy");
}
function assertComposePort(image) {
  const config = JSON.parse(composeRun(["config", "--format", "json"], image));
  const ports = config.services?.frontend?.ports || [];
  if (!ports.some((port) => String(port.published) === "3001" && Number(port.target) === 8080)) {
    throw new Error("Compose frontend configuration does not publish container port 8080 on host port 3001");
  }
}
async function verifyIndex(containerId, hashes) {
  const response = await fetch("http://127.0.0.1:3001/", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Frontend index returned HTTP ${response.status}`);
  const served = Buffer.from(await response.arrayBuffer());
  if (sha(served) !== hashes["index.html"]) throw new Error(`Served index hash differs from container ${containerId}`);
  return response.status;
}
function save(evidence) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
async function main() {
  if (!["plan", "deploy", "rollback"].includes(command)) throw new Error("Usage: node scripts/release-frontend.cjs plan|deploy|rollback [evidence.json]");
  if (!fs.existsSync(path.join(root, ".env.docker"))) throw new Error(".env.docker is required");
  const before = containers();
  const previous = frontend();
  if (command === "plan") {
    const commit = run("git", ["rev-parse", "HEAD"]);
    const clean = !run("git", ["status", "--porcelain"]);
    console.log(JSON.stringify({ commit, clean, frontend: previous, otherContainers: before.filter((item) => item.service !== "frontend") }, null, 2));
    return;
  }
  if (command === "rollback") {
    const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
    if (evidence.previous?.imageId !== imageId(evidence.previous.tag)) throw new Error("Rollback image identity changed");
    assertComposePort(evidence.previous.tag);
    composeRun(["up", "--no-deps", "--no-build", "--force-recreate", "-d", "frontend"], evidence.previous.tag);
    const status = await waitForFrontend();
    assertOtherContainers(before);
    const current = frontend();
    if (current.imageId !== evidence.previous.imageId) throw new Error("Rollback image mismatch");
    const hashes = assetHashes(current.id);
    await verifyIndex(current.id, hashes);
    console.log(JSON.stringify({ result: "rolled_back", status, frontend: current, assetHashes: hashes }, null, 2));
    return;
  }
  const commit = run("git", ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit) || run("git", ["status", "--porcelain"])) throw new Error("Deployment requires a clean exact commit");
  if (process.argv[4] !== commit) throw new Error("Pass the full expected commit SHA as the fourth argument");
  if (fs.existsSync(evidencePath)) throw new Error("Choose a new evidence path; existing release records are immutable");
  const previousTag = `rakshakai-frontend:rollback-${sha(previous.imageId).slice(0, 16)}`;
  const releaseTag = `rakshakai-frontend:commit-${commit}`;
  assertComposePort(releaseTag);
  docker(["tag", previous.imageId, previousTag]);
  docker(["build", "-f", "frontend/Dockerfile", "--build-arg", "VITE_API_BASE_URL=/api", "--label", `org.opencontainers.image.revision=${commit}`, "-t", releaseTag, "."]);
  const releaseImageId = imageId(releaseTag);
  const label = JSON.parse(docker(["image", "inspect", releaseTag]))[0].Config.Labels?.["org.opencontainers.image.revision"];
  if (label !== commit) throw new Error("Built image revision label does not match the exact commit");
  const evidence = { createdAt: new Date().toISOString(), commit, previous: { ...previous, tag: previousTag, assetHashes: assetHashes(previous.id) },
    release: { tag: releaseTag, imageId: releaseImageId }, otherContainers: before.filter((item) => item.service !== "frontend") };
  try {
    composeRun(["up", "--no-deps", "--no-build", "--force-recreate", "-d", "frontend"], releaseTag);
    evidence.release.healthStatus = await waitForFrontend();
    assertOtherContainers(before);
    evidence.release.container = frontend();
    if (evidence.release.container.imageId !== releaseImageId) throw new Error("Deployed image identity mismatch");
    evidence.release.assetHashes = assetHashes(evidence.release.container.id);
    evidence.release.indexStatus = await verifyIndex(evidence.release.container.id, evidence.release.assetHashes);
    evidence.result = "deployed";
    save(evidence);
    console.log(JSON.stringify({ result: evidence.result, evidencePath, commit, frontend: evidence.release.container, assetHashes: evidence.release.assetHashes }, null, 2));
  } catch (error) {
    evidence.result = "deployment_failed";
    evidence.failure = error.message;
    try {
      composeRun(["up", "--no-deps", "--no-build", "--force-recreate", "-d", "frontend"], previousTag);
      evidence.rollback = { status: await waitForFrontend(), container: frontend() };
      assertOtherContainers(before);
      if (evidence.rollback.container.imageId !== previous.imageId) throw new Error("Rollback image mismatch");
      evidence.rollback.assetHashes = assetHashes(evidence.rollback.container.id);
      await verifyIndex(evidence.rollback.container.id, evidence.rollback.assetHashes);
      evidence.rollback.result = "restored";
    } catch (rollbackError) {
      evidence.rollback = { result: "failed", error: rollbackError.message };
    }
    save(evidence);
    throw new Error(`Frontend deployment failed; rollback ${evidence.rollback.result}; evidence: ${evidencePath}`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
