const els = {
  watchDirInput: document.getElementById("watchDirInput"),
  apiBaseUrlInput: document.getElementById("apiBaseUrlInput"),
  apiFallbackBaseUrlInput: document.getElementById("apiFallbackBaseUrlInput"),
  uploadApiKeyInput: document.getElementById("uploadApiKeyInput"),
  autoStartWatchingInput: document.getElementById("autoStartWatchingInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  detectFolderBtn: document.getElementById("detectFolderBtn"),
  chooseFolderBtn: document.getElementById("chooseFolderBtn"),
  startWatchingBtn: document.getElementById("startWatchingBtn"),
  stopWatchingBtn: document.getElementById("stopWatchingBtn"),
  openFolderBtn: document.getElementById("openFolderBtn"),
  scanImportBtn: document.getElementById("scanImportBtn"),
  retryFailedBtn: document.getElementById("retryFailedBtn"),
  copySupportBtn: document.getElementById("copySupportBtn"),
  toggleKeyVisibilityBtn: document.getElementById("toggleKeyVisibilityBtn"),
  watcherStateText: document.getElementById("watcherStateText"),
  watcherStateDetailText: document.getElementById("watcherStateDetailText"),
  folderReadyText: document.getElementById("folderReadyText"),
  folderPathText: document.getElementById("folderPathText"),
  keyReadyText: document.getElementById("keyReadyText"),
  keyHintText: document.getElementById("keyHintText"),
  setupSummaryText: document.getElementById("setupSummaryText"),
  statusBar: document.getElementById("statusBar"),
  heroAppVersionText: document.getElementById("heroAppVersionText"),
  heroPlatformText: document.getElementById("heroPlatformText"),
  appVersionText: document.getElementById("appVersionText"),
  platformText: document.getElementById("platformText"),
  protocolStatusText: document.getElementById("protocolStatusText"),
  protocolDetailText: document.getElementById("protocolDetailText"),
  apiHostText: document.getElementById("apiHostText"),
  replayPathDiagText: document.getElementById("replayPathDiagText"),
  supportedExtensionsText: document.getElementById("supportedExtensionsText"),
  importPhaseText: document.getElementById("importPhaseText"),
  importDetailText: document.getElementById("importDetailText"),
  importSummaryText: document.getElementById("importSummaryText"),
  importProgressFill: document.getElementById("importProgressFill"),
  importProgressPercent: document.getElementById("importProgressPercent"),
  importFoundCount: document.getElementById("importFoundCount"),
  importQueuedCount: document.getElementById("importQueuedCount"),
  importSkippedCount: document.getElementById("importSkippedCount"),
  importUploadedCount: document.getElementById("importUploadedCount"),
  importFailedCount: document.getElementById("importFailedCount"),
  importUnsupportedCount: document.getElementById("importUnsupportedCount"),
  importRecentList: document.getElementById("importRecentList"),
  importFailedList: document.getElementById("importFailedList"),
  log: document.getElementById("log"),
};

const DEFAULT_CONFIG = {
  watchDir: "",
  apiBaseUrl: "https://api-prodn.aoe2hdbets.com",
  apiFallbackBaseUrl: "https://aoe2hdbets.com",
  uploadApiKey: "",
  autoStartWatching: true,
  lastImportSummary: null,
};

const EMPTY_IMPORT_STATE = {
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

let currentConfig = { ...DEFAULT_CONFIG };
let appInfo = null;
let watcherState = { isWatching: false };
let importState = { ...EMPTY_IMPORT_STATE };
let runtimeState = {
  phase: "booting",
  detail: "Loading watcher…",
  lastUploadSuccess: "",
  lastUploadError: "",
  activeUpload: null,
};
let watchDirStatus = {
  exists: false,
  isDirectory: false,
  path: "",
  error: null,
};
let statusNotice = null;
let statusNoticeTimer = null;
let validateWatchDirToken = 0;
let keyIsVisible = false;

function setStatus(message, kind = "neutral", { sticky = false } = {}) {
  statusNotice = {
    message,
    kind,
    sticky,
  };

  if (statusNoticeTimer) {
    window.clearTimeout(statusNoticeTimer);
    statusNoticeTimer = null;
  }

  if (!sticky) {
    statusNoticeTimer = window.setTimeout(() => {
      statusNotice = null;
      renderStatusBar();
    }, 5000);
  }

  renderStatusBar();
}

function clearStatusNotice() {
  statusNotice = null;
  if (statusNoticeTimer) {
    window.clearTimeout(statusNoticeTimer);
    statusNoticeTimer = null;
  }
}

function addLog(line, level = "info") {
  const row = document.createElement("div");
  row.className =
    `log-line${
      level === "warn"
        ? " warn"
        : level === "error"
          ? " error"
          : level === "session"
            ? " session"
            : ""
    }`;
  row.textContent = line;
  els.log.appendChild(row);
  els.log.scrollTop = els.log.scrollHeight;
}

function clearLog() {
  els.log.innerHTML = "";
}

function readForm() {
  return {
    watchDir: els.watchDirInput.value.trim(),
    apiBaseUrl: els.apiBaseUrlInput.value.trim(),
    apiFallbackBaseUrl: els.apiFallbackBaseUrlInput.value.trim(),
    uploadApiKey: els.uploadApiKeyInput.value.trim(),
    autoStartWatching: Boolean(els.autoStartWatchingInput.checked),
  };
}

function writeForm(config) {
  els.watchDirInput.value = config.watchDir || "";
  els.apiBaseUrlInput.value = config.apiBaseUrl || "";
  els.apiFallbackBaseUrlInput.value = config.apiFallbackBaseUrl || "";
  els.uploadApiKeyInput.value = config.uploadApiKey || "";
  els.autoStartWatchingInput.checked = config.autoStartWatching !== false;
}

function formatPlatform(value) {
  if (value === "win32") return "Windows";
  if (value === "darwin") return "macOS";
  if (value === "linux") return "Linux";
  return value || "Unknown";
}

function formatDateTime(value) {
  if (!value) return "";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function shortenPath(value, fallback = "Not set") {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  if (text.length <= 64) {
    return text;
  }

  return `${text.slice(0, 28)}…${text.slice(-28)}`;
}

function hasWatcherKey() {
  return Boolean(readForm().uploadApiKey);
}

function hasReplayFolder() {
  return Boolean(readForm().watchDir);
}

function isReplayFolderReady() {
  return Boolean(watchDirStatus.exists && watchDirStatus.isDirectory);
}

function setReadinessState(el, isReady) {
  el.classList.toggle("ready", isReady);
  el.classList.toggle("missing", !isReady);
}

function getPrimaryStatus() {
  if (importState.isRunning) {
    if (importState.phase === "scanning") {
      return {
        label: "Scanning historical replays",
        detail: "Reading the replay folder and building the import queue.",
        kind: "neutral",
      };
    }

    return {
      label: "Importing saved replays",
      detail:
        importState.currentFile && importState.queued > 0
          ? `Working through ${importState.currentIndex} of ${importState.queued}: ${importState.currentFile}`
          : "Uploading replay history to AoE2HDBets.",
      kind: "success",
    };
  }

  if (runtimeState.phase === "uploading") {
    return {
      label: "Uploading replay",
      detail: runtimeState.detail || "Sending replay data to AoE2HDBets.",
      kind: "success",
    };
  }

  if (runtimeState.phase === "retrying") {
    return {
      label: "Retrying upload",
      detail: runtimeState.detail || "A replay upload is retrying automatically.",
      kind: "warn",
    };
  }

  if (!hasWatcherKey() && !isReplayFolderReady()) {
    return {
      label: "Finish setup",
      detail: "Choose the replay folder and add a watcher key. Manual key paste always works.",
      kind: "warn",
    };
  }

  if (!isReplayFolderReady()) {
    return {
      label: "Replay folder missing",
      detail: hasReplayFolder()
        ? "The saved path is not a valid AoE2 SaveGame folder right now. Choose the real folder to continue."
        : "Choose the AoE2 SaveGame folder to continue.",
      kind: "warn",
    };
  }

  if (!hasWatcherKey()) {
    return {
      label: "Not paired",
      detail: "Open Profile Pairing or paste a watcher key manually, then save once.",
      kind: "warn",
    };
  }

  if (watcherState.isWatching) {
    if (runtimeState.phase === "watching_error") {
      return {
        label: "Watching with a recent issue",
        detail: runtimeState.detail || "The watcher is still running, but the last upload had a problem.",
        kind: "error",
      };
    }

    return {
      label: "Watching for new replays",
      detail: runtimeState.detail || "Leave the watcher open while you play.",
      kind: "success",
    };
  }

  if (runtimeState.phase === "error") {
    return {
      label: "Attention needed",
      detail: runtimeState.detail || "The watcher hit an error and needs a quick check.",
      kind: "error",
    };
  }

  if (runtimeState.lastUploadSuccess) {
    return {
      label: "Idle but ready",
      detail: `${runtimeState.lastUploadSuccess} The watcher is ready for the next match.`,
      kind: "success",
    };
  }

  return {
    label: "Idle but ready",
    detail: "Setup is saved. Start watching before the next set, or scan the folder to import your history.",
    kind: "success",
  };
}

function getSetupSummaryText() {
  if (!hasWatcherKey() && !isReplayFolderReady()) {
    return "Choose the replay folder, pair your watcher key, then either start live watching or import your saved replays.";
  }

  if (!isReplayFolderReady()) {
    return "Watcher key looks good. Choose the AoE2 SaveGame folder next so live watching and import can run cleanly.";
  }

  if (!hasWatcherKey()) {
    return "Replay folder is ready. Pair now from your AoE2HDBets profile, or paste a watcher key manually and save once.";
  }

  if (importState.isRunning) {
    return "Historical import is running. The app stays responsive, and live watching can still stay armed.";
  }

  return "Everything is ready. Start watching for new replays, or use Scan & Import Replays to bring older matches online.";
}

function renderReadiness() {
  const primaryStatus = getPrimaryStatus();
  const folderReady = isReplayFolderReady();
  const keyReady = hasWatcherKey();

  els.watcherStateText.textContent = primaryStatus.label;
  els.watcherStateDetailText.textContent = primaryStatus.detail;

  setReadinessState(els.folderReadyText, folderReady);
  els.folderReadyText.textContent = folderReady ? "Folder ready" : "Folder missing";
  els.folderPathText.textContent = folderReady
    ? shortenPath(readForm().watchDir)
    : hasReplayFolder()
      ? shortenPath(readForm().watchDir)
      : "Choose or auto-detect the SaveGame folder.";

  setReadinessState(els.keyReadyText, keyReady);
  els.keyReadyText.textContent = keyReady ? "Watcher key saved" : "Watcher key missing";
  els.keyHintText.textContent = keyReady
    ? "Manual paste is still available any time."
    : "Open Profile Pairing or paste the watcher key yourself.";

  els.setupSummaryText.textContent = getSetupSummaryText();
}

function renderStatusBar() {
  const status = statusNotice || getPrimaryStatus();
  els.statusBar.textContent = status.message || status.detail;
  els.statusBar.className = "status-bar";

  if (status.kind === "error") {
    els.statusBar.classList.add("error");
  } else if (status.kind === "success") {
    els.statusBar.classList.add("success");
  } else if (status.kind === "warn") {
    els.statusBar.classList.add("warn");
  }
}

function renderDiagnostics() {
  els.heroAppVersionText.textContent = appInfo?.version || "Unknown";
  els.heroPlatformText.textContent = formatPlatform(appInfo?.platform);
  els.appVersionText.textContent = appInfo?.version || "Unknown";
  els.platformText.textContent = formatPlatform(appInfo?.platform);
  els.protocolStatusText.textContent = appInfo?.protocolRegistered
    ? "Browser handoff ready"
    : "Manual key fallback ready";
  els.protocolDetailText.textContent = appInfo?.protocolRegistered
    ? "Profile Pairing should be able to hand the key to the app."
    : "If browser handoff does not register, click Mint Key Only and paste the key here.";
  els.apiHostText.textContent = readForm().apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl;
  els.replayPathDiagText.textContent = shortenPath(readForm().watchDir, "Not chosen yet");
  els.supportedExtensionsText.textContent =
    appInfo?.supportedReplayExtensions?.join(", ") || ".aoe2record, .aoe2mpgame, .mgz, .mgx, .mgl";
}

function describeImportPhase() {
  if (importState.isRunning && importState.phase === "scanning") {
    return {
      title: "Scanning folder",
      detail: "Reading the configured SaveGame folder and building a safe replay queue.",
    };
  }

  if (importState.isRunning && importState.phase === "uploading") {
    return {
      title: importState.source === "retry" ? "Retrying failed uploads" : "Uploading saved replays",
      detail:
        importState.currentFile && importState.queued > 0
          ? `Now working on ${importState.currentIndex} of ${importState.queued}: ${importState.currentFile}`
          : "Uploads are running in-order from oldest replay to newest replay.",
    };
  }

  if (importState.phase === "error") {
    return {
      title: "Import failed",
      detail: importState.summaryText || "The import stopped before it finished.",
    };
  }

  if (importState.phase === "complete_with_failures") {
    return {
      title: "Import finished with issues",
      detail: importState.summaryText || "Some saved replays still need attention.",
    };
  }

  if (importState.phase === "complete") {
    return {
      title: "Import finished",
      detail:
        importState.summaryText ||
        (importState.completedAt
          ? `Last completed ${formatDateTime(importState.completedAt)}.`
          : "The last replay import completed."),
    };
  }

  return {
    title: "Historical import",
    detail: "Scan the SaveGame folder to import older replays while live watching stays available.",
  };
}

function renderImportList(container, items, emptyMessage) {
  container.innerHTML = "";

  if (!items || items.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "list-empty";
    emptyRow.textContent = emptyMessage;
    container.appendChild(emptyRow);
    return;
  }

  for (const item of items.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = `list-row ${item.status || "neutral"}`;

    const top = document.createElement("div");
    top.className = "list-row-top";

    const name = document.createElement("div");
    name.className = "list-row-name";
    name.textContent = item.fileName || shortenPath(item.filePath, "Replay");
    top.appendChild(name);

    const badge = document.createElement("div");
    badge.className = `badge ${item.status || "neutral"}`;
    badge.textContent =
      item.status === "uploaded"
        ? "Uploaded"
        : item.status === "failed"
          ? "Failed"
          : "Skipped";
    top.appendChild(badge);

    const detail = document.createElement("div");
    detail.className = "list-row-detail";
    detail.textContent = item.detail || "";

    row.appendChild(top);
    row.appendChild(detail);
    container.appendChild(row);
  }
}

function renderImportState() {
  const phase = describeImportPhase();

  els.importPhaseText.textContent = phase.title;
  els.importDetailText.textContent = phase.detail;
  els.importSummaryText.textContent = importState.completedAt
    ? `Last finished ${formatDateTime(importState.completedAt)}`
    : importState.startedAt
      ? `Started ${formatDateTime(importState.startedAt)}`
      : "No import run yet.";
  els.importProgressFill.style.width = `${importState.percent || 0}%`;
  els.importProgressPercent.textContent = `${importState.percent || 0}%`;
  els.importFoundCount.textContent = String(importState.found || 0);
  els.importQueuedCount.textContent = String(importState.queued || 0);
  els.importSkippedCount.textContent = String(importState.skipped || 0);
  els.importUploadedCount.textContent = String(importState.uploaded || 0);
  els.importFailedCount.textContent = String(importState.failed || 0);
  els.importUnsupportedCount.textContent = String(importState.unsupported || 0);

  renderImportList(
    els.importRecentList,
    importState.recentItems,
    "Recent import results will appear here."
  );
  renderImportList(
    els.importFailedList,
    importState.failedItems,
    "No failed uploads right now."
  );

  els.retryFailedBtn.disabled = importState.isRunning || !importState.failedItems?.length;
}

function renderButtons() {
  els.startWatchingBtn.disabled = watcherState.isWatching || importState.isRunning;
  els.stopWatchingBtn.disabled = !watcherState.isWatching;
  els.scanImportBtn.disabled =
    importState.isRunning || !isReplayFolderReady() || !hasWatcherKey();
  els.openFolderBtn.disabled = !hasReplayFolder();
}

function renderAll() {
  renderReadiness();
  renderStatusBar();
  renderDiagnostics();
  renderImportState();
  renderButtons();
}

async function validateWatchDir(targetPath = readForm().watchDir) {
  const token = ++validateWatchDirToken;

  if (!targetPath) {
    watchDirStatus = {
      exists: false,
      isDirectory: false,
      path: "",
      error: null,
    };
    renderAll();
    return watchDirStatus;
  }

  const result = await window.watcherApi.validateWatchDir(targetPath);
  if (token !== validateWatchDirToken) {
    return result;
  }

  watchDirStatus = result;

  if (appInfo) {
    appInfo = {
      ...appInfo,
      watchDirStatus: result,
    };
  }

  renderAll();
  return result;
}

async function saveCurrentForm({ successMessage, silent = false } = {}) {
  const saved = await window.watcherApi.saveConfig(readForm());
  currentConfig = {
    ...currentConfig,
    ...saved,
  };
  writeForm(currentConfig);
  await validateWatchDir(currentConfig.watchDir);
  renderAll();

  if (!silent && successMessage) {
    setStatus(successMessage, "success");
  }

  return saved;
}

function buildSupportSnapshot() {
  const primaryStatus = getPrimaryStatus();
  const config = readForm();

  return [
    `Product: ${appInfo?.productName || "AoE2HDBets Watcher"}`,
    `Version: ${appInfo?.version || "Unknown"}`,
    `Platform: ${formatPlatform(appInfo?.platform)}`,
    `Status: ${primaryStatus.label}`,
    `Status detail: ${primaryStatus.detail}`,
    `Watching: ${watcherState.isWatching ? "yes" : "no"}`,
    `Replay folder: ${config.watchDir || "(empty)"}`,
    `Replay folder exists: ${watchDirStatus.exists ? "yes" : "no"}`,
    `Watcher key saved: ${hasWatcherKey() ? "yes" : "no"}`,
    `Protocol registered: ${appInfo?.protocolRegistered ? "yes" : "no"}`,
    `API base: ${config.apiBaseUrl || "(empty)"}`,
    `Fallback API: ${config.apiFallbackBaseUrl || "(empty)"}`,
    `Import phase: ${importState.phase || "idle"}`,
    `Import summary: ${importState.summaryText || "none"}`,
  ].join("\n");
}

function consumeRuntimeEvent(event) {
  switch (event.type) {
    case "watching-started":
    case "watcher-ready":
      runtimeState.phase = "watching";
      runtimeState.detail = "Watching for new replay files in the configured SaveGame folder.";
      runtimeState.activeUpload = null;
      break;
    case "replay-detected":
      runtimeState.phase = "watching";
      runtimeState.detail = `${event.fileName} detected. Waiting for upload timing.`;
      break;
    case "upload-start":
      runtimeState.phase = "uploading";
      runtimeState.activeUpload = event;
      runtimeState.detail = `${
        event.isFinal ? "Uploading final replay" : "Uploading live replay"
      }: ${event.fileName}`;
      break;
    case "upload-retry":
      runtimeState.phase = "retrying";
      runtimeState.activeUpload = event;
      runtimeState.lastUploadError = event.errorMessage || "Retry queued.";
      runtimeState.detail = `Retrying ${event.fileName} in ${Math.max(
        1,
        Math.round((event.retryInMs || 0) / 1000)
      )}s.`;
      break;
    case "upload-success":
      runtimeState.phase = watcherState.isWatching ? "watching" : "idle";
      runtimeState.activeUpload = null;
      runtimeState.lastUploadSuccess =
        event.detail ||
        `${event.fileName} ${event.resultType === "refreshed" ? "refreshed" : "uploaded"}.`;
      runtimeState.detail = watcherState.isWatching
        ? `Watching for new replays. Last result: ${runtimeState.lastUploadSuccess}`
        : runtimeState.lastUploadSuccess;
      break;
    case "upload-failure":
      runtimeState.phase = watcherState.isWatching ? "watching_error" : "error";
      runtimeState.activeUpload = null;
      runtimeState.lastUploadError = event.errorMessage || `Upload failed for ${event.fileName}.`;
      runtimeState.detail = runtimeState.lastUploadError;
      break;
    case "watching-stopped":
      runtimeState.phase = "idle";
      runtimeState.activeUpload = null;
      runtimeState.detail = "Watcher stopped. Start again before the next set.";
      break;
    case "watcher-error":
      runtimeState.phase = "error";
      runtimeState.detail = event.detail || "Watcher error.";
      break;
    default:
      return;
  }

  renderAll();
}

async function loadInitialData() {
  const [config, info] = await Promise.all([
    window.watcherApi.getConfig(),
    window.watcherApi.getAppInfo(),
  ]);

  currentConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  appInfo = info;
  writeForm(currentConfig);
  watchDirStatus = info?.watchDirStatus || watchDirStatus;
  renderAll();
  await validateWatchDir(currentConfig.watchDir);
}

els.saveSettingsBtn.addEventListener("click", async () => {
  try {
    await saveCurrentForm({
      successMessage: hasWatcherKey()
        ? "Settings saved locally."
        : "Settings saved. Pair now or paste the watcher key to finish setup.",
    });
  } catch (error) {
    setStatus(`Failed saving settings: ${error.message || error}`, "error", { sticky: true });
  }
});

els.detectFolderBtn.addEventListener("click", async () => {
  try {
    const replayDir = await window.watcherApi.getDefaultReplayDir();
    if (!replayDir) {
      setStatus("No replay folder was auto-detected.", "error", { sticky: true });
      return;
    }

    els.watchDirInput.value = replayDir;
    await validateWatchDir(replayDir);
    await saveCurrentForm({
      successMessage: "Replay folder auto-detected and saved.",
    });
  } catch (error) {
    setStatus(`Failed detecting replay folder: ${error.message || error}`, "error", { sticky: true });
  }
});

els.chooseFolderBtn.addEventListener("click", async () => {
  try {
    const result = await window.watcherApi.chooseReplayDir();
    if (!result.ok) {
      return;
    }

    els.watchDirInput.value = result.path;
    await validateWatchDir(result.path);
    await saveCurrentForm({
      successMessage: "Replay folder updated and saved.",
    });
  } catch (error) {
    setStatus(`Failed choosing replay folder: ${error.message || error}`, "error", { sticky: true });
  }
});

els.startWatchingBtn.addEventListener("click", async () => {
  try {
    const saved = await saveCurrentForm({ silent: true });
    const folderStatus = await validateWatchDir(saved.watchDir);

    if (!folderStatus.exists) {
      setStatus(
        "Replay folder is missing. Choose the real SaveGame folder before starting.",
        "error",
        { sticky: true }
      );
      return;
    }

    if (!saved.apiBaseUrl) {
      setStatus("Primary API host is missing.", "error", { sticky: true });
      return;
    }

    if (!saved.uploadApiKey) {
      setStatus(
        "Watcher key required. Open Profile Pairing, or paste the key manually.",
        "error",
        { sticky: true }
      );
      return;
    }

    const result = await window.watcherApi.startWatching(saved);

    if (result.ok) {
      currentConfig = {
        ...currentConfig,
        ...result.config,
      };
      writeForm(currentConfig);
      watcherState.isWatching = true;
      clearStatusNotice();
      renderAll();
    } else {
      setStatus("Watcher did not start. Check the replay folder and watcher key.", "error", {
        sticky: true,
      });
    }
  } catch (error) {
    setStatus(`Failed starting watcher: ${error.message || error}`, "error", { sticky: true });
  }
});

els.stopWatchingBtn.addEventListener("click", async () => {
  try {
    await window.watcherApi.stopWatching();
    watcherState.isWatching = false;
    clearStatusNotice();
    renderAll();
    setStatus("Watcher stopped.", "success");
  } catch (error) {
    setStatus(`Failed stopping watcher: ${error.message || error}`, "error", { sticky: true });
  }
});

els.openFolderBtn.addEventListener("click", async () => {
  try {
    const targetPath = els.watchDirInput.value.trim();
    if (!targetPath) {
      setStatus("Replay folder is empty.", "error", { sticky: true });
      return;
    }

    const result = await window.watcherApi.openFolder(targetPath);
    if (!result.ok) {
      throw new Error(result.error || "Failed opening folder.");
    }

    setStatus("Opened replay folder.", "success");
  } catch (error) {
    setStatus(`Failed opening replay folder: ${error.message || error}`, "error", { sticky: true });
  }
});

els.scanImportBtn.addEventListener("click", async () => {
  try {
    await saveCurrentForm({ silent: true });
    const result = await window.watcherApi.startImport();
    if (!result.ok) {
      setStatus(result.error || "Import did not start.", "error", { sticky: true });
      return;
    }

    clearStatusNotice();
    renderAll();
  } catch (error) {
    setStatus(`Failed starting import: ${error.message || error}`, "error", { sticky: true });
  }
});

els.retryFailedBtn.addEventListener("click", async () => {
  try {
    await saveCurrentForm({ silent: true });
    const result = await window.watcherApi.retryImport();
    if (!result.ok) {
      setStatus(result.error || "Retry did not start.", "error", { sticky: true });
      return;
    }

    clearStatusNotice();
    renderAll();
  } catch (error) {
    setStatus(`Failed retrying uploads: ${error.message || error}`, "error", { sticky: true });
  }
});

els.copySupportBtn.addEventListener("click", async () => {
  try {
    await window.watcherApi.copyText(buildSupportSnapshot());
    setStatus("Support snapshot copied.", "success");
  } catch (error) {
    setStatus(`Failed copying support snapshot: ${error.message || error}`, "error", {
      sticky: true,
    });
  }
});

els.toggleKeyVisibilityBtn.addEventListener("click", () => {
  keyIsVisible = !keyIsVisible;
  els.uploadApiKeyInput.type = keyIsVisible ? "text" : "password";
  els.toggleKeyVisibilityBtn.textContent = keyIsVisible ? "Hide" : "Show";
});

els.watchDirInput.addEventListener("input", () => {
  validateWatchDir(els.watchDirInput.value.trim()).catch(() => {});
  renderAll();
});

els.uploadApiKeyInput.addEventListener("input", () => {
  renderAll();
});

els.apiBaseUrlInput.addEventListener("input", () => {
  renderAll();
});

els.apiFallbackBaseUrlInput.addEventListener("input", () => {
  renderAll();
});

els.autoStartWatchingInput.addEventListener("change", () => {
  renderAll();
});

window.watcherApi.onConfig((config) => {
  currentConfig = {
    ...currentConfig,
    ...config,
  };
  writeForm(currentConfig);
  validateWatchDir(currentConfig.watchDir).catch(() => {});
  renderAll();
});

window.watcherApi.onAppInfo((info) => {
  appInfo = info;
  if (info?.watchDirStatus) {
    watchDirStatus = info.watchDirStatus;
  }
  renderAll();
});

window.watcherApi.onState(({ isWatching }) => {
  watcherState.isWatching = isWatching;
  if (!isWatching && runtimeState.phase === "uploading") {
    runtimeState.phase = "idle";
  }
  renderAll();
});

window.watcherApi.onRuntimeEvent((event) => {
  consumeRuntimeEvent(event);
});

window.watcherApi.onImportState((state) => {
  importState = {
    ...EMPTY_IMPORT_STATE,
    ...state,
  };
  renderAll();
});

window.watcherApi.onLog(({ line, level }) => {
  addLog(line, level);

  if (level === "error") {
    setStatus(line, "error", { sticky: true });
  }
});

window.watcherApi.onClearLog(() => {
  clearLog();
});

loadInitialData().catch((error) => {
  setStatus(`Failed loading watcher data: ${error.message || error}`, "error", { sticky: true });
});
