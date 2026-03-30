const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("watcherApi", {
  getConfig: () => ipcRenderer.invoke("watcher:get-config"),
  saveConfig: (config) => ipcRenderer.invoke("watcher:save-config", config),
  startWatching: (config) => ipcRenderer.invoke("watcher:start", config),
  stopWatching: () => ipcRenderer.invoke("watcher:stop"),
  openFolder: (targetPath) => ipcRenderer.invoke("watcher:open-folder", targetPath),
  getDefaultReplayDir: () => ipcRenderer.invoke("watcher:get-default-replay-dir"),
  onConfig: (callback) => {
    ipcRenderer.on("watcher:config", (_event, payload) => callback(payload));
  },
  onState: (callback) => {
    ipcRenderer.on("watcher:state", (_event, payload) => callback(payload));
  },
  onLog: (callback) => {
    ipcRenderer.on("watcher:log", (_event, payload) => callback(payload));
  },
  onClearLog: (callback) => {
    ipcRenderer.on("watcher:clear-log", () => callback());
  },
});