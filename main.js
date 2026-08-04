require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const axios = require("axios");
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  powerMonitor,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const { version: WATCHER_VERSION } = require("./package.json");
const {
  createDurableTelemetryQueue,
} = require("./telemetryQueue");

const {
  detectReplayFolder,
  getDefaultReplayDir,
  getRuntimeStatus,
  getSupportedReplayExtensions,
  inspectReplayFolder,
  importHistoricalReplays,
  startWatching,
  stopWatching,
} = require("./watcher");
const { buildStreamHandoff } = require("./streamHandoff");

const WATCHER_PAIR_PROTOCOL = "aoe2hd-watcher";
const APP_NAME = "AoE2HDBets Watcher";
const DEFAULT_RELEASE_BASE_URL = "https://aoe2war.com";
const RELEASE_ENDPOINT_PATH = "/api/watcher/release";
const DOWNLOAD_PAGE_PATH = "/download";
const LEGACY_DOMAIN_MIGRATIONS = [
  ["https://api-prodn.aoe2hdbets.com", "https://api-prodn.aoe2war.com"],
  ["https://api.aoe2hdbets.com", "https://api-prodn.aoe2war.com"],
  ["https://www.aoe2hdbets.com", "https://www.aoe2war.com"],
  ["https://aoe2hdbets.com", "https://aoe2war.com"],
];
const URL_CONFIG_KEYS = ["apiBaseUrl", "apiFallbackBaseUrl", "telemetryBaseUrl"];
const STREAM_HANDOFF_RUNTIME_EVENTS = new Set([
  "monitor-start",
  "replay-detected",
  "waiting-for-minimum-size",
  "file-size-progress",
  "upload-start",
  "upload-success",
  "final-candidate-reopened",
]);
const STREAM_HANDOFF_CLEAR_EVENTS = new Set([
  "final-candidate-accepted",
  "monitor-stop",
  "watching-stopped",
]);
const TELEMETRY_HEARTBEAT_MS = Number(process.env.AOE2_TELEMETRY_HEARTBEAT_MS || 60 * 1000);
const TELEMETRY_TIMEOUT_MS = Number(process.env.AOE2_TELEMETRY_TIMEOUT_MS || 5000);
const TELEMETRY_QUEUE_MAX_ENTRIES = Number(
  process.env.AOE2_TELEMETRY_QUEUE_MAX_ENTRIES ||
    1000
);
const TELEMETRY_QUEUE_MAX_AGE_MS = Number(
  process.env.AOE2_TELEMETRY_QUEUE_MAX_AGE_MS ||
    7 * 24 * 60 * 60 * 1000
);
const RUNTIME_EVENT_JOURNAL_MAX_BYTES = Number(
  process.env.AOE2_RUNTIME_EVENT_JOURNAL_MAX_BYTES ||
    5 * 1024 * 1024
);
const RELEASE_CHECK_TIMEOUT_MS = Number(process.env.AOE2_RELEASE_CHECK_TIMEOUT_MS || 5000);
const AUTO_UPDATE_FEED_URL = process.env.AOE2_UPDATE_FEED_URL || "https://aoe2war.com/downloads";
const MAC_AUTO_UPDATE_ENABLED = process.env.AOE2_ENABLE_MAC_AUTO_UPDATE === "1";
const APP_SESSION_ID = createRandomId("session");

let mainWindow = null;
let watcherHandle = null;
let watcherSession = 0;
let importSession = 0;
let rendererReady = false;
let pendingPairingUrl = null;
let currentImportState = createImportStateFromSummary();
let heartbeatTimer = null;
let durableTelemetryQueue = null;
let releaseState = createReleaseState();
let updateState = createUpdateState();
let updateCheckInFlight = false;
let updateEventsConfigured = false;
let lastStreamHandoff = null;
let monitorWatchdogTimer = null;
let monitorReattachAttempts = 0;
let monitorLastReattachAt = 0;
const MONITOR_WATCHDOG_MS = Number(process.env.AOE2_MONITOR_WATCHDOG_MS || 30 * 1000);
const MONITOR_REATTACH_LIMIT = Number(process.env.AOE2_MONITOR_REATTACH_LIMIT || 3);
const MONITOR_REATTACH_COOLDOWN_MS = Number(
  process.env.AOE2_MONITOR_REATTACH_COOLDOWN_MS || 60 * 1000
);


function createUpdateState(patch = {}) {
  return {
    supported: Boolean(autoUpdater),
    status: "idle",
    message: "Updates idle.",
    feedUrl: AUTO_UPDATE_FEED_URL,
    currentVersion: WATCHER_VERSION,
    updateVersion: null,
    downloaded: false,
    manualInstall: false,
    manualReason: null,
    manualDownloadUrl: null,
    downloadPercent: 0,
    error: null,
    checkedAt: null,
    updatedAt: null,
    ...patch,
  };
}

function requiresManualUpdateInstall() {
  return process.platform === "darwin" && !MAC_AUTO_UPDATE_ENABLED;
}

function isWatcherUpdateBusy() {
  return Boolean(watcherHandle || currentImportState?.isRunning);
}

function getManualUpdateUrl() {
  return releaseState.updateUrl || releaseState.releaseUrl || `${DEFAULT_RELEASE_BASE_URL}${DOWNLOAD_PAGE_PATH}`;
}

function isMacSignatureValidationError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    process.platform === "darwin" &&
    (message.includes("code signature") ||
      message.includes("shipit") ||
      message.includes("did not pass validation"))
  );
}

function setManualUpdateState(reason, error = null, info = {}) {
  const version = info.version || updateState.updateVersion || releaseState.latestVersion || null;

  return setUpdateState(
    {
      supported: true,
      status: "manual_required",
      message:
        reason === "mac_signature_validation"
          ? "Mac update needs a manual replace. Download the new watcher and reopen it."
          : version
            ? `Watcher ${version} is ready. Download and replace the app.`
            : "Watcher update is ready. Download and replace the app.",
      updateVersion: version,
      downloaded: false,
      manualInstall: true,
      manualReason: reason,
      manualDownloadUrl: getManualUpdateUrl(),
      error: error?.message || (error ? String(error) : null),
    },
    {
      logMessage:
        reason === "mac_signature_validation"
          ? "Mac updater could not validate this unsigned build. Download the latest watcher and replace the app."
          : "Mac watcher update is ready. Download the latest watcher and replace the app.",
      level: reason === "mac_signature_validation" ? "warn" : "info",
      telemetryEvent: reason === "mac_signature_validation" ? "watcher_update_error" : "watcher_update_available",
      telemetryPayload: {
        metadata: {
          manualInstall: true,
          manualReason: reason,
          updateInfo: info,
          error: error?.message || (error ? String(error) : null),
        },
      },
    }
  );
}

