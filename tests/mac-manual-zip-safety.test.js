const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const zipSource = fs.readFileSync(
  path.join(__dirname, "..", "scripts", "build-manual-zip.mjs"), "utf8",
);

test("direct ZIP readme never instructs bypassing macOS Gatekeeper or quarantine", () => {
  assert.doesNotMatch(zipSource, /xattr\s+-[a-z]*r[a-z]*\s+com\.apple\.quarantine/i);
  assert.doesNotMatch(zipSource, /spctl\s+--master-disable|spctl\s+--global-disable/i);
  assert.doesNotMatch(zipSource, /If macOS blocks the unsigned app, run:/);
  assert.match(zipSource, /Only install an AoE2WAR Watcher release downloaded from https:\/\/aoe2war\.com\//);
  assert.match(zipSource, /Developer ID signed and Apple notarized/);
  assert.match(zipSource, /Do not disable Gatekeeper, remove quarantine attributes, or bypass/);
  assert.match(zipSource, /do not delete or relocate them to upgrade/i);
});
test("direct ZIP remains an identifiable, versioned manual artifact", () => {
  assert.match(zipSource, /packageJson\.version/);
  assert.match(zipSource, /const appBundlePath = path\.join\(distDir, "mac-arm64", appBundleName\)/);
  assert.match(zipSource, /"ditto"/);
  assert.match(zipSource, /"README\.txt"/);
});
