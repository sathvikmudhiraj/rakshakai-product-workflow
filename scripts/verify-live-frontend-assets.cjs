const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const baseUrl = process.env.RAKSHAKAI_URL || "http://localhost:3001";
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function main() {
  const response = await fetch(baseUrl, { cache: "no-store" });
  assert.equal(response.status, 200, "frontend HTML must be served");
  const servedHtml = Buffer.from(await response.arrayBuffer());
  const localHtml = fs.readFileSync(path.join(root, "frontend", "dist", "index.html"));
  assert.equal(sha256(servedHtml), sha256(localHtml), "served HTML differs from local production output");
  const assetNames = [...new Set([...servedHtml.toString("utf8").matchAll(/\/assets\/(index-[^" ]+\.(?:js|css))/g)].map((match) => match[1]))];
  assert.equal(assetNames.length, 2, "expected one JS and one CSS bundle");
  const assets = [];
  for (const name of assetNames) {
    const assetResponse = await fetch(`${baseUrl}/assets/${name}`, { cache: "no-store" });
    assert.equal(assetResponse.status, 200, `${name} must load from the running frontend`);
    const served = Buffer.from(await assetResponse.arrayBuffer());
    const local = fs.readFileSync(path.join(root, "frontend", "dist", "assets", name));
    const item = { name, sha256: sha256(served), matchesLocalBuild: sha256(served) === sha256(local) };
    assert.equal(item.matchesLocalBuild, true, `${name} differs from local production output`);
    assets.push(item);
  }
  console.log(JSON.stringify({ result: "PASS", baseUrl, htmlSha256: sha256(servedHtml), assets }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
