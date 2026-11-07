#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const project = process.argv[2];
const candidateRef = process.argv[3];
const evidenceFile = path.resolve(process.argv[4] || "artifacts/staging-rollback-drill.json");
const port = Number(process.argv[5] || 48124);
if (!/^rakshakai-stage-[a-z0-9-]+$/.test(project || "") || !candidateRef
  || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 3001) {
  throw new Error("Usage: node scripts/staging-rollback-drill.cjs <rakshakai-stage-project> <local-candidate-image> <new-evidence-file> [loopback-port]");
}
if (fs.existsSync(evidenceFile)) throw new Error("Choose a new evidence file; drill records are immutable");

const drillName = `rakshakai-rollback-drill-${crypto.randomBytes(6).toString("hex")}`;
const baseUrl = `http://127.0.0.1:${port}`;
function docker(args) { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function inspect(id) { return JSON.parse(docker(["inspect", id]))[0]; }
function image(ref) { return JSON.parse(docker(["image", "inspect", ref]))[0]; }
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function projectContainers(name) {
  return docker(["ps", "-a", "--filter", `label=com.docker.compose.project=${name}`, "--format", "{{.ID}}"])
    .split(/\r?\n/).filter(Boolean).map((id) => {
      const item = inspect(id);
      return { id: item.Id, service: item.Config.Labels["com.docker.compose.service"], imageId: item.Image };
    });
}
function assertUnchanged(before, name) {
  const after = projectContainers(name);
  if (JSON.stringify(after.sort((a, b) => a.id.localeCompare(b.id))) !== JSON.stringify(before.sort((a, b) => a.id.localeCompare(b.id)))) {
    throw new Error(`${name} Compose container identities changed during the drill`);
  }
}
function internalPort(ref) {
  const exposed = Object.keys(image(ref).Config.ExposedPorts || {});
  const portName = exposed.find((value) => value === "8080/tcp") || exposed.find((value) => value === "80/tcp");
  if (!portName) throw new Error("Frontend image does not expose 8080 or 80 TCP");
  return portName.split("/")[0];
}
async function ready() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const health = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2000) });
      if (health.ok) {
        const api = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
        if (!api.ok) throw new Error(`Staging API proxy returned ${api.status}`);
        const index = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(3000) });
        if (!index.ok) throw new Error(`Staging index returned ${index.status}`);
        return { healthStatus: health.status, apiStatus: api.status, indexStatus: index.status,
          indexSha256: sha(Buffer.from(await index.arrayBuffer())) };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Staging frontend or API proxy did not become healthy");
}
async function main() {
  const production = projectContainers("rakshakai");
  const staging = projectContainers(project);
  const frontends = staging.filter((item) => item.service === "frontend");
  const backends = staging.filter((item) => item.service === "backend");
  if (frontends.length !== 1 || backends.length !== 1) throw new Error("Existing isolated staging frontend and backend are required");
  if (inspect(frontends[0].id).State.Health?.Status !== "healthy" || inspect(backends[0].id).State.Health?.Status !== "healthy") {
    throw new Error("Existing staging frontend and backend must be healthy");
  }
  const networks = Object.keys(inspect(frontends[0].id).NetworkSettings.Networks || {});
  const backendNetworks = Object.keys(inspect(backends[0].id).NetworkSettings.Networks || {});
  const network = networks.find((name) => backendNetworks.includes(name) && name.startsWith(`${project}_`));
  if (!network) throw new Error("Staging frontend and backend do not share an isolated project network");
  const baselineImage = frontends[0].imageId;
  const candidateImage = image(candidateRef).Id;
  if (baselineImage === candidateImage) throw new Error("Candidate must be a different image from the staging baseline");
  const safeEnv = inspect(frontends[0].id).Config.Env.filter((value) => /^CSP_(ENV|CONNECT_SRC|IMG_SRC)=/.test(value));
  const evidence = { project, port, network, startedAt: new Date().toISOString(), baselineImage, candidateImage,
    productionContainers: production, stagingContainers: staging };
  let activeId = null;
  async function stopActive() {
    if (!activeId) return;
    const item = inspect(activeId);
    if (item.Config.Labels?.["rakshakai.rollback-drill"] !== drillName) throw new Error("Refusing to stop a container not created by this drill");
    docker(["stop", activeId]);
    activeId = null;
  }
  async function start(ref) {
    const published = `${"127.0.0.1"}:${port}:${internalPort(ref)}`;
    const args = ["run", "--detach", "--rm", "--name", drillName,
      "--label", `rakshakai.rollback-drill=${drillName}`, "--network", network, "--publish", published];
    for (const value of safeEnv) args.push("--env", value);
    activeId = docker([...args, ref]);
    const result = await ready();
    return { id: activeId, imageId: inspect(activeId).Image, ...result };
  }
  try {
    evidence.baseline = await start(baselineImage);
    await stopActive();
    evidence.candidate = await start(candidateImage);
    await stopActive();
    evidence.rollback = await start(baselineImage);
    if (evidence.rollback.indexSha256 !== evidence.baseline.indexSha256 || evidence.rollback.imageId !== baselineImage) {
      throw new Error("Rollback did not restore the baseline image and index bytes");
    }
    evidence.result = "PASS";
  } catch (error) {
    evidence.result = "FAIL";
    evidence.failure = error.message;
    await stopActive().catch(() => {});
    if (evidence.baseline && !evidence.rollback) {
      try { evidence.rollback = await start(baselineImage); } catch (rollbackError) { evidence.rollbackError = rollbackError.message; }
    }
  } finally {
    try { await stopActive(); } catch (error) {
      evidence.result = "FAIL";
      evidence.cleanupError = error.message;
    }
    try {
      assertUnchanged(production, "rakshakai");
      assertUnchanged(staging, project);
      evidence.existingContainersUnchanged = true;
    } catch (error) {
      evidence.result = "FAIL";
      evidence.existingContainersUnchanged = false;
      evidence.containerChange = error.message;
    }
    evidence.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ result: evidence.result, evidenceFile, baseline: evidence.baseline,
      candidate: evidence.candidate, rollback: evidence.rollback, existingContainersUnchanged: evidence.existingContainersUnchanged }, null, 2));
    if (evidence.result !== "PASS") process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
