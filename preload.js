const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("watcherApi", {
  getConfig: () => ipcRenderer.invoke("watcher:get-config"),
  getAppInfo: () => ipcRenderer.invoke("watcher:get-app-info"),
  saveConfig: (config) => ipcRenderer.invoke("watcher:save-config", config),
  startWatching: (config) => ipcRenderer.invoke("watcher:start", config),
  stopWatching: () => ipcRenderer.invoke("watcher:stop"),
  openFolder: (targetPath) => ipcRenderer.invoke("watcher:open-folder", targetPath),
  chooseReplayDir: () => ipcRenderer.invoke("watcher:choose-replay-dir"),
  validateWatchDir: (targetPath) => ipcRenderer.invoke("watcher:validate-watch-dir", targetPath),
  getDefaultReplayDir: () => ipcRenderer.invoke("watcher:get-default-replay-dir"),
  startImport: () => ipcRenderer.invoke("watcher:start-import"),
  retryImport: () => ipcRenderer.invoke("watcher:retry-import"),
  copyText: (value) => ipcRenderer.invoke("watcher:copy-text", value),
  onConfig: (callback) => {
    ipcRenderer.on("watcher:config", (_event, payload) => callback(payload));
  },
  onAppInfo: (callback) => {
    ipcRenderer.on("watcher:app-info", (_event, payload) => callback(payload));
  },
  onState: (callback) => {
    ipcRenderer.on("watcher:state", (_event, payload) => callback(payload));
  },
  onRuntimeEvent: (callback) => {
    ipcRenderer.on("watcher:runtime-event", (_event, payload) => callback(payload));
  },
  onImportState: (callback) => {
    ipcRenderer.on("watcher:import-state", (_event, payload) => callback(payload));
  },
  onLog: (callback) => {
    ipcRenderer.on("watcher:log", (_event, payload) => callback(payload));
  },
  onClearLog: (callback) => {
    ipcRenderer.on("watcher:clear-log", () => callback());
  },
});
