const DEFAULT_IDLE_RECOVERY_SCAN_MS = 60 * 1000;
const DEFAULT_MONITOR_WATCHDOG_MS = 60 * 1000;
const DEFAULT_FOLDER_FRESHNESS_PROBE_MS = 5 * 60 * 1000;
const DEFAULT_FINAL_SETTLE_POLL_MS = 10 * 1000;
const DEFAULT_FOLDER_STATUS_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

const MAX_NODE_TIMER_MS = 2_147_483_647;

// Invalid and out-of-range environment overrides must never become an
// effective 1 ms Node interval (or an infinite/no-op safety watchdog).
// Normal defaults remain unchanged; this is evaluated only during boot.
function boundedBackgroundIntervalMs(
  raw,
  { fallback, minimum, maximum = MAX_NODE_TIMER_MS }
) {
  if (
    !Number.isSafeInteger(fallback) ||
    !Number.isSafeInteger(minimum) ||
    !Number.isSafeInteger(maximum) ||
    minimum < 1 ||
    fallback < minimum ||
    maximum < fallback ||
    maximum > MAX_NODE_TIMER_MS
  ) {
    throw new TypeError("invalid background timer policy");
  }
  if (
    raw === undefined || raw === null ||
    (typeof raw === "string" && !raw.trim())
  ) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function getUpdateBlocker({
  runtimeStatus = {},
  importRunning = false,
  nativeStreamActive = false,
} = {}) {
  if (importRunning) return "historical_import";
  if (nativeStreamActive) return "native_stream";
  if (runtimeStatus.replayScanInFlight) return "replay_scan";
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

function shouldRunBackgroundUpdateCheck(
  updateState = {}
) {
  if (
    updateState.manualInstall ||
    updateState.downloaded
  ) {
    return false;
  }

  return !new Set([
    "checking",
    "available",
    "downloading",
    "manual_required",
    "pending_install",
    "installing",
    "unsupported",
    "dev_skipped",
  ]).has(
    String(
      updateState.status || "idle"
    )
  );
}

function getUpdateTrayPresentation(
  updateState = {}
) {
  const manualUpdateReady =
    Boolean(
      updateState.manualInstall ||
      updateState.status ===
        "manual_required"
    );

  if (manualUpdateReady) {
    const version =
      String(
        updateState.updateVersion || ""
      ).trim();

    return {
      action: "download_manual",
      label: version
        ? `Download Watcher ${version}`
        : "Download Watcher Update",
      tooltip: version
        ? `AoE2HDBets Watcher — update ${version} available`
        : "AoE2HDBets Watcher — update available",
    };
  }

  if (updateState.downloaded) {
    return {
      action: "install_downloaded",
      label: "Install Downloaded Update",
      tooltip: "AoE2HDBets Watcher — update ready to install",
    };
  }

  return {
    action: "check",
    label: "Check for Updates",
    tooltip: "AoE2HDBets Watcher",
  };
}

module.exports = {
  DEFAULT_FINAL_SETTLE_POLL_MS,
  DEFAULT_FOLDER_FRESHNESS_PROBE_MS,
  DEFAULT_FOLDER_STATUS_CACHE_MS,
  DEFAULT_IDLE_RECOVERY_SCAN_MS,
  DEFAULT_MONITOR_WATCHDOG_MS,
  DEFAULT_UPDATE_RECHECK_MS,
  boundedBackgroundIntervalMs,
  getUpdateBlocker,
  getUpdateTrayPresentation,
  shouldLaunchInBackground,
  shouldRunBackgroundUpdateCheck,
};
