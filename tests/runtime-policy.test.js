const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_FINAL_SETTLE_POLL_MS,
  DEFAULT_FOLDER_FRESHNESS_PROBE_MS,
  DEFAULT_IDLE_RECOVERY_SCAN_MS,
  DEFAULT_MONITOR_WATCHDOG_MS,
  getUpdateBlocker,
  shouldLaunchInBackground,
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

test("idle safety nets are deliberately low-frequency", () => {
  assert.ok(DEFAULT_IDLE_RECOVERY_SCAN_MS >= 60_000);
  assert.ok(DEFAULT_MONITOR_WATCHDOG_MS >= 60_000);
  assert.ok(DEFAULT_FOLDER_FRESHNESS_PROBE_MS >= 300_000);
  assert.ok(DEFAULT_FINAL_SETTLE_POLL_MS >= 10_000);
});
