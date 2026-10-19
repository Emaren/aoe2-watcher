"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const publisher = fs.readFileSync(path.join(root, ".github/workflows/publish-watcher-v165.yml"), "utf8");
const certifier = fs.readFileSync(path.join(root, "scripts/certify-watcher-v165-release.py"), "utf8");
const { validatePublishAuthority } = require("../scripts/validate-publish-authority.cjs");

test("1.6.5 publisher is source-pinned and cannot run with placeholder pins", () => {
  assert.match(publisher, /BUILD_SOURCE_SHA: "b49f31bb69fea629378072faa22220cdfcc2f1ef"/);
  assert.match(publisher, /WINDOWS_RUN_ID: "0"/);
  assert.match(publisher, /NONWINDOWS_RUN_ID: "0"/);
  assert.match(publisher, /node scripts\/validate-publish-authority\.cjs/);
  assert.throws(() => validatePublishAuthority({
    packageVersion: "1.6.5", lockVersion: "1.6.5", rootLockVersion: "1.6.5",
    env: {VERSION:"1.6.5",BUILD_SOURCE_SHA:"b49f31bb69fea629378072faa22220cdfcc2f1ef",
      RUNTIME_SOURCE_SHA:"8d8a5faf9e92cb51e79aeef2df450df703d5f59c",
      WINDOWS_RUN_ID:"0",NONWINDOWS_RUN_ID:"0"}
  }), /positive workflow run ID/);
});

test("publisher verifies full inventory, signed Windows and explicitly unsigned macOS", () => {
  for (const invariant of [
    "SIGNED_WINDOWS_SHA256.txt","UNSIGNED_MACOS_SHA256.txt",
    "SHA256SUMS-","watcher-release-manifest-",
    "macos_signature", "UNSIGNED", "macos_notarization",
    "manual", "BUILD_SOURCE_SHA", "Windows",
    "latest-mac.yml", "latest-linux.yml"
  ]) assert.match(certifier, new RegExp(invariant));
  assert.match(publisher, /"headSha": os\.environ\["BUILD_SOURCE_SHA"\]/);
  assert.match(publisher, /gh release create/);
  assert.match(publisher, /--draft/);
  assert.match(publisher, /--draft=false/);
  assert.match(publisher, /Production website metadata requires independent app release-controller promotion/);
  assert.doesNotMatch(publisher, /secrets\.(?:APPLE_ID|CSC_LINK|APPLE_TEAM_ID)/);
});

test("published release exact names and source tag must be verified before public edit", () => {
  const assetCheck = publisher.indexOf("Verify exact GitHub release asset inventory and source tag");
  const edit = publisher.indexOf("gh release edit");
  assert.ok(assetCheck > 0 && edit > assetCheck);
  assert.match(publisher, /tag\.get\("object", \{\}\)\.get\("sha"\)/);
  assert.match(publisher, /len\(actual\) != 12/);
});
