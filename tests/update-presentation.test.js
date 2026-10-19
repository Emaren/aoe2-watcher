const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const statusFunction = renderer.slice(
  renderer.indexOf("function getReleaseStatus()"),
  renderer.indexOf("function formatDateTime", renderer.indexOf("function getReleaseStatus()"))
);
function presentation(updateState) {
  return vm.runInNewContext(`${statusFunction}\ngetReleaseStatus()`, {
    appInfo: { version: "1.6.3", release: {} }, updateState,
  });
}

test("failed downloaded installation shows a retry without claiming installation is pending", () => {
  const view = presentation({ status: "error", downloaded: true, message: "Installation failed; monitoring restored." });
  assert.match(view.headline, /Update Paused/);
  assert.equal(view.detail, "Installation failed; monitoring restored.");
  assert.equal(view.canInstall, true);
  assert.equal(view.showUpdate, true);
});

test("Mac validation wait remains a deferred update with its truthful message", () => {
  const view = presentation({ status: "pending_install", downloaded: true, message: "Verifying the signed Mac update in the background." });
  assert.match(view.detail, /Verifying/);
  assert.equal(view.canInstall, true);
});

test("manual portable and unsupported-platform replacement never exposes install action", () => {
  for (const manualReason of ["windows_portable", "linux_non_appimage", "mac_signing_unverified"]) {
    const view = presentation({ status: "manual_required", manualInstall: true, manualReason, error: "Validation failed", manualDownloadUrl: "https://example.invalid/download" });
    assert.equal(view.canInstall, false);
    assert.equal(view.updateUrl, "https://example.invalid/download");
    assert.equal(view.detail, "Update needs a fresh download.");
  }
});
