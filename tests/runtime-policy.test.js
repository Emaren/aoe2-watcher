const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FINAL_SETTLE_POLL_MS,
  DEFAULT_FOLDER_FRESHNESS_PROBE_MS,
  DEFAULT_FOLDER_STATUS_CACHE_MS,
  DEFAULT_IDLE_RECOVERY_SCAN_MS,
  DEFAULT_MONITOR_WATCHDOG_MS,
  DEFAULT_UPDATE_RECHECK_MS,
  getUpdateBlocker,
  getUpdateTrayPresentation,
  shouldLaunchInBackground,
  shouldRunBackgroundUpdateCheck,
} = require("../runtimePolicy");

test("armed but idle watcher does not block update install", () => {
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: {
        monitorAttached: true,
        activeReplay: false,
        uploadQueueLength: 0,
      },
    }),
    null
  );
});

test("real replay work blocks update installation", () => {
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: { activeReplay: true, uploadQueueLength: 0 },
    }),
    "active_replay"
  );
  assert.equal(
    getUpdateBlocker({
      runtimeStatus: { activeReplay: false, uploadQueueLength: 1 },
    }),
    "replay_upload"
  );
  assert.equal(
    getUpdateBlocker({ runtimeStatus: {}, importRunning: true }),
    "historical_import"
  );
  assert.equal(
    getUpdateBlocker({ runtimeStatus: {}, nativeStreamActive: true }),
    "native_stream"
  );
});

test("background launch policy recognizes login and explicit starts", () => {
  assert.equal(shouldLaunchInBackground({ argv: ["watcher"] }), false);
  assert.equal(
    shouldLaunchInBackground({ argv: ["watcher", "--background"] }),
    true
  );
  assert.equal(
    shouldLaunchInBackground({
      argv: ["watcher"],
      wasOpenedAtLogin: true,
    }),
    true
  );
});

test("manual Mac update is visible and actionable from the tray", () => {
  assert.deepEqual(
    getUpdateTrayPresentation({
      status: "manual_required",
      manualInstall: true,
      updateVersion: "1.6.2",
      downloaded: false,
    }),
    {
      action: "download_manual",
      label: "Download Watcher 1.6.2",
      tooltip: "AoE2HDBets Watcher — update 1.6.2 available",
    }
  );
});

test("downloaded update remains an install action and idle state remains a check", () => {
  assert.equal(
    getUpdateTrayPresentation({
      downloaded: true,
    }).action,
    "install_downloaded"
  );
  assert.deepEqual(
    getUpdateTrayPresentation({}),
    {
      action: "check",
      label: "Check for Updates",
      tooltip: "AoE2HDBets Watcher",
    }
  );
});

test("background update polling runs only while no update is already pending", () => {
  assert.equal(
    shouldRunBackgroundUpdateCheck({
      status: "current",
    }),
    true
  );
  assert.equal(
    shouldRunBackgroundUpdateCheck({
      status: "error",
    }),
    true
  );

  for (const state of [
    { status: "checking" },
    { status: "downloading" },
    { status: "manual_required", manualInstall: true },
    { status: "pending_install", downloaded: true },
    { status: "installing" },
  ]) {
    assert.equal(
      shouldRunBackgroundUpdateCheck(state),
      false
    );
  }
});

test("idle safety nets are deliberately low-frequency", () => {
  assert.ok(DEFAULT_IDLE_RECOVERY_SCAN_MS >= 60_000);
  assert.ok(DEFAULT_MONITOR_WATCHDOG_MS >= 60_000);
  assert.ok(DEFAULT_FOLDER_FRESHNESS_PROBE_MS >= 300_000);
  assert.ok(DEFAULT_FOLDER_STATUS_CACHE_MS >= 300_000);
  assert.ok(DEFAULT_FINAL_SETTLE_POLL_MS >= 10_000);
  assert.ok(DEFAULT_UPDATE_RECHECK_MS >= 6 * 60 * 60 * 1000);
});


test("folder inspection reports bounded cost evidence for power audits", () => {
  const watcherSource = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "watcher.js"),
    "utf8"
  );

  assert.match(watcherSource, /entriesScanned/);
  assert.match(watcherSource, /inspectionDurationMs/);
  assert.match(watcherSource, /process\.hrtime\.bigint\(\)/);
});
