const chokidar = require("chokidar");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const FormData = require("form-data");

function firstExistingPath(paths) {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return paths[0] || null;
}

function getDefaultReplayDir() {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === "darwin") {
    return firstExistingPath([
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Age2HD/SaveGame"
      ),
      path.join(
        home,
        "Library/Application Support/CrossOver/Bottles/Steam/drive_c/users/crossover/My Documents/My Games/Age of Empires 2 HD/SaveGame"
      ),
      path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
      path.join(home, "Documents", "My Games", "Age of Empires 2 DE", "SaveGame"),
    ]);
  }
  if (platform === "win32") {
    return firstExistingPath([
      path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
      path.join(home, "Documents", "My Games", "Age of Empires 2 DE", "SaveGame"),
    ]);
  }
  return firstExistingPath([
    path.join(
      home,
      ".wine/drive_c/Program Files (x86)/Microsoft Games/Age of Empires II HD/SaveGame"
    ),
    path.join(home, ".wine/drive_c/users", os.userInfo().username, "My Documents/My Games/Age of Empires 2 HD/SaveGame"),
    path.join(home, "Documents", "My Games", "Age of Empires 2 HD", "SaveGame"),
  ]);
}

const API_BASE_URL = (process.env.AOE2_API_BASE_URL || "https://api-prodn.aoe2hdbets.com").replace(/\/$/, "");
const UPLOAD_URL = `${API_BASE_URL}/api/replay/upload`;
const WATCH_DIR = process.env.AOE2_WATCH_DIR || getDefaultReplayDir();
const WATCH_EXTENSIONS = new Set([".aoe2record", ".aoe2mpgame", ".mgz", ".mgx", ".mgl"]);
const UPLOAD_API_KEY = process.env.AOE2_UPLOAD_API_KEY?.trim();
const MAX_UPLOAD_RETRIES = Number(process.env.AOE2_UPLOAD_RETRY_ATTEMPTS || 4);
const RETRY_BASE_DELAY_MS = Number(process.env.AOE2_UPLOAD_RETRY_BASE_DELAY_MS || 4000);
const STABLE_CHECK_INTERVAL_MS = Number(process.env.AOE2_UPLOAD_STABLE_CHECK_INTERVAL_MS || 3000);
const STABLE_CHECK_PASSES = Number(process.env.AOE2_UPLOAD_STABLE_CHECK_PASSES || 3);
const QUIET_PERIOD_MS = Number(process.env.AOE2_UPLOAD_QUIET_PERIOD_MS || 30000);
const WATCHER_UID =
  process.env.WATCHER_USER_UID ||
  `watcher-${crypto.createHash("sha1").update(os.hostname()).digest("hex").slice(0, 12)}`;
const uploadState = new Map();

function getRetryDelayMs(attempt) {
  return Math.min(RETRY_BASE_DELAY_MS * Math.max(1, 2 ** Math.max(0, attempt - 1)), 30000);
}

async function getFileFingerprint(filePath) {
  const stats = await fs.promises.stat(filePath);
  return `${stats.size}:${Math.floor(stats.mtimeMs)}`;
}

function getStateEntry(filePath) {
  let entry = uploadState.get(filePath);
  if (!entry) {
    entry = {
      fingerprint: null,
      processing: false,
      attempts: 0,
      retryTimer: null,
      uploadedFingerprint: null,
      pendingRescan: false,
      pendingFingerprint: null,
    };
    uploadState.set(filePath, entry);
  }
  return entry;
}

function clearRetryTimer(entry) {
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
}

