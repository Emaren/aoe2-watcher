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
  streamMatchBtn: document.getElementById("streamMatchBtn"),
  openBrowserStreamBtn: document.getElementById("openBrowserStreamBtn"),
  refreshStreamSourcesBtn: document.getElementById("refreshStreamSourcesBtn"),
  startNativeStreamBtn: document.getElementById("startNativeStreamBtn"),
  stopNativeStreamBtn: document.getElementById("stopNativeStreamBtn"),
  streamSourceSelect: document.getElementById("streamSourceSelect"),
  streamPreview: document.getElementById("streamPreview"),
  streamPreviewEmpty: document.getElementById("streamPreviewEmpty"),
  streamStatePill: document.getElementById("streamStatePill"),
  streamTitleText: document.getElementById("streamTitleText"),
  streamReadoutDetails: document.getElementById("streamReadoutDetails"),
  streamReadoutSummary: document.getElementById("streamReadoutSummary"),
  streamReadoutDetail: document.getElementById("streamReadoutDetail"),
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
  heroVersionStatusText: document.getElementById("heroVersionStatusText"),
  heroUpdateWatcherBtn: document.getElementById("heroUpdateWatcherBtn"),
  heroCheckVersionBtn: document.getElementById("heroCheckVersionBtn"),
  heroPlatformText: document.getElementById("heroPlatformText"),
  appVersionText: document.getElementById("appVersionText"),
  diagnosticsVersionStatusText: document.getElementById("diagnosticsVersionStatusText"),
  diagnosticsUpdateWatcherBtn: document.getElementById("diagnosticsUpdateWatcherBtn"),
  diagnosticsCheckVersionBtn: document.getElementById("diagnosticsCheckVersionBtn"),
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
  apiBaseUrl: "https://api-prodn.aoe2war.com",
  apiFallbackBaseUrl: "https://aoe2war.com",
  uploadApiKey: "",
  autoStartWatching: true,
  lastImportSummary: null,
};

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
const STREAM_CHUNK_TIMESLICE_MS = 1000;
const STREAM_HEARTBEAT_MS = 5000;
const STREAM_KEYFRAME_INTERVAL_MS = 1000;
const STREAM_MAX_UPLOAD_QUEUE = 6;
const STREAM_MODES = [
  {
    key: "stable",
    label: "Stable",
    detail: "720p / 15 fps",
    width: 1280,
    height: 720,
    frameRate: 15,
    videoBitsPerSecond: 1400000,
    preferredKind: "window",
  },
  {
    key: "screen",
    label: "Full Screen",
    detail: "720p / 18 fps",
    width: 1280,
    height: 720,
    frameRate: 18,
    videoBitsPerSecond: 1800000,
    preferredKind: "screen",
  },
  {
    key: "sharp",
    label: "Sharp",
    detail: "720p / 24 fps",
    width: 1280,
    height: 720,
    frameRate: 24,
    videoBitsPerSecond: 2600000,
    preferredKind: "window",
  },
];
const STREAM_MIME_CANDIDATES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

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
let updateState = {
  supported: false,
  status: "idle",
  message: "Updates idle.",
  currentVersion: null,
  updateVersion: null,
  downloaded: false,
  downloadPercent: 0,
  error: null,
};
let runtimeState = {
  phase: "booting",
  detail: "Loading watcher…",
  lastUploadSuccess: "",
  lastUploadError: "",
  activeUpload: null,
};
let streamHandoff = null;
let nativeStreamState = {
  status: "idle",
  mode: "stable",
  busy: false,
  sources: [],
  selectedSourceId: "",
  sourceName: "",
  sourceKind: "",
  mediaStream: null,
  recorder: null,
  stream: null,
  sequence: 0,
  chunkCount: 0,
  lastChunkBytes: 0,
  uploadFailures: 0,
  consecutiveUploadFailures: 0,
  heartbeatFailures: 0,
  uploadQueueLength: 0,
  lastUploadLatencyMs: 0,
  droppedChunks: 0,
  lastHeartbeatAt: 0,
  mediaMimeType: "video/webm",
  heartbeatTimer: null,
  startedAt: 0,
  manualStop: false,
  readout: "Idle.",
  detail: "Pick a source when a watcher match is ready.",
};
let nativeUploadChain = Promise.resolve();
let watchDirStatus = {
  exists: false,
  isDirectory: false,
  valid: false,
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

function getReleaseStatus() {
  const release = appInfo?.release || {};
  const autoUpdate = updateState || appInfo?.autoUpdate || appInfo?.update || {};
  const currentVersion =
    autoUpdate.currentVersion || release.currentVersion || appInfo?.version || "Unknown";
  const latestVersion = release.latestVersion || autoUpdate.updateVersion || "";

  if (autoUpdate.status === "checking" || release.phase === "checking") {
    return {
      headline: currentVersion,
      detail: "Checking for watcher updates...",
      showUpdate: false,
      showCheck: false,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "downloading") {
    return {
      headline: `${currentVersion} Updating`,
      detail: autoUpdate.downloadPercent
        ? `Downloading update: ${Math.round(autoUpdate.downloadPercent)}%.`
        : "Downloading watcher update.",
      showUpdate: false,
      showCheck: false,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "installing") {
    return {
      headline: `${currentVersion} Installing`,
      detail: "Installing watcher update now.",
      showUpdate: false,
      showCheck: false,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "manual_required" || autoUpdate.manualInstall) {
    return {
      headline: `${currentVersion} Update Ready`,
      detail: autoUpdate.error
        ? "Mac update needs a fresh download."
        : latestVersion || autoUpdate.updateVersion
          ? `Watcher ${latestVersion || autoUpdate.updateVersion} is ready.`
          : "A watcher update is ready.",
      showUpdate: true,
      showCheck: true,
      updateUrl:
        autoUpdate.manualDownloadUrl ||
        release.updateUrl ||
        release.releaseUrl ||
        "https://aoe2war.com/download",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "pending_install") {
    return {
      headline: `${currentVersion} Update Ready`,
      detail: "Update will install after watching or uploads stop.",
      showUpdate: true,
      showCheck: false,
      updateUrl: "",
      canInstall: true,
    };
  }

  if (autoUpdate.downloaded) {
    return {
      headline: `${currentVersion} Update Ready`,
      detail: "Update downloaded. Installing when safe.",
      showUpdate: true,
      showCheck: false,
      updateUrl: "",
      canInstall: true,
    };
  }

  if (autoUpdate.status === "available") {
    return {
      headline: `${currentVersion} Update Available`,
      detail: autoUpdate.updateVersion
        ? `Watcher ${autoUpdate.updateVersion} is downloading in the background.`
        : "A watcher update is downloading in the background.",
      showUpdate: false,
      showCheck: false,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (release.updateAvailable) {
    return {
      headline: `${currentVersion} Update Available`,
      detail: latestVersion
        ? `Latest watcher is ${latestVersion}.`
        : "A newer watcher build is available.",
      showUpdate: true,
      showCheck: true,
      updateUrl: release.updateUrl || release.releaseUrl || "https://aoe2war.com/download",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "current" || release.isLatest) {
    return {
      headline: `${currentVersion} Current`,
      detail: "Watcher is up to date.",
      showUpdate: false,
      showCheck: true,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "dev_skipped") {
    return {
      headline: currentVersion,
      detail: "Update checks are skipped while running from source.",
      showUpdate: false,
      showCheck: true,
      updateUrl: "",
      canInstall: false,
    };
  }

  if (autoUpdate.status === "error" || release.phase === "error") {
    return {
      headline: currentVersion,
      detail:
        autoUpdate.error ||
        autoUpdate.message ||
        release.error ||
        "Could not check the latest watcher release.",
      showUpdate: false,
      showCheck: true,
      updateUrl: "",
      canInstall: false,
    };
  }

  return {
    headline: currentVersion,
    detail: autoUpdate.message || "Watcher update status will appear here.",
    showUpdate: false,
    showCheck: true,
    updateUrl: "",
    canInstall: false,
  };
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
  return Boolean(watchDirStatus.valid);
}

function getStreamCandidate() {
  return streamHandoff || runtimeState.activeUpload;
}

function getStreamCandidateLabel() {
  const candidate = getStreamCandidate();
  if (!candidate) {
    return "";
  }

  return (
    candidate.title ||
    candidate.streamTitle ||
    candidate.matchTitle ||
    candidate.fileName ||
    candidate.sessionKey ||
    candidate.streamSession ||
    ""
  );
}

function hasStreamCandidate() {
  const candidate = getStreamCandidate();
  return Boolean(
    candidate?.sessionKey ||
      candidate?.streamSession ||
      candidate?.fileName ||
      candidate?.filePath
  );
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function getStreamingBaseUrl() {
  return normalizeBaseUrl(currentConfig.apiFallbackBaseUrl) || "https://aoe2war.com";
}

function getNativeStreamMode() {
  return STREAM_MODES.find((mode) => mode.key === nativeStreamState.mode) || STREAM_MODES[0];
}

function describeNativeMode(mode = getNativeStreamMode()) {
  const bitrateMbps = mode.videoBitsPerSecond
    ? `${(mode.videoBitsPerSecond / 1000000).toFixed(1)} Mbps`
    : "auto bitrate";
  return `${mode.label} ${mode.detail} · ${bitrateMbps} · ${STREAM_CHUNK_TIMESLICE_MS / 1000}s chunks`;
}

function countStreamSources(sources = nativeStreamState.sources) {
  return sources.reduce(
    (counts, source) => {
      if (source.kind === "screen") {
        counts.screens += 1;
      } else {
        counts.windows += 1;
      }
      return counts;
    },
    { windows: 0, screens: 0 }
  );
}

function isMacPlatform() {
  return appInfo?.platform === "darwin";
}

function sourceKindLabel(source) {
  return source?.kind === "screen" ? "Display" : "Window";
}

function sourceOptionLabel(source) {
  return `${sourceKindLabel(source)} - ${source.name}`;
}

function describeSourceDetail(source, mode = getNativeStreamMode()) {
  if (!source) {
    return "Open AoE2HD, Steam, or CrossOver, then refresh.";
  }

  const base = `${sourceKindLabel(source)} · ${source.name}`;
  if (source.kind === "screen" && isMacPlatform()) {
    return `${base}. Go Live, then switch to AoE2 full-screen.`;
  }
  if (source.kind === "screen") {
    return `${base}. Use this when the game window is full-screen.`;
  }
  if (mode.preferredKind === "screen") {
    return `${base}. Full Screen mode works best with a Display source.`;
  }
  return base;
}

function pickNativeStreamSource(sources, selectedSourceId, mode = getNativeStreamMode()) {
  const selected = sources.find((source) => source.id === selectedSourceId) || null;

  if (mode.preferredKind === "screen" && selected?.kind !== "screen") {
    return sources.find((source) => source.kind === "screen") || selected || sources[0] || null;
  }

  return selected || sources[0] || null;
}

function chooseNativeRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "video/webm";
  }
  return STREAM_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "video/webm";
}

function buildNativeRecorderOptions(mode = getNativeStreamMode(), mediaMimeType = chooseNativeRecorderMimeType()) {
  return {
    mimeType: mediaMimeType,
    videoBitsPerSecond: mode.videoBitsPerSecond,
    videoKeyFrameIntervalDuration: STREAM_KEYFRAME_INTERVAL_MS,
  };
}

function buildNativeSessionKey() {
  const candidate = getStreamCandidate();
  const raw =
    candidate?.sessionKey ||
    candidate?.streamSession ||
    candidate?.fileName ||
    candidate?.filePath ||
    `watcher:${appInfo?.sessionId || Date.now()}`;
  return String(raw).trim().slice(0, 255);
}

function buildNativeStreamTitle() {
  return getStreamCandidateLabel() || "AoE2WAR watcher stream";
}

function updateNativeStreamState(patch = {}) {
  nativeStreamState = {
    ...nativeStreamState,
    ...patch,
  };
  renderNativeStreamState();
}

function setNativeReadout(readout, detail = "", options = {}) {
  updateNativeStreamState({
    readout,
    detail,
  });
  if (options.open && els.streamReadoutDetails) {
    els.streamReadoutDetails.open = true;
  }
}

function buildDesktopCaptureConstraints(sourceId, mode = getNativeStreamMode()) {
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        minWidth: Math.min(640, mode.width),
        maxWidth: mode.width,
        minHeight: Math.min(360, mode.height),
        maxHeight: mode.height,
        maxFrameRate: mode.frameRate,
      },
    },
  };
}

function describeCaptureStartError(error, source, mode) {
  const message = error?.message || String(error || "Capture failed.");
  const name = error?.name || "";
  if (/permission|denied|notallowed/i.test(`${name} ${message}`)) {
    return "macOS blocked capture. Allow screen recording for AoE2HDBets Watcher, then reopen it.";
  }
  if (source?.kind === "window" && mode.preferredKind !== "screen") {
    return "That window may disappear in full-screen play. Switch to Full Screen mode and try again.";
  }
  if (source?.kind === "screen") {
    return "Display capture could not open. Check macOS Screen Recording permission, then refresh sources.";
  }
  return message;
}

function captureNativeThumbnail() {
  const video = els.streamPreview;
  if (!video || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * canvas.width));
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.58);
}

async function streamJson(path, body = {}) {
  const result = await window.watcherApi.streamJson({
    baseUrl: getStreamingBaseUrl(),
    path,
    method: "POST",
    body,
  });

  if (!result?.ok) {
    throw new Error(result?.error || result?.data?.detail || "Streaming request failed.");
  }

  return result.data || {};
}

async function sendNativeStreamEvent(eventType, metadata = {}) {
  try {
    const mode = getNativeStreamMode();
    await streamJson("/api/streams/client-event", {
      eventType,
      appVersion: appInfo?.version || "",
      platform: appInfo?.platform || "watcher",
      watcherId: appInfo?.watcherId || "",
      sessionKey: buildNativeSessionKey(),
      streamId: nativeStreamState.stream?.id
        ? String(nativeStreamState.stream.id)
        : metadata.streamId
          ? String(metadata.streamId)
          : "",
      captureMode: nativeStreamState.mode,
      mediaMimeType: nativeStreamState.mediaMimeType,
      metadata: {
        title: buildNativeStreamTitle(),
        sourceName: nativeStreamState.sourceName,
        sourceKind: nativeStreamState.sourceKind,
        sourceType: "watcher_native",
        modeLabel: mode.label,
        modeDetail: mode.detail,
        videoBitrate: mode.videoBitsPerSecond || null,
        frameRate: mode.frameRate,
        chunkTimesliceMs: STREAM_CHUNK_TIMESLICE_MS,
        chunkCount: nativeStreamState.chunkCount,
        lastChunkBytes: nativeStreamState.lastChunkBytes,
        uploadFailures: nativeStreamState.uploadFailures,
        consecutiveUploadFailures: nativeStreamState.consecutiveUploadFailures,
        heartbeatFailures: nativeStreamState.heartbeatFailures,
        uploadQueueLength: nativeStreamState.uploadQueueLength,
        lastUploadLatencyMs: nativeStreamState.lastUploadLatencyMs,
        droppedChunks: nativeStreamState.droppedChunks,
        ...metadata,
      },
    });
  } catch {
    // Streaming telemetry should never block the user's local stream controls.
  }
}

async function refreshNativeStreamSources() {
  if (!window.watcherApi.listStreamSources) {
    setNativeReadout("Native source scan is unavailable in this build.", "", { open: true });
    return [];
  }

  updateNativeStreamState({
    busy: true,
    readout: "Scanning capture sources.",
    detail: "Looking for AoE2, CrossOver, Steam, and display capture.",
  });

  try {
    const result = await window.watcherApi.listStreamSources();
    if (!result?.ok) {
      throw new Error(result?.error || "Could not list capture sources.");
    }

    const sources = Array.isArray(result.sources) ? result.sources : [];
    const sourceCounts = countStreamSources(sources);
    const selectedSource = pickNativeStreamSource(
      sources,
      nativeStreamState.selectedSourceId,
      getNativeStreamMode()
    );
    const selected = selectedSource?.id || "";

    updateNativeStreamState({
      busy: false,
      sources,
      selectedSourceId: selected,
      sourceName: selectedSource?.name || "",
      sourceKind: selectedSource?.kind || "",
      readout: sources.length
        ? selectedSource?.kind === "screen" && isMacPlatform()
          ? "Display capture ready for full-screen AoE2."
          : `${sources.length} source${sources.length === 1 ? "" : "s"} ready.`
        : "No capture sources found.",
      detail: describeSourceDetail(selectedSource),
    });

    void sendNativeStreamEvent("stream_sources_listed", {
      sourceCount: sources.length,
      windowCount: sourceCounts.windows,
      screenCount: sourceCounts.screens,
      topSourceName: sources[0]?.name || null,
      selectedSourceName: selectedSource?.name || null,
      selectedSourceKind: selectedSource?.kind || null,
      selectedSourceDetail: describeSourceDetail(selectedSource),
    });

    return sources;
  } catch (error) {
    updateNativeStreamState({
      busy: false,
      readout: "Source scan failed.",
      detail: error.message || String(error),
    });
    void sendNativeStreamEvent("stream_error", {
      errorMessage: "Source scan failed.",
      detail: error.message || String(error),
    });
    if (els.streamReadoutDetails) {
      els.streamReadoutDetails.open = true;
    }
    return [];
  }
}

function stopNativeLocalCapture() {
  if (nativeStreamState.heartbeatTimer) {
    window.clearInterval(nativeStreamState.heartbeatTimer);
  }
  try {
    nativeStreamState.recorder?.stop();
  } catch {
    // Recorder may already be stopped.
  }
  nativeStreamState.mediaStream?.getTracks().forEach((track) => track.stop());
  if (els.streamPreview) {
    els.streamPreview.srcObject = null;
  }
}

async function endNativeStream(reason = "manual") {
  const activeStream = nativeStreamState.stream;
  const preserveIssue = reason !== "manual" && nativeStreamState.status === "error";
  nativeStreamState.manualStop = true;
  stopNativeLocalCapture();

  updateNativeStreamState({
    status: preserveIssue ? "error" : "idle",
    busy: false,
    mediaStream: null,
    recorder: null,
    stream: null,
    heartbeatTimer: null,
    startedAt: 0,
    lastHeartbeatAt: 0,
    uploadQueueLength: 0,
    consecutiveUploadFailures: 0,
    heartbeatFailures: 0,
    readout: preserveIssue
      ? nativeStreamState.readout
      : reason === "manual"
        ? "Stream ended."
        : "Stream stopped.",
    detail: preserveIssue ? nativeStreamState.detail : reason,
  });

  if (activeStream?.id) {
    try {
      await streamJson(`/api/streams/${activeStream.id}/end`, {});
    } catch (error) {
      setNativeReadout("Stream stopped locally; AoE2WAR end call failed.", error.message || String(error), {
        open: true,
      });
    }
  }

  void sendNativeStreamEvent("stream_stopped", {
    reason,
    streamId: activeStream?.id || null,
  });
}

async function uploadNativeChunk(streamId, sequence, blob) {
  if (!blob?.size) {
    return;
  }

  const uploadStartedAt = Date.now();
  const result = await window.watcherApi.streamChunk({
    baseUrl: getStreamingBaseUrl(),
    streamId,
    sequence,
    mimeType: blob.type || nativeStreamState.mediaMimeType,
    bytes: await blob.arrayBuffer(),
  });

  if (!result?.ok) {
    throw new Error(result?.error || result?.data?.detail || "Chunk upload failed.");
  }

  const uploadLatencyMs = Date.now() - uploadStartedAt;
  const nextStream = result.data?.stream || nativeStreamState.stream;
  const nextChunkCount = Math.max(nativeStreamState.chunkCount + 1, nextStream?.chunkCount || 0);
  updateNativeStreamState({
    stream: nextStream,
    chunkCount: nextChunkCount,
    lastChunkBytes: blob.size,
    consecutiveUploadFailures: 0,
    lastUploadLatencyMs: uploadLatencyMs,
    readout: `Live. Chunk ${sequence} published (${Math.round(blob.size / 1024)} KB).`,
    detail: `${nativeStreamState.sourceName || "Capture source"} · ${uploadLatencyMs} ms upload · queue ${nativeStreamState.uploadQueueLength}`,
  });

  if (sequence === 0 || sequence % 8 === 0) {
    void sendNativeStreamEvent("stream_chunk_uploaded", {
      streamId,
      sequence,
      blobSize: blob.size,
      chunkCount: nextChunkCount,
      uploadLatencyMs,
    });
  }
}

function queueNativeChunkUpload(streamId, sequence, blob) {
  if (!blob?.size) {
    return;
  }

  if (nativeStreamState.uploadQueueLength >= STREAM_MAX_UPLOAD_QUEUE) {
    updateNativeStreamState({
      droppedChunks: nativeStreamState.droppedChunks + 1,
      readout: "Network catching up. Skipping stale video slice.",
      detail: `${nativeStreamState.sourceName || "Capture source"} · queue ${nativeStreamState.uploadQueueLength}`,
    });
    void sendNativeStreamEvent("stream_chunk_dropped", {
      streamId,
      sequence,
      blobSize: blob.size,
      uploadQueueLength: nativeStreamState.uploadQueueLength,
      reason: "upload_queue_backpressure",
    });
    return;
  }

  updateNativeStreamState({
    uploadQueueLength: nativeStreamState.uploadQueueLength + 1,
  });

  nativeUploadChain = nativeUploadChain
    .catch(() => undefined)
    .then(async () => {
      if (
        nativeStreamState.manualStop ||
        nativeStreamState.status === "idle" ||
        nativeStreamState.stream?.id !== streamId
      ) {
        return;
      }

      try {
        await uploadNativeChunk(streamId, sequence, blob);
      } catch (error) {
        const failures = nativeStreamState.consecutiveUploadFailures + 1;
        updateNativeStreamState({
          uploadFailures: nativeStreamState.uploadFailures + 1,
          consecutiveUploadFailures: failures,
          readout: "Upload missed; retrying with the next slice.",
          detail: error.message || String(error),
        });
        void sendNativeStreamEvent("stream_chunk_failed", {
          streamId,
          sequence,
          blobSize: blob.size,
          consecutiveUploadFailures: failures,
          errorMessage: error.message || String(error),
        });
        if (failures >= 5) {
          handleNativeStreamError("Stream upload keeps failing.", error.message || String(error), {
            streamId,
            sequence,
            consecutiveUploadFailures: failures,
          });
        }
      } finally {
        updateNativeStreamState({
          uploadQueueLength: Math.max(0, nativeStreamState.uploadQueueLength - 1),
        });
      }
    });
}

async function sendNativeHeartbeat(streamId, status = "live") {
  const thumbnailUrl = captureNativeThumbnail();
  const data = await streamJson(`/api/streams/${streamId}/heartbeat`, {
    status,
    mediaMimeType: nativeStreamState.mediaMimeType,
    thumbnailUrl,
  });

  updateNativeStreamState({
    stream: data.stream || nativeStreamState.stream,
    lastHeartbeatAt: Date.now(),
    heartbeatFailures: 0,
    readout: "Heartbeat OK. Stream is visible on AoE2WAR.",
    detail: `${nativeStreamState.sourceName || "Watcher-native stream"} · ${nativeStreamState.chunkCount} chunks · queue ${nativeStreamState.uploadQueueLength}`,
  });

  void sendNativeStreamEvent("stream_heartbeat", {
    streamId,
    status,
    thumbnailUpdated: Boolean(thumbnailUrl),
    uploadQueueLength: nativeStreamState.uploadQueueLength,
  });
}

function handleNativeStreamError(message, detail = "", metadata = {}) {
  updateNativeStreamState({
    status: "error",
    busy: false,
    readout: message,
    detail,
  });
  if (els.streamReadoutDetails) {
    els.streamReadoutDetails.open = true;
  }
  void sendNativeStreamEvent("stream_error", {
    errorMessage: message,
    detail,
    ...metadata,
  });
}

async function startNativeStream() {
  if (nativeStreamState.busy || nativeStreamState.status === "live") {
    return;
  }

  const config = readForm();
  if (!config.uploadApiKey) {
    handleNativeStreamError("Pair profile before streaming.", "Watcher-native streaming uses your watcher key.");
    return;
  }

  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    handleNativeStreamError("Native streaming is unavailable in this build.", "MediaRecorder or desktop capture is missing.");
    return;
  }

  let sources = nativeStreamState.sources;
  if (sources.length === 0) {
    sources = await refreshNativeStreamSources();
  }

  const mode = getNativeStreamMode();
  const selectedSource = pickNativeStreamSource(sources, nativeStreamState.selectedSourceId, mode);
  if (!selectedSource) {
    handleNativeStreamError("No capture source found.", "Open AoE2HD, Steam, or CrossOver, then refresh sources.");
    return;
  }

  const mediaMimeType = chooseNativeRecorderMimeType();
  const streamStartedAt = Date.now();

  updateNativeStreamState({
    status: "starting",
    busy: true,
    selectedSourceId: selectedSource.id,
    sourceName: selectedSource.name,
    sourceKind: selectedSource.kind,
    mediaMimeType,
    readout:
      selectedSource.kind === "screen"
        ? "Opening display capture."
        : `Opening ${selectedSource.name}.`,
    detail:
      selectedSource.kind === "screen" && isMacPlatform()
        ? `${describeNativeMode(mode)}. Switch to AoE2 after the preview appears.`
        : describeNativeMode(mode),
  });

  try {
    void sendNativeStreamEvent("stream_capture_requested", {
      sourceId: selectedSource.id,
      sourceName: selectedSource.name,
      sourceKind: selectedSource.kind,
      mode: mode.key,
      modeLabel: mode.label,
      modeDetail: mode.detail,
      videoBitrate: mode.videoBitsPerSecond,
      chunkTimesliceMs: STREAM_CHUNK_TIMESLICE_MS,
    });

    const capture = await navigator.mediaDevices.getUserMedia(
      buildDesktopCaptureConstraints(selectedSource.id, mode)
    );
    nativeStreamState.mediaStream?.getTracks().forEach((track) => track.stop());
    if (els.streamPreview) {
      els.streamPreview.srcObject = capture;
      await els.streamPreview.play().catch(() => undefined);
    }

    capture.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (nativeStreamState.manualStop) {
          return;
        }
        const elapsedMs = Date.now() - streamStartedAt;
        handleNativeStreamError(
          elapsedMs < 15000
            ? selectedSource.kind === "screen"
              ? "Display capture stopped quickly."
              : "Capture stopped quickly. Try Full Screen."
            : "Capture source ended.",
          selectedSource.kind === "window"
            ? `${track.label || selectedSource.name}. Window capture can vanish when AoE2HD enters macOS full screen.`
            : `${track.label || selectedSource.name}. Check Screen Recording permission if this keeps happening.`,
          {
            elapsedMs,
            sourceName: selectedSource.name,
            sourceKind: selectedSource.kind,
            mode: mode.key,
          }
        );
        void sendNativeStreamEvent("stream_track_ended", {
          elapsedMs,
          sourceName: selectedSource.name,
          sourceKind: selectedSource.kind,
          mode: mode.key,
          trackLabel: track.label || null,
        });
        void endNativeStream("track_ended");
      });
    });

    updateNativeStreamState({
      mediaStream: capture,
      status: "preview",
      readout:
        selectedSource.kind === "screen" && isMacPlatform()
          ? "Display preview ready. Switch to AoE2."
          : "Preview ready.",
      detail: describeSourceDetail(selectedSource, mode),
    });
    const trackSettings = capture.getVideoTracks()[0]?.getSettings?.() || {};
    void sendNativeStreamEvent("stream_preview_started", {
      sourceName: selectedSource.name,
      sourceKind: selectedSource.kind,
      trackCount: capture.getTracks().length,
      videoTrackLabels: capture.getVideoTracks().map((track) => track.label).filter(Boolean),
      captureWidth: trackSettings.width || null,
      captureHeight: trackSettings.height || null,
      captureFrameRate: trackSettings.frameRate || null,
    });
    void sendNativeStreamEvent("stream_source_ready", {
      sourceName: selectedSource.name,
      sourceKind: selectedSource.kind,
      mode: mode.key,
      captureWidth: trackSettings.width || null,
      captureHeight: trackSettings.height || null,
      captureFrameRate: trackSettings.frameRate || null,
    });

    const streamData = await streamJson("/api/streams/start", {
      sessionKey: buildNativeSessionKey(),
      title: buildNativeStreamTitle(),
      label: "Watcher Stream",
      playerLabel: "Watcher",
      sourceType: "watcher_native",
      mediaMimeType,
      thumbnailUrl: captureNativeThumbnail(),
    });

    const stream = streamData.stream;
    if (!stream?.id) {
      throw new Error("AoE2WAR did not return a stream id.");
    }

    nativeStreamState.manualStop = false;
    nativeStreamState.sequence = 0;
    nativeStreamState.chunkCount = 0;
    nativeStreamState.lastChunkBytes = 0;
    nativeStreamState.uploadFailures = 0;
    nativeStreamState.consecutiveUploadFailures = 0;
    nativeStreamState.heartbeatFailures = 0;
    nativeStreamState.uploadQueueLength = 0;
    nativeStreamState.lastUploadLatencyMs = 0;
    nativeStreamState.droppedChunks = 0;
    nativeUploadChain = Promise.resolve();

    const recorder = new MediaRecorder(capture, buildNativeRecorderOptions(mode, mediaMimeType));
    recorder.ondataavailable = (event) => {
      const sequence = nativeStreamState.sequence;
      nativeStreamState.sequence += 1;
      queueNativeChunkUpload(stream.id, sequence, event.data);
    };
    recorder.onerror = (event) => {
      const mediaError = event.error;
      void sendNativeStreamEvent("stream_recorder_error", {
        streamId: stream.id,
        errorMessage: mediaError?.message || "Recorder error.",
        errorName: mediaError?.name || "MediaRecorder",
      });
      handleNativeStreamError(
        mediaError?.message || "Recorder error.",
        mediaError?.name || "MediaRecorder",
        {
          streamId: stream.id,
        }
      );
    };
    recorder.onstop = () => {
      if (!nativeStreamState.manualStop && Date.now() - streamStartedAt < 15000) {
        handleNativeStreamError(
          selectedSource.kind === "screen"
            ? "Recorder stopped quickly on display capture."
            : "Recorder stopped quickly. Try Full Screen.",
          describeSourceDetail(selectedSource, mode),
          {
            streamId: stream.id,
            elapsedMs: Date.now() - streamStartedAt,
            sourceKind: selectedSource.kind,
            mode: mode.key,
          }
        );
      }
    };
    recorder.start(STREAM_CHUNK_TIMESLICE_MS);

    const heartbeatTimer = window.setInterval(() => {
      void sendNativeHeartbeat(stream.id, "live").catch((error) => {
        const failures = nativeStreamState.heartbeatFailures + 1;
        updateNativeStreamState({
          heartbeatFailures: failures,
          readout: failures >= 3 ? "Heartbeat retrying. Stream chunks may still be live." : "Heartbeat retrying.",
          detail: error.message || String(error),
        });
        void sendNativeStreamEvent("stream_heartbeat_failed", {
          streamId: stream.id,
          errorMessage: error.message || String(error),
          chunkCount: nativeStreamState.chunkCount,
          heartbeatFailures: failures,
        });
      });
    }, STREAM_HEARTBEAT_MS);

    updateNativeStreamState({
      status: "live",
      busy: false,
      recorder,
      stream,
      heartbeatTimer,
      startedAt: streamStartedAt,
      readout:
        selectedSource.kind === "screen" && isMacPlatform()
          ? "Live. Switch to AoE2 full-screen."
          : "Live. First chunks are publishing now.",
      detail: `${describeSourceDetail(selectedSource, mode)} · ${describeNativeMode(mode)}`,
    });

    await sendNativeHeartbeat(stream.id, "live");
    void sendNativeStreamEvent("stream_started", {
      streamId: stream.id,
      sourceName: selectedSource.name,
      sourceKind: selectedSource.kind,
      mode: mode.key,
      modeLabel: mode.label,
      videoBitrate: mode.videoBitsPerSecond,
      chunkTimesliceMs: STREAM_CHUNK_TIMESLICE_MS,
      captureGuidance: describeSourceDetail(selectedSource, mode),
    });
    setStatus("Watcher stream is live.", "success");
  } catch (error) {
    stopNativeLocalCapture();
    handleNativeStreamError("Could not start watcher stream.", describeCaptureStartError(error, selectedSource, mode), {
      sourceName: selectedSource.name,
      sourceKind: selectedSource.kind,
      mode: mode.key,
      rawError: error.message || String(error),
    });
  }
}

