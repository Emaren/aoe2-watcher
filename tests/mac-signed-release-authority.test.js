"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const release = fs.readFileSync(path.join(root, ".github/workflows/build-nonwindows-release.yml"), "utf8");
const smoke = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const futurePaidVerifier = fs.readFileSync(path.join(root, "scripts/verify-mac-signed-release.sh"), "utf8");

test("macOS production policy is explicitly unsigned manual until Apple Developer is funded", () => {
  assert.match(release, /workflow_dispatch:/);
  assert.match(release, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.match(release, /UNSIGNED_MACOS_SHA256.txt/);
  assert.match(release, /UNSIGNED_MACOS_MANUAL_ONLY=1/);
  assert.match(release, /npm run verify:mac-updater/);
  assert.doesNotMatch(release, /secrets\.(?:CSC_LINK|APPLE_ID|APPLE_TEAM_ID)/);
  assert.doesNotMatch(release, /notarytool submit|stapler staple|Refuse uncredentialed/);
  assert.doesNotMatch(release, /verify-mac-signed-release\.sh/);
  const build = release.indexOf("name: Build unsigned macOS DMG");
  const verify = release.indexOf("name: Verify and attest unsigned macOS");
  const upload = release.indexOf("name: Upload macOS release");
  assert.ok(build > 0 && verify > build && upload > verify);
});

test("future paid Apple signing path stays independently protected, never spoofed by unsigned release", () => {
  for (const invariant of ["codesign --verify --deep --strict", "Authority=Developer ID Application:",
    "TeamIdentifier=$APPLE_TEAM_ID", "source=Notarized Developer ID",
    "xcrun stapler validate", "npm run verify:mac-updater", "ditto -x -k"]) {
    assert.ok(futurePaidVerifier.includes(invariant), "missing future paid identity gate " + invariant);
  }
  assert.doesNotMatch(smoke, /secrets\.CSC_LINK|secrets\.APPLE_ID|verify-mac-signed-release\.sh/);
  assert.match(smoke, /unsigned-test-only/);
});
