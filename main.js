const { app } = require("electron");
const { startWatching } = require("./watcher");

app.whenReady().then(() => {
  startWatching();
});

app.on("window-all-closed", () => {
  app.quit();
});