function syncStreamCandidateFromRuntimeEvent(event) {
  if (!event || typeof event !== "object") {
    return;
  }

  if (STREAM_HANDOFF_CLEAR_EVENTS.has(event.type)) {
    streamHandoff = null;
    return;
  }

  if (!STREAM_HANDOFF_RUNTIME_EVENTS.has(event.type) || event.isFinal === true) {
    return;
  }

  if (event.sessionKey || event.streamSession || event.fileName || event.filePath) {
    streamHandoff = {
      ...streamHandoff,
      ...event,
      updatedAt: new Date().toISOString(),
    };
  }
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
      detail: "Click Pair Profile, then choose the replay folder if needed.",
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
      detail: "Click Pair Profile to connect this watcher to your AoE2WAR account.",
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
    detail: "Ready. Start watching, or batch upload saved replays.",
    kind: "success",
  };
}

function getSetupSummaryText() {
  if (hasStreamCandidate()) {
    const label = getStreamCandidateLabel();
    return label ? `Stream is ready for ${label}.` : "Stream is ready.";
  }

  if (!hasWatcherKey() && !isReplayFolderReady()) {
    return "Pair profile. Choose folder. Start watching."; 
  }

  if (!isReplayFolderReady()) {
    return "Profile paired. Choose the SaveGame folder."; 
  }

  if (!hasWatcherKey()) {
    return "Folder ready. Pair profile."; 
  }

  if (importState.isRunning) {
    return "Import running. Watching can stay armed.";
  }

  return "Ready. Start watching or import replays."; 
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
  els.keyReadyText.textContent = keyReady ? "Profile paired" : "Not paired";
  els.keyHintText.textContent = keyReady
    ? "Manual recovery in Advanced."
    : "Pair Profile or paste manually."; 

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
  const releaseStatus = getReleaseStatus();

  els.heroAppVersionText.textContent = releaseStatus.headline;
  els.heroVersionStatusText.textContent = releaseStatus.detail;
  els.heroUpdateWatcherBtn.hidden = !releaseStatus.showUpdate;
  els.heroUpdateWatcherBtn.disabled = !releaseStatus.showUpdate;
  els.heroCheckVersionBtn.hidden = !releaseStatus.showCheck;
  els.heroCheckVersionBtn.disabled = appInfo?.release?.phase === "checking";
  els.heroPlatformText.textContent = formatPlatform(appInfo?.platform);
  els.appVersionText.textContent = releaseStatus.headline;
  els.diagnosticsVersionStatusText.textContent = releaseStatus.detail;
  els.diagnosticsUpdateWatcherBtn.hidden = !releaseStatus.showUpdate;
  els.diagnosticsUpdateWatcherBtn.disabled = !releaseStatus.showUpdate;
  els.diagnosticsCheckVersionBtn.hidden = !releaseStatus.showCheck;
  els.diagnosticsCheckVersionBtn.disabled = appInfo?.release?.phase === "checking";
  els.platformText.textContent = formatPlatform(appInfo?.platform);
  els.protocolStatusText.textContent = appInfo?.protocolRegistered
    ? "Browser handoff ready"
    : "Manual key fallback ready";
  els.protocolDetailText.textContent = appInfo?.protocolRegistered
    ? "Profile Pairing can hand off automatically."
    : "Manual paste is available in Advanced."; 
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
    title: "Batch upload",
    detail: "Upload saved replays from your SaveGame folder while live watching stays available.",
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
  if (els.streamMatchBtn) {
    els.streamMatchBtn.disabled =
      nativeStreamState.busy || nativeStreamState.status === "live" || !hasWatcherKey();
  }
  if (els.openBrowserStreamBtn) {
    els.openBrowserStreamBtn.disabled = !hasStreamCandidate();
  }
  if (els.refreshStreamSourcesBtn) {
    els.refreshStreamSourcesBtn.disabled = nativeStreamState.busy || nativeStreamState.status === "live";
  }
  if (els.startNativeStreamBtn) {
    els.startNativeStreamBtn.disabled =
      nativeStreamState.busy || nativeStreamState.status === "live" || !hasWatcherKey();
  }
  if (els.stopNativeStreamBtn) {
    els.stopNativeStreamBtn.disabled = nativeStreamState.status !== "live" && nativeStreamState.status !== "starting";
  }
}

