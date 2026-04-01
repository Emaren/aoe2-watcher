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
  folderReadyText: document.getElementById("folderReadyText"),
  keyReadyText: document.getElementById("keyReadyText"),
  setupSummaryText: document.getElementById("setupSummaryText"),
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

function setSetupState(el, readyLabel, missingLabel, isReady) {
  if (!el) return;
  el.textContent = isReady ? readyLabel : missingLabel;
  el.classList.toggle("ready", isReady);
  el.classList.toggle("missing", !isReady);
}

function updateSetupSummary(config = readForm()) {
  const hasFolder = Boolean(config.watchDir);
  const hasKey = Boolean(config.uploadApiKey);

  setSetupState(els.folderReadyText, "Ready", "Needs folder", hasFolder);
  setSetupState(els.keyReadyText, "Saved", "Paste once", hasKey);

  if (hasFolder && hasKey) {
    els.setupSummaryText.textContent =
      "This Mac is ready. Press Start Watching and leave the watcher open while you play.";
    return;
  }

  if (hasFolder) {
    els.setupSummaryText.textContent =
      "Replay folder looks good. Paste your watcher key once, then this Mac is basically one-click.";
    return;
  }

  if (hasKey) {
    els.setupSummaryText.textContent =
      "Watcher key is saved. Confirm the replay folder next, then Start Watching.";
    return;
  }

  els.setupSummaryText.textContent =
    "One-time setup: mint a watcher key on your profile, confirm the replay folder, then future launches are easy.";
}

function setLoadedStatus(config, { autoDetectedFolder = false } = {}) {
  const hasFolder = Boolean(config.watchDir);
  const hasKey = Boolean(config.uploadApiKey);

  if (hasFolder && hasKey) {
    setStatus("Ready. Start the watcher and leave it open while you play.", "success");
    return;
  }

  if (autoDetectedFolder && !hasKey) {
    setStatus("Replay folder auto-detected. Paste your watcher key once, then press Start Watching.");
    return;
  }

  if (hasFolder && !hasKey) {
    setStatus("Replay folder loaded. Paste your watcher key once, then press Start Watching.");
    return;
  }

  if (!hasFolder && hasKey) {
    setStatus("Watcher key loaded. Confirm the replay folder before starting.");
    return;
  }

  setStatus("Use Auto-Detect Folder, paste your watcher key once, and this Mac is ready.");
}

async function loadInitialConfig() {
  const config = await window.watcherApi.getConfig();
  currentConfig = config;
  writeForm(config);
  updateSetupSummary(config);
  setLoadedStatus(config);
}

els.saveSettingsBtn.addEventListener("click", async () => {
  try {
    const config = readForm();
    const saved = await window.watcherApi.saveConfig(config);
    currentConfig = saved;
    writeForm(saved);
    updateSetupSummary(saved);
    setStatus(
      saved.uploadApiKey
        ? "Settings saved locally on this Mac."
        : "Settings saved. Paste your watcher key once and you are set.",
      "success"
    );
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
    updateSetupSummary();
    setStatus("Replay folder auto-detected.", "success");
  } catch (error) {
    setStatus(`Failed detecting replay folder: ${error.message || error}`, "error");
  }
});

els.startWatchingBtn.addEventListener("click", async () => {
  try {
    const config = readForm();

    if (!config.watchDir) {
      setStatus("Replay folder is required. Use Auto-Detect Folder or paste the SaveGame path.", "error");
      return;
    }

    if (!config.apiBaseUrl) {
      setStatus("Upload host is missing. Expand Advanced only if you changed it.", "error");
      return;
    }

    if (!config.uploadApiKey) {
      setStatus(
        "Watcher key required. Open aoe2hdbets.com/profile, mint one, paste it once, then start watching.",
        "error"
      );
      return;
    }

    const result = await window.watcherApi.startWatching(config);

    if (result.ok) {
      currentConfig = result.config;
      writeForm(result.config);
      updateSetupSummary(result.config);
      setStatus("Watcher live. Leave this open while you play.", "success");
      setWatchingText(true);
    } else {
      setStatus("Watcher did not start. Check the replay folder and watcher key.", "error");
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
    setStatus("Watcher stopped. Press Start Watching when your next set begins.", "success");
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

for (const input of [els.watchDirInput, els.uploadApiKeyInput]) {
  input.addEventListener("input", () => updateSetupSummary());
}

window.watcherApi.onConfig((config) => {
  currentConfig = config;
  writeForm(config);
  updateSetupSummary(config);
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

window.watcherApi.onClearLog(() => {
  clearLog();
});

loadInitialConfig().catch((error) => {
  setStatus(`Failed loading initial config: ${error.message || error}`, "error");
});
