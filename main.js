require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const {
  getDefaultReplayDir,
  startWatching,
  stopWatching,
} = require("./watcher");

let mainWindow = null;
let watcherHandle = null;

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

function appendLog(message, level = "info") {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  sendToRenderer("watcher:log", { line, level });
}

function stopCurrentWatcher() {
  if (watcherHandle && typeof watcherHandle.close === "function") {
    try {
      watcherHandle.close();
    } catch (error) {
      console.error("Failed closing watcher:", error);
    }
  }

  watcherHandle = null;
  stopWatching();
  setWatchingState(false);
}

function startCurrentWatcher(config) {
  stopCurrentWatcher();

  watcherHandle = startWatching(config, {
    onLog: (message, level = "info") => appendLog(message, level),
  });

  const isWatching = Boolean(watcherHandle);
  setWatchingState(isWatching);

  return isWatching;
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

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("watcher:get-config", async () => {
    return loadConfig();
  });

  ipcMain.handle("watcher:save-config", async (_event, config) => {
    const saved = saveConfig(config);
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
      await shell.openPath(targetPath);
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
    sendToRenderer("watcher:config", config);

    if (config.autoStartWatching) {
      const started = startCurrentWatcher(config);
      if (!started) {
        appendLog("Watcher did not start. Check replay folder and settings.", "error");
      }
    } else {
      setWatchingState(false);
      appendLog("Watcher is idle. Press Start Watching when ready.", "info");
    }
  });
});

app.on("window-all-closed", () => {
  stopCurrentWatcher();
  app.quit();
});