function renderNativeStreamState() {
  const candidateLabel = getStreamCandidateLabel();
  const isLive = nativeStreamState.status === "live";
  const isStarting = nativeStreamState.status === "starting" || nativeStreamState.status === "preview";
  const sourceSelect = els.streamSourceSelect;

  if (els.streamTitleText) {
    els.streamTitleText.textContent = candidateLabel || "Free watcher stream";
  }

  if (els.streamStatePill) {
    els.streamStatePill.textContent = isLive ? "Live" : isStarting ? "Starting" : nativeStreamState.status === "error" ? "Issue" : "Idle";
    els.streamStatePill.className = `badge ${
      isLive ? "stream-live" : isStarting ? "stream-warm" : nativeStreamState.status === "error" ? "failed" : "neutral"
    }`;
  }

  if (sourceSelect) {
    const currentValue = sourceSelect.value;
    sourceSelect.innerHTML = "";
    for (const source of nativeStreamState.sources) {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = sourceOptionLabel(source);
      sourceSelect.appendChild(option);
    }
    const desired = nativeStreamState.selectedSourceId || currentValue;
    if (desired && nativeStreamState.sources.some((source) => source.id === desired)) {
      sourceSelect.value = desired;
    }
    sourceSelect.disabled = nativeStreamState.busy || isLive || nativeStreamState.sources.length === 0;
  }

  document.querySelectorAll("[data-stream-mode]").forEach((button) => {
    const selected = button.getAttribute("data-stream-mode") === nativeStreamState.mode;
    button.classList.toggle("selected", selected);
    button.disabled = nativeStreamState.busy || isLive;
  });

  if (els.streamPreview) {
    els.streamPreview.hidden = !nativeStreamState.mediaStream;
    if (nativeStreamState.mediaStream && els.streamPreview.srcObject !== nativeStreamState.mediaStream) {
      els.streamPreview.srcObject = nativeStreamState.mediaStream;
    }
  }

  if (els.streamPreviewEmpty) {
    els.streamPreviewEmpty.hidden = Boolean(nativeStreamState.mediaStream);
    els.streamPreviewEmpty.textContent = nativeStreamState.sources.length
      ? nativeStreamState.sourceKind === "screen"
        ? "Display ready"
        : nativeStreamState.sourceName || "Source ready"
      : "Refresh sources";
  }

  if (els.streamReadoutSummary) {
    els.streamReadoutSummary.textContent = nativeStreamState.readout || "Idle.";
  }

  if (els.streamReadoutDetail) {
    const mode = getNativeStreamMode();
    els.streamReadoutDetail.textContent =
      nativeStreamState.detail ||
      `${mode.label} ${mode.detail}. ${nativeStreamState.mediaMimeType}.`;
  }

  renderButtons();
}