function buildRuntimeMetadata(config = loadConfig()) {
  const watcherRuntime = getRuntimeStatus();
  const folder = inspectReplayFolder(config?.watchDir);
  return {
    appVersion: WATCHER_VERSION,
    platform: process.platform,
    arch: process.arch,
    osPlatform: os.platform(),
    osRelease: os.release(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    watcherId: config?.watcherId || null,
    sessionId: APP_SESSION_ID,
    isWatching: Boolean(watcherHandle),
    monitorAttached: Boolean(watcherHandle && watcherRuntime.monitorAttached),
    folderValid: folder.valid,
    folderKind: folder.kind,
    folderLabel: folder.label,
    lastFolderActivityAt: watcherRuntime.lastFolderActivityAt || folder.latestReplayModifiedAt,
    lastReplayDetectedAt: watcherRuntime.lastReplayDetectedAt,
    lastReplayUploadAt: watcherRuntime.lastReplayUploadAt,
    lastReplayUploadStatus: watcherRuntime.lastReplayUploadStatus,
    activeReplay: watcherRuntime.activeReplay,
    activeReplayBasename: watcherRuntime.activeReplayBasename,
    activeReplaySizeBytes: watcherRuntime.activeReplaySizeBytes,
    activeReplayLastChangedAt: watcherRuntime.activeReplayLastChangedAt,
    uploadQueueLength: watcherRuntime.uploadQueueLength,
    repeatedUploadErrors: watcherRuntime.repeatedUploadErrors,
    batchUploadActive: Boolean(currentImportState?.isRunning),
    streamActive: Boolean(lastStreamHandoff?.streamId && !lastStreamHandoff?.endedAt),
    watcherVersion: WATCHER_VERSION,
    importRunning: Boolean(currentImportState?.isRunning),
    appPackaged: Boolean(app.isPackaged),
    updateFeedUrl: AUTO_UPDATE_FEED_URL,
    finalityContractVersion: 2,
  };
}

function emitUpdateTelemetry(eventType, payload = {}, config = loadConfig()) {
  emitWatcherTelemetry(
    eventType,
    {
      ...payload,
      metadata: {
        ...(payload.metadata || {}),
        ...buildRuntimeMetadata(config),
        updateState,
      },
    },
    config
  );
}

function setUpdateState(patch = {}, options = {}) {
  updateState = {
    ...updateState,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  sendToRenderer("watcher:update-state", updateState);
  sendToRenderer("watcher:app-info", getAppInfo(loadConfig()));

  if (options.logMessage) {
    appendLog(options.logMessage, options.level || "info");
  }

  if (options.telemetryEvent) {
    emitUpdateTelemetry(options.telemetryEvent, options.telemetryPayload || {});
  }

  return updateState;
}

function configureAutoUpdater() {
  if (updateEventsConfigured) {
    return updateState;
  }

  updateEventsConfigured = true;

  if (!autoUpdater) {
    return setUpdateState({
      supported: false,
      status: "unsupported",
      message: "Auto-updates are unavailable in this build.",
    });
  }

  autoUpdater.autoDownload = !requiresManualUpdateInstall();
  autoUpdater.autoInstallOnAppQuit = !requiresManualUpdateInstall();

  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: AUTO_UPDATE_FEED_URL,
    });
  } catch (error) {
    return setUpdateState(
      {
        supported: false,
        status: "feed_error",
        error: error.message || String(error),
        message: "Update feed could not be configured.",
      },
      {
        logMessage: `Update feed error: ${error.message || error}`,
        level: "warn",
        telemetryEvent: "watcher_update_error",
      }
    );
  }

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      supported: true,
      status: "checking",
      message: "Checking for watcher updates...",
      checkedAt: new Date().toISOString(),
      error: null,
    });
  });

  autoUpdater.on("update-available", (info = {}) => {
    if (requiresManualUpdateInstall()) {
      setManualUpdateState("mac_manual_unsigned", null, info);
      return;
    }

    setUpdateState(
      {
        supported: true,
        status: "available",
        message: `Watcher update ${info.version || ""} is available.`.trim(),
        updateVersion: info.version || null,
        downloaded: false,
        manualInstall: false,
        manualReason: null,
        manualDownloadUrl: null,
        downloadPercent: 0,
        error: null,
      },
      {
        logMessage: `Watcher update ${info.version || ""} available. Downloading in the background...`.trim(),
        telemetryEvent: "watcher_update_available",
        telemetryPayload: { metadata: { updateInfo: info } },
      }
    );
  });

  autoUpdater.on("update-not-available", (info = {}) => {
    setUpdateState(
      {
        supported: true,
        status: "current",
        message: "Watcher is up to date.",
        updateVersion: info.version || null,
        downloaded: false,
        manualInstall: false,
        manualReason: null,
        manualDownloadUrl: null,
        downloadPercent: 0,
        error: null,
      },
      {
        telemetryEvent: "watcher_update_not_available",
        telemetryPayload: { metadata: { updateInfo: info } },
      }
    );
  });

  autoUpdater.on("download-progress", (progress = {}) => {
    const percent = Number(progress.percent || 0);
    setUpdateState({
      supported: true,
      status: "downloading",
      message: `Downloading watcher update (${Math.round(percent)}%).`,
      downloadPercent: percent,
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info = {}) => {
    if (requiresManualUpdateInstall()) {
      setManualUpdateState("mac_manual_unsigned", null, info);
      return;
    }

    const busy = isWatcherUpdateBusy();
    setUpdateState(
      {
        supported: true,
        status: busy ? "pending_install" : "downloaded",
        message: busy
          ? "Watcher update downloaded. It will install after watching or uploads stop."
          : "Watcher update downloaded. Installing now.",
        updateVersion: info.version || null,
        downloaded: true,
        manualInstall: false,
        manualReason: null,
        manualDownloadUrl: null,
        downloadPercent: 100,
        error: null,
      },
      {
        logMessage: busy
          ? "Watcher update downloaded. It will install after uploads/watching stop."
          : "Watcher update downloaded. Installing now.",
        telemetryEvent: "watcher_update_downloaded",
        telemetryPayload: { metadata: { updateInfo: info } },
      }
    );

    if (!busy) {
      setTimeout(() => {
        void installDownloadedWatcherUpdate(loadConfig(), {
          automatic: true,
          reason: "downloaded_idle",
        });
      }, 700);
    }
  });

  autoUpdater.on("error", (error) => {
    if (isMacSignatureValidationError(error)) {
      setManualUpdateState("mac_signature_validation", error);
      return;
    }

    setUpdateState(
      {
        supported: true,
        status: "error",
        message: "Watcher update check failed.",
        error: error?.message || String(error),
      },
      {
        logMessage: `Watcher update error: ${error?.message || error}`,
        level: "warn",
        telemetryEvent: "watcher_update_error",
      }
    );
  });

  return updateState;
}

async function checkForWatcherUpdates({ manual = false, config = loadConfig() } = {}) {
  configureAutoUpdater();

  if (!autoUpdater) {
    return setUpdateState({
      supported: false,
      status: "unsupported",
      message: "Auto-updates are unavailable in this build.",
    });
  }

  if (!app.isPackaged && process.env.AOE2_UPDATE_CHECK_IN_DEV !== "1") {
    return setUpdateState(
      {
        supported: true,
        status: "dev_skipped",
        message: "Update checks are skipped while running from source.",
        checkedAt: new Date().toISOString(),
      },
      {
        telemetryEvent: "watcher_update_not_available",
        telemetryPayload: {
          metadata: {
            manual,
            reason: "development_mode",
          },
        },
      }
    );
  }

  if (updateCheckInFlight) {
    return updateState;
  }

  updateCheckInFlight = true;

  setUpdateState(
    {
      supported: true,
      status: "checking",
      message: manual ? "Manual update check started." : "Checking for watcher updates...",
      checkedAt: new Date().toISOString(),
      error: null,
    },
    {
      logMessage: manual ? "Checking for watcher updates..." : null,
      telemetryEvent: "watcher_update_check_started",
      telemetryPayload: {
        metadata: {
          manual,
        },
      },
    }
  );

  if (requiresManualUpdateInstall()) {
    try {
      const latestRelease = await refreshWatcherRelease(config);
      if (latestRelease.updateAvailable) {
        setManualUpdateState("mac_manual_unsigned", null, {
          version: latestRelease.latestVersion,
          releaseName: latestRelease.label,
          updateUrl: latestRelease.updateUrl,
        });
        return updateState;
      }

      return setUpdateState(
        {
          supported: true,
          status: "current",
          message: "Watcher is up to date.",
          updateVersion: latestRelease.latestVersion,
          downloaded: false,
          manualInstall: false,
          manualReason: null,
          manualDownloadUrl: null,
          downloadPercent: 0,
          error: null,
        },
        {
          telemetryEvent: "watcher_update_not_available",
          telemetryPayload: {
            metadata: {
              manual,
              source: "release_api",
            },
          },
        }
      );
    } catch (error) {
      return setUpdateState(
        {
          supported: true,
          status: "error",
          message: "Watcher update check failed.",
          error: error?.message || String(error),
        },
        {
          logMessage: `Watcher update check failed: ${error?.message || error}`,
          level: "warn",
          telemetryEvent: "watcher_update_error",
          telemetryPayload: {
            metadata: {
              manual,
              source: "release_api",
            },
          },
        }
      );
    } finally {
      updateCheckInFlight = false;
    }
  }

  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return setUpdateState(
      {
        supported: true,
        status: "error",
        message: "Watcher update check failed.",
        error: error?.message || String(error),
      },
      {
        logMessage: `Watcher update check failed: ${error?.message || error}`,
        level: "warn",
        telemetryEvent: "watcher_update_error",
        telemetryPayload: {
          metadata: {
            manual,
          },
        },
      }
    );
  } finally {
    updateCheckInFlight = false;
  }
}

async function installDownloadedWatcherUpdate(config = loadConfig(), options = {}) {
  configureAutoUpdater();

  if (updateState.manualInstall || updateState.status === "manual_required") {
    return {
      ok: false,
      manualRequired: true,
      updateUrl: getManualUpdateUrl(),
      update: updateState,
    };
  }

  if (!autoUpdater || !updateState.downloaded) {
    return {
      ok: false,
      error: "No downloaded watcher update is ready to install.",
      update: updateState,
    };
  }

  emitUpdateTelemetry("watcher_update_install_requested", {
    metadata: {
      isWatching: Boolean(watcherHandle),
      importRunning: Boolean(currentImportState?.isRunning),
    },
  }, config);

  if (isWatcherUpdateBusy()) {
    autoUpdater.autoInstallOnAppQuit = true;
    setUpdateState(
      {
        status: "pending_install",
        message: "Update ready. It will install after uploads/watching stop.",
      },
      {
        logMessage: "Update is ready. It will install after uploads/watching stop.",
        level: "warn",
      }
    );
    return {
      ok: true,
      deferred: true,
      update: updateState,
    };
  }

  setUpdateState(
    {
      status: "installing",
      message: "Installing watcher update now.",
    },
    {
      logMessage: "Installing watcher update now...",
      telemetryEvent: "watcher_update_install_started",
      telemetryPayload: {
        metadata: {
          automatic: Boolean(options.automatic),
          reason: options.reason || null,
        },
      },
    }
  );
  autoUpdater.quitAndInstall(false, true);

  return {
    ok: true,
    installing: true,
    update: updateState,
  };
}

