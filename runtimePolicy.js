const DEFAULT_IDLE_RECOVERY_SCAN_MS = 60 * 1000;
const DEFAULT_MONITOR_WATCHDOG_MS = 60 * 1000;
const DEFAULT_FOLDER_FRESHNESS_PROBE_MS = 5 * 60 * 1000;
const DEFAULT_FINAL_SETTLE_POLL_MS = 10 * 1000;
const DEFAULT_FOLDER_STATUS_CACHE_MS = 60 * 1000;

function getUpdateBlocker({
  runtimeStatus = {},
  importRunning = false,
  nativeStreamActive = false,
} = {}) {
  if (importRunning) return "historical_import";
  if (nativeStreamActive) return "native_stream";
  if (Number(runtimeStatus.uploadQueueLength || 0) > 0) {
    return "replay_upload";
  }
  if (runtimeStatus.activeReplay) return "active_replay";
  return null;
}

function shouldLaunchInBackground({
  argv = [],
  wasOpenedAtLogin = false,
} = {}) {
  return Boolean(
    wasOpenedAtLogin ||
    argv.some((value) => String(value || "").trim() === "--background")
  );
}

module.exports = {
  DEFAULT_FINAL_SETTLE_POLL_MS,
  DEFAULT_FOLDER_FRESHNESS_PROBE_MS,
  DEFAULT_FOLDER_STATUS_CACHE_MS,
  DEFAULT_IDLE_RECOVERY_SCAN_MS,
  DEFAULT_MONITOR_WATCHDOG_MS,
  getUpdateBlocker,
  shouldLaunchInBackground,
};