function formatResponseBody(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data.message === "string") return data.message;
  if (typeof data.detail === "string") return data.detail;

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function shouldHandle(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!WATCH_EXTENSIONS.has(ext)) return false;
  if (filePath.includes("Out of Sync")) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStableFingerprint(filePath, startingFingerprint = null) {
  let stats = await fs.promises.stat(filePath);
  let fingerprint =
    startingFingerprint || `${stats.size}:${Math.floor(stats.mtimeMs)}`;
  let stablePasses = 1;
  let observedChanges = 0;

  while (true) {
    const quietForMs = Date.now() - stats.mtimeMs;
    if (stablePasses >= STABLE_CHECK_PASSES && quietForMs >= QUIET_PERIOD_MS) {
      return fingerprint;
    }

    const waitMs = Math.max(
      STABLE_CHECK_INTERVAL_MS,
      Math.min(QUIET_PERIOD_MS - quietForMs, QUIET_PERIOD_MS)
    );
    await sleep(waitMs);
    stats = await fs.promises.stat(filePath);
    const nextFingerprint = `${stats.size}:${Math.floor(stats.mtimeMs)}`;

    if (nextFingerprint === fingerprint) {
      stablePasses += 1;
      continue;
    }

    fingerprint = nextFingerprint;
    stablePasses = 1;
    observedChanges += 1;

    if (observedChanges === 1) {
      console.log(
        `Replay is still changing on disk: ${path.basename(filePath)}. Waiting for it to stabilize before upload.`
      );
    }
  }

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

function isRetryableUploadError(error) {
  const status = error?.response?.status;
  const detail = formatResponseBody(error?.response?.data).toLowerCase();

  if (!error?.response) {
    return true;
  }

  if (status === 422 && detail.includes("failed to parse replay file")) {
    return true;
  }

  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function scheduleRetry(filePath, entry, fingerprint, reason) {
  if (entry.attempts >= MAX_UPLOAD_RETRIES) {
    console.error(
      `Giving up on ${path.basename(filePath)} after ${entry.attempts} failed attempts. Last reason: ${reason}`
    );
    return;
  }

  clearRetryTimer(entry);
  const nextAttempt = entry.attempts + 1;
  const delayMs = getRetryDelayMs(nextAttempt);

  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    void processReplayFile(filePath, { fingerprint, attempt: nextAttempt });
  }, delayMs);

  console.warn(
    `Retrying ${path.basename(filePath)} in ${Math.round(delayMs / 1000)}s (attempt ${nextAttempt}/${MAX_UPLOAD_RETRIES}) because ${reason}`
  );
}

async function processReplayFile(filePath, options = {}) {
  if (!shouldHandle(filePath)) return;

  const entry = getStateEntry(filePath);
  let fingerprint = options.fingerprint || null;

  if (entry.processing) {
    entry.pendingRescan = true;
    if (fingerprint) {
      entry.pendingFingerprint = fingerprint;
    }
    return;
  }

  entry.processing = true;

  try {
    fingerprint = fingerprint || (await getFileFingerprint(filePath));
  } catch (err) {
    console.error(`Unable to inspect ${path.basename(filePath)}:`, err.message);
    entry.processing = false;
    return;
  }

  if (entry.uploadedFingerprint === fingerprint) {
    entry.processing = false;
    return;
  }

  clearRetryTimer(entry);
  entry.pendingRescan = false;
  entry.pendingFingerprint = null;

  try {
    fingerprint = await waitForStableFingerprint(filePath, fingerprint);
  } catch (err) {
    console.error(`Unable to wait for ${path.basename(filePath)} to stabilize:`, err.message);
    entry.processing = false;
    return;
  }

  if (entry.uploadedFingerprint === fingerprint) {
    entry.processing = false;
    return;
  }

  entry.fingerprint = fingerprint;
  entry.attempts = Number.isFinite(options.attempt) ? options.attempt : 0;

  console.log(
    `Uploading replay: ${filePath}${entry.attempts > 0 ? ` (retry ${entry.attempts}/${MAX_UPLOAD_RETRIES})` : ""}`
  );

  try {
    const res = await uploadReplay(filePath);
    const detail = formatResponseBody(res.data);
    entry.uploadedFingerprint = fingerprint;
    entry.attempts = 0;
    entry.fingerprint = fingerprint;
    console.log(
      `Uploaded (${res.status}): ${path.basename(filePath)}${detail ? ` - ${detail}` : ""}`
    );
  } catch (err) {
    const responseDetail = formatResponseBody(err?.response?.data);
    console.error(`Upload failed for ${path.basename(filePath)}:`, err.message);
    if (err.response) {
      console.error("Server response:", err.response.status, err.response.data);
    }

    if (isRetryableUploadError(err)) {
      scheduleRetry(filePath, entry, fingerprint, responseDetail || err.message);
    } else {
      entry.attempts = 0;
    }
  } finally {
    entry.processing = false;
    if (!entry.retryTimer && entry.pendingRescan) {
      const pendingFingerprint = entry.pendingFingerprint;
      entry.pendingRescan = false;
      entry.pendingFingerprint = null;
      void processReplayFile(filePath, { fingerprint: pendingFingerprint });
    }
  }
}

async function onFileDetected(filePath) {
  await processReplayFile(filePath);
}

function startWatching() {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`Replay directory does not exist: ${WATCH_DIR}`);
    console.error("Set AOE2_WATCH_DIR in .env to your SaveGame folder and restart.");
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
  getRetryDelayMs,
  isRetryableUploadError,
  processReplayFile,
  startWatching,
};