function polishStaticUiCopy() {
  if (els.scanImportBtn) {
    els.scanImportBtn.textContent = "Batch Upload Replays";
  }

  if (els.streamMatchBtn) {
    els.streamMatchBtn.textContent = "Start Stream";
  }

  if (els.openBrowserStreamBtn) {
    els.openBrowserStreamBtn.textContent = "Browser Stream";
  }

  if (els.retryFailedBtn) {
    els.retryFailedBtn.textContent = "Retry Failed";
  }

  if (els.saveSettingsBtn) {
    els.saveSettingsBtn.textContent = "Save";
  }

  if (els.heroCheckVersionBtn) {
    els.heroCheckVersionBtn.textContent = "Check Update";
  }

  if (els.diagnosticsCheckVersionBtn) {
    els.diagnosticsCheckVersionBtn.textContent = "Check Update";
  }

  if (els.heroUpdateWatcherBtn) {
    els.heroUpdateWatcherBtn.textContent =
      getReleaseStatus().canInstall ? "Install Update" : "Download Update";
  }

  if (els.diagnosticsUpdateWatcherBtn) {
    els.diagnosticsUpdateWatcherBtn.textContent =
      getReleaseStatus().canInstall ? "Install Update" : "Download Update";
  }
}

function renderAll() {
  polishStaticUiCopy();
  renderReadiness();
  renderStatusBar();
  renderDiagnostics();
  renderImportState();
  renderButtons();
  renderNativeStreamState();
}

