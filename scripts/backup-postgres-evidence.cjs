const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const archiveImage = "postgres:16-alpine";

async function docker(args, { input, output } = {}) {
  const descriptors = [];
  try {
    const stdin = input ? fs.openSync(input, "r") : "ignore";
    if (input) descriptors.push(stdin);
    const stdout = output ? fs.openSync(output, "wx", 0o600) : "pipe";
    if (output) descriptors.push(stdout);
    return await new Promise((resolve, reject) => {
      const child = spawn("docker", args, { stdio: [stdin, stdout, "pipe"] });
      let text = "";
      if (!output) child.stdout.on("data", (chunk) => { text += chunk; });
      // Docker/database diagnostics may contain sensitive values; report only the operation.
      child.stderr.resume();
      child.on("error", () => reject(new Error("Docker could not be started")));
      child.on("close", (code) => code === 0 ? resolve(text.trim()) : reject(new Error(`Docker ${args[0]} failed; recovery set is not complete`)));
    });
  } finally {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
  }
}

async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function outsideRepository(directory) {
  const resolved = fs.realpathSync(directory);
  const relative = path.relative(root, resolved);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Recovery sets must be outside the repository");
  }
  return resolved;
}

async function context(options) {
  for (const key of ["postgres", "backend", "database", "user"]) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(options[key] || "")) throw new Error(`A safe explicit --${key} is required`);
  }
  const state = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", options.backend]));
  if (state.Running || state.Restarting || state.Paused) throw new Error("Stop the backend and all other writers before backup or restore");
  const mounts = JSON.parse(await docker(["inspect", "--format", "{{json .Mounts}}", options.backend]));
  const mount = mounts.find((item) => item.Destination === (options["evidence-dir"] || "/app/backend/storage/evidence"));
  if (!mount || mount.Type !== "volume") throw new Error("An explicit Docker named evidence volume is required");
  const pgState = JSON.parse(await docker(["inspect", "--format", "{{json .State}}", options.postgres]));
  if (!pgState.Running) throw new Error("PostgreSQL must be running");
  const version = await docker(["exec", options.postgres, "psql", "-U", options.user, "-d", options.database, "-At", "-c", "SHOW server_version_num"]);
  if (!/^16\d{4}$/.test(version)) throw new Error("This recovery tool supports PostgreSQL 16 only");
  return { volume: mount.Name };
}

async function backup(options) {
  const { volume } = await context(options);
  if (!options.output) throw new Error("--output must name a new recovery-set directory");
  const parent = outsideRepository(path.dirname(path.resolve(options.output)));
  const directory = path.join(parent, path.basename(options.output));
  fs.mkdirSync(directory, { mode: 0o700 });
  const startedAt = new Date().toISOString();
  await docker(["exec", options.postgres, "pg_dump", "-U", options.user, "-d", options.database, "--format=custom", "--no-owner", "--no-acl"], { output: path.join(directory, "database.dump") });
  await docker(["run", "--rm", "--network", "none", "--mount", `type=volume,source=${volume},target=/evidence,readonly`, archiveImage, "tar", "-C", "/evidence", "-czf", "-", "."], { output: path.join(directory, "evidence.tar.gz") });
  await context(options);
  const files = {};
  for (const name of ["database.dump", "evidence.tar.gz"]) {
    const file = path.join(directory, name);
    const bytes = fs.statSync(file).size;
    if (!bytes) throw new Error("An empty backup artifact was produced");
    files[name] = { bytes, sha256: await digest(file) };
  }
  const manifest = { format: 1, postgresMajor: 16, startedAt, completedAt: new Date().toISOString(), consistency: "all writers stopped", files };
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("Paired recovery set completed; database, evidence and manifest are required together.");
}

async function restore(options) {
  const { volume } = await context(options);
  if (!options.input) throw new Error("--input must name a completed recovery set");
  const directory = outsideRepository(options.input);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.postgresMajor !== 16) throw new Error("Unsupported recovery set format");
  for (const name of ["database.dump", "evidence.tar.gz"]) {
    const file = path.join(directory, name);
    if (fs.statSync(file).size !== manifest.files?.[name]?.bytes || await digest(file) !== manifest.files[name].sha256) {
      throw new Error("Recovery artifact checksum or size mismatch");
    }
  }
  const count = await docker(["exec", options.postgres, "psql", "-U", options.user, "-d", options.database, "-At", "-v", "ON_ERROR_STOP=1", "-c", "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');"]);
  if (count !== "0") throw new Error("Restore requires an empty target database; existing data will not be overwritten");
  const entries = await docker(["run", "--rm", "--network", "none", "--mount", `type=volume,source=${volume},target=/evidence,readonly`, archiveImage, "find", "/evidence", "-mindepth", "1", "-print", "-quit"]);
  if (entries) throw new Error("Restore requires an empty evidence volume");
  const archive = path.join(directory, "evidence.tar.gz");
  const listing = await docker(["run", "--rm", "-i", "--network", "none", archiveImage, "tar", "-tzf", "-"], { input: archive });
  if (listing.split("\n").some((entry) => entry.startsWith("/") || entry.split("/").includes(".."))) throw new Error("Unsafe evidence archive path");
  await docker(["run", "--rm", "-i", "--network", "none", "--mount", `type=volume,source=${volume},target=/evidence`, archiveImage, "tar", "-C", "/evidence", "-xzpf", "-"], { input: archive });
  await docker(["exec", "-i", options.postgres, "pg_restore", "-U", options.user, "-d", options.database, "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], { input: path.join(directory, "database.dump") });
  console.log("Paired restore completed. Keep traffic closed until health, role and evidence-preview checks pass.");
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1]) throw new Error("Expected --option value pairs");
    options[args[i].slice(2)] = args[i + 1];
  }
  if (operation === "backup") return backup(options);
  if (operation === "restore") return restore(options);
  throw new Error("Use backup or restore with explicit container, database, user and recovery-set paths");
}

if (require.main === module) main().catch(() => { console.error("Backup/restore failed; do not reopen traffic or use an incomplete recovery set. Verify target state and permissions."); process.exitCode = 1; });
module.exports = { backup, restore, digest };
