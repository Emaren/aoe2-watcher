const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isStableNewerVersion, getUpdateCapability } = require("../updatePolicy");

const pkg = require("../package.json");
const lock = require("../package-lock.json");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

test("public source version and lock metadata are exact 1.6.4, never accidentally shipped as 1.6.3", () => {
  assert.equal(pkg.version, "1.6.4");
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(isStableNewerVersion(pkg.version, "1.5.10"), true);
  assert.equal(isStableNewerVersion(pkg.version, "1.6.3"), true);
  assert.equal(isStableNewerVersion("1.5.10", pkg.version), false);
});
test("old installed Windows Watcher has automatic update capability but portable needs manual replacement", () => {
  assert.deepEqual(getUpdateCapability({
    platform: "win32", isPackaged: true, portableExecutablePath: "",
  }), { automatic: true, manualReason: null });
  assert.deepEqual(getUpdateCapability({
    platform: "win32", isPackaged: true, portableExecutablePath: "C:\\Watcher Portable\\Watcher.exe",
  }), { automatic: false, manualReason: "windows_portable" });
  assert.match(mainSource,/const AUTO_UPDATE_FEED_URL = process\.env\.AOE2_UPDATE_FEED_URL \|\| "https:\/\/aoe2war\.com\/downloads"/);
  assert.match(mainSource,/return path\.join\(app\.getPath\("userData"\), "watcher-config\.json"\)/);
  assert.match(mainSource,/autoUpdater\.checkForUpdates\(\)/);
  assert.match(mainSource,/quitAndInstall\(false, true\)/);
  assert.match(appSource,/manual_required/);
  assert.match(readme,/v1\.5\.10/);
  assert.match(readme,/Watcher 1\.6\.4 is the current public release\./);
  assert.match(readme,/must be verified on a real installed v1\.5\.10 machine/);
  assert.doesNotMatch(readme,/Watcher 1\.6\.4 is not yet published/);
});
test("legacy config and Replay Truth must not be reset as an upgrade shortcut", () => {
  assert.match(mainSource,/\.\.\.loadConfig\(\)/);
  assert.match(mainSource,/\.\.\.migrateLegacyConfig\(config\)/);
  assert.doesNotMatch(mainSource,/rmSync\(getConfigPath\(/);
  assert.match(readme,/does not retroactively decide unknown games/);
});
