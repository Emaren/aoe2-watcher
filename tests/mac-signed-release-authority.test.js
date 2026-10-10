"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const release = fs.readFileSync(path.join(root, ".github/workflows/build-nonwindows-release.yml"), "utf8");
const smoke = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const verifier = fs.readFileSync(path.join(root, "scripts/verify-mac-signed-release.sh"), "utf8");

test("protected Mac release requires explicit signing credentials", () => {
  assert.match(release, /workflow_dispatch:/);
  for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    assert.ok(release.includes(key + ": "), "release workflow missing " + key);
    assert.ok(verifier.includes(key), "attestor missing " + key);
  }
  const preflight = release.indexOf("name: Refuse uncredentialed macOS release");
  const build = release.indexOf("name: Build macOS Watcher");
  const verify = release.indexOf("name: Verify signed/notarized macOS release");
  const upload = release.indexOf("name: Upload macOS release");
  assert.ok(preflight > 0 && build > preflight && verify > build && upload > verify);
});

test("Mac release attestation checks real notarization and update bundle identity", () => {
  for (const invariant of ["codesign --verify --deep --strict",
      "Authority=Developer ID Application:", "TeamIdentifier=$APPLE_TEAM_ID",
      "source=Notarized Developer ID", "xcrun stapler validate",
      "npm run verify:mac-updater", "ditto -x -k", "SIGNED_MACOS_SHA256.txt"]) {
    assert.ok(verifier.includes(invariant), "missing invariant " + invariant);
  }
  assert.ok(release.includes("dist/SIGNED_MACOS_SHA256.txt"));
  assert.ok(release.includes("dist/*-arm64*.zip"));
});

test("unsigned Mac test CI cannot silently become an official release", () => {
  assert.doesNotMatch(smoke, /secrets\.CSC_LINK|secrets\.APPLE_ID|verify-mac-signed-release\.sh/);
  assert.match(smoke, /unsigned-test-only/);
});
