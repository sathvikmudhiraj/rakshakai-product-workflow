const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");

const project = `rakshakai-release-test-${crypto.randomBytes(6).toString("hex")}`;
const env = {
  ...process.env,
  RELEASE_TEST_PASSWORD: crypto.randomBytes(24).toString("hex"),
  RELEASE_TEST_JWT: crypto.randomBytes(32).toString("hex"),
  RELEASE_TEST_CAMERA_KEY: crypto.randomBytes(32).toString("hex"),
};
const args = ["compose", "--project-name", project, "--file", "compose.test.yaml"];
function docker(command, { quiet = false } = {}) {
  const result = spawnSync("docker", command, { env, cwd: path.resolve(__dirname, ".."), encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const redact = (text = "") => text
    .replaceAll(env.RELEASE_TEST_PASSWORD, "[REDACTED]")
    .replaceAll(env.RELEASE_TEST_JWT, "[REDACTED]")
    .replaceAll(env.RELEASE_TEST_CAMERA_KEY, "[REDACTED]");
  if (!quiet) {
    process.stdout.write(redact(result.stdout));
    process.stderr.write(redact(result.stderr));
  }
  if (result.error || result.status !== 0) throw new Error(`Docker ${command[0]} failed (exit ${result.status})`);
  return result.stdout;
}

async function main() {
try {
  docker(["version", "--format", "{{.Server.Version}}"]);
  docker([...args, "config", "--quiet"]);
  docker([...args, "up", "--build", "--detach", "--wait", "--wait-timeout", "180", "frontend"]);
  const address = docker([...args, "port", "frontend", "80"], { quiet: true }).trim();
  env.RELEASE_TEST_ORIGIN = `http://${address}`;
  env.RELEASE_TEST_PORT = new URL(env.RELEASE_TEST_ORIGIN).port;
  docker([...args, "up", "--no-deps", "--force-recreate", "--detach", "--wait", "backend"]);
  docker([...args, "up", "--no-deps", "--force-recreate", "--detach", "--wait", "frontend"]);
  docker([...args, "run", "--rm", "integration"]);
  await require("./browser-release.cjs").runBrowserChecks({ baseUrl: `http://${address}`, password: env.RELEASE_TEST_PASSWORD });
  console.log("Isolated PostgreSQL and production frontend release checks passed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Only resources labeled with this run's random project name are eligible for cleanup.
  try {
    docker([...args, "down", "--timeout", "30"]);
    const volumes = docker(["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], { quiet: true }).trim().split(/\r?\n/).filter(Boolean);
    for (const volume of volumes) {
      if (!volume.startsWith(`${project}_`)) throw new Error("Unexpected test volume name; preserving it");
      docker(["volume", "rm", volume]);
    }
  } catch (error) {
    console.error(`Test resource cleanup: ${error.message}`);
    process.exitCode = 1;
  }
}
}

main().catch(() => { process.exitCode = 1; });
