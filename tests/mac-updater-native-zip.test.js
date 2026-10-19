"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const { verifyMacUpdater } = require("../scripts/verify-mac-updater.cjs");

const VERSION = "1.6.4";
const NATIVE = `AoE2HDBets Watcher-${VERSION}-arm64-mac.zip`;
const MANUAL = "aoe2hdbets-watcher-direct.zip";
function fixture(fn) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "watcher-mac-updater-"));
  const zipBytes = Buffer.alloc(1000001, 90);
  fs.writeFileSync(path.join(dist, NATIVE), zipBytes);
  fs.writeFileSync(path.join(dist, MANUAL), "manual only");
  const digest = crypto.createHash("sha512").update(zipBytes).digest("base64");
  const manifest = (url = NATIVE, sha = digest, manifestPath = NATIVE) =>
    `version: ${VERSION}\nfiles:\n  - url: ${url}\n    sha512: ${sha}\n    size: 1000001\npath: ${manifestPath}\nsha512: ${sha}\nreleaseDate: '2026-10-10T00:00:00Z'\n`;
  fs.writeFileSync(path.join(dist, "latest-mac.yml"), manifest());
  return Promise.resolve().then(() => fn({ dist, manifest, digest }))
    .finally(() => fs.rmSync(dist, { recursive: true, force: true }));
}

test("macOS update-native ZIP has its own identity and exact sha512 in latest-mac.yml", async () => {
  await fixture(async ({dist}) => {
    const result = await verifyMacUpdater({dist,version:VERSION});
    assert.equal(result.name, NATIVE);
    assert.equal(result.bytes, 1000001);
  });
});

test("macOS auto updater refuses a manual ZIP, wrong hash, stale or missing native ZIP", async () => {
  await fixture(async ({dist,manifest,digest}) => {
    const write = text => fs.writeFileSync(path.join(dist, "latest-mac.yml"), text);
    write(manifest(MANUAL,digest,MANUAL));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /default path/);
    write(manifest(NATIVE,"bad-hash"));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /sha512/);
    write(manifest().replace("version: 1.6.4", "version: 1.6.3"));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /version mismatch/);
    write(manifest());
    fs.writeFileSync(path.join(dist, "another.zip"), "x");
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /exactly one/);
    fs.rmSync(path.join(dist,"another.zip"));
    fs.rmSync(path.join(dist,NATIVE));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /exactly one/);
  });
});

test("macOS updater rejects nested or ambiguous manifest paths", async () => {
  await fixture(async ({dist,manifest,digest}) => {
    const write = text => fs.writeFileSync(path.join(dist,"latest-mac.yml"),text);
    write(manifest("../bad.zip",digest,"../bad.zip"));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /local flat artifact/);
    write(manifest(NATIVE,digest,"different.zip"));
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /default path/);
    write(manifest()+"  - url: "+NATIVE+"\n    sha512: "+digest+"\n");
    await assert.rejects(verifyMacUpdater({dist,version:VERSION}), /ambiguous/);
  });
});
