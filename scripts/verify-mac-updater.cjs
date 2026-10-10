"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function safeMetadataName(raw) {
  const text = String(raw || "").trim().replace(/^["']|["']$/g, "");
  let name;
  try {
    name = decodeURIComponent(text);
  } catch {
    throw new Error("STOP: malformed updater manifest URL encoding");
  }
  if (!name || path.basename(name) !== name || name === "." || name === ".."
      || /[\\/]/.test(name)) {
    throw new Error("STOP: updater manifest must name a local flat artifact");
  }
  return name;
}

function parseMacManifest(text) {
  const lines = text.split(/\r?\n/);
  const version = /^version:\s*(\S+)\s*$/m.exec(text)?.[1];
  const rootPath = /^path:\s*(.+?)\s*$/m.exec(text)?.[1];
  const rootHash = /^sha512:\s*(\S+)\s*$/m.exec(text)?.[1];
  const entries = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s+-\s+url:\s*(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    let digest = "";
    for (let next = index + 1; next < lines.length; next++) {
      if (/^\s+-\s+url:/.test(lines[next]) || /^\S/.test(lines[next])) break;
      const shaMatch = /^\s+sha512:\s*(\S+)\s*$/.exec(lines[next]);
      if (shaMatch) { digest = shaMatch[1]; break; }
    }
    entries.push({ name: safeMetadataName(match[1]), sha512: digest });
  }
  return {
    version, path: safeMetadataName(rootPath), sha512: rootHash, entries,
  };
}

async function sha512Base64(file) {
  const hash = crypto.createHash("sha512");
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest("base64");
}

async function verifyMacUpdater({ dist, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("STOP: invalid version");
  const files = fs.readdirSync(dist);
  const updaterZips = files.filter(name => name.toLowerCase().endsWith(".zip")
    && name !== "aoe2hdbets-watcher-direct.zip");
  if (updaterZips.length !== 1) {
    throw new Error("STOP: expected exactly one distinct updater-native ZIP");
  }
  const name = updaterZips[0];
  if (!name.startsWith(`AoE2HDBets Watcher-${version}-`)
      || !/arm64.*\.zip$/i.test(name)) {
    throw new Error("STOP: version/architecture mismatch in updater-native ZIP");
  }
  const zip = path.join(dist, name);
  const info = fs.statSync(zip);
  if (!info.isFile() || info.size < 1000000) {
    throw new Error("STOP: updater-native ZIP missing or implausibly small");
  }
  const manifest = parseMacManifest(fs.readFileSync(path.join(dist, "latest-mac.yml"), "utf8"));
  if (manifest.version !== version) throw new Error("STOP: macOS updater version mismatch");
  if (manifest.path !== name) throw new Error("STOP: macOS updater default path is not updater-native ZIP");
  const entries = manifest.entries.filter(row => row.name === name);
  if (entries.length !== 1) throw new Error("STOP: updater ZIP missing/ambiguous in macOS manifest files");
  const digest = await sha512Base64(zip);
  if (manifest.sha512 !== digest || entries[0].sha512 !== digest) {
    throw new Error("STOP: updater-native ZIP sha512 does not match latest-mac.yml");
  }
  if (manifest.entries.some(row => row.name === "aoe2hdbets-watcher-direct.zip")) {
    throw new Error("STOP: manual download ZIP referenced by updater metadata");
  }
  return { version, name, bytes: info.size, sha512: digest };
}

if (require.main === module) {
  (async () => {
    const pkg = require("../package.json");
    const result = await verifyMacUpdater({
      dist: path.resolve(__dirname, "..", "dist"), version: pkg.version,
    });
    process.stdout.write(`PASS: native macOS updater ZIP ${result.name} sha512=${result.sha512}\n`);
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyMacUpdater, parseMacManifest };