function maybeInstallPendingWatcherUpdate(reason) {
  if (updateState.status !== "pending_install" || !updateState.downloaded || isWatcherUpdateBusy()) {
    return;
  }

  void installDownloadedWatcherUpdate(loadConfig(), {
    automatic: true,
    reason,
  });
}


function getConfigPath() {
  return path.join(app.getPath("userData"), "watcher-config.json");
}

function createRandomId(prefix) {
  const value =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${value.replace(/-/g, "")}`;
}

function ensureWatcherId(config) {
  const watcherId = String(config?.watcherId || "").trim();
  return {
    ...config,
    watcherId: watcherId || process.env.AOE2_WATCHER_ID || createRandomId("watcher"),
  };
}

function getDefaultConfig() {
  return {
    watchDir: process.env.AOE2_WATCH_DIR || getDefaultReplayDir() || "",
    apiBaseUrl: process.env.AOE2_API_BASE_URL || "https://api-prodn.aoe2war.com",
    apiFallbackBaseUrl: process.env.AOE2_API_FALLBACK_BASE_URL || "https://aoe2war.com",
    telemetryBaseUrl:
      process.env.AOE2_TELEMETRY_BASE_URL ||
      process.env.AOE2_API_FALLBACK_BASE_URL ||
      "https://aoe2war.com",
    uploadApiKey: process.env.AOE2_UPLOAD_API_KEY || "",
    watcherId: process.env.AOE2_WATCHER_ID || "",
    launchAtLogin: true,
    autoStartWatching: true,
    lastImportSummary: null,
  };
}

function migrateLegacyUrl(value) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = normalizeBaseUrl(value);
  return LEGACY_DOMAIN_MIGRATIONS.reduce(
    (current, [from, to]) => current.replaceAll(from, to),
    normalized
  );
}

function migrateLegacyConfig(config) {
  const migrated = { ...config };

  for (const key of URL_CONFIG_KEYS) {
    migrated[key] = migrateLegacyUrl(migrated[key]);
  }

  return migrated;
}

function loadConfig() {
  const configPath = getConfigPath();
  const defaults = getDefaultConfig();

  try {
    if (!fs.existsSync(configPath)) {
      return ensureWatcherId(defaults);
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const merged = ensureWatcherId(migrateLegacyConfig({
      ...defaults,
      ...parsed,
    }));

    if (JSON.stringify(parsed) !== JSON.stringify({ ...parsed, ...migrateLegacyConfig(parsed) })) {
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");
    }

    return merged;
  } catch (error) {
    console.error("Failed to load watcher config:", error);
    return ensureWatcherId(defaults);
  }
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const merged = ensureWatcherId({
    ...getDefaultConfig(),
    ...loadConfig(),
    ...migrateLegacyConfig(config),
  });

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");

  return merged;
}

function applyLaunchAtLogin(config = loadConfig()) {
  const requested = config.launchAtLogin !== false;

  if (!["darwin", "win32"].includes(process.platform)) {
    return {
      supported: false,
      requested,
      openAtLogin: false,
      reason: "unsupported_platform",
    };
  }

  if (!app.isPackaged) {
    return {
      supported: true,
      requested,
      openAtLogin: false,
      reason: "development_build",
    };
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: requested,
    });

    const current = app.getLoginItemSettings();

    return {
      supported: true,
      requested,
      openAtLogin: Boolean(current.openAtLogin),
      reason: null,
    };
  } catch (error) {
    console.warn(
      "Failed applying launch-at-login setting:",
      error?.message || error
    );

    return {
      supported: true,
      requested,
      openAtLogin: false,
      reason: error?.message || String(error),
    };
  }
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function getTelemetryBaseUrl(config) {
  return normalizeBaseUrl(
    config.telemetryBaseUrl ||
      config.apiFallbackBaseUrl ||
      process.env.AOE2_TELEMETRY_BASE_URL ||
      "https://aoe2war.com"
  );
}

function createReleaseState(overrides = {}) {
  return {
    phase: "idle",
    currentVersion: null,
    latestVersion: null,
    updateAvailable: false,
    isLatest: false,
    label: "",
    updateUrl: "",
    updateLabel: "",
    releaseUrl: `${DEFAULT_RELEASE_BASE_URL}${DOWNLOAD_PAGE_PATH}`,
    checkedAt: null,
    error: null,
    ...overrides,
  };
}

function parseVersionParts(value) {
  const version = String(value || "").trim().replace(/^v/i, "");
  return version
    .split(".")
    .map((part) => Number.parseInt(part.replace(/\D.*$/, ""), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) {
      return 1;
    }

    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function toAbsoluteUrl(baseUrl, value) {
  try {
    return new URL(String(value || DOWNLOAD_PAGE_PATH), baseUrl).toString();
  } catch {
    return `${DEFAULT_RELEASE_BASE_URL}${DOWNLOAD_PAGE_PATH}`;
  }
}

function getReleaseBaseUrlCandidates(config) {
  return [
    process.env.AOE2_WATCHER_RELEASE_BASE_URL,
    config?.telemetryBaseUrl,
    config?.apiFallbackBaseUrl,
    DEFAULT_RELEASE_BASE_URL,
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function getPreferredReleaseArtifactKey(platform = process.platform) {
  if (platform === "win32") {
    return "windows-installer";
  }

  if (platform === "darwin") {
    return "mac-dmg";
  }

  if (platform === "linux") {
    return "linux-appimage";
  }

  return null;
}

function pickReleaseArtifact(payload) {
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const preferredKey = getPreferredReleaseArtifactKey();
  return (
    artifacts.find((artifact) => artifact?.key === preferredKey) ||
    artifacts.find((artifact) => artifact?.primary) ||
    artifacts[0] ||
    null
  );
}

function buildReleaseStateFromPayload(payload, baseUrl) {
  const currentVersion = WATCHER_VERSION;
  const latestVersion = String(payload?.version || "").trim();
  const artifact = pickReleaseArtifact(payload);
  const comparison = latestVersion ? compareVersions(currentVersion, latestVersion) : 0;
  const updateAvailable = Boolean(latestVersion && comparison < 0);
  const isLatest = Boolean(latestVersion && comparison >= 0);
  const releaseUrl = toAbsoluteUrl(baseUrl, payload?.releaseUrl || DOWNLOAD_PAGE_PATH);
  const updateHref = artifact?.trackedHref || artifact?.downloadPath || payload?.downloadPath || DOWNLOAD_PAGE_PATH;

  return createReleaseState({
    phase: updateAvailable ? "available" : isLatest ? "current" : "unknown",
    currentVersion,
    latestVersion: latestVersion || null,
    updateAvailable,
    isLatest,
    label: payload?.label || (latestVersion ? `${APP_NAME} ${latestVersion}` : ""),
    updateUrl: toAbsoluteUrl(baseUrl, updateHref),
    updateLabel: artifact?.title || "Download Update",
    releaseUrl,
    checkedAt: new Date().toISOString(),
    error: null,
  });
}

async function fetchWatcherRelease(config = loadConfig()) {
  const baseUrls = getReleaseBaseUrlCandidates(config);
  let lastError = null;

  for (const baseUrl of baseUrls) {
    try {
      const response = await axios.get(`${baseUrl}${RELEASE_ENDPOINT_PATH}`, {
        timeout: RELEASE_CHECK_TIMEOUT_MS,
        headers: {
          accept: "application/json",
        },
      });

      if (response?.data?.version) {
        return {
          baseUrl,
          payload: response.data,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Latest watcher release could not be reached.");
}

async function refreshWatcherRelease(config = loadConfig()) {
  releaseState = createReleaseState({
    ...releaseState,
    phase: "checking",
    currentVersion: WATCHER_VERSION,
    error: null,
  });
  sendToRenderer("watcher:app-info", getAppInfo(config));

  try {
    const { baseUrl, payload } = await fetchWatcherRelease(config);
    releaseState = buildReleaseStateFromPayload(payload, baseUrl);
  } catch (error) {
    releaseState = createReleaseState({
      ...releaseState,
      phase: "error",
      currentVersion: WATCHER_VERSION,
      checkedAt: new Date().toISOString(),
      error: error?.response?.status
        ? `Release check failed with HTTP ${error.response.status}.`
        : error?.message || "Release check failed.",
    });
  }

  sendToRenderer("watcher:app-info", getAppInfo(config));
  return releaseState;
}

function buildTelemetryPayload(eventType, payload = {}, config = loadConfig()) {
  const replayFile = payload.fileName || (payload.filePath ? path.basename(payload.filePath) : null);
  const metadata = {
    ...payload.metadata,
    runtimeEventType: payload.runtimeEventType || payload.type || null,
    isFinal: typeof payload.isFinal === "boolean" ? payload.isFinal : undefined,
    parseIteration: Number.isFinite(payload.parseIteration) ? payload.parseIteration : undefined,
    attempt: Number.isFinite(payload.attempt) ? payload.attempt : undefined,
    maxRetryCount: Number.isFinite(payload.maxRetryCount) ? payload.maxRetryCount : undefined,
    resultType: payload.resultType || undefined,
    reason: payload.reason || undefined,
    detail: payload.detail ? String(payload.detail).slice(0, 500) : undefined,
    responseStatus: payload.responseStatus || undefined,
    uploadHost: payload.uploadHost || undefined,
    fileSizeBytes: Number.isFinite(payload.fileSizeBytes) ? payload.fileSizeBytes : undefined,
    previousFileSizeBytes: Number.isFinite(payload.previousFileSizeBytes)
      ? payload.previousFileSizeBytes
      : undefined,
    minReplayBytes: Number.isFinite(payload.minReplayBytes) ? payload.minReplayBytes : undefined,
    mtimeMs: Number.isFinite(payload.mtimeMs) ? payload.mtimeMs : undefined,
    waitedMs: Number.isFinite(payload.waitedMs) ? payload.waitedMs : undefined,
    waitMs: Number.isFinite(payload.waitMs) ? payload.waitMs : undefined,
    remainingTimeoutMs: Number.isFinite(payload.remainingTimeoutMs)
      ? payload.remainingTimeoutMs
      : undefined,
    observedForMs: Number.isFinite(payload.observedForMs) ? payload.observedForMs : undefined,
    requiredMs: Number.isFinite(payload.requiredMs) ? payload.requiredMs : undefined,
    sampleCount: Number.isFinite(payload.sampleCount) ? payload.sampleCount : undefined,
    retryInMs: Number.isFinite(payload.retryInMs) ? payload.retryInMs : undefined,
    nextRetryAttempt: Number.isFinite(payload.nextRetryAttempt)
      ? payload.nextRetryAttempt
      : undefined,
    reachedMinimum:
      typeof payload.reachedMinimum === "boolean" ? payload.reachedMinimum : undefined,
    finalityStatus: payload.finalityStatus || undefined,
    shouldSettle: typeof payload.shouldSettle === "boolean" ? payload.shouldSettle : undefined,
    pendingParse: typeof payload.pendingParse === "boolean" ? payload.pendingParse : undefined,
    unparsedFinal:
      typeof payload.unparsedFinal === "boolean" ? payload.unparsedFinal : undefined,
    archived: typeof payload.archived === "boolean" ? payload.archived : undefined,
    parseCompleted:
      typeof payload.parseCompleted === "boolean" ? payload.parseCompleted : undefined,
    parsed: typeof payload.parsed === "boolean" ? payload.parsed : undefined,
    resultReady: typeof payload.resultReady === "boolean" ? payload.resultReady : undefined,
    reviewRouted:
      typeof payload.reviewRouted === "boolean" ? payload.reviewRouted : undefined,
    finalAccepted:
      typeof payload.finalAccepted === "boolean" ? payload.finalAccepted : undefined,
    finalStored:
      typeof payload.finalStored === "boolean" ? payload.finalStored : undefined,
    settleWindowMs:
      Number.isFinite(payload.settleWindowMs) ? payload.settleWindowMs : undefined,
    fingerprint: payload.fingerprint || undefined,
    previousFinalFingerprint: payload.previousFinalFingerprint || undefined,
    unknownFields: Array.isArray(payload.unknownFields) ? payload.unknownFields : undefined,
    found: Number.isFinite(payload.found) ? payload.found : undefined,
    queued: Number.isFinite(payload.queued) ? payload.queued : undefined,
    totalFiles: Number.isFinite(payload.totalFiles) ? payload.totalFiles : undefined,
    unsupportedCount: Number.isFinite(payload.unsupportedCount)
      ? payload.unsupportedCount
      : undefined,
    uploadedCount: Number.isFinite(payload.uploadedCount) ? payload.uploadedCount : undefined,
    archivedCount: Number.isFinite(payload.archivedCount) ? payload.archivedCount : undefined,
    parsedCount: Number.isFinite(payload.parsedCount) ? payload.parsedCount : undefined,
    resultReadyCount: Number.isFinite(payload.resultReadyCount)
      ? payload.resultReadyCount
      : undefined,
    reviewRoutedCount: Number.isFinite(payload.reviewRoutedCount)
      ? payload.reviewRoutedCount
      : undefined,
    skippedCount: Number.isFinite(payload.skippedCount) ? payload.skippedCount : undefined,
    failedCount: Number.isFinite(payload.failedCount) ? payload.failedCount : undefined,
    currentIndex: Number.isFinite(payload.currentIndex) ? payload.currentIndex : undefined,
    percent: Number.isFinite(payload.percent) ? payload.percent : undefined,
    phase: payload.phase || undefined,
    source: payload.source || undefined,
    summaryText: payload.summaryText || undefined,
    errorMessage: payload.errorMessage ? String(payload.errorMessage).slice(0, 300) : undefined,
    folderKind: payload.folderKind || undefined,
    folderLabel: payload.folderLabel || undefined,
    watchDirBasename: payload.watchDir
      ? path.basename(String(payload.watchDir))
      : payload.scanPath
        ? path.basename(String(payload.scanPath))
        : undefined,
    maxScanDepth: Number.isFinite(payload.maxScanDepth) ? payload.maxScanDepth : undefined,
    entriesSeen: Number.isFinite(payload.entriesSeen) ? payload.entriesSeen : undefined,
    fileEntriesSeen: Number.isFinite(payload.fileEntriesSeen) ? payload.fileEntriesSeen : undefined,
    folderEntriesSeen: Number.isFinite(payload.folderEntriesSeen)
      ? payload.folderEntriesSeen
      : undefined,
    supportedCount: Number.isFinite(payload.supportedCount) ? payload.supportedCount : undefined,
    skippedAtScanCount: Number.isFinite(payload.skippedAtScanCount)
      ? payload.skippedAtScanCount
      : undefined,
    sampleEntries: Array.isArray(payload.sampleEntries)
      ? payload.sampleEntries.slice(0, 20).map((entry) => ({
          name: String(entry?.name || "").slice(0, 160),
          kind: String(entry?.kind || "").slice(0, 20),
          depth: Number.isFinite(entry?.depth) ? entry.depth : null,
          relativePath: String(entry?.relativePath || "").slice(0, 260),
        }))
      : undefined,
    ...buildRuntimeMetadata(config),
  };

  return {
    event_type: eventType,
    app_version: WATCHER_VERSION,
    platform: process.platform,
    artifact: app.isPackaged ? "electron-packaged" : "electron-dev",
    watcher_id: config.watcherId,
    session_id: APP_SESSION_ID,
    replay_hash: payload.replayHash || null,
    replay_file: replayFile || null,
    parse_source: payload.parseSource || null,
    parse_reason: payload.parseReason || null,
    metadata,
  };
}

function normalizeRuntimeEventType(type) {
  if (typeof type !== "string" || !type.trim()) {
    return null;
  }

  return type
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 40);
}

function isRetryableTelemetryError(
  error
) {
  const status =
    error?.response?.status;

  if (!error?.response) {
    return true;
  }

  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function getDurableTelemetryQueue() {
  if (!app.isReady()) {
    return null;
  }

  if (!durableTelemetryQueue) {
    durableTelemetryQueue =
      createDurableTelemetryQueue({
        filePath: path.join(
          app.getPath("userData"),
          "watcher-telemetry-queue.json"
        ),
        maxEntries:
          TELEMETRY_QUEUE_MAX_ENTRIES,
        maxAgeMs:
          TELEMETRY_QUEUE_MAX_AGE_MS,
      });
  }

  return durableTelemetryQueue;
}

async function flushWatcherTelemetryQueue(
  config = loadConfig()
) {
  const queue =
    getDurableTelemetryQueue();

  const baseUrl =
    getTelemetryBaseUrl(config);

  if (!queue || !baseUrl) {
    return null;
  }

  const result =
    await queue.flush(
      async (entry) => {
        try {
          await axios.post(
            `${baseUrl}/api/watcher/events`,
            entry.payload,
            {
              timeout:
                TELEMETRY_TIMEOUT_MS,
              headers: {
                "content-type":
                  "application/json",
                ...(config.uploadApiKey
                  ? {
                      "x-api-key":
                        config.uploadApiKey,
                    }
                  : {}),
              },
            }
          );

          return {
            ok: true,
          };
        } catch (error) {
          return {
            ok: false,
            retryable:
              isRetryableTelemetryError(
                error
              ),
          };
        }
      },
      {
        limit: 100,
      }
    );

  if (
    result.delivered > 0 ||
    result.dropped > 0
  ) {
    console.log(
      `Watcher telemetry queue flush: delivered=${result.delivered} dropped=${result.dropped} remaining=${result.remaining}`
    );
  }

  return result;
}

async function postWatcherTelemetry(
  eventType,
  payload = {},
  {
    wait = false,
    config = loadConfig(),
  } = {}
) {
  const baseUrl =
    getTelemetryBaseUrl(config);

  if (!baseUrl) {
    return null;
  }

  const telemetryEventId =
    createRandomId("telemetry");

  const telemetryPayload =
    buildTelemetryPayload(
      eventType,
      {
        ...payload,
        metadata: {
          ...(payload.metadata || {}),
          telemetryEventId,
        },
      },
      config
    );

  const request = axios
    .post(
      `${baseUrl}/api/watcher/events`,
      telemetryPayload,
      {
        timeout:
          TELEMETRY_TIMEOUT_MS,
        headers: {
          "content-type":
            "application/json",
          ...(config.uploadApiKey
            ? {
                "x-api-key":
                  config.uploadApiKey,
              }
            : {}),
        },
      }
    )
    .then(
      (response) =>
        response.data
    )
    .catch(async (error) => {
      const detail =
        error?.response?.status
          ? `${error.response.status} ${
              error.response.statusText ||
              ""
            }`.trim()
          : error.message ||
            "network error";

      const retryable =
        isRetryableTelemetryError(
          error
        );

      if (retryable) {
        const queue =
          getDurableTelemetryQueue();

        if (queue) {
          const queued =
            await queue.enqueue({
              id: telemetryEventId,
              eventType,
              payload:
                telemetryPayload,
              queuedAtMs:
                Date.now(),
            });

          console.warn(
            `Watcher telemetry ${eventType} failed: ${detail}; queued for retry (${queued} pending).`
          );

          return null;
        }
      }

      console.warn(
        `Watcher telemetry ${eventType} failed: ${detail}${
          retryable
            ? ""
            : "; non-retryable response, not queued"
        }`
      );

      return null;
    });

  if (wait) {
    return request;
  }

  void request;

  return null;
}

function emitWatcherTelemetry(eventType, payload = {}, config = loadConfig()) {
  void postWatcherTelemetry(eventType, payload, { config });
}

async function verifyWatcherAuth(config = loadConfig()) {
  if (!config.uploadApiKey) {
    return;
  }

  const authStarted = await postWatcherTelemetry(
    "auth_started",
    { metadata: { authCheck: "watcher_key" } },
    { wait: true, config }
  );

  if (authStarted?.linked) {
    emitWatcherTelemetry("auth_success", { metadata: { authCheck: "watcher_key" } }, config);
    return;
  }

  emitWatcherTelemetry("auth_failed", { metadata: { authCheck: "watcher_key" } }, config);
}

function startTelemetryHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (!Number.isFinite(TELEMETRY_HEARTBEAT_MS) || TELEMETRY_HEARTBEAT_MS <= 0) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    const config = loadConfig();

    emitWatcherTelemetry("heartbeat", {
      metadata:
        buildRuntimeMetadata(config),
    });

    void flushWatcherTelemetryQueue(
      config
    );
  }, TELEMETRY_HEARTBEAT_MS);
}

function stopTelemetryHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function stopMonitorWatchdog() {
  if (monitorWatchdogTimer) clearInterval(monitorWatchdogTimer);
  monitorWatchdogTimer = null;
}

function safelyReattachMonitor(reason) {
  const config = loadConfig();
  const folder = inspectReplayFolder(config.watchDir);
  if (!config.autoStartWatching || !config.uploadApiKey || !folder.valid) return false;
  const now = Date.now();
  if (monitorReattachAttempts >= MONITOR_REATTACH_LIMIT || now - monitorLastReattachAt < MONITOR_REATTACH_COOLDOWN_MS) {
    emitWatcherTelemetry("monitor_watchdog_blocked", {
      reason,
      metadata: { attempts: monitorReattachAttempts, ...buildRuntimeMetadata(config) },
    }, config);
    return false;
  }
  monitorReattachAttempts += 1;
  monitorLastReattachAt = now;
  emitWatcherTelemetry("monitor_watchdog_reattach", {
    reason,
    metadata: { attempt: monitorReattachAttempts, ...buildRuntimeMetadata(config) },
  }, config);
  return startCurrentWatcher(config, {
    preserveLog: true,
    startMessage: `Monitor watchdog is reattaching after ${reason}.`,
  });
}

function startMonitorWatchdog() {
  stopMonitorWatchdog();

  monitorWatchdogTimer = setInterval(() => {
    const runtime = getRuntimeStatus();

    // Normal operation is event-driven. When the Chokidar monitor is
    // healthy there is no reason to touch the replay directory merely
    // to prove that the already-attached watcher still exists.
    if (watcherHandle && runtime.monitorAttached) {
      monitorReattachAttempts = 0;
      return;
    }

    const config = loadConfig();

    if (!config.autoStartWatching) {
      return;
    }

    const folder = inspectReplayFolder(config.watchDir);

    if (!folder.valid) {
      emitWatcherTelemetry(
        "monitor_watchdog_folder_unavailable",
        {
          folderKind: folder.kind,
          folderLabel: folder.label,
          reason: folder.error || "folder_invalid",
        },
        config
      );
      return;
    }

    safelyReattachMonitor("monitor_handle_absent");
  }, MONITOR_WATCHDOG_MS);
}

function createImportStateFromSummary(summary = null) {
  const base = {
    isRunning: false,
    source: "scan",
    phase: "idle",
    startedAt: null,
    completedAt: null,
    percent: 0,
    found: 0,
    queued: 0,
    skipped: 0,
    uploaded: 0,
    archived: 0,
    parsed: 0,
    resultReady: 0,
    reviewRouted: 0,
    failed: 0,
    unsupported: 0,
    currentFile: "",
    currentIndex: 0,
    failedItems: [],
    skippedItems: [],
    recentItems: [],
    summaryText: "",
  };

  if (!summary) {
    return base;
  }

  return {
    ...base,
    ...summary,
    isRunning: false,
    currentFile: "",
    phase:
      summary.phase ||
      (summary.failed > 0 ? "complete_with_failures" : summary.completedAt ? "complete" : "idle"),
  };
}

function summarizeImportState(state) {
  if (!state) {
    return null;
  }

  return {
    source: state.source || "scan",
    phase: state.phase || "idle",
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    percent: Number.isFinite(state.percent) ? state.percent : 0,
    found: state.found || 0,
    queued: state.queued || 0,
    skipped: state.skipped || 0,
    uploaded: state.uploaded || 0,
    archived: state.archived || 0,
    parsed: state.parsed || 0,
    resultReady: state.resultReady || 0,
    reviewRouted: state.reviewRouted || 0,
    failed: state.failed || 0,
    unsupported: state.unsupported || 0,
    failedItems: Array.isArray(state.failedItems) ? state.failedItems : [],
    skippedItems: Array.isArray(state.skippedItems) ? state.skippedItems : [],
    recentItems: Array.isArray(state.recentItems) ? state.recentItems : [],
    summaryText: state.summaryText || "",
  };
}

function setImportState(nextState, { persist = false } = {}) {
  currentImportState = createImportStateFromSummary(nextState);
  currentImportState.isRunning = Boolean(nextState?.isRunning);
  currentImportState.currentFile = nextState?.currentFile || "";
  currentImportState.currentIndex = nextState?.currentIndex || 0;

  if (persist) {
    saveConfig({
      lastImportSummary: summarizeImportState(currentImportState),
    });
  }

  sendToRenderer("watcher:import-state", currentImportState);
}

function getWatchDirStatus(targetPath) {
  return inspectReplayFolder(targetPath);
}

function getAppInfo(config = loadConfig()) {
  return {
    version: WATCHER_VERSION,
    productName: APP_NAME,
    platform: process.platform,
    isPackaged: app.isPackaged,
    watcherId: config.watcherId || null,
    sessionId: APP_SESSION_ID,
    finalityContractVersion: 2,
    configPath: getConfigPath(),
    protocolScheme: WATCHER_PAIR_PROTOCOL,
    protocolRegistered: app.isDefaultProtocolClient(WATCHER_PAIR_PROTOCOL),
    supportedReplayExtensions: getSupportedReplayExtensions(),
    watchDirStatus: getWatchDirStatus(config.watchDir),
    release: releaseState,
    update: updateState,
    autoUpdate: updateState,
  };
}

function getWindowIconPath() {
  const buildDir = path.join(__dirname, "build");
  const windowsIconPath = path.join(buildDir, "icon.ico");
  const pngIconPath = path.join(buildDir, "aoe2hd-watcher-logo.png");

  if (process.platform === "win32" && fs.existsSync(windowsIconPath)) {
    return windowsIconPath;
  }

  if (fs.existsSync(pngIconPath)) {
    return pngIconPath;
  }

  return undefined;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function broadcastConfig(config) {
  const savedConfig = config || loadConfig();
  sendToRenderer("watcher:config", savedConfig);
  sendToRenderer("watcher:app-info", getAppInfo(savedConfig));
}

function setWatchingState(isWatching) {
  sendToRenderer("watcher:state", { isWatching });
}

function getStreamWebBaseUrl(config = loadConfig()) {
  return config.apiFallbackBaseUrl || DEFAULT_RELEASE_BASE_URL;
}

function getSafeStreamApiPath(value) {
  const apiPath = String(value || "").trim();
  if (!apiPath.startsWith("/api/streams/")) {
    throw new Error("Invalid stream API path.");
  }
  return apiPath;
}

function streamRequestHeaders(config, headers = {}) {
  return {
    ...headers,
    ...(config.uploadApiKey ? { "x-api-key": config.uploadApiKey } : {}),
  };
}

function formatAxiosError(error) {
  const responseDetail = error?.response?.data?.detail || error?.response?.data?.message;
  if (error?.response?.status) {
    return `${error.response.status} ${responseDetail || error.response.statusText || "request failed"}`.trim();
  }
  return error?.message || String(error || "request failed");
}

async function postStreamJson(payload = {}) {
  const config = loadConfig();
  const apiPath = getSafeStreamApiPath(payload.path);
  const method = String(payload.method || "POST").toUpperCase();
  const baseUrl = normalizeBaseUrl(payload.baseUrl || getStreamWebBaseUrl(config));

  if (!baseUrl) {
    throw new Error("Streaming API host is missing.");
  }

  const response = await axios({
    method,
    url: `${baseUrl}${apiPath}`,
    timeout: TELEMETRY_TIMEOUT_MS,
    data: payload.body || {},
    headers: streamRequestHeaders(config, {
      "content-type": "application/json",
      accept: "application/json",
    }),
  });

  return {
    ok: true,
    status: response.status,
    data: response.data,
  };
}

async function postStreamChunk(payload = {}) {
  const config = loadConfig();
  const streamId = Number(payload.streamId);
  const sequence = Number(payload.sequence);
  if (!Number.isInteger(streamId) || streamId <= 0 || !Number.isInteger(sequence) || sequence < 0) {
    throw new Error("Invalid stream chunk.");
  }

  const bytes = payload.bytes;
  if (!bytes) {
    throw new Error("Empty stream chunk.");
  }

  const buffer = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  if (buffer.length <= 0) {
    return { ok: true, skipped: true };
  }

  const baseUrl = normalizeBaseUrl(payload.baseUrl || getStreamWebBaseUrl(config));
  const response = await axios.post(
    `${baseUrl}/api/streams/${streamId}/chunks?sequence=${sequence}`,
    buffer,
    {
      timeout: 20000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      headers: streamRequestHeaders(config, {
        "content-type": payload.mimeType || "video/webm",
        "x-stream-sequence": String(sequence),
        accept: "application/json",
      }),
    }
  );

  return {
    ok: true,
    status: response.status,
    data: response.data,
  };
}

function isBrowserOrAoE2WarCaptureName(value) {
  const name = String(value || "").toLowerCase();

  return (
    name.includes("aoe2hdbets") ||
    name.includes("aoe2war") ||
    name.includes("microsoft edge") ||
    name.includes("google chrome") ||
    name.includes("firefox") ||
    name.includes("brave") ||
    name.includes("opera") ||
    name.includes("safari")
  );
}

function isLikelyAoE2GameCaptureName(value) {
  const name = String(value || "").toLowerCase();

  if (isBrowserOrAoE2WarCaptureName(name)) {
    return false;
  }

  return (
    /age of empires\s*(ii|2)/i.test(name) ||
    name.includes("age2hd") ||
    name.includes("aok hd") ||
    name.includes("aok hd.exe") ||
    name.includes("age of kings") ||
    /\baoe2(?:\s*hd)?\b/i.test(name)
  );
}

function captureSourceScore(source) {
  const name = String(source?.name || "").toLowerCase();
  const id = String(source?.id || "").toLowerCase();

  let score = id.startsWith("window:") ? 30 : 8;

  if (isBrowserOrAoE2WarCaptureName(name)) {
    score -= 500;
  }

  if (isLikelyAoE2GameCaptureName(name)) {
    score += 250;
  }

  if (name.includes("crossover")) score += 35;
  if (name.includes("steam")) score += 20;
  if (name.includes("wine")) score += 20;
  if (name.includes("screen") || name.includes("display")) score += 12;

  return score;
}

async function listDesktopCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });

  return sources
    .map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id || null,
      kind: String(source.id || "").startsWith("screen:") ? "screen" : "window",
      score: captureSourceScore(source),
      thumbnailUrl: null,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name)
    );
}

function publishStreamHandoff(handoff) {
  sendToRenderer("watcher:stream-handoff", handoff);
}

function clearStreamHandoffState() {
  lastStreamHandoff = null;
  publishStreamHandoff(null);
}

function updateStreamHandoffFromRuntimeEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (STREAM_HANDOFF_CLEAR_EVENTS.has(event.type)) {
    clearStreamHandoffState();
    return;
  }

  if (!STREAM_HANDOFF_RUNTIME_EVENTS.has(event.type) || event.isFinal === true) {
    return;
  }

  const config = loadConfig();
  const handoff = buildStreamHandoff(event, {
    webBaseUrl: getStreamWebBaseUrl(config),
  });

  if (!handoff.ok) {
    return;
  }

  lastStreamHandoff = {
    ...handoff,
    eventType: event.type,
    fileName: event.fileName || null,
    filePath: event.filePath || null,
    parseIteration: event.parseIteration || null,
    updatedAt: new Date().toISOString(),
  };
  publishStreamHandoff(lastStreamHandoff);
}

function clearRendererLog() {
  sendToRenderer("watcher:clear-log", {});
}

function appendLog(message, level = "info") {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](line);
  sendToRenderer("watcher:log", { line, level });
}

function appendSessionHeader(title) {
  sendToRenderer("watcher:log", {
    line: `\n──────── ${title} ────────`,
    level: "session",
  });
}

function emitTelemetryForRuntimeEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  const basePayload = {
    ...event,
    runtimeEventType: event.type,
  };

  // Internal recovery diagnostics are useful to the local Watcher UI,
  // but are not part of the current remote telemetry event contract.
  // Keep them local instead of generating HTTP 400 noise.
  if (
    event.type === "initial-replay-scan-complete" ||
    event.type === "midgame-replay-recovered"
  ) {
    return;
  }

  if (event.type === "replay-detected") {
    emitWatcherTelemetry("replay_detected", basePayload);
    return;
  }

  if (event.type === "upload-start") {
    emitWatcherTelemetry("upload_attempted", basePayload);
    return;
  }

  if (event.type === "upload-success") {
    emitWatcherTelemetry("upload_succeeded", basePayload);
    if (event.archived) {
      emitWatcherTelemetry("replay_archived", basePayload);
    }
    emitWatcherTelemetry(event.parseCompleted ? "parse_succeeded" : "parse_pending", basePayload);
    if (event.resultReady) {
      emitWatcherTelemetry("result_ready", basePayload);
    } else if (event.reviewRouted) {
      emitWatcherTelemetry("result_review_routed", basePayload);
    }
    return;
  }

  if (event.type === "upload-failure") {
    emitWatcherTelemetry("upload_failed", basePayload);
    if (event.responseStatus) {
      emitWatcherTelemetry("parse_failed", basePayload);
    }
    return;
  }

  const normalizedType = normalizeRuntimeEventType(event.type);
  if (normalizedType) {
    emitWatcherTelemetry(normalizedType, basePayload);
  }
}

function appendRuntimeEventJournal(
  event
) {
  if (
    !app.isReady() ||
    !event ||
    typeof event !== "object"
  ) {
    return;
  }

  try {
    const journalPath =
      path.join(
        app.getPath("userData"),
        "watcher-runtime-events.jsonl"
      );

    fs.mkdirSync(
      path.dirname(journalPath),
      {
        recursive: true,
      }
    );

    if (
      fs.existsSync(journalPath) &&
      fs.statSync(journalPath).size >
        RUNTIME_EVENT_JOURNAL_MAX_BYTES
    ) {
      const rotated =
        `${journalPath}.1`;

      try {
        fs.rmSync(
          rotated,
          {
            force: true,
          }
        );
      } catch {}

      fs.renameSync(
        journalPath,
        rotated
      );
    }

    fs.appendFileSync(
      journalPath,
      `${JSON.stringify({
        recordedAt:
          new Date().toISOString(),
        appVersion:
          WATCHER_VERSION,
        sessionId:
          APP_SESSION_ID,
        ...event,
      })}\n`,
      "utf8"
    );
  } catch (error) {
    console.warn(
      `Watcher runtime journal failed: ${
        error.message || error
      }`
    );
  }
}

function handleWatcherRuntimeEvent(event) {
  appendRuntimeEventJournal(event);
  updateStreamHandoffFromRuntimeEvent(event);
  sendToRenderer("watcher:runtime-event", event);
  emitTelemetryForRuntimeEvent(event);
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function getPairingUrlFromArgs(argv = []) {
  return argv.find(
    (value) =>
      typeof value === "string" &&
      value.trim().toLowerCase().startsWith(`${WATCHER_PAIR_PROTOCOL}://`)
  );
}

function parsePairingUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== `${WATCHER_PAIR_PROTOCOL}:`) {
      return null;
    }

    const uploadApiKey = (
      parsedUrl.searchParams.get("apiKey") ||
      parsedUrl.searchParams.get("watcherKey") ||
      ""
    ).trim();
    const watchDir = (parsedUrl.searchParams.get("watchDir") || "").trim();

    if (!uploadApiKey) {
      return null;
    }

    return {
      uploadApiKey,
      watchDir,
    };
  } catch {
    return null;
  }
}

function registerPairingProtocol() {
  try {
    if (process.defaultApp) {
      app.setAsDefaultProtocolClient(WATCHER_PAIR_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
      return;
    }

    app.setAsDefaultProtocolClient(WATCHER_PAIR_PROTOCOL);
  } catch (error) {
    console.error("Failed to register Watcher pairing protocol:", error);
  }
}

function getSetupBlocker(config) {
  if (!config.watchDir && !config.uploadApiKey) {
    return "Choose the replay folder and save a watcher key before starting.";
  }

  if (!config.watchDir) {
    return "Choose the replay folder before starting.";
  }

  if (!config.uploadApiKey) {
    return "Open Profile Pairing or paste a watcher key before starting.";
  }

  return null;
}

function stopCurrentWatcher({ quiet = false, allowPendingInstall = true } = {}) {
  if (!quiet) {
    appendLog("Stopping watcher session...");
  }

  watcherHandle = null;
  stopWatching();
  clearStreamHandoffState();
  setWatchingState(false);
  emitWatcherTelemetry("watcher_stopped", {
    metadata: buildRuntimeMetadata(loadConfig()),
  });

  if (!quiet) {
    appendLog("Watcher is now idle.");
  }

  if (allowPendingInstall) {
    maybeInstallPendingWatcherUpdate("watcher_stopped");
  }
}

function startCurrentWatcher(
  config,
  { preserveLog = false, startMessage = "Start Watching clicked." } = {}
) {
  watcherSession += 1;

  stopCurrentWatcher({ quiet: true, allowPendingInstall: false });
  if (!preserveLog) {
    clearRendererLog();
  }
  appendSessionHeader(`Watcher session ${watcherSession}`);
  appendLog(startMessage);
  appendLog(
    `Resolved config: watchDir="${config.watchDir || ""}", apiBaseUrl="${config.apiBaseUrl || ""}", fallback="${config.apiFallbackBaseUrl || ""}", watcherKey=${
      config.uploadApiKey ? "present" : "missing"
    }`
  );
  void verifyWatcherAuth(config);

  const runtimeConfig = {
    ...config,
    appSessionId: APP_SESSION_ID,
    settlementStatePath:
      path.join(
        app.getPath("userData"),
        "replay-settlement-state.json"
      ),
  };

  watcherHandle = startWatching(runtimeConfig, {
    onLog: (message, level = "info") => appendLog(message, level),
    onEvent: handleWatcherRuntimeEvent,
  });

  const isWatching = Boolean(watcherHandle);
  setWatchingState(isWatching);

  if (isWatching) {
    appendLog("Watcher handle created successfully.");
  } else {
    appendLog("Watcher start returned null.", "error");
  }

  return isWatching;
}

async function runHistoricalImport({ source, filePaths = [] }) {
  if (currentImportState.isRunning) {
    return {
      ok: false,
      error: "An import is already running. Let it finish first.",
      state: currentImportState,
    };
  }

  const config = loadConfig();
  const setupBlocker = getSetupBlocker(config);
  if (setupBlocker) {
    return {
      ok: false,
      error: setupBlocker,
    };
  }

  importSession += 1;
  const thisRun = importSession;

  appendSessionHeader(source === "retry" ? `Import retry ${thisRun}` : `Batch upload ${thisRun}`);
  appendLog(
    source === "retry"
      ? "Retrying the failed replay uploads from the last import summary."
      : "Scanning the replay folder and importing saved replays oldest to newest."
  );

  setImportState(
    {
      isRunning: true,
      source,
      phase: "scanning",
      startedAt: new Date().toISOString(),
      completedAt: null,
      percent: 0,
      found: 0,
      queued: 0,
      skipped: 0,
      uploaded: 0,
      archived: 0,
      parsed: 0,
      resultReady: 0,
      reviewRouted: 0,
      failed: 0,
      unsupported: 0,
      currentFile: "",
      currentIndex: 0,
      failedItems: [],
      skippedItems: [],
      recentItems: [],
      summaryText: "",
    },
    { persist: false }
  );

  try {
    const finalState = await importHistoricalReplays(
      {
        ...config,
        appSessionId: APP_SESSION_ID,
      },
      {
        source,
        filePaths,
      },
      {
        onLog: (message, level = "info") => appendLog(message, level),
        onEvent: handleWatcherRuntimeEvent,
        onProgress: (state) => {
          if (thisRun !== importSession) {
            return;
          }
          setImportState(state, { persist: false });
        },
      }
    );

    setImportState(finalState, { persist: true });
    appendLog(finalState.summaryText || "Batch upload complete.");
    maybeInstallPendingWatcherUpdate("import_finished");

    return {
      ok: true,
      state: finalState,
    };
  } catch (error) {
    const message = error.message || "Batch upload failed.";
    appendLog(`Batch upload failed: ${message}`, "error");

    const failedState = {
      ...currentImportState,
      isRunning: false,
      phase: "error",
      completedAt: new Date().toISOString(),
      summaryText: message,
    };
    setImportState(failedState, { persist: true });
    maybeInstallPendingWatcherUpdate("import_failed");

    return {
      ok: false,
      error: message,
      state: failedState,
    };
  }
}

function processPendingPairingUrl() {
  if (!rendererReady || !pendingPairingUrl) {
    return false;
  }

  const rawUrl = pendingPairingUrl;
  pendingPairingUrl = null;

  const pairingConfig = parsePairingUrl(rawUrl);
  if (!pairingConfig) {
    appendLog("Ignored an invalid Watcher pairing link.", "error");
    return false;
  }

  const currentConfig = loadConfig();
  const savedConfig = saveConfig({
    ...currentConfig,
    uploadApiKey: pairingConfig.uploadApiKey,
    watchDir:
      pairingConfig.watchDir ||
      currentConfig.watchDir ||
      getDefaultReplayDir() ||
      "",
  });

  broadcastConfig(savedConfig);
  appendLog("Paired this watcher with your AoE2HDBets profile key.");
  void verifyWatcherAuth(savedConfig);

  const setupBlocker = getSetupBlocker(savedConfig);
  if (setupBlocker) {
    setWatchingState(false);
    appendLog(
      `${setupBlocker} The key is saved now, so you do not need to pair again.`,
      "warn"
    );
    focusMainWindow();
    return true;
  }

  const started = startCurrentWatcher(savedConfig, {
    preserveLog: true,
    startMessage: "Pairing is complete. Auto-starting the watcher now.",
  });
  if (!started) {
    appendLog("Watcher did not start after pairing. Check the replay folder and try again.", "error");
  }

  focusMainWindow();
  return true;
}

function queuePairingUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim().toLowerCase().startsWith(`${WATCHER_PAIR_PROTOCOL}://`)) {
    return false;
  }

  pendingPairingUrl = rawUrl.trim();
  return processPendingPairingUrl();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: APP_NAME,
    backgroundColor: "#071119",
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