async function validateWatchDir(targetPath = readForm().watchDir) {
  const token = ++validateWatchDirToken;

  if (!targetPath) {
    watchDirStatus = {
      exists: false,
      isDirectory: false,
      valid: false,
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

async function checkLatestRelease({ silent = false } = {}) {
  try {
    if (!silent) {
      setStatus("Checking latest watcher release...", "neutral");
    }

    const release = await window.watcherApi.checkRelease();
    appInfo = {
      ...appInfo,
      release,
    };
    renderAll();

    if (!silent) {
      setStatus(
        release?.updateAvailable
          ? `Watcher ${release.latestVersion} is available.`
          : `Watcher ${appInfo?.version || release?.currentVersion || ""} is current.`,
        release?.updateAvailable ? "warn" : "success"
      );
    }

    return release;
  } catch (error) {
    setStatus(`Failed checking watcher release: ${error.message || error}`, "error", {
      sticky: true,
    });
    return null;
  }
}

async function checkWatcherUpdate({ silent = false } = {}) {
  try {
    if (!silent) {
      setStatus("Checking watcher update...", "neutral");
    }

    const update = await window.watcherApi.checkUpdate();
    updateState = {
      ...updateState,
      ...(update || {}),
    };
    appInfo = {
      ...appInfo,
      update: updateState,
      autoUpdate: updateState,
    };
    renderAll();

    if (!silent) {
      const status = getReleaseStatus();
      setStatus(status.detail || "Watcher update check finished.", status.canInstall ? "warn" : "success");
    }

    return update;
  } catch (error) {
    setStatus(`Failed checking watcher update: ${error.message || error}`, "error", {
      sticky: true,
    });

    return checkLatestRelease({ silent: true });
  }
}

async function openWatcherUpdate() {
  const releaseStatus = getReleaseStatus();

  try {
    if (releaseStatus.canInstall && window.watcherApi.installUpdate) {
      const result = await window.watcherApi.installUpdate();

      if (result?.manualRequired) {
        await window.watcherApi.openUpdate(result.updateUrl);
        setStatus("Opened watcher update download.", "warn");
        return;
      }

      if (result?.deferred) {
        setStatus("Update is ready. It will install when the watcher closes safely.", "warn");
        return;
      }

      if (result?.ok) {
        setStatus("Installing watcher update.", "success");
        return;
      }
    }

    await window.watcherApi.openUpdate(releaseStatus.updateUrl);
    setStatus("Opened watcher update download.", "success");
  } catch (error) {
    setStatus(`Failed opening/installing update: ${error.message || error}`, "error", {
      sticky: true,
    });
  }
}

function buildSupportSnapshot() {
  const primaryStatus = getPrimaryStatus();
  const config = readForm();
  const releaseStatus = getReleaseStatus();

  return [
    `Product: ${appInfo?.productName || "AoE2HDBets Watcher"}`,
    `Version: ${appInfo?.version || "Unknown"}`,
    `Watcher ID: ${appInfo?.watcherId || "Unknown"}`,
    `Session ID: ${appInfo?.sessionId || "Unknown"}`,
    `Finality contract: v${appInfo?.finalityContractVersion || "1"}`,
    `Watcher update status: ${releaseStatus.headline}`,
    `Watcher update detail: ${releaseStatus.detail}`,
    `Auto-update status: ${updateState.status || "unknown"}`,
    `Auto-update detail: ${updateState.message || updateState.error || "none"}`,
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
    `Stream handoff: ${hasStreamCandidate() ? getStreamCandidateLabel() || "ready" : "none"}`,
    `Batch upload phase: ${importState.phase || "idle"}`,
    `Batch upload summary: ${importState.summaryText || "none"}`,
  ].join("\n");
}

function consumeRuntimeEvent(event) {
  syncStreamCandidateFromRuntimeEvent(event);

  switch (event.type) {
    case "watching-started":
    case "watcher-ready":
      runtimeState.phase = "watching";
      runtimeState.detail = event.latestReplayBasename
        ? `Connected · Watching. Latest replay: ${event.latestReplayBasename}.`
        : "Connected · Watching. Folder valid · No replay changes observed.";
      runtimeState.activeUpload = null;
      break;
    case "midgame-replay-recovered":
      runtimeState.phase = "watching";
      runtimeState.detail = `Current game detected after monitor attach: ${event.fileName}.`;
      break;
    case "monitor-start":
      runtimeState.phase = "watching";
      runtimeState.detail = `${event.fileName} is being monitored. Waiting for parseable replay bytes.`;
      runtimeState.activeUpload = event;
      break;
    case "replay-detected":
      runtimeState.phase = "watching";
      runtimeState.detail = `${event.fileName} detected. Waiting for upload timing.`;
      break;
    case "waiting-for-minimum-size":
    case "file-size-progress":
      runtimeState.phase = "watching";
      runtimeState.activeUpload = event;
      runtimeState.detail = `${event.fileName} is still being written (${Math.max(
        0,
        event.fileSizeBytes || 0
      ).toLocaleString()} bytes).`;
      break;
    case "final-candidate-ready":
      runtimeState.phase = "uploading";
      runtimeState.activeUpload = event;
      runtimeState.detail = `${event.fileName} looks quiet and stable. Sending final candidate.`;
      break;
    case "final-candidate-deferred":
      runtimeState.phase = "watching";
      runtimeState.activeUpload = event;
      runtimeState.detail = `Holding ${event.fileName} open until the replay is safer to finalize${
        event.waitMs ? ` (${Math.max(1, Math.round(event.waitMs / 1000))}s)` : ""
      }.`;
      break;
    case "final-candidate-accepted":
      runtimeState.phase = "watching";
      runtimeState.activeUpload = null;
      runtimeState.lastUploadSuccess = `${event.fileName} accepted as final.`;
      runtimeState.detail = `${event.fileName} is final and settlement-safe.`;
      break;
    case "final-candidate-reopened":
      runtimeState.phase = "watching";
      runtimeState.activeUpload = event;
      runtimeState.detail = `${event.fileName} grew after a final upload. Reopening the live monitor.`;
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
    case "monitor-stop":
      runtimeState.activeUpload = null;
      runtimeState.detail = watcherState.isWatching
        ? "Watching for new replays."
        : "Watcher stopped. Start again before the next set.";
      runtimeState.phase = watcherState.isWatching ? "watching" : "idle";
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
  updateState = info?.autoUpdate || info?.update || updateState;
  writeForm(currentConfig);
  watchDirStatus = info?.watchDirStatus || watchDirStatus;
  renderAll();
  await validateWatchDir(currentConfig.watchDir);
  if (window.watcherApi.listStreamSources) {
    refreshNativeStreamSources().catch(() => {});
  }
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

els.heroUpdateWatcherBtn.addEventListener("click", openWatcherUpdate);
els.diagnosticsUpdateWatcherBtn.addEventListener("click", openWatcherUpdate);
els.heroCheckVersionBtn.addEventListener("click", () => checkWatcherUpdate());
els.diagnosticsCheckVersionBtn.addEventListener("click", () => checkWatcherUpdate());

if (els.streamMatchBtn) {
  els.streamMatchBtn.addEventListener("click", async () => {
    await startNativeStream();
  });
}

if (els.openBrowserStreamBtn) {
  els.openBrowserStreamBtn.addEventListener("click", async () => {
    try {
      const result = await window.watcherApi.openStreamHandoff(getStreamCandidate() || {});
      if (!result.ok) {
        setStatus(result.error || "No watcher match is ready to stream yet.", "warn");
        return;
      }

      streamHandoff = result.handoff || streamHandoff;
      renderAll();
      setStatus("Opening AoE2WAR stream studio.", "success");
    } catch (error) {
      setStatus(`Failed opening stream studio: ${error.message || error}`, "error", {
        sticky: true,
      });
    }
  });
}

if (els.refreshStreamSourcesBtn) {
  els.refreshStreamSourcesBtn.addEventListener("click", () => {
    refreshNativeStreamSources().catch(() => {});
  });
}

if (els.startNativeStreamBtn) {
  els.startNativeStreamBtn.addEventListener("click", () => {
    startNativeStream().catch((error) => {
      handleNativeStreamError("Could not start watcher stream.", error.message || String(error));
    });
  });
}

if (els.stopNativeStreamBtn) {
  els.stopNativeStreamBtn.addEventListener("click", () => {
    endNativeStream("manual").catch((error) => {
      handleNativeStreamError("Could not stop watcher stream.", error.message || String(error));
    });
  });
}

if (els.streamSourceSelect) {
  els.streamSourceSelect.addEventListener("change", () => {
    const selectedSource = nativeStreamState.sources.find(
      (source) => source.id === els.streamSourceSelect.value
    );
    updateNativeStreamState({
      selectedSourceId: els.streamSourceSelect.value,
      sourceName: selectedSource?.name || "",
      sourceKind: selectedSource?.kind || "",
      readout: selectedSource
        ? selectedSource.kind === "screen" && isMacPlatform()
          ? "Display selected for full-screen AoE2."
          : `Source selected: ${selectedSource.name}.`
        : "Source selected.",
      detail: describeSourceDetail(selectedSource),
    });
  });
}

document.querySelectorAll("[data-stream-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.getAttribute("data-stream-mode") || "stable";
    const nextMode = STREAM_MODES.find((entry) => entry.key === mode) || STREAM_MODES[0];
    const preferredSource = pickNativeStreamSource(
      nativeStreamState.sources,
      nativeStreamState.selectedSourceId,
      nextMode
    );
    updateNativeStreamState({
      mode,
      selectedSourceId: preferredSource?.id || nativeStreamState.selectedSourceId,
      sourceName: preferredSource?.name || nativeStreamState.sourceName,
      sourceKind: preferredSource?.kind || nativeStreamState.sourceKind,
      readout: `${nextMode.label} mode selected.`,
      detail: preferredSource
        ? `${describeNativeMode(nextMode)} · ${describeSourceDetail(preferredSource, nextMode)}`
        : describeNativeMode(nextMode),
    });
  });
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

    if (!folderStatus.valid) {
      setStatus(
        folderStatus.kind === "de"
          ? "That is an AoE2 DE folder. Choose the AoE2 HD SaveGame folder."
          : "Replay folder is missing, unreadable, or not an AoE2 HD SaveGame folder.",
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
        "Pair Profile first. Manual key paste is available in Advanced if needed.",
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
      setStatus("Watcher did not start. Check pairing and replay folder.", "error", {
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
  if (
    info?.platform === "darwin" &&
    nativeStreamState.status === "idle" &&
    nativeStreamState.mode === "stable"
  ) {
    updateNativeStreamState({
      mode: "screen",
      readout: "Full Screen mode ready for macOS.",
      detail: "Use Display capture, go live, then switch to AoE2.",
    });
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

if (window.watcherApi.onStreamHandoff) {
  window.watcherApi.onStreamHandoff((handoff) => {
    streamHandoff = handoff || null;
    renderAll();
  });
}

window.watcherApi.onImportState((state) => {
  importState = {
    ...EMPTY_IMPORT_STATE,
    ...state,
  };
  renderAll();
});

if (window.watcherApi.onUpdateState) {
  window.watcherApi.onUpdateState((state) => {
    updateState = {
      ...updateState,
      ...(state || {}),
    };
    appInfo = {
      ...appInfo,
      update: updateState,
      autoUpdate: updateState,
    };
    renderAll();
  });
}

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
