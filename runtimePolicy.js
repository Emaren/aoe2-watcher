const DEFAULT_IDLE_RECOVERY_SCAN_MS = 60 * 1000;
const DEFAULT_MONITOR_WATCHDOG_MS = 60 * 1000;
const DEFAULT_FOLDER_FRESHNESS_PROBE_MS = 5 * 60 * 1000;
const DEFAULT_FINAL_SETTLE_POLL_MS = 10 * 1000;
const DEFAULT_FOLDER_STATUS_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

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
  getUpdateBlocker,
  getUpdateTrayPresentation,
  shouldLaunchInBackground,
  shouldRunBackgroundUpdateCheck,
};
