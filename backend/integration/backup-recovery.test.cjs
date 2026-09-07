const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { backup, restore } = require("../../scripts/backup-postgres-evidence.cjs");

test("restore PostgreSQL and evidence together into fresh isolated containers", { timeout: 360000 }, async () => {
  const started = Date.now();
  const suffix = crypto.randomBytes(6).toString("hex");
  const source = `rakshakai-recovery-source-${suffix}`;
  const target = `rakshakai-recovery-target-${suffix}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rakshakai-recovery-"));
  const output = path.join(directory, "paired-backup");
  const env = { ...process.env, RELEASE_TEST_PASSWORD: crypto.randomBytes(24).toString("hex"), RELEASE_TEST_JWT: crypto.randomBytes(32).toString("hex") };
  const root = path.resolve(__dirname, "../..");
  function docker(args, quiet = false) {
    const result = spawnSync("docker", args, { cwd: root, env, encoding: "utf8", timeout: 180000, maxBuffer: 15 * 1024 * 1024 });
    if (!quiet) {
      for (const value of [result.stdout || "", result.stderr || ""]) process.stdout.write(value.replaceAll(env.RELEASE_TEST_PASSWORD, "[REDACTED]").replaceAll(env.RELEASE_TEST_JWT, "[REDACTED]"));
    }
    if (result.error || result.status !== 0) throw new Error(`Docker ${args[0]} failed in isolated recovery drill`);
    return result.stdout.trim();
  }
  const compose = (project, args, quiet = false) => docker(["compose", "--project-name", project, "--file", "compose.test.yaml", ...args], quiet);
  const options = (project) => ({ postgres: `${project}-postgres-1`, backend: `${project}-backend-1`, database: "rakshakai_test_release", user: "release_test" });
  const snapshotCode = `
    const assert=require('node:assert/strict');
    const crypto=require('node:crypto');
    const {readDatabase}=require('./services/core.service');
    const {closePool}=require('./services/postgres.service');
    (async()=>{
      const db=await readDatabase();
      const user=db.users.find(u=>u.role==='Admin');
      const login=await fetch('http://127.0.0.1:5000/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:process.env.SEED_ADMIN_PASSWORD})});
      assert.equal(login.status,200);
      const cookie=login.headers.getSetCookie().find(v=>v.startsWith('rakshakai_session=')).split(';')[0];
      const checksums=[];
      for(const evidence of db.videoEvidence.filter(e=>e.storageKey)){
        const response=await fetch('http://127.0.0.1:5000/api/video-evidence/'+evidence.id+'/preview',{headers:{Cookie:cookie}});
        assert.equal(response.status,200);
        const checksum=crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
        assert.equal(checksum,evidence.checksum);
        checksums.push(checksum);
      }
      assert.ok(checksums.length>0);
      const counts=Object.fromEntries(['users','incidents','responseUnits','reports','videoEvidence','auditLogs','dispatchEvents'].map(k=>[k,(db[k]||[]).length]));
      console.log(JSON.stringify({counts,checksums:checksums.sort()}));
    })().catch(()=>{console.error('Recovery snapshot or preview failed');process.exitCode=1;}).finally(closePool);
  `;
  try {
    compose(source, ["up", "--build", "--detach", "--wait", "--wait-timeout", "180", "backend"]);
    compose(source, ["run", "--rm", "--no-deps", "integration", "node", "--test", "--test-name-pattern=fresh non-root Docker evidence volume", "integration/release.test.cjs"]);
    const before = JSON.parse(compose(source, ["exec", "-T", "backend", "node", "-e", snapshotCode], true));
    await assert.rejects(backup({ ...options(source), output }), /Stop the backend/);
    compose(source, ["stop", "backend"]);
    await backup({ ...options(source), output });

    compose(target, ["up", "--detach", "--wait", "postgres"]);
    compose(target, ["create", "--build", "backend"]);
    const manifestPath = path.join(output, "manifest.json");
    const originalManifest = fs.readFileSync(manifestPath, "utf8");
    const broken = JSON.parse(originalManifest);
    broken.files["database.dump"].sha256 = "0".repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(broken));
    await assert.rejects(restore({ ...options(target), input: output }), /checksum/);
    fs.writeFileSync(manifestPath, originalManifest);
    const restoreStarted = Date.now();
    await restore({ ...options(target), input: output });
    await assert.rejects(restore({ ...options(target), input: output }), /empty target database/);
    compose(target, ["up", "--no-deps", "--detach", "--wait", "--wait-timeout", "180", "backend"]);
    const after = JSON.parse(compose(target, ["exec", "-T", "backend", "node", "-e", snapshotCode], true));
    assert.deepEqual(after, before, "restored collection counts and evidence preview checksums match source");
    console.log(JSON.stringify({ event: "recovery_drill_passed", evidenceFilesVerified: after.checksums.length, restoreAndVerificationMs: Date.now() - restoreStarted, totalMs: Date.now() - started }));
  } finally {
    for (const project of [target, source]) {
      compose(project, ["down", "--timeout", "30"]);
      const volumes = docker(["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`], true).split(/\r?\n/).filter(Boolean);
      for (const volume of volumes) {
        assert.ok(volume.startsWith(`${project}_`));
        docker(["volume", "rm", volume]);
      }
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("rakshakai-recovery-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
