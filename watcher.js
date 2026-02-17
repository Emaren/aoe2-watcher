const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

function getDefaultReplayDir() {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === "darwin") {
    return path.join(
      home,
      "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Age2HD/SaveGame"
    );
  }
  if (platform === "win32") {
    return path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame");
  }
  return path.join(
    home,
    ".wine/drive_c/Program Files (x86)/Microsoft Games/Age of Empires II HD/SaveGame"
  );
}

const API_BASE_URL = (process.env.AOE2_API_BASE_URL || "https://api-prodn.aoe2hdbets.com").replace(/\/$/, "");
const UPLOAD_URL = `${API_BASE_URL}/api/replay/upload`;
const WATCH_DIR = process.env.AOE2_WATCH_DIR || getDefaultReplayDir();
const WATCH_EXTENSIONS = new Set([".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"]);
const UPLOAD_API_KEY = process.env.AOE2_UPLOAD_API_KEY?.trim();
const WATCHER_UID =
  process.env.WATCHER_USER_UID ||
  `watcher-${crypto.createHash("sha1").update(os.hostname()).digest("hex").slice(0, 12)}`;
const lastSeen = new Map();

function shouldHandle(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!WATCH_EXTENSIONS.has(ext)) return false;
  if (filePath.includes("Out of Sync")) return false;

  const now = Date.now();
  const prev = lastSeen.get(filePath) || 0;
  if (now - prev < 5000) return false;
  lastSeen.set(filePath, now);
  return true;
}

async function uploadReplay(filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), path.basename(filePath));
  const headers = {
    ...form.getHeaders(),
    "x-user-uid": WATCHER_UID,
  };
  if (UPLOAD_API_KEY) {
    headers["x-api-key"] = UPLOAD_API_KEY;
  }

  const res = await axios.post(UPLOAD_URL, form, {
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    headers,
  });
  return res;
}

async function onFileDetected(filePath) {
  if (!shouldHandle(filePath)) return;

  console.log("Uploading replay:", filePath);
  try {
    const res = await uploadReplay(filePath);
    console.log(`Uploaded (${res.status}): ${path.basename(filePath)}`);
  } catch (err) {
    console.error(`Upload failed for ${path.basename(filePath)}:`, err.message);
    if (err.response) {
      console.error("Server response:", err.response.status, err.response.data);
    }
  }
}

function startWatching() {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`Replay directory does not exist: ${WATCH_DIR}`);
    return null;
  }

  console.log(`Watching directory: ${WATCH_DIR}`);
  console.log(`Upload endpoint: ${UPLOAD_URL}`);
  console.log(`Watcher UID: ${WATCHER_UID}`);

  const watcher = chokidar.watch(WATCH_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
  });

  watcher.on("add", onFileDetected);
  watcher.on("change", onFileDetected);
  watcher.on("error", (err) => console.error("Watcher error:", err.message));

  return watcher;
}

module.exports = {
  getDefaultReplayDir,
  startWatching,
};
