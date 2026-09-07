const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let checked = 0;
function check(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (["node_modules", "dist", "storage", "data", "fixtures"].includes(entry.name)) continue;
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(c?js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", file], { cwd: root, encoding: "utf8" });
      if (result.status !== 0) {
        process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
        process.exitCode = 1;
      }
      checked++;
    }
  }
}
for (const directory of ["backend", "frontend", "scripts"]) check(directory);
const result = spawnSync(process.execPath, ["--check", "csp.config.cjs"], { cwd: root, encoding: "utf8" });
if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
console.log(`Syntax checked ${checked + 1} JavaScript files.`);
