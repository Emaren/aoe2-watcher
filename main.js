require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const { getDefaultReplayDir, startWatching, stopWatching } = require("./watcher");

const WATCHER_PAIR_PROTOCOL = "aoe2hd-watcher";

let mainWindow = null;
let watcherHandle = null;
let watcherSession = 0;
let rendererReady = false;
let pendingPairingUrl = null;

function getConfigPath() {
  return path.join(app.getPath("userData"), "watcher-config.json");
}

function getDefaultConfig() {
  return {
    watchDir: process.env.AOE2_WATCH_DIR || getDefaultReplayDir() || "",
    apiBaseUrl: process.env.AOE2_API_BASE_URL || "https://api-prodn.aoe2hdbets.com",
    apiFallbackBaseUrl: process.env.AOE2_API_FALLBACK_BASE_URL || "https://aoe2hdbets.com",
    uploadApiKey: process.env.AOE2_UPLOAD_API_KEY || "",
    autoStartWatching: true,
  };
}

function loadConfig() {
  const configPath = getConfigPath();
  const defaults = getDefaultConfig();

  try {
    if (!fs.existsSync(configPath)) {
      return defaults;
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...defaults,
      ...parsed,
    };
  } catch (error) {
    console.error("Failed to load watcher config:", error);
    return defaults;
  }
}

function saveConfig(config) {
  const configPath = getConfigPath();
  const merged = {
    ...getDefaultConfig(),
    ...config,
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf8");

  return merged;
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
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
    return "Confirm the replay folder and pair your profile key before starting.";
  }

  if (!config.watchDir) {
    return "Confirm the replay folder before starting.";
  }

  if (!config.uploadApiKey) {
    return "Pair this Mac from aoe2hdbets.com/profile, or paste your watcher key manually.";
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

  if (!quiet) {
    appendLog("Watcher is now idle.");
  }
}

function startCurrentWatcher(config, { preserveLog = false, startMessage = "Start Watching clicked." } = {}) {
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

  watcherHandle = startWatching(config, {
    onLog: (message, level = "info") => appendLog(message, level),
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

  sendToRenderer("watcher:config", savedConfig);
  appendLog("Paired this Watcher with your AoE2HDBets profile key.");

  const setupBlocker = getSetupBlocker(savedConfig);
  if (setupBlocker) {
    setWatchingState(false);
    appendLog(
      `${setupBlocker} The key is saved now, so pairing does not need to be repeated.`,
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
    width: 1040,
    height: 760,
    minWidth: 920,
    minHeight: 680,
    title: "AoE2HD Watcher",
    backgroundColor: "#08111f",
    autoHideMenuBar: true,
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
  registerPairingProtocol();
  createWindow();

  ipcMain.handle("watcher:get-config", async () => {
    return loadConfig();
  });

  ipcMain.handle("watcher:save-config", async (_event, config) => {
    const saved = saveConfig(config);
    appendLog("Settings saved locally.");
    return saved;
  });

  ipcMain.handle("watcher:start", async (_event, config) => {
    const saved = saveConfig(config);
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

  ipcMain.handle("watcher:get-default-replay-dir", async () => {
    return getDefaultReplayDir() || "";
  });

  const config = loadConfig();

  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    sendToRenderer("watcher:config", config);
    appendLog("UI loaded.");
    appendLog(
      `Initial config loaded: watchDir="${config.watchDir || ""}", apiBaseUrl="${config.apiBaseUrl || ""}", fallback="${config.apiFallbackBaseUrl || ""}", watcherKey=${
        config.uploadApiKey ? "present" : "missing"
      }`
    );

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
        `${setupBlocker} Future launches on this Mac can auto-start once both are saved.`,
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
