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
  dialog,
  ipcMain,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");

const {
  getDefaultReplayDir,
  getSupportedReplayExtensions,
  importHistoricalReplays,
  startWatching,
  stopWatching,
} = require("./watcher");

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
const TELEMETRY_HEARTBEAT_MS = Number(process.env.AOE2_TELEMETRY_HEARTBEAT_MS || 60 * 1000);
const TELEMETRY_TIMEOUT_MS = Number(process.env.AOE2_TELEMETRY_TIMEOUT_MS || 5000);
const RELEASE_CHECK_TIMEOUT_MS = Number(process.env.AOE2_RELEASE_CHECK_TIMEOUT_MS || 5000);
const AUTO_UPDATE_FEED_URL = process.env.AOE2_UPDATE_FEED_URL || "https://aoe2war.com/downloads";
const APP_SESSION_ID = createRandomId("session");

let mainWindow = null;
let watcherHandle = null;
let watcherSession = 0;
let importSession = 0;
let rendererReady = false;
let pendingPairingUrl = null;
let currentImportState = createImportStateFromSummary();
let heartbeatTimer = null;
let releaseState = createReleaseState();
let updateState = createUpdateState();
let updateCheckInFlight = false;
let updateEventsConfigured = false;


function createUpdateState(patch = {}) {
  return {
    supported: Boolean(autoUpdater),
    status: "idle",
    message: "Updates idle.",
    feedUrl: AUTO_UPDATE_FEED_URL,
    currentVersion: typeof app.getVersion === "function" ? app.getVersion() : null,
    updateVersion: null,
    downloaded: false,
    downloadPercent: 0,
    error: null,
    checkedAt: null,
    updatedAt: null,
    ...patch,
  };
}

function buildRuntimeMetadata(config = loadConfig()) {
  return {
    appVersion: typeof app.getVersion === "function" ? app.getVersion() : null,
    platform: process.platform,
    arch: process.arch,
    osPlatform: os.platform(),
    osRelease: os.release(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    watcherId: config?.watcherId || null,
    sessionId: APP_SESSION_ID,
    isWatching: Boolean(watcherHandle),
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

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

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
    setUpdateState(
      {
        supported: true,
        status: "available",
        message: `Watcher update ${info.version || ""} is available.`.trim(),
        updateVersion: info.version || null,
        downloaded: false,
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
    setUpdateState(
      {
        supported: true,
        status: "downloaded",
        message: "Watcher update downloaded. It will install when the app closes.",
        updateVersion: info.version || null,
        downloaded: true,
        downloadPercent: 100,
        error: null,
      },
      {
        logMessage: "Watcher update downloaded. Close and reopen the watcher to finish updating.",
        telemetryEvent: "watcher_update_downloaded",
        telemetryPayload: { metadata: { updateInfo: info } },
      }
    );
  });

  autoUpdater.on("error", (error) => {
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

async function installDownloadedWatcherUpdate(config = loadConfig()) {
  configureAutoUpdater();

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

  if (watcherHandle || currentImportState?.isRunning) {
    autoUpdater.autoInstallOnAppQuit = true;
    appendLog("Update is ready. It will install after uploads/watching stop and the app closes.", "warn");
    return {
      ok: true,
      deferred: true,
      update: updateState,
    };
  }

  appendLog("Installing watcher update now...");
  autoUpdater.quitAndInstall(false, true);

  return {
    ok: true,
    installing: true,
    update: updateState,
  };
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
  const currentVersion = app.getVersion();
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
    currentVersion: app.getVersion(),
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
      currentVersion: app.getVersion(),
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
    finalAccepted:
      typeof payload.finalAccepted === "boolean" ? payload.finalAccepted : undefined,
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
    skippedCount: Number.isFinite(payload.skippedCount) ? payload.skippedCount : undefined,
    failedCount: Number.isFinite(payload.failedCount) ? payload.failedCount : undefined,
    currentIndex: Number.isFinite(payload.currentIndex) ? payload.currentIndex : undefined,
    percent: Number.isFinite(payload.percent) ? payload.percent : undefined,
    phase: payload.phase || undefined,
    source: payload.source || undefined,
    summaryText: payload.summaryText || undefined,
    errorMessage: payload.errorMessage ? String(payload.errorMessage).slice(0, 300) : undefined,
    watchDirBasename: payload.watchDir ? path.basename(String(payload.watchDir)) : undefined,
    ...buildRuntimeMetadata(config),
  };

  return {
    event_type: eventType,
    app_version: app.getVersion(),
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

async function postWatcherTelemetry(eventType, payload = {}, { wait = false, config = loadConfig() } = {}) {
  const baseUrl = getTelemetryBaseUrl(config);
  if (!baseUrl) {
    return null;
  }

  const request = axios
    .post(`${baseUrl}/api/watcher/events`, buildTelemetryPayload(eventType, payload, config), {
      timeout: TELEMETRY_TIMEOUT_MS,
      headers: {
        "content-type": "application/json",
        ...(config.uploadApiKey ? { "x-api-key": config.uploadApiKey } : {}),
      },
    })
    .then((response) => response.data)
    .catch((error) => {
      const detail = error?.response?.status
        ? `${error.response.status} ${error.response.statusText || ""}`.trim()
        : error.message || "network error";
      console.warn(`Watcher telemetry ${eventType} failed: ${detail}`);
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
    emitWatcherTelemetry("heartbeat", {
      metadata: {
        isWatching: Boolean(watcherHandle),
      },
    });
  }, TELEMETRY_HEARTBEAT_MS);
}

function stopTelemetryHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
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
  const normalizedPath = String(targetPath || "").trim();

  if (!normalizedPath) {
    return {
      exists: false,
      isDirectory: false,
      path: "",
      error: null,
    };
  }

  try {
    const stats = fs.statSync(normalizedPath);
    return {
      exists: stats.isDirectory(),
      isDirectory: stats.isDirectory(),
      path: normalizedPath,
      error: null,
    };
  } catch (error) {
    return {
      exists: false,
      isDirectory: false,
      path: normalizedPath,
      error: error.message || "Folder not found.",
    };
  }
}

function getAppInfo(config = loadConfig()) {
  return {
    version: app.getVersion(),
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
    emitWatcherTelemetry(
      event.pendingParse || (event.isFinal && event.finalAccepted === false)
        ? "parse_pending"
        : "parse_succeeded",
      basePayload
    );
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

function handleWatcherRuntimeEvent(event) {
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

function stopCurrentWatcher({ quiet = false } = {}) {
  if (!quiet) {
    appendLog("Stopping watcher session...");
  }

  if (watcherHandle && typeof watcherHandle.close === "function") {
    try {
      watcherHandle.close();
    } catch (error) {
      appendLog(`Failed closing watcher handle: ${error.message}`, "error");
    }
  }

  watcherHandle = null;
  stopWatching();
  setWatchingState(false);
  emitWatcherTelemetry("watcher_stopped", {
    metadata: buildRuntimeMetadata(loadConfig()),
  });

  if (!quiet) {
    appendLog("Watcher is now idle.");
  }
}

function startCurrentWatcher(
  config,
  { preserveLog = false, startMessage = "Start Watching clicked." } = {}
) {
  watcherSession += 1;

  stopCurrentWatcher({ quiet: true });
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
    appendLog("Settings saved locally.");
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
    return getDefaultReplayDir() || "";
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
  stopCurrentWatcher({ quiet: true });
  app.quit();
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    bootWatcherApp();
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