function bootWatcherApp() {
  app.setName(APP_NAME);
  if (process.platform === "win32") {
    app.setAppUserModelId("com.aoe2hdbets.watcher");
  }

  registerPairingProtocol();
  configureAutoUpdater();
  createWindow();

  ipcMain.handle("watcher:get-config", async () => {
    return loadConfig();
  });

  ipcMain.handle("watcher:get-app-info", async () => {
    return getAppInfo(loadConfig());
  });

  ipcMain.handle("watcher:save-config", async (_event, config) => {
    const previous = loadConfig();
    const saved = saveConfig(config);
    const launchState = applyLaunchAtLogin(saved);

    appendLog("Settings saved locally.");

    if (
      launchState.supported &&
      launchState.reason !== "development_build"
    ) {
      appendLog(
        launchState.openAtLogin
          ? "Start at sign-in is enabled."
          : "Start at sign-in is disabled."
      );
    }

    broadcastConfig(saved);
    if ((config?.watchDir || "") && config.watchDir !== previous.watchDir) {
      emitWatcherTelemetry(
        "watch_folder_selected",
        {
          watchDir: config.watchDir,
          metadata: {
            source: "settings_save",
          },
        },
        saved
      );
    }
    if ((config?.uploadApiKey || "") && config.uploadApiKey !== previous.uploadApiKey) {
      void verifyWatcherAuth(saved);
    }
    void refreshWatcherRelease(saved);
    return saved;
  });

  ipcMain.handle("watcher:start", async (_event, config) => {
    const saved = saveConfig(config);
    broadcastConfig(saved);
    const started = startCurrentWatcher(saved);

    return {
      ok: started,
      config: saved,
    };
  });

  ipcMain.handle("watcher:stop", async () => {
    stopCurrentWatcher();
    return { ok: true };
  });

  ipcMain.handle("watcher:open-stream-handoff", async (_event, payload = {}) => {
    const config = loadConfig();
    const candidate =
      payload && typeof payload === "object" && Object.keys(payload).length > 0
        ? payload
        : lastStreamHandoff || {};
    const handoff = buildStreamHandoff(candidate, {
      webBaseUrl: getStreamWebBaseUrl(config),
    });

    if (!handoff.ok) {
      return {
        ok: false,
        error: "No watcher match is ready to stream yet.",
      };
    }

    const publishedHandoff = {
      ...lastStreamHandoff,
      ...handoff,
      openedAt: new Date().toISOString(),
    };

    await shell.openExternal(handoff.url);
    lastStreamHandoff = publishedHandoff;
    publishStreamHandoff(lastStreamHandoff);
    emitWatcherTelemetry(
      "stream_handoff_opened",
      {
        sessionKey: handoff.sessionKey,
        title: handoff.title,
        metadata: {
          source: "watcher_app",
          webBaseUrl: handoff.webBaseUrl,
        },
      },
      config
    );

    return {
      ok: true,
      handoff: lastStreamHandoff,
    };
  });

  ipcMain.handle("watcher:list-stream-sources", async () => {
    try {
      const sources = await listDesktopCaptureSources();
      emitWatcherTelemetry("stream_sources_listed", {
        metadata: {
          sourceCount: sources.length,
          topSourceName: sources[0]?.name || null,
          topSourceKind: sources[0]?.kind || null,
        },
      });
      return {
        ok: true,
        sources,
      };
    } catch (error) {
      appendLog(`Stream source scan failed: ${error.message || error}`, "error");
      emitWatcherTelemetry("stream_error", {
        metadata: {
          source: "desktop_capturer",
          errorMessage: error.message || String(error),
        },
      });
      return {
        ok: false,
        error: error.message || "Stream source scan failed.",
        sources: [],
      };
    }
  });

  ipcMain.handle("watcher:stream-json", async (_event, payload = {}) => {
    try {
      return await postStreamJson(payload);
    } catch (error) {
      return {
        ok: false,
        status: error?.response?.status || 0,
        error: formatAxiosError(error),
        data: error?.response?.data || null,
      };
    }
  });

  ipcMain.handle("watcher:stream-chunk", async (_event, payload = {}) => {
    try {
      return await postStreamChunk(payload);
    } catch (error) {
      return {
        ok: false,
        status: error?.response?.status || 0,
        error: formatAxiosError(error),
        data: error?.response?.data || null,
      };
    }
  });

  ipcMain.handle("watcher:open-folder", async (_event, targetPath) => {
    if (!targetPath) {
      return { ok: false, error: "Missing path." };
    }

    try {
      const result = await shell.openPath(targetPath);
      if (result) {
        return { ok: false, error: result };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || "Failed to open folder." };
    }
  });

  ipcMain.handle("watcher:choose-replay-dir", async () => {
    const config = loadConfig();
    const defaultPath =
      config.watchDir || getDefaultReplayDir() || path.join(app.getPath("documents"), "My Games");

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose your AoE2 SaveGame folder",
      defaultPath,
      properties: ["openDirectory", "dontAddToRecent"],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    emitWatcherTelemetry("watch_folder_selected", {
      watchDir: result.filePaths[0],
      metadata: {
        source: "folder_picker",
      },
    });

    return {
      ok: true,
      path: result.filePaths[0],
    };
  });

  ipcMain.handle("watcher:validate-watch-dir", async (_event, targetPath) => {
    return getWatchDirStatus(targetPath);
  });

  ipcMain.handle("watcher:get-default-replay-dir", async () => {
    return detectReplayFolder()?.path || getDefaultReplayDir() || "";
  });

  ipcMain.handle("watcher:check-release", async () => {
    return refreshWatcherRelease(loadConfig());
  });

  ipcMain.handle("watcher:open-update", async (_event, updateUrl) => {
    const targetUrl = updateUrl || releaseState.updateUrl || releaseState.releaseUrl;
    await shell.openExternal(targetUrl || `${DEFAULT_RELEASE_BASE_URL}${DOWNLOAD_PAGE_PATH}`);
    return { ok: true };
  });

  ipcMain.handle("watcher:check-update", async () => {
    return checkForWatcherUpdates({ manual: true, config: loadConfig() });
  });

  ipcMain.handle("watcher:install-update", async () => {
    return installDownloadedWatcherUpdate(loadConfig());
  });

  ipcMain.handle("watcher:start-import", async () => {
    return runHistoricalImport({ source: "scan" });
  });

  ipcMain.handle("watcher:retry-import", async () => {
    const summary = currentImportState || createImportStateFromSummary(loadConfig().lastImportSummary);
    const failedItems = Array.isArray(summary.failedItems) ? summary.failedItems : [];
    const filePaths = failedItems
      .map((item) => item?.filePath)
      .filter((value) => typeof value === "string" && value.trim().length > 0);

    if (filePaths.length === 0) {
      return {
        ok: false,
        error: "There are no failed uploads to retry.",
        state: currentImportState,
      };
    }

    return runHistoricalImport({
      source: "retry",
      filePaths,
    });
  });

  ipcMain.handle("watcher:copy-text", async (_event, value) => {
    clipboard.writeText(String(value || ""));
    return { ok: true };
  });

  const config = saveConfig(loadConfig());
  const launchState = applyLaunchAtLogin(config);

  currentImportState = createImportStateFromSummary(config.lastImportSummary);

  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    broadcastConfig(config);
    sendToRenderer("watcher:import-state", currentImportState);
    appendLog("UI loaded.");
    appendLog(
      `Initial config loaded: watchDir="${config.watchDir || ""}", apiBaseUrl="${config.apiBaseUrl || ""}", fallback="${config.apiFallbackBaseUrl || ""}", watcherKey=${
        config.uploadApiKey ? "present" : "missing"
      }`
    );
    emitWatcherTelemetry("app_open", {
      metadata: {
        launchAtLogin: Boolean(config.launchAtLogin),
        autoStartWatching: Boolean(config.autoStartWatching),
        hasWatcherKey: Boolean(config.uploadApiKey),
        hasWatchDir: Boolean(config.watchDir),
      },
    }, config);
    emitWatcherTelemetry("watcher_started", {
      metadata: buildRuntimeMetadata(config),
    }, config);
    emitWatcherTelemetry("watcher_version_seen", {
      metadata: buildRuntimeMetadata(config),
    }, config);
    void verifyWatcherAuth(config);
    void refreshWatcherRelease(config);
    void checkForWatcherUpdates({ config });
    startTelemetryHeartbeat();
    void flushWatcherTelemetryQueue(
      config
    );
    startMonitorWatchdog();

    const pairedFromUrl = processPendingPairingUrl();
    if (pairedFromUrl) {
      return;
    }

    const setupBlocker = getSetupBlocker(config);

    if (config.autoStartWatching && !setupBlocker) {
      appendLog("Auto-start is enabled. Attempting watcher start...");
      const started = startCurrentWatcher(config);
      if (!started) {
        appendLog("Watcher did not start. Check replay folder and settings.", "error");
      }
    } else if (config.autoStartWatching && setupBlocker) {
      setWatchingState(false);
      appendLog(
        `${setupBlocker} Future launches can auto-start once both are saved.`,
        "warn"
      );
    } else {
      setWatchingState(false);
      appendLog("Watcher is idle. Press Start Watching when ready.");
    }
  });
}

app.on("window-all-closed", () => {
  rendererReady = false;
  stopTelemetryHeartbeat();
  stopMonitorWatchdog();
  stopCurrentWatcher({ quiet: true });
  app.quit();
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    bootWatcherApp();
    powerMonitor.on("resume", () => {
      const config =
        loadConfig();

      emitWatcherTelemetry(
        "system_resumed",
        {
          metadata:
            buildRuntimeMetadata(
              config
            ),
        }
      );

      void flushWatcherTelemetryQueue(
        config
      );

      setTimeout(
        () =>
          safelyReattachMonitor(
            "system_resume"
          ),
        1500
      );
    });
  });

  app.on("second-instance", (_event, argv) => {
    const pairingUrl = getPairingUrlFromArgs(argv);
    if (pairingUrl) {
      queuePairingUrl(pairingUrl);
    }
    focusMainWindow();
  });

  app.on("open-url", (event, rawUrl) => {
    event.preventDefault();
    queuePairingUrl(rawUrl);
  });

  const startupPairingUrl = getPairingUrlFromArgs(process.argv);
  if (startupPairingUrl) {
    queuePairingUrl(startupPairingUrl);
  }
}
