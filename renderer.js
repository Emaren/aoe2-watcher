const els = {
  watchDirInput: document.getElementById("watchDirInput"),
  apiBaseUrlInput: document.getElementById("apiBaseUrlInput"),
  apiFallbackBaseUrlInput: document.getElementById("apiFallbackBaseUrlInput"),
  uploadApiKeyInput: document.getElementById("uploadApiKeyInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  detectFolderBtn: document.getElementById("detectFolderBtn"),
  startWatchingBtn: document.getElementById("startWatchingBtn"),
  stopWatchingBtn: document.getElementById("stopWatchingBtn"),
  openFolderBtn: document.getElementById("openFolderBtn"),
  watcherStateText: document.getElementById("watcherStateText"),
  statusBar: document.getElementById("statusBar"),
  log: document.getElementById("log"),
};

let currentConfig = {
  watchDir: "",
  apiBaseUrl: "https://api-prodn.aoe2hdbets.com",
  apiFallbackBaseUrl: "https://aoe2hdbets.com",
  uploadApiKey: "",
  autoStartWatching: true,
};

function setStatus(message, kind = "neutral") {
  els.statusBar.textContent = message;
  els.statusBar.className = "status-bar";

  if (kind === "error") {
    els.statusBar.classList.add("error");
  } else if (kind === "success") {
    els.statusBar.classList.add("success");
  }
}

function addLog(line, level = "info") {
  const row = document.createElement("div");
  row.className = `log-line${level === "warn" ? " warn" : level === "error" ? " error" : ""}`;
  row.textContent = line;
  els.log.prepend(row);
}

function readForm() {
  return {
    watchDir: els.watchDirInput.value.trim(),
    apiBaseUrl: els.apiBaseUrlInput.value.trim(),
    apiFallbackBaseUrl: els.apiFallbackBaseUrlInput.value.trim(),
    uploadApiKey: els.uploadApiKeyInput.value.trim(),
    autoStartWatching: true,
  };
}

function writeForm(config) {
  els.watchDirInput.value = config.watchDir || "";
  els.apiBaseUrlInput.value = config.apiBaseUrl || "";
  els.apiFallbackBaseUrlInput.value = config.apiFallbackBaseUrl || "";
  els.uploadApiKeyInput.value = config.uploadApiKey || "";
}

function setWatchingText(isWatching) {
  els.watcherStateText.textContent = isWatching ? "Watching" : "Idle";
}

async function loadInitialConfig() {
  const config = await window.watcherApi.getConfig();
  currentConfig = config;
  writeForm(config);
  setStatus("Settings loaded.", "success");
}

els.saveSettingsBtn.addEventListener("click", async () => {
  try {
    const config = readForm();
    const saved = await window.watcherApi.saveConfig(config);
    currentConfig = saved;
    writeForm(saved);
    setStatus("Settings saved locally on this Mac.", "success");
  } catch (error) {
    setStatus(`Failed saving settings: ${error.message || error}`, "error");
  }
});

els.detectFolderBtn.addEventListener("click", async () => {
  try {
    const replayDir = await window.watcherApi.getDefaultReplayDir();
    if (!replayDir) {
      setStatus("No replay folder was auto-detected.", "error");
      return;
    }

    els.watchDirInput.value = replayDir;
    setStatus("Replay folder auto-detected.", "success");
  } catch (error) {
    setStatus(`Failed detecting replay folder: ${error.message || error}`, "error");
  }
});

els.startWatchingBtn.addEventListener("click", async () => {
  try {
    const config = readForm();

    if (!config.watchDir) {
      setStatus("Replay folder is required.", "error");
      return;
    }

    if (!config.apiBaseUrl) {
      setStatus("API base URL is required.", "error");
      return;
    }

    if (!config.uploadApiKey) {
      setStatus("Upload API key is required.", "error");
      return;
    }

    const result = await window.watcherApi.startWatching(config);

    if (result.ok) {
      currentConfig = result.config;
      writeForm(result.config);
      setStatus("Watcher started successfully.", "success");
      setWatchingText(true);
    } else {
      setStatus("Watcher did not start. Check settings and try again.", "error");
      setWatchingText(false);
    }
  } catch (error) {
    setStatus(`Failed starting watcher: ${error.message || error}`, "error");
    setWatchingText(false);
  }
});

els.stopWatchingBtn.addEventListener("click", async () => {
  try {
    await window.watcherApi.stopWatching();
    setStatus("Watcher stopped.", "success");
    setWatchingText(false);
  } catch (error) {
    setStatus(`Failed stopping watcher: ${error.message || error}`, "error");
  }
});

els.openFolderBtn.addEventListener("click", async () => {
  try {
    const targetPath = els.watchDirInput.value.trim();
    if (!targetPath) {
      setStatus("Replay folder is empty.", "error");
      return;
    }

    const result = await window.watcherApi.openFolder(targetPath);
    if (!result.ok) {
      throw new Error(result.error || "Failed opening folder.");
    }

    setStatus("Opened replay folder.", "success");
  } catch (error) {
    setStatus(`Failed opening replay folder: ${error.message || error}`, "error");
  }
});

window.watcherApi.onConfig((config) => {
  currentConfig = config;
  writeForm(config);
});

window.watcherApi.onState(({ isWatching }) => {
  setWatchingText(isWatching);
});

window.watcherApi.onLog(({ line, level }) => {
  addLog(line, level);

  if (level === "error") {
    setStatus(line, "error");
  }
});

loadInitialConfig().catch((error) => {
  setStatus(`Failed loading initial config: ${error.message || error}`, "error");
